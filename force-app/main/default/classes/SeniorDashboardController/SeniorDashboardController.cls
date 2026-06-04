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

    private static final List<String> STAGE_ORDER = new List<String>{
        'Signed/Unfiled', 'Filed', 'Service', 'Discovery', 'Pre-Trial',
        'Trial Prep', 'Trial', 'Settlement', 'Post-Trial', 'Appeal'
    };

    private static final Set<String> CLOSED_STAGES = new Set<String>{
        'File Closed', 'Closed', 'Dismissed', 'Archived'
    };

    @AuraEnabled
    public static List<Map<String, Object>> getTeamList() {
        if (!FeatureManagement.checkPermission('View_Executive_Dashboard')) {
            throw new AuraHandledException('Insufficient permissions to view team list');
        }
        List<Map<String, Object>> teams = new List<Map<String, Object>>();
        for (Group g : [
            SELECT Id, Name FROM Group
            WHERE Name IN :TEAM_GROUP_NAMES AND Type = 'Regular'
            ORDER BY Name ASC
        ]) {
            String displayName = g.Name.startsWith('Team ') ? g.Name.substring(5) : g.Name;
            teams.add(new Map<String, Object>{
                'groupName'   => g.Name,
                'displayName' => displayName
            });
        }
        return teams;
    }

    @AuraEnabled
    public static Map<String, Object> getDashboardData(String viewAsGroupName) {
        if (String.isNotBlank(viewAsGroupName) &&
            !FeatureManagement.checkPermission('View_Executive_Dashboard')) {
            throw new AuraHandledException('Insufficient permissions to view other team dashboards');
        }
        try {
            Id   userId    = UserInfo.getUserId();
            Date today     = Date.today();
            Date weekStart = today.toStartOfWeek();
            Date in14Days  = today.addDays(14);
            Date in360Days = today.addDays(360);

            /* ── 1. Find team via public group ── */
            String teamGroupName  = '';
            Set<Id> teamMemberIds = new Set<Id>();

            if (String.isNotBlank(viewAsGroupName)) {
                /* Exec view: look up group directly by name */
                List<Group> execGroups = [
                    SELECT Id, Name FROM Group
                    WHERE Name = :viewAsGroupName AND Type = 'Regular' LIMIT 1
                ];
                if (!execGroups.isEmpty()) {
                    teamGroupName = execGroups[0].Name;
                    for (GroupMember gm : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :execGroups[0].Id]) {
                        if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                            teamMemberIds.add(gm.UserOrGroupId);
                        }
                    }
                }
            } else {
                /* Normal: find current user's team group */
                List<GroupMember> myGroupMembership = [
                    SELECT GroupId, Group.Name FROM GroupMember
                    WHERE UserOrGroupId = :userId
                      AND Group.Type = 'Regular'
                      AND Group.Name IN :TEAM_GROUP_NAMES
                    LIMIT 1
                ];
                if (!myGroupMembership.isEmpty()) {
                    teamGroupName = myGroupMembership[0].Group.Name;
                    Id groupId    = myGroupMembership[0].GroupId;
                    for (GroupMember gm : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :groupId]) {
                        if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                            teamMemberIds.add(gm.UserOrGroupId);
                        }
                    }
                }
            }

            /* ── 2. Team member details ── */
            Map<Id, User> teamUsers     = new Map<Id, User>();
            List<User>    teamUsersList = new List<User>();
            if (!teamMemberIds.isEmpty()) {
                for (User u : [
                    SELECT Id, Name, FirstName, Title, UserRole.Name
                    FROM User
                    WHERE Id IN :teamMemberIds AND IsActive = true
                    ORDER BY Name ASC
                ]) {
                    teamUsers.put(u.Id, u);
                    teamUsersList.add(u);
                }
            }

            /* ── 3. Team matters ── */
            List<NEOS_Matter__c> matters = teamMemberIds.isEmpty()
                ? new List<NEOS_Matter__c>()
                : [
                    SELECT Id, Name, CourtJurisdiction__c, RecordType.Name,
                           Senior_Attorney__c, Senior_Attorney__r.Name,
                           Associate_Attorney__c, Associate_Attorney__r.Name,
                           Associate_Attorney__r.FirstName,
                           LSS_Paralegal__c, LSS_Paralegal__r.Name,
                           LSS_Paralegal__r.FirstName
                    FROM NEOS_Matter__c
                    WHERE (Senior_Attorney__c   IN :teamMemberIds
                        OR Associate_Attorney__c IN :teamMemberIds
                        OR LSS_Paralegal__c       IN :teamMemberIds)
                      AND (Stage__c = null OR Stage__c NOT IN :CLOSED_STAGES)
                    ORDER BY Name ASC
                    LIMIT 500
                ];

            Set<Id> matterIds = new Set<Id>();
            for (NEOS_Matter__c m : matters) {
                matterIds.add(m.Id);
            }

            /* ── 4. Last time entry date per matter ── */
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

            /* ── 5. Open + overdue task counts per matter ── */
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

                Boolean noRecentEntry   = (lastEntry == null || lastEntry < today.addDays(-30));
                Boolean deadlineSoon    = (daysAway != null && daysAway <= 7);
                Boolean deadlineCaution = (daysAway != null && daysAway <= 14);
                String  status = (overdueTasks > 0 || deadlineSoon || noRecentEntry
                                  || openTasks > 0 || deadlineCaution)
                                 ? 'atrisk' : 'ontrack';

                String seniorName = m.Senior_Attorney__r    != null ? m.Senior_Attorney__r.Name    : '';
                String assocName  = m.Associate_Attorney__r != null ? m.Associate_Attorney__r.Name : '';
                String lssName    = m.LSS_Paralegal__r      != null ? m.LSS_Paralegal__r.Name      : '';

                matterHealth.add(new Map<String, Object>{
                    'id'                  => m.Id,
                    'name'                => m.Name,
                    'jurisdiction'        => m.CourtJurisdiction__c != null ? m.CourtJurisdiction__c : '',
                    'recordType'          => m.RecordType != null ? m.RecordType.Name : '',
                    'seniorAttorneyName'  => seniorName,
                    'associateName'       => assocName,
                    'lssName'             => lssName,
                    'lastEntryDate'  => lastEntry != null ? String.valueOf(lastEntry) : '',
                    'noRecentEntry'  => noRecentEntry,
                    'openTasks'      => openTasks,
                    'overdueTasks'   => overdueTasks,
                    'nextDeadline'   => dl,
                    'status'         => status
                });
            }

            /* ── 6. Hours + tasks per team member ── */
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

            /* ── 7. Build teamStats ── */
            Integer behindCount = 0;
            List<Map<String, Object>> teamStats = new List<Map<String, Object>>();
            for (User u : teamUsersList) {
                Id      uid          = u.Id;
                Decimal todayHrs     = hoursToday.get(uid) != null ? hoursToday.get(uid) : 0;
                Decimal weekHrs      = hoursWeek.get(uid)  != null ? hoursWeek.get(uid)  : 0;
                Integer overdueTasks = overdueByUser.get(uid) != null ? overdueByUser.get(uid) : 0;
                String  role         = String.isNotBlank(u.Title) ? u.Title
                                     : (u.UserRole != null ? u.UserRole.Name : '');
                if (todayHrs == 0) behindCount++;
                teamStats.add(new Map<String, Object>{
                    'id'           => uid,
                    'name'         => u.Name,
                    'firstName'    => u.FirstName != null ? u.FirstName : u.Name,
                    'role'         => role,
                    'hoursToday'   => todayHrs,
                    'hoursWeek'    => weekHrs,
                    'overdueTasks' => overdueTasks,
                    'atGoal'       => todayHrs > 0
                });
            }
            teamStats.sort(new TeamStatSorter());

            Decimal teamHoursToday = 0;
            Decimal teamHoursWeek  = 0;
            for (Decimal h : hoursToday.values()) teamHoursToday += h;
            for (Decimal h : hoursWeek.values())  teamHoursWeek  += h;

            /* ── 8b. Team matters by stage (manager chart) ── */
            Map<Id, Map<String, List<Map<String, Object>>>> memberStageMap =
                new Map<Id, Map<String, List<Map<String, Object>>>>();
            Set<String> stagesPresent = new Set<String>();

            if (!teamMemberIds.isEmpty()) {
                for (NEOS_Matter__c m : [
                    SELECT Id, Name, Stage__c, CourtJurisdiction__c, RecordType.Name,
                           Senior_Attorney__c, Associate_Attorney__c, LSS_Paralegal__c
                    FROM NEOS_Matter__c
                    WHERE (Senior_Attorney__c IN :teamMemberIds
                        OR Associate_Attorney__c IN :teamMemberIds
                        OR LSS_Paralegal__c IN :teamMemberIds)
                      AND Stage__c != null
                      AND Stage__c NOT IN :CLOSED_STAGES
                    ORDER BY Name ASC
                    LIMIT 1000
                ]) {
                    String stage = m.Stage__c;
                    stagesPresent.add(stage);
                    Map<String, Object> mInfo = new Map<String, Object>{
                        'id'           => m.Id,
                        'name'         => m.Name,
                        'jurisdiction' => m.CourtJurisdiction__c != null ? m.CourtJurisdiction__c : '',
                        'recordType'   => m.RecordType != null ? m.RecordType.Name : ''
                    };
                    Set<Id> assigned = new Set<Id>();
                    if (m.Senior_Attorney__c    != null && teamMemberIds.contains(m.Senior_Attorney__c))    assigned.add(m.Senior_Attorney__c);
                    if (m.Associate_Attorney__c != null && teamMemberIds.contains(m.Associate_Attorney__c)) assigned.add(m.Associate_Attorney__c);
                    if (m.LSS_Paralegal__c      != null && teamMemberIds.contains(m.LSS_Paralegal__c))      assigned.add(m.LSS_Paralegal__c);
                    for (Id uid : assigned) {
                        if (!memberStageMap.containsKey(uid)) memberStageMap.put(uid, new Map<String, List<Map<String, Object>>>());
                        Map<String, List<Map<String, Object>>> sMap = memberStageMap.get(uid);
                        if (!sMap.containsKey(stage)) sMap.put(stage, new List<Map<String, Object>>());
                        sMap.get(stage).add(mInfo);
                    }
                }
            }

            List<String> chartStageOrder = new List<String>();
            Set<String>  csSet           = new Set<String>();
            for (String s : STAGE_ORDER) {
                if (stagesPresent.contains(s)) { chartStageOrder.add(s); csSet.add(s); }
            }
            for (String s : stagesPresent) {
                if (!csSet.contains(s)) { chartStageOrder.add(s); csSet.add(s); }
            }

            List<Map<String, Object>> chartMembers = new List<Map<String, Object>>();
            for (User u : teamUsersList) {
                Map<String, List<Map<String, Object>>> sMap = memberStageMap.containsKey(u.Id)
                    ? memberStageMap.get(u.Id) : new Map<String, List<Map<String, Object>>>();
                List<Map<String, Object>> segments = new List<Map<String, Object>>();
                Integer chartTotal = 0;
                for (String stage : chartStageOrder) {
                    List<Map<String, Object>> sMatters = sMap.containsKey(stage) ? sMap.get(stage) : null;
                    if (sMatters != null && !sMatters.isEmpty()) {
                        chartTotal += sMatters.size();
                        segments.add(new Map<String, Object>{ 'stage' => stage, 'count' => sMatters.size(), 'matters' => sMatters });
                    }
                }
                String initials = '';
                if (String.isNotBlank(u.FirstName)) initials += u.FirstName.substring(0, 1);
                if (String.isNotBlank(u.Name)) {
                    List<String> parts = u.Name.split(' ');
                    if (parts.size() > 1) initials += parts[parts.size()-1].substring(0, 1);
                }
                chartMembers.add(new Map<String, Object>{
                    'id'        => u.Id,
                    'name'      => u.Name,
                    'firstName' => String.isNotBlank(u.FirstName) ? u.FirstName : u.Name,
                    'initials'  => initials.toUpperCase(),
                    'total'     => chartTotal,
                    'segments'  => segments
                });
            }

            Map<String, Object> result = new Map<String, Object>();
            result.put('matterHealth',          matterHealth);
            result.put('teamStats',             teamStats);
            result.put('teamGroupName',         teamGroupName);
            result.put('matterCount',           matters.size());
            result.put('upcomingDeadlineCount', upcomingDeadlineCount);
            result.put('behindCount',           behindCount);
            result.put('teamMemberCount',       teamUsers.size());
            result.put('teamHoursToday',        teamHoursToday);
            result.put('teamHoursWeek',         teamHoursWeek);
            result.put('firstName',             UserInfo.getFirstName());
            result.put('currentUserId',         userId);
            result.put('managerChart', new Map<String, Object>{
                'stageOrder' => chartStageOrder,
                'members'    => chartMembers
            });
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
