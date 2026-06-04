public without sharing class OperationsConsoleController {

    private static final Set<String> TEAM_GROUP_NAMES = new Set<String>{
        'Team Roman', 'Team Natalie', 'Team Enoch', 'Team DK', 'Team Arsine',
        'Team Alvin', 'Team Adam'
    };

    private static final Set<String> CRITICAL_TYPES = new Set<String>{
        'SOL', 'Trial', 'Class Cert - Hearing', 'Class Cert - Deadline',
        'Discovery Cutoff', 'Opposition to MSJ', 'PMK depo', 'client deposition',
        'Motion Deadline', 'Motion for Summary Judgment Hearing',
        'Discovery Deadline', 'Federal - Hearing', 'Federal - Trial'
    };

    @AuraEnabled
    public static Map<String, Object> getConsoleData(String targetUserId) {
        try {
            Id   userId     = UserInfo.getUserId();
            Date today      = Date.today();
            Date in360Days  = today.addDays(360);

            // Enforce permission when viewing another user's data
            Id viewUserId = userId;
            if (String.isNotBlank(targetUserId) && targetUserId != userId) {
                Boolean hasOther = FeatureManagement.checkPermission('View_Other_Dockets');
                Boolean hasTeam  = FeatureManagement.checkPermission('View_Team_Dockets');
                if (!hasOther && !hasTeam) {
                    throw new AuraHandledException('You do not have permission to view other users\' dockets.');
                }
                if (!hasOther && hasTeam) {
                    // Validate the target user is in the caller's team group
                    List<GroupMember> myGroup = [
                        SELECT GroupId FROM GroupMember
                        WHERE UserOrGroupId = :userId
                          AND Group.Type = 'Regular'
                          AND Group.Name IN :TEAM_GROUP_NAMES
                        LIMIT 1
                    ];
                    if (myGroup.isEmpty()) {
                        throw new AuraHandledException('You are not assigned to a team group.');
                    }
                    Integer inTeam = [
                        SELECT COUNT() FROM GroupMember
                        WHERE GroupId = :myGroup[0].GroupId
                          AND UserOrGroupId = :(Id) targetUserId
                    ];
                    if (inTeam == 0) {
                        throw new AuraHandledException('You can only view dockets of your team members.');
                    }
                }
                viewUserId = (Id) targetUserId;
            }

            /* ── Today's hours (viewed user) ── */
            Decimal todayHours = 0;
            for (AggregateResult ar : [
                SELECT SUM(Submit_Hours__c) hrs FROM Time_Entry__c
                WHERE Entry_Date__c = TODAY AND Staff__c = :viewUserId
            ]) {
                if (ar.get('hrs') != null) todayHours = (Decimal) ar.get('hrs');
            }

            /* ── This week's hours Sun–Sat (viewed user, matches SF THIS WEEK filter) ── */
            Date weekStart = today.toStartOfWeek(); // Sunday
            Date weekEnd   = weekStart.addDays(6);  // Saturday
            Decimal last7Hours = 0;
            List<Map<String, Object>> last7ByDate = new List<Map<String, Object>>();
            for (AggregateResult ar : [
                SELECT Entry_Date__c edate, SUM(Submit_Hours__c) hrs
                FROM Time_Entry__c
                WHERE Entry_Date__c >= :weekStart AND Entry_Date__c <= :weekEnd
                AND Staff__c = :viewUserId
                GROUP BY Entry_Date__c ORDER BY Entry_Date__c ASC
            ]) {
                Decimal hrs = ar.get('hrs') != null ? (Decimal) ar.get('hrs') : 0;
                last7Hours += hrs;
                last7ByDate.add(new Map<String, Object>{
                    'date'  => String.valueOf(ar.get('edate')),
                    'hours' => hrs
                });
            }

            /* ── Open task summary counts (viewed user) ── */
            Integer openTaskCount    = 0;
            Integer overdueTaskCount = 0;
            for (AggregateResult ar : [
                SELECT COUNT(Id) cnt FROM Task
                WHERE OwnerId = :viewUserId AND IsClosed = false AND What.Type = 'NEOS_Matter__c'
            ]) {
                openTaskCount = ar.get('cnt') != null ? (Integer) ar.get('cnt') : 0;
            }
            for (AggregateResult ar : [
                SELECT COUNT(Id) cnt FROM Task
                WHERE OwnerId = :viewUserId AND IsClosed = false AND What.Type = 'NEOS_Matter__c' AND ActivityDate < TODAY
            ]) {
                overdueTaskCount = ar.get('cnt') != null ? (Integer) ar.get('cnt') : 0;
            }

            /* ── Task list (viewed user): open, due within 360 days or overdue ── */
            List<Map<String, Object>> myTasks = new List<Map<String, Object>>();
            for (Task t : [
                SELECT Id, Subject, ActivityDate, Status, IsClosed,
                       WhatId, What.Name, Priority
                FROM Task
                WHERE OwnerId = :viewUserId
                  AND IsClosed = false
                  AND What.Type = 'NEOS_Matter__c'
                  AND (ActivityDate = null OR ActivityDate <= :in360Days)
                ORDER BY ActivityDate ASC NULLS LAST, CreatedDate ASC
                LIMIT 200
            ]) {
                myTasks.add(new Map<String, Object>{
                    'id'         => t.Id,
                    'subject'    => t.Subject,
                    'dueDate'    => t.ActivityDate != null ? String.valueOf(t.ActivityDate) : '',
                    'matterName' => t.What != null ? t.What.Name : '',
                    'matterId'   => t.WhatId != null ? String.valueOf(t.WhatId) : '',
                    'taskType'   => '',
                    'priority'   => t.Priority != null ? t.Priority : '',
                    'status'     => t.Status   != null ? t.Status   : ''
                });
            }

            /* ── Critical deadlines (next 9 months, scoped to viewed user's matters) ── */
            List<Map<String, Object>> criticalDeadlines = new List<Map<String, Object>>();
            try {
                String typeList = '(\'' + String.join(new List<String>(CRITICAL_TYPES), '\',\'') + '\')';
                String dlSoql = 'SELECT Id, Subject__c, Event_Type__c, Start_DateTime__c, End_DateTime__c,' +
                    ' Is_All_Day__c, Location__c, Description__c, Matter__c, Matter__r.Name,' +
                    ' (SELECT User__r.Name FROM Calendar_Attendees__r)' +
                    ' FROM Calendar_Event__c' +
                    ' WHERE Event_Type__c IN ' + typeList +
                    '   AND Status__c = \'Active\'' +
                    '   AND DAY_ONLY(Start_DateTime__c) >= TODAY' +
                    '   AND DAY_ONLY(Start_DateTime__c) <= :in360Days' +
                    '   AND (Matter__r.Senior_Attorney__c = :viewUserId' +
                    '     OR Matter__r.Associate_Attorney__c = :viewUserId' +
                    '     OR Matter__r.LSS_Paralegal__c = :viewUserId)' +
                    ' ORDER BY Start_DateTime__c ASC LIMIT 50';
                for (SObject dlRow : Database.query(dlSoql)) {
                    criticalDeadlines.add(buildDeadlineRow(dlRow, today));
                }
            } catch (Exception ignored) {}

            /* ── Events: Calendar_Event__c records where viewed user is an attendee ── */
            List<Map<String, Object>> myEvents = new List<Map<String, Object>>();
            try {
                myEvents = buildMyEvents(viewUserId, today, in360Days);
            } catch (Exception ignored) {}

            Integer criticalCount = criticalDeadlines.size();
            Integer daysToNext    = (criticalCount > 0 && criticalDeadlines[0].get('daysAway') != null)
                ? (Integer) criticalDeadlines[0].get('daysAway') : -1;

            // Resolve viewed user's display name when different from the running user
            String viewFirstName = UserInfo.getFirstName();
            String viewFullName  = UserInfo.getName();
            if (viewUserId != userId) {
                List<User> viewedUsers = [SELECT FirstName, Name FROM User WHERE Id = :viewUserId LIMIT 1];
                if (!viewedUsers.isEmpty()) {
                    viewFirstName = viewedUsers[0].FirstName;
                    viewFullName  = viewedUsers[0].Name;
                }
            }

            Map<String, Object> result = new Map<String, Object>();
            result.put('todayHours',        todayHours);
            result.put('last7Hours',        last7Hours);
            result.put('last7ByDate',       last7ByDate);
            result.put('openTaskCount',     openTaskCount);
            result.put('overdueTaskCount',  overdueTaskCount);
            result.put('criticalDeadlines', criticalDeadlines);
            result.put('criticalCount',     criticalCount);
            result.put('daysToNext',        daysToNext);
            result.put('myEvents',          myEvents);
            result.put('myTasks',           myTasks);
            result.put('currentUserId',     userId);          // always the running user
            result.put('currentUserName',   UserInfo.getName());
            result.put('firstName',         UserInfo.getFirstName());
            result.put('viewUserId',        String.valueOf(viewUserId));
            result.put('viewFirstName',     viewFirstName);
            result.put('viewFullName',      viewFullName);
            return result;
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }

    @AuraEnabled
    public static void completeTask(Id taskId) {
        try {
            update new Task(Id = taskId, Status = 'Completed');
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }

    /* ── Matter search: by matter name (SOSL), attorney name (SOSL→SOQL), jurisdiction (SOQL) ── */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> searchMatters(String query, Boolean myOnly, String targetUserId) {
        if (String.isBlank(query) || query.trim().length() < 2)
            return new List<Map<String, Object>>();

        String term = query.trim() + '*';
        String lk   = '%' + query.trim() + '%';
        Id     uid  = (String.isNotBlank(targetUserId) && myOnly == true)
                          ? (Id) targetUserId
                          : UserInfo.getUserId();
        Set<Id> matchedIds = new Set<Id>();

        // 1. Single SOSL: match matter names + user names simultaneously
        List<List<SObject>> found;
        if (myOnly == true) {
            found = [
                FIND :term IN NAME FIELDS
                RETURNING
                    NEOS_Matter__c(Id WHERE Senior_Attorney__c = :uid
                                       OR Associate_Attorney__c = :uid
                                       OR LSS_Paralegal__c      = :uid
                                   LIMIT 25),
                    User(Id WHERE IsActive = true LIMIT 25)
            ];
        } else {
            found = [
                FIND :term IN NAME FIELDS
                RETURNING
                    NEOS_Matter__c(Id LIMIT 50),
                    User(Id WHERE IsActive = true LIMIT 25)
            ];
        }
        for (SObject s : found[0]) matchedIds.add(s.Id);

        // 2. SOQL: matters assigned to any name-matching staff member
        Set<Id> staffIds = new Set<Id>();
        for (SObject u : found[1]) staffIds.add(u.Id);
        if (!staffIds.isEmpty()) {
            if (myOnly == true) {
                for (NEOS_Matter__c m : [
                    SELECT Id FROM NEOS_Matter__c
                    WHERE (Senior_Attorney__c IN :staffIds
                        OR Associate_Attorney__c IN :staffIds
                        OR LSS_Paralegal__c IN :staffIds)
                      AND (Senior_Attorney__c = :uid
                        OR Associate_Attorney__c = :uid
                        OR LSS_Paralegal__c = :uid)
                    LIMIT 50
                ]) matchedIds.add(m.Id);
            } else {
                for (NEOS_Matter__c m : [
                    SELECT Id FROM NEOS_Matter__c
                    WHERE Senior_Attorney__c IN :staffIds
                       OR Associate_Attorney__c IN :staffIds
                       OR LSS_Paralegal__c IN :staffIds
                    LIMIT 50
                ]) matchedIds.add(m.Id);
            }
        }

        // 3. SOQL: jurisdiction LIKE match
        if (myOnly == true) {
            for (NEOS_Matter__c m : [
                SELECT Id FROM NEOS_Matter__c
                WHERE CourtJurisdiction__c LIKE :lk
                  AND (Senior_Attorney__c = :uid
                    OR Associate_Attorney__c = :uid
                    OR LSS_Paralegal__c = :uid)
                LIMIT 50
            ]) matchedIds.add(m.Id);
        } else {
            for (NEOS_Matter__c m : [
                SELECT Id FROM NEOS_Matter__c
                WHERE CourtJurisdiction__c LIKE :lk
                LIMIT 50
            ]) matchedIds.add(m.Id);
        }

        if (matchedIds.isEmpty()) return new List<Map<String, Object>>();

        // 4. Final fetch with full fields, sorted
        List<Map<String, Object>> results = new List<Map<String, Object>>();
        for (NEOS_Matter__c m : [
            SELECT Id, Name, CourtJurisdiction__c, RecordType.Name,
                   Senior_Attorney__r.Name, Associate_Attorney__r.Name, LSS_Paralegal__r.Name
            FROM NEOS_Matter__c
            WHERE Id IN :matchedIds
            ORDER BY Name ASC
            LIMIT 100
        ]) {
            results.add(matterToMap(m));
        }
        return results;
    }

    /* ── Initial matter list for picker (top 100 sorted by name) ── */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getRecentMatters(Boolean myOnly, String targetUserId) {
        Id userId = (String.isNotBlank(targetUserId) && myOnly == true)
                        ? (Id) targetUserId
                        : UserInfo.getUserId();
        List<NEOS_Matter__c> matters;
        if (myOnly == true) {
            matters = [
                SELECT Id, Name, CourtJurisdiction__c, RecordType.Name,
                       Senior_Attorney__r.Name, Associate_Attorney__r.Name, LSS_Paralegal__r.Name
                FROM NEOS_Matter__c
                WHERE Senior_Attorney__c = :userId
                   OR Associate_Attorney__c = :userId
                   OR LSS_Paralegal__c = :userId
                ORDER BY Name ASC
                LIMIT 200
            ];
        } else {
            matters = [
                SELECT Id, Name, CourtJurisdiction__c, RecordType.Name,
                       Senior_Attorney__r.Name, Associate_Attorney__r.Name, LSS_Paralegal__r.Name
                FROM NEOS_Matter__c
                ORDER BY LastModifiedDate DESC
                LIMIT 500
            ];
        }
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (NEOS_Matter__c m : matters) {
            result.add(matterToMap(m));
        }
        return result;
    }

    /* ── Team members from the caller's public group (for View_Team_Dockets) ── */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getMyTeamStaff() {
        Id userId = UserInfo.getUserId();
        List<GroupMember> myGroup = [
            SELECT GroupId FROM GroupMember
            WHERE UserOrGroupId = :userId
              AND Group.Type = 'Regular'
              AND Group.Name IN :TEAM_GROUP_NAMES
            LIMIT 1
        ];
        if (myGroup.isEmpty()) return new List<Map<String, Object>>();
        Id groupId = myGroup[0].GroupId;
        Set<Id> memberIds = new Set<Id>();
        for (GroupMember gm : [SELECT UserOrGroupId FROM GroupMember WHERE GroupId = :groupId]) {
            if (gm.UserOrGroupId.getSObjectType() == User.SObjectType && gm.UserOrGroupId != userId) {
                memberIds.add(gm.UserOrGroupId);
            }
        }
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (User u : [SELECT Id, Name, FirstName FROM User WHERE Id IN :memberIds AND IsActive = true ORDER BY Name ASC]) {
            result.add(new Map<String, Object>{ 'id' => u.Id, 'name' => u.Name, 'firstName' => u.FirstName });
        }
        return result;
    }

    /* ── Staff eligible to have time logged against them ── */
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getEligibleStaff() {
        Id currentUserId = UserInfo.getUserId();
        List<User> users = [
            SELECT Id, Name
            FROM User
            WHERE IsActive = true
              AND Id NOT IN (SELECT UserId FROM UserLogin WHERE IsFrozen = true)
              AND (Profile.Name IN ('TREO Service Agent', 'TREO Service Supervisor')
                   OR UserRole.Name LIKE '%Attorney%'
                   OR UserRole.Name LIKE '%Counsel%'
                   OR Email = 'emil@d.law'
                   OR Id = :currentUserId)
            ORDER BY Name ASC
        ];
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (User u : users) {
            result.add(new Map<String, Object>{ 'id' => u.Id, 'name' => u.Name });
        }
        return result;
    }

    /* ── Time entry submission ── */
    @AuraEnabled
    public static void submitTimeEntries(List<Map<String, Object>> entries) {
        try {
            Id   currentUserId = UserInfo.getUserId();
            Date today         = Date.today();
            List<Time_Entry__c> toInsert = new List<Time_Entry__c>();
            for (Map<String, Object> entry : entries) {
                String matterId     = (String) entry.get('matterId');
                String hoursStr     = (String) entry.get('hours');
                String taskNote     = (String) entry.get('taskNote');
                String staffId      = (String) entry.get('staffId');
                String entryDateStr = (String) entry.get('entryDate');
                if (String.isBlank(matterId) || String.isBlank(hoursStr)) continue;
                Date entryDate = String.isNotBlank(entryDateStr)
                    ? Date.valueOf(entryDateStr) : today;
                Id staff = String.isNotBlank(staffId) ? (Id) staffId : currentUserId;
                toInsert.add(new Time_Entry__c(
                    NEOS_Matter__c  = (Id) matterId,
                    Submit_Hours__c = Decimal.valueOf(hoursStr),
                    Notes__c        = taskNote != null ? taskNote : '',
                    Staff__c        = staff,
                    Entry_Date__c   = entryDate
                ));
            }
            if (!toInsert.isEmpty()) insert toInsert;
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }

    private static List<Map<String, Object>> buildMyEvents(Id userId, Date today, Date in360Days) {
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        String soql = 'SELECT Id, Subject__c, Event_Type__c, Start_DateTime__c, End_DateTime__c,' +
            ' Is_All_Day__c, Location__c, Description__c, Matter__c, Matter__r.Name,' +
            ' (SELECT User__r.Name FROM Calendar_Attendees__r)' +
            ' FROM Calendar_Event__c' +
            ' WHERE Status__c = \'Active\'' +
            '   AND DAY_ONLY(Start_DateTime__c) >= TODAY' +
            '   AND DAY_ONLY(Start_DateTime__c) <= :in360Days' +
            '   AND Id IN (SELECT Calendar_Event__c FROM Calendar_Attendee__c WHERE User__c = :userId)' +
            ' ORDER BY Start_DateTime__c ASC LIMIT 500';
        for (SObject sobj : Database.query(soql)) {
            SObject  matterRel = sobj.getSObject('Matter__r');
            Datetime startDt   = (Datetime) sobj.get('Start_DateTime__c');
            Datetime endDt     = (Datetime) sobj.get('End_DateTime__c');
            Date     eventDate = startDt != null ? startDt.dateGmt() : today;
            List<SObject> attObjs  = sobj.getSObjects('Calendar_Attendees__r');
            List<String>  attNames = new List<String>();
            if (attObjs != null) {
                for (SObject a : attObjs) {
                    SObject userRel = a.getSObject('User__r');
                    if (userRel != null && String.isNotBlank((String) userRel.get('Name')))
                        attNames.add((String) userRel.get('Name'));
                }
            }
            Map<String, Object> row = new Map<String, Object>();
            row.put('id',          (String) sobj.get('Id'));
            row.put('subject',     sobj.get('Subject__c'));
            row.put('eventType',   sobj.get('Event_Type__c'));
            row.put('startDate',   startDt != null ? startDt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'') : '');
            row.put('endDate',     endDt   != null ? endDt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')   : '');
            row.put('isAllDay',    sobj.get('Is_All_Day__c') == true);
            row.put('location',    sobj.get('Location__c')    != null ? sobj.get('Location__c')    : '');
            row.put('description', sobj.get('Description__c') != null ? sobj.get('Description__c') : '');
            row.put('attendees',   String.join(attNames, ', '));
            row.put('matterName',  matterRel != null ? matterRel.get('Name') : '');
            row.put('matterId',    sobj.get('Matter__c') != null ? String.valueOf(sobj.get('Matter__c')) : '');
            row.put('isToday',     (eventDate == today));
            row.put('daysAway',    today.daysBetween(eventDate));
            result.add(row);
        }
        return result;
    }

    private static Map<String, Object> buildDeadlineRow(SObject sobj, Date today) {
        SObject matterRel = sobj.getSObject('Matter__r');
        Datetime startDt  = (Datetime) sobj.get('Start_DateTime__c');
        Datetime endDt    = (Datetime) sobj.get('End_DateTime__c');
        Date eventDate    = startDt != null ? startDt.dateGmt() : today;
        Integer daysAway  = today.daysBetween(eventDate);
        List<SObject> attObjs = sobj.getSObjects('Calendar_Attendees__r');
        List<String> attNames = new List<String>();
        if (attObjs != null) {
            for (SObject a : attObjs) {
                SObject userRel = a.getSObject('User__r');
                if (userRel != null && String.isNotBlank((String) userRel.get('Name'))) {
                    attNames.add((String) userRel.get('Name'));
                }
            }
        }
        Map<String, Object> row = new Map<String, Object>();
        row.put('id',          (String) sobj.get('Id'));
        row.put('subject',     sobj.get('Subject__c'));
        row.put('eventType',   sobj.get('Event_Type__c'));
        row.put('startDate',   startDt != null ? startDt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'') : '');
        row.put('endDate',     endDt   != null ? endDt.formatGmt('yyyy-MM-dd\'T\'HH:mm:ss\'Z\'')   : '');
        row.put('isAllDay',    sobj.get('Is_All_Day__c') == true);
        row.put('location',    sobj.get('Location__c')    != null ? sobj.get('Location__c')    : '');
        row.put('description', sobj.get('Description__c') != null ? sobj.get('Description__c') : '');
        row.put('matterName',  matterRel != null ? matterRel.get('Name') : '');
        row.put('matterId',    sobj.get('Matter__c') != null ? String.valueOf(sobj.get('Matter__c')) : '');
        row.put('attendees',   String.join(attNames, ', '));
        row.put('daysAway',    daysAway);
        return row;
    }

    private static Map<String, Object> matterToMap(NEOS_Matter__c m) {
        return new Map<String, Object>{
            'id'             => m.Id,
            'name'           => m.Name,
            'jurisdiction'   => m.CourtJurisdiction__c != null ? m.CourtJurisdiction__c : '',
            'recordType'     => m.RecordType != null ? m.RecordType.Name : '',
            'seniorAttorney' => m.Senior_Attorney__r != null ? m.Senior_Attorney__r.Name : '',
            'associateAtty'  => m.Associate_Attorney__r != null ? m.Associate_Attorney__r.Name : '',
            'lssParalegal'   => m.LSS_Paralegal__r != null ? m.LSS_Paralegal__r.Name : ''
        };
    }
}
