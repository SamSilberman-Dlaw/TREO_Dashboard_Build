public without sharing class SeniorDashboardController {

    private static final Set<String> CRITICAL_TYPES = new Set<String>{
        'SOL', 'Trial', 'Class Cert - Hearing', 'Discovery Cutoff',
        'Opposition to MSJ', 'PMK depo', 'client deposition',
        'Motion Deadline', 'Motion for Summary Judgment Hearing',
        'Discovery Deadline', 'Federal - Hearing', 'Federal - Trial'
    };

    private static final Set<String> TEAM_GROUP_NAMES = new Set<String>{
        'Team Roman', 'Team Natalie', 'Team Enoch', 'Team DK', 'Team Arsine',
        'Team Alvin', 'Team Adam'
    };

    @AuraEnabled
    public static Map<String, Object> getDashboardData() {
        try {
            Id   userId    = UserInfo.getUserId();
            Date today     = Date.today();
            Date weekStart = today.toStartOfWeek();
            Date in14Days  = today.addDays(14);
            Date in360Days = today.addDays(360);

            /* ── 1. My matters (Senior Attorney) ── */
            List<NEOS_Matter__c> matters = [
                SELECT Id, Name, CourtJurisdiction__c, RecordType.Name,
                       Associate_Attorney__c, Associate_Attorney__r.Name,
                       Associate_Attorney__r.FirstName,
                       LSS_Paralegal__c, LSS_Paralegal__r.Name,
                       LSS_Paralegal__r.FirstName
                FROM NEOS_Matter__c
                WHERE Senior_Attorney__c = :userId
                ORDER BY Name ASC
                LIMIT 200
            ];

            Set<Id> matterIds = new Set<Id>();
            for (NEOS_Matter__c m : matters) {
                matterIds.add(m.Id);
            }

            /* ── 2. Last time entry date per matter ── */
            Map<Id, Date> lastEntryDate = new Map<Id, Date>();
            if (!matterIds.isEmpty()) {
                for (AggregateResult ar : [
                    SELECT NEOS_Matter__c mid, MAX(Entry_Date__c) lastDate
                    FROM Time_Entry__c
                    WHERE NEOS_Matter__c IN :matterIds
                    GROUP BY NEOS_Matter__c
                ]) {
                    lastEntryDate.put((Id) ar.get('mid'), (Date) ar.get('lastDate'));
                }
            }

            /* ── 3. Open + overdue task counts per matter ── */
            Map<Id, Integer> openTasksByMatter    = new Map<Id, Integer>();
            Map<Id, Integer> overdueTasksByMatter = new Map<Id, Integer>();
            if (!matterIds.isEmpty()) {
                for (AggregateResult ar : [
                    SELECT WhatId mid, COUNT(Id) cnt
                    FROM Task
                    WHERE WhatId IN :matterIds AND IsClosed = false
                    GROUP BY WhatId
                ]) {
                    openTasksByMatter.put((Id) ar.get('mid'), (Integer) ar.get('cnt'));
                }
                for (AggregateResult ar : [
                    SELECT WhatId mid, COUNT(Id) cnt
                    FROM Task
                    WHERE WhatId IN :matterIds AND IsClosed = false AND ActivityDate < TODAY
                    GROUP BY WhatId
                ]) {
                    overdueTasksByMatter.put((Id) ar.get('mid'), (Integer) ar.get('cnt'));
                }
            }

            /* ── 4. Next critical deadline per matter ── */
            Map<Id, Map<String, Object>> nextDeadlineByMatter = new Map<Id, Map<String, Object>>();
            if (!matterIds.isEmpty()) {
                try {
                    String typeList = '(\'' + String.join(new List<String>(CRITICAL_TYPES), '\',\'') + '\')';
                    String dlSoql   = 'SELECT Matter__c, Event_Type__c, Start_DateTime__c'
                        + ' FROM Calendar_Event__c'
                        + ' WHERE Matter__c IN :matterIds'
                        + '   AND Status__c = \'Active\''
                        + '   AND DAY_ONLY(Start_DateTime__c) >= TODAY'
                        + '   AND DAY_ONLY(Start_DateTime__c) <= :in360Days'
                        + '   AND Event_Type__c IN ' + typeList
                        + ' ORDER BY Start_DateTime__c ASC LIMIT 500';
                    for (SObject ev : Database.query(dlSoql)) {
                        Id mid = (Id) ev.get('Matter__c');
                        if (!nextDeadlineByMatter.containsKey(mid)) {
                            Datetime dt      = (Datetime) ev.get('Start_DateTime__c');
                            Date     evDate  = dt != null ? dt.dateGmt() : today;
                            Integer  days    = today.daysBetween(evDate);
                            nextDeadlineByMatter.put(mid, new Map<String, Object>{
                                'eventType' => (String) ev.get('Event_Type__c'),
                                'startDate' => dt != null ? dt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'') : '',
                                'daysAway'  => days
                            });
                        }
                    }
                } catch (Exception ignored) {}
            }

            /* ── 5. Build matter health rows ── */
            Integer upcomingDeadlineCount = 0;
            List<Map<String, Object>> matterHealth = new List<Map<String, Object>>();
            for (NEOS_Matter__c m : matters) {
                Date    lastEntry    = lastEntryDate.get(m.Id);
                Integer openTasks   = openTasksByMatter.get(m.Id)   != null ? openTasksByMatter.get(m.Id)   : 0;
                Integer overdueTasks= overdueTasksByMatter.get(m.Id) != null ? overdueTasksByMatter.get(m.Id) : 0;
                Map<String, Object> dl = nextDeadlineByMatter.get(m.Id);

                Integer daysAway = dl != null ? (Integer) dl.get('daysAway') : null;
                if (daysAway != null && daysAway <= 14) upcomingDeadlineCount++;

                Boolean noEntryThisWeek = (lastEntry == null || lastEntry < weekStart);
                Boolean deadlineSoon    = (daysAway != null && daysAway <= 7);
                Boolean deadlineCaution = (daysAway != null && daysAway <= 14);
                String  status;
                if (overdueTasks > 0 || deadlineSoon || noEntryThisWeek) {
                    status = 'atrisk';
                } else if (openTasks > 0 || deadlineCaution) {
                    status = 'caution';
                } else {
                    status = 'ontrack';
                }

                String assocName = m.Associate_Attorney__r != null ? m.Associate_Attorney__r.Name : '';
                String lssName   = m.LSS_Paralegal__r      != null ? m.LSS_Paralegal__r.Name      : '';

                matterHealth.add(new Map<String, Object>{
                    'id'             => m.Id,
                    'name'           => m.Name,
                    'jurisdiction'   => m.CourtJurisdiction__c != null ? m.CourtJurisdiction__c : '',
                    'recordType'     => m.RecordType != null ? m.RecordType.Name : '',
                    'associateName'  => assocName,
                    'lssName'        => lssName,
                    'lastEntryDate'  => lastEntry != null ? String.valueOf(lastEntry) : '',
                    'noEntryThisWeek'=> noEntryThisWeek,
                    'openTasks'      => openTasks,
                    'overdueTasks'   => overdueTasks,
                    'nextDeadline'   => dl,
                    'status'         => status
                });
            }

            /* ── 6. Find my team via public group ── */
            String teamGroupName  = '';
            Set<Id> teamMemberIds = new Set<Id>();

            List<GroupMember> myGroupMembership = [
                SELECT GroupId, Group.Name FROM GroupMember
                WHERE UserOrGroupId = :userId
                  AND Group.Type = 'Regular'
                  AND Group.Name IN :TEAM_GROUP_NAMES
                LIMIT 1
            ];
            if (!myGroupMembership.isEmpty()) {
                teamGroupName   = myGroupMembership[0].Group.Name;
                Id groupId      = myGroupMembership[0].GroupId;
                for (GroupMember gm : [
                    SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :groupId
                ]) {
                    if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                        teamMemberIds.add(gm.UserOrGroupId);
                    }
                }
            }

            /* ── 7. Team member details from User ── */
            Map<Id, User> teamUsers = new Map<Id, User>();
            if (!teamMemberIds.isEmpty()) {
                for (User u : [
                    SELECT Id, Name, FirstName, Title, UserRole.Name
                    FROM User
                    WHERE Id IN :teamMemberIds AND IsActive = true
                    ORDER BY Name ASC
                ]) {
                    teamUsers.put(u.Id, u);
                }
            }

            /* ── 8. Hours + tasks per team member ── */
            Map<Id, Decimal> hoursToday    = new Map<Id, Decimal>();
            Map<Id, Decimal> hoursWeek     = new Map<Id, Decimal>();
            Map<Id, Integer> overdueByUser = new Map<Id, Integer>();

            if (!teamMemberIds.isEmpty()) {
                for (AggregateResult ar : [
                    SELECT Staff__c uid, SUM(Submit_Hours__c) hrs
                    FROM Time_Entry__c
                    WHERE Staff__c IN :teamMemberIds AND Entry_Date__c = TODAY
                    GROUP BY Staff__c
                ]) {
                    hoursToday.put((Id) ar.get('uid'), (Decimal) ar.get('hrs'));
                }
                for (AggregateResult ar : [
                    SELECT Staff__c uid, SUM(Submit_Hours__c) hrs
                    FROM Time_Entry__c
                    WHERE Staff__c IN :teamMemberIds
                      AND Entry_Date__c >= :weekStart AND Entry_Date__c <= :today
                    GROUP BY Staff__c
                ]) {
                    hoursWeek.put((Id) ar.get('uid'), (Decimal) ar.get('hrs'));
                }
                for (AggregateResult ar : [
                    SELECT OwnerId uid, COUNT(Id) cnt
                    FROM Task
                    WHERE OwnerId IN :teamMemberIds AND IsClosed = false
                      AND What.Type = 'NEOS_Matter__c' AND ActivityDate < TODAY
                    GROUP BY OwnerId
                ]) {
                    overdueByUser.put((Id) ar.get('uid'), (Integer) ar.get('cnt'));
                }
            }

            /* ── 9. Build teamStats ── */
            Decimal DAILY_GOAL = 8.0;
            Integer behindCount = 0;
            List<Map<String, Object>> teamStats = new List<Map<String, Object>>();
            for (User u : teamUsers.values()) {
                Id      uid          = u.Id;
                Decimal todayHrs     = hoursToday.get(uid) != null ? hoursToday.get(uid) : 0;
                Decimal weekHrs      = hoursWeek.get(uid)  != null ? hoursWeek.get(uid)  : 0;
                Integer overdueTasks = overdueByUser.get(uid) != null ? overdueByUser.get(uid) : 0;
                String  role         = String.isNotBlank(u.Title) ? u.Title
                                     : (u.UserRole != null ? u.UserRole.Name : '');
                if (todayHrs < DAILY_GOAL) behindCount++;
                teamStats.add(new Map<String, Object>{
                    'id'           => uid,
                    'name'         => u.Name,
                    'firstName'    => u.FirstName != null ? u.FirstName : u.Name,
                    'role'         => role,
                    'hoursToday'   => todayHrs,
                    'hoursWeek'    => weekHrs,
                    'overdueTasks' => overdueTasks,
                    'atGoal'       => todayHrs >= DAILY_GOAL
                });
            }
            teamStats.sort(new TeamStatSorter());

            /* ── 10. My own hours ── */
            Decimal myHoursToday = 0;
            Decimal myHoursWeek  = 0;
            for (AggregateResult ar : [
                SELECT SUM(Submit_Hours__c) hrs FROM Time_Entry__c
                WHERE Staff__c = :userId AND Entry_Date__c = TODAY
            ]) { if (ar.get('hrs') != null) myHoursToday = (Decimal) ar.get('hrs'); }
            for (AggregateResult ar : [
                SELECT SUM(Submit_Hours__c) hrs FROM Time_Entry__c
                WHERE Staff__c = :userId AND Entry_Date__c >= :weekStart AND Entry_Date__c <= :today
            ]) { if (ar.get('hrs') != null) myHoursWeek = (Decimal) ar.get('hrs'); }

            Map<String, Object> result = new Map<String, Object>();
            result.put('matterHealth',          matterHealth);
            result.put('teamStats',             teamStats);
            result.put('teamGroupName',         teamGroupName);
            result.put('matterCount',           matters.size());
            result.put('upcomingDeadlineCount', upcomingDeadlineCount);
            result.put('behindCount',           behindCount);
            result.put('teamMemberCount',       teamUsers.size());
            result.put('myHoursToday',          myHoursToday);
            result.put('myHoursWeek',           myHoursWeek);
            result.put('firstName',             UserInfo.getFirstName());
            result.put('currentUserId',         userId);
            return result;

        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }

    private class TeamStatSorter implements Comparator<Object> {
        public Integer compare(Object a, Object b) {
            Map<String, Object> ma = (Map<String, Object>) a;
            Map<String, Object> mb = (Map<String, Object>) b;
            Boolean aAtGoal = (Boolean) ma.get('atGoal');
            Boolean bAtGoal = (Boolean) mb.get('atGoal');
            if (aAtGoal != bAtGoal) return aAtGoal ? 1 : -1;
            return String.valueOf(ma.get('name')).compareTo(String.valueOf(mb.get('name')));
        }
    }
}
