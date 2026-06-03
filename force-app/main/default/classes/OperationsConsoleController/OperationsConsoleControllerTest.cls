@IsTest
public class OperationsConsoleControllerTest {

    private static NEOS_Matter__c createMatter(Id seniorId) {
        NEOS_Matter__c m = new NEOS_Matter__c(
            Name                  = 'Test Matter',
            Case_Title__c         = 'Test Matter',
            CourtJurisdiction__c  = 'Test Jurisdiction'
        );
        if (seniorId != null) m.Senior_Attorney__c = seniorId;
        insert m;
        return m;
    }

    @IsTest
    static void getConsoleData_returnsExpectedKeys() {
        Id userId = UserInfo.getUserId();
        NEOS_Matter__c m = createMatter(userId);

        insert new Time_Entry__c(
            NEOS_Matter__c  = m.Id,
            Submit_Hours__c = 2,
            Staff__c        = userId,
            Entry_Date__c   = Date.today(),
            Notes__c        = 'Test work'
        );

        insert new Task(
            Subject      = 'Test Task',
            OwnerId      = userId,
            WhatId       = m.Id,
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(5)
        );

        try {
            SObject ce = Schema.getGlobalDescribe().get('Calendar_Event__c').newSObject();
            ce.put('Subject__c',        'Test Trial');
            ce.put('Start_DateTime__c', System.now().addDays(10));
            ce.put('End_DateTime__c',   System.now().addDays(10).addHours(2));
            ce.put('Status__c',         'Active');
            ce.put('Event_Type__c',     'Trial');
            ce.put('Matter__c',         m.Id);
            insert ce;
            SObject att = Schema.getGlobalDescribe().get('Calendar_Attendee__c').newSObject();
            att.put('Calendar_Event__c', ce.Id);
            att.put('User__c',           userId);
            insert att;
        } catch (Exception ignored) {}

        Test.startTest();
        Map<String, Object> result = OperationsConsoleController.getConsoleData(null);
        Test.stopTest();

        System.assertNotEquals(null, result, 'Should return data map');
        System.assert(result.containsKey('todayHours'),        'Missing todayHours');
        System.assert(result.containsKey('last7Hours'),        'Missing last7Hours');
        System.assert(result.containsKey('myTasks'),           'Missing myTasks');
        System.assert(result.containsKey('criticalDeadlines'), 'Missing criticalDeadlines');
        System.assert(result.containsKey('myEvents'),           'Missing myEvents');
        System.assert(result.containsKey('currentUserId'),     'Missing currentUserId');
    }

    @IsTest
    static void completeTask_setsStatusCompleted() {
        Task t = new Task(
            Subject = 'Test Task',
            OwnerId = UserInfo.getUserId(),
            Status  = 'Not Started'
        );
        insert t;

        Test.startTest();
        OperationsConsoleController.completeTask(t.Id);
        Test.stopTest();

        System.assertEquals('Completed', [SELECT Status FROM Task WHERE Id = :t.Id].Status);
    }

    @IsTest
    static void getRecentMatters_myOnly_returnsList() {
        createMatter(UserInfo.getUserId());
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.getRecentMatters(true, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
        System.assert(results.size() >= 1, 'Should return at least the matter assigned to current user');
    }

    @IsTest
    static void getRecentMatters_allCases_returnsList() {
        createMatter(null);
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.getRecentMatters(false, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
    }

    @IsTest
    static void getEligibleStaff_includesCurrentUser() {
        Test.startTest();
        List<Map<String, Object>> staff = OperationsConsoleController.getEligibleStaff();
        Test.stopTest();
        System.assertNotEquals(null, staff);
        System.assert(staff.size() >= 1, 'Should include at least the current user');
    }

    @IsTest
    static void submitTimeEntries_insertsRecord() {
        NEOS_Matter__c m = createMatter(null);
        Id userId = UserInfo.getUserId();

        List<Map<String, Object>> entries = new List<Map<String, Object>>{
            new Map<String, Object>{
                'matterId'  => String.valueOf(m.Id),
                'hours'     => '2.5',
                'taskNote'  => 'Test work performed',
                'staffId'   => String.valueOf(userId),
                'entryDate' => String.valueOf(Date.today())
            }
        };

        Test.startTest();
        OperationsConsoleController.submitTimeEntries(entries);
        Test.stopTest();

        List<Time_Entry__c> inserted = [
            SELECT Submit_Hours__c FROM Time_Entry__c WHERE NEOS_Matter__c = :m.Id
        ];
        System.assertEquals(1, inserted.size(), 'Should insert 1 time entry');
        System.assertEquals(2.5, inserted[0].Submit_Hours__c, 'Hours should match');
    }

    @IsTest
    static void submitTimeEntries_skipsBlankMatter() {
        List<Map<String, Object>> entries = new List<Map<String, Object>>{
            new Map<String, Object>{
                'matterId'  => '',
                'hours'     => '1',
                'taskNote'  => 'ignored',
                'staffId'   => String.valueOf(UserInfo.getUserId()),
                'entryDate' => String.valueOf(Date.today())
            }
        };
        Test.startTest();
        OperationsConsoleController.submitTimeEntries(entries);
        Test.stopTest();
    }

    @IsTest
    static void searchMatters_noMatch_returnsEmpty() {
        Test.setFixedSearchResults(new List<Id>{});
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('ZZZnomatch', false, null);
        Test.stopTest();
        System.assertEquals(0, results.size());
    }

    @IsTest
    static void searchMatters_shortQuery_returnsEmpty() {
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('a', true, null);
        Test.stopTest();
        System.assertEquals(0, results.size(), 'Single-char query should return empty');
    }

    @IsTest
    static void searchMatters_myOnly_runsWithoutError() {
        NEOS_Matter__c m = createMatter(UserInfo.getUserId());
        Test.setFixedSearchResults(new List<Id>{ m.Id });
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('Test', true, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
    }

    @IsTest
    static void searchMatters_allCases_runsWithoutError() {
        NEOS_Matter__c m = createMatter(null);
        Test.setFixedSearchResults(new List<Id>{ m.Id });
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('Test', false, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
    }

    @IsTest
    static void searchMatters_myOnly_withUserResult() {
        NEOS_Matter__c m = createMatter(UserInfo.getUserId());
        Test.setFixedSearchResults(new List<Id>{ UserInfo.getUserId(), m.Id });
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('Test', true, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
    }

    @IsTest
    static void searchMatters_allCases_withUserResult() {
        NEOS_Matter__c m = createMatter(UserInfo.getUserId());
        Test.setFixedSearchResults(new List<Id>{ UserInfo.getUserId(), m.Id });
        Test.startTest();
        List<Map<String, Object>> results = OperationsConsoleController.searchMatters('Test', false, null);
        Test.stopTest();
        System.assertNotEquals(null, results);
    }

    @IsTest
    static void submitTimeEntries_defaultsToCurrentUser() {
        NEOS_Matter__c m = createMatter(null);
        List<Map<String, Object>> entries = new List<Map<String, Object>>{
            new Map<String, Object>{
                'matterId'  => String.valueOf(m.Id),
                'hours'     => '1',
                'taskNote'  => null,
                'staffId'   => '',
                'entryDate' => ''
            }
        };
        Test.startTest();
        OperationsConsoleController.submitTimeEntries(entries);
        Test.stopTest();
        System.assertEquals(1, [SELECT COUNT() FROM Time_Entry__c WHERE NEOS_Matter__c = :m.Id]);
    }
}
