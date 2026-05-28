public with sharing class DlawConsoleController {

    @AuraEnabled(cacheable=true)
    public static TimeMetrics getTimeMetrics() {
        Id userId = UserInfo.getUserId();
        Date today = Date.today();
        Date weekStart = today.addDays(-6);
        Date nineMonthsOut = today.addDays(270);

        TimeMetrics metrics = new TimeMetrics();
        metrics.todayGoal = 8.0;

        AggregateResult[] todayAgg = [
            SELECT SUM(Hours__c) hrs
            FROM Time_Entry__c
            WHERE OwnerId = :userId AND Entry_Date__c = :today AND Status__c != 'Deleted'
        ];
        metrics.todayHours = todayAgg[0].get('hrs') != null ? (Decimal) todayAgg[0].get('hrs') : 0;

        AggregateResult[] weekAgg = [
            SELECT SUM(Hours__c) hrs
            FROM Time_Entry__c
            WHERE OwnerId = :userId AND Entry_Date__c >= :weekStart AND Entry_Date__c <= :today AND Status__c != 'Deleted'
        ];
        metrics.last7DaysHours = weekAgg[0].get('hrs') != null ? (Decimal) weekAgg[0].get('hrs') : 0;
        metrics.last7DaysAvg = (metrics.last7DaysHours / 7).setScale(1);

        List<AggregateResult> dailyAgg = [
            SELECT Entry_Date__c d, SUM(Hours__c) hrs
            FROM Time_Entry__c
            WHERE OwnerId = :userId AND Entry_Date__c >= :weekStart AND Entry_Date__c <= :today AND Status__c != 'Deleted'
            GROUP BY Entry_Date__c
            ORDER BY Entry_Date__c ASC
        ];
        metrics.dailyBreakdown = new List<DailyHours>();
        for (AggregateResult ar : dailyAgg) {
            DailyHours dh = new DailyHours();
            dh.entryDate = (Date) ar.get('d');
            dh.hours = ar.get('hrs') != null ? ((Decimal) ar.get('hrs')).setScale(1) : 0;
            dh.dayLabel = getDayAbbrev(dh.entryDate.toStartOfWeek().daysBetween(dh.entryDate));
            metrics.dailyBreakdown.add(dh);
        }

        metrics.openTaskCount = [
            SELECT COUNT() FROM Task WHERE OwnerId = :userId AND Status != 'Completed' AND IsClosed = false
        ];
        metrics.overdueTaskCount = [
            SELECT COUNT() FROM Task WHERE OwnerId = :userId AND Status != 'Completed' AND IsClosed = false AND ActivityDate < :today
        ];
        metrics.criticalDeadlineCount = [
            SELECT COUNT() FROM Deadline__c WHERE Deadline_Date__c >= :today AND Deadline_Date__c <= :nineMonthsOut AND Status__c = 'Active'
        ];

        List<Deadline__c> nextDeadlines = [
            SELECT Deadline_Date__c FROM Deadline__c WHERE Deadline_Date__c >= :today AND Status__c = 'Active' ORDER BY Deadline_Date__c ASC LIMIT 1
        ];
        metrics.nextDeadlineDays = nextDeadlines.isEmpty() ? 0 : today.daysBetween(nextDeadlines[0].Deadline_Date__c.date());

        return metrics;
    }

    @AuraEnabled(cacheable=true)
    public static List<DeadlineWrapper> getCriticalDeadlines() {
        Date today = Date.today();
        Date nineMonthsOut = today.addDays(270);

        List<Deadline__c> deadlines = [
            SELECT Id, Name, Matter__c, Matter__r.Name, Deadline_Type__c,
                   Deadline_Date__c, Assigned_Attorney__c, Assigned_Attorney__r.Name, Priority__c
            FROM Deadline__c
            WHERE Deadline_Date__c >= :today AND Deadline_Date__c <= :nineMonthsOut AND Status__c = 'Active'
            ORDER BY Deadline_Date__c ASC
            LIMIT 25
        ];

        List<DeadlineWrapper> results = new List<DeadlineWrapper>();
        for (Deadline__c d : deadlines) {
            DeadlineWrapper dw = new DeadlineWrapper();
            dw.id = d.Id;
            dw.matterId = d.Matter__c;
            dw.matterName = d.Matter__r != null ? d.Matter__r.Name : '';
            dw.deadlineType = d.Deadline_Type__c;
            dw.deadlineDate = d.Deadline_Date__c;
            dw.assignedAttorney = d.Assigned_Attorney__r != null ? d.Assigned_Attorney__r.Name : '';
            dw.daysRemaining = today.daysBetween(d.Deadline_Date__c.date());
            dw.priorityColor = dw.daysRemaining <= 14 ? 'red' : dw.daysRemaining <= 30 ? 'orange' : 'purple';
            results.add(dw);
        }
        return results;
    }

    @AuraEnabled(cacheable=true)
    public static List<AssociateEventWrapper> getAssociateEvents() {
        Id userId = UserInfo.getUserId();
        Date today = Date.today();
        Date weekEnd = today.addDays(7);

        List<Task> tasks = [
            SELECT Id, Subject, ActivityDate, Matter__c, Matter__r.Name,
                   Owner.Name, Owner.FirstName, Owner.LastName
            FROM Task
            WHERE OwnerId != :userId
              AND ActivityDate >= :today
              AND ActivityDate <= :weekEnd
              AND Status != 'Completed'
            ORDER BY ActivityDate ASC, Subject ASC
            LIMIT 50
        ];

        List<AssociateEventWrapper> results = new List<AssociateEventWrapper>();
        for (Task t : tasks) {
            AssociateEventWrapper aew = new AssociateEventWrapper();
            aew.id = t.Id;
            aew.subject = t.Subject;
            aew.matterId = t.Matter__c;
            aew.matterName = t.Matter__r != null ? t.Matter__r.Name : '';
            aew.dueDate = DateTime.newInstance(t.ActivityDate, Time.newInstance(17, 0, 0, 0));
            String fn = t.Owner.FirstName != null ? t.Owner.FirstName : '';
            String ln = t.Owner.LastName != null ? t.Owner.LastName : '';
            aew.associateName = (fn + ' ' + ln).trim();
            aew.associateInitials = (fn.length() > 0 ? fn.substring(0, 1) : '') +
                                    (ln.length() > 0 ? ln.substring(0, 1) : '');
            aew.groupLabel = t.ActivityDate == today ? 'TODAY' : 'THIS_WEEK';
            results.add(aew);
        }
        return results;
    }

    @AuraEnabled(cacheable=true)
    public static List<TaskWrapper> getMyTasks() {
        Id userId = UserInfo.getUserId();
        Date today = Date.today();
        Date pastWeek = today.addDays(-7);
        Date thirtyOut = today.addDays(30);

        List<Task> tasks = [
            SELECT Id, Subject, ActivityDate, Status, IsClosed,
                   Matter__c, Matter__r.Name, Estimated_Hours__c, Related_Time_Entry__c
            FROM Task
            WHERE OwnerId = :userId
              AND (ActivityDate <= :thirtyOut OR (Status = 'Completed' AND ActivityDate >= :pastWeek))
              AND ActivityDate >= :pastWeek
            ORDER BY ActivityDate ASC, CreatedDate DESC
            LIMIT 50
        ];

        List<TaskWrapper> results = new List<TaskWrapper>();
        for (Task t : tasks) {
            TaskWrapper tw = new TaskWrapper();
            tw.id = t.Id;
            tw.subject = t.Subject;
            tw.matterId = t.Matter__c;
            tw.matterName = t.Matter__r != null ? t.Matter__r.Name : '';
            tw.dueDate = t.ActivityDate;
            tw.status = t.Status;
            tw.estimatedHours = t.Estimated_Hours__c;
            tw.relatedTimeEntryId = t.Related_Time_Entry__c;
            tw.isCompleted = t.IsClosed;
            tw.isOverdue = !t.IsClosed && t.ActivityDate < today;
            results.add(tw);
        }
        return results;
    }

    @AuraEnabled(cacheable=true)
    public static List<TimeEntryWrapper> getDraftTimeEntries() {
        Id userId = UserInfo.getUserId();
        Date today = Date.today();

        List<Time_Entry__c> entries = [
            SELECT Id, Matter__c, Matter__r.Name, Task__c, Task__r.Subject,
                   Hours__c, Narrative__c, Billable__c, Entry_Date__c
            FROM Time_Entry__c
            WHERE OwnerId = :userId AND Status__c = 'Draft' AND Entry_Date__c = :today
            ORDER BY CreatedDate ASC
        ];

        List<TimeEntryWrapper> results = new List<TimeEntryWrapper>();
        for (Time_Entry__c te : entries) {
            TimeEntryWrapper tew = new TimeEntryWrapper();
            tew.id = te.Id;
            tew.matterId = te.Matter__c;
            tew.matterName = te.Matter__r != null ? te.Matter__r.Name : '';
            tew.taskId = te.Task__c;
            tew.taskName = te.Task__r != null ? te.Task__r.Subject : '';
            tew.hours = te.Hours__c != null ? te.Hours__c : 0;
            tew.narrative = te.Narrative__c;
            tew.isBillable = te.Billable__c;
            tew.entryDate = te.Entry_Date__c;
            results.add(tew);
        }
        return results;
    }

    @AuraEnabled
    public static String saveTimeEntries(String entriesJson) {
        List<TimeEntryInput> inputs = (List<TimeEntryInput>) JSON.deserialize(entriesJson, List<TimeEntryInput>.class);
        upsert buildTimeEntryRecords(inputs, 'Draft');
        return 'success';
    }

    @AuraEnabled
    public static String submitTimeEntries(String entriesJson) {
        List<TimeEntryInput> inputs = (List<TimeEntryInput>) JSON.deserialize(entriesJson, List<TimeEntryInput>.class);
        upsert buildTimeEntryRecords(inputs, 'Submitted');
        return 'success';
    }

    @AuraEnabled
    public static String completeTask(String taskId) {
        Task t = new Task(Id = taskId, Status = 'Completed');
        update t;
        return 'success';
    }

    @AuraEnabled(cacheable=true)
    public static MatterDetail getMatterDetail(String matterId) {
        Matter__c m = [
            SELECT Id, Name, Status__c, Case_Number__c, Assigned_Attorney__r.Name,
                   (SELECT Id, Subject, ActivityDate, Status FROM Tasks WHERE Status != 'Completed' ORDER BY ActivityDate ASC LIMIT 5),
                   (SELECT Id, Deadline_Type__c, Deadline_Date__c FROM Deadlines__r WHERE Deadline_Date__c >= TODAY ORDER BY Deadline_Date__c ASC LIMIT 3)
            FROM Matter__c
            WHERE Id = :matterId
            LIMIT 1
        ];

        MatterDetail md = new MatterDetail();
        md.id = m.Id;
        md.name = m.Name;
        md.status = m.Status__c;
        md.caseNumber = m.Case_Number__c;
        md.assignedAttorney = m.Assigned_Attorney__r != null ? m.Assigned_Attorney__r.Name : '';

        md.openTasks = new List<Map<String, Object>>();
        for (Task t : m.Tasks) {
            md.openTasks.add(new Map<String, Object>{
                'id' => t.Id, 'subject' => t.Subject,
                'dueDate' => t.ActivityDate != null ? String.valueOf(t.ActivityDate) : '',
                'status' => t.Status
            });
        }

        md.upcomingDeadlines = new List<Map<String, Object>>();
        for (Deadline__c d : m.Deadlines__r) {
            md.upcomingDeadlines.add(new Map<String, Object>{
                'id' => d.Id, 'type' => d.Deadline_Type__c,
                'date' => String.valueOf(d.Deadline_Date__c)
            });
        }
        return md;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> searchMatters(String searchTerm) {
        if (String.isBlank(searchTerm) || searchTerm.length() < 2) return new List<Map<String, Object>>();
        String likeParam = '%' + String.escapeSingleQuotes(searchTerm) + '%';
        List<Matter__c> matters = [
            SELECT Id, Name, Case_Number__c
            FROM Matter__c
            WHERE (Name LIKE :likeParam OR Case_Number__c LIKE :likeParam) AND Status__c = 'Active'
            ORDER BY Name ASC
            LIMIT 10
        ];
        List<Map<String, Object>> results = new List<Map<String, Object>>();
        for (Matter__c m : matters) {
            results.add(new Map<String, Object>{'id' => m.Id, 'name' => m.Name, 'caseNumber' => m.Case_Number__c});
        }
        return results;
    }

    private static List<Time_Entry__c> buildTimeEntryRecords(List<TimeEntryInput> inputs, String status) {
        List<Time_Entry__c> records = new List<Time_Entry__c>();
        for (TimeEntryInput inp : inputs) {
            Time_Entry__c te = new Time_Entry__c();
            if (String.isNotBlank(inp.id)) te.Id = inp.id;
            te.Matter__c = inp.matterId;
            te.Task__c = String.isNotBlank(inp.taskId) ? inp.taskId : null;
            te.Hours__c = inp.hours;
            te.Narrative__c = inp.narrative;
            te.Billable__c = inp.isBillable != null ? inp.isBillable : true;
            te.Entry_Date__c = Date.today();
            te.Status__c = status;
            records.add(te);
        }
        return records;
    }

    private static String getDayAbbrev(Integer dow) {
        List<String> days = new List<String>{'Sun','Mon','Tue','Wed','Thu','Fri','Sat'};
        return days[Math.max(0, Math.min(6, dow))];
    }

    // ── Inner wrapper classes ──────────────────────────────────────────────

    public class TimeMetrics {
        @AuraEnabled public Decimal todayHours;
        @AuraEnabled public Decimal todayGoal;
        @AuraEnabled public Decimal last7DaysHours;
        @AuraEnabled public Decimal last7DaysAvg;
        @AuraEnabled public Integer openTaskCount;
        @AuraEnabled public Integer overdueTaskCount;
        @AuraEnabled public Integer criticalDeadlineCount;
        @AuraEnabled public Integer nextDeadlineDays;
        @AuraEnabled public List<DailyHours> dailyBreakdown;
    }

    public class DailyHours {
        @AuraEnabled public Date entryDate;
        @AuraEnabled public Decimal hours;
        @AuraEnabled public String dayLabel;
    }

    public class DeadlineWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String matterId;
        @AuraEnabled public String matterName;
        @AuraEnabled public String deadlineType;
        @AuraEnabled public DateTime deadlineDate;
        @AuraEnabled public Integer daysRemaining;
        @AuraEnabled public String assignedAttorney;
        @AuraEnabled public String priorityColor;
    }

    public class AssociateEventWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String associateInitials;
        @AuraEnabled public String associateName;
        @AuraEnabled public String subject;
        @AuraEnabled public String matterId;
        @AuraEnabled public String matterName;
        @AuraEnabled public DateTime dueDate;
        @AuraEnabled public String groupLabel;
    }

    public class TaskWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String subject;
        @AuraEnabled public String matterId;
        @AuraEnabled public String matterName;
        @AuraEnabled public Date dueDate;
        @AuraEnabled public String status;
        @AuraEnabled public Decimal estimatedHours;
        @AuraEnabled public String relatedTimeEntryId;
        @AuraEnabled public Boolean isCompleted;
        @AuraEnabled public Boolean isOverdue;
    }

    public class TimeEntryWrapper {
        @AuraEnabled public String id;
        @AuraEnabled public String matterId;
        @AuraEnabled public String matterName;
        @AuraEnabled public String taskId;
        @AuraEnabled public String taskName;
        @AuraEnabled public Decimal hours;
        @AuraEnabled public String narrative;
        @AuraEnabled public Boolean isBillable;
        @AuraEnabled public Date entryDate;
    }

    public class TimeEntryInput {
        public String id;
        public String matterId;
        public String taskId;
        public Decimal hours;
        public String narrative;
        public Boolean isBillable;
    }

    public class MatterDetail {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String status;
        @AuraEnabled public String caseNumber;
        @AuraEnabled public String assignedAttorney;
        @AuraEnabled public List<Map<String, Object>> openTasks;
        @AuraEnabled public List<Map<String, Object>> upcomingDeadlines;
    }
}
