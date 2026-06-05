@isTest
private class TimeEntryDashboardControllerTest {

    @isTest
    static void testGetTeams() {
        Test.startTest();
        List<Map<String, Object>> teams = TimeEntryDashboardController.getTeams();
        Test.stopTest();
        System.assertNotEquals(null, teams);
    }

    @isTest
    static void testGetChartData_homePage() {
        String today     = String.valueOf(Date.today());
        String monthAgo  = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getChartData(
            null, monthAgo, today, new List<String>(), false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
        System.assert(result.containsKey('byStaff'));
        System.assert(result.containsKey('byDate'));
        System.assert(result.containsKey('byMatter'));
        System.assert(result.containsKey('entries'));
        System.assert(result.containsKey('totalHours'));
        System.assert(result.containsKey('entryCount'));
    }

    @isTest
    static void testGetChartData_withStaffFilter() {
        String today     = String.valueOf(Date.today());
        String monthAgo  = String.valueOf(Date.today().addDays(-30));
        User u = [SELECT Id FROM User WHERE IsActive = true LIMIT 1];
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getChartData(
            null, monthAgo, today, new List<String>{ u.Id }, false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
    }

    @isTest
    static void testGetChartData_blankDates() {
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getChartData(
            null, '', '', null, false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
    }

    @isTest
    static void testGetChartData_matterPage() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter', Case_Title__c = 'Test Matter');
        insert matter;
        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getChartData(
            matter.Id, monthAgo, today, null, false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
        System.assert(result.containsKey('entries'));
    }

    @isTest
    static void testGetStaffAndTotals_homePage() {
        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getStaffAndTotals(
            null, monthAgo, today, new List<String>(), false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
        System.assert(result.containsKey('byStaff'));
        System.assert(result.containsKey('totalHours'));
        System.assert(result.containsKey('staffCount'));
    }

    @isTest
    static void testGetStaffAndTotals_mineOnly() {
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getStaffAndTotals(
            null, '', '', null, true
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
    }

    @isTest
    static void testGetByDate() {
        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        List<Map<String, Object>> result = TimeEntryDashboardController.getByDate(
            null, monthAgo, today, new List<String>(), false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
    }

    @isTest
    static void testGetByMatter() {
        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        List<Map<String, Object>> result = TimeEntryDashboardController.getByMatter(
            monthAgo, today, new List<String>(), false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
    }

    @isTest
    static void testGetStaffAndTotals_matterPage() {
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter 2', Case_Title__c = 'Test Matter 2');
        insert matter;
        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));
        Test.startTest();
        Map<String, Object> result = TimeEntryDashboardController.getStaffAndTotals(
            matter.Id, monthAgo, today, null, false
        );
        Test.stopTest();
        System.assertNotEquals(null, result);
        System.assert(result.containsKey('entries'));
    }

    @isTest
    static void testAllMethods_withData() {
        User u = [SELECT Id FROM User WHERE IsActive = true LIMIT 1];
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Test Matter 3', Case_Title__c = 'Test Matter 3');
        insert matter;

        Time_Entry__c te = new Time_Entry__c(
            Staff__c        = u.Id,
            Entry_Date__c   = Date.today().addDays(-5),
            Submit_Hours__c = 2.5,
            NEOS_Matter__c  = matter.Id
        );
        insert te;

        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));

        Test.startTest();

        Map<String, Object> staffResult = TimeEntryDashboardController.getStaffAndTotals(
            null, monthAgo, today, new List<String>{ u.Id }, false
        );
        System.assertNotEquals(null, staffResult);
        System.assert(!((List<Object>) staffResult.get('byStaff')).isEmpty());

        List<Map<String, Object>> dateResult = TimeEntryDashboardController.getByDate(
            null, monthAgo, today, new List<String>{ u.Id }, false
        );
        System.assert(!dateResult.isEmpty());

        List<Map<String, Object>> matterResult = TimeEntryDashboardController.getByMatter(
            monthAgo, today, new List<String>{ u.Id }, false
        );
        System.assert(!matterResult.isEmpty());

        // Primary method used by the dashboard
        Map<String, Object> allData = TimeEntryDashboardController.getAllChartData(
            null, monthAgo, today, new List<String>{ u.Id }, false
        );
        System.assertNotEquals(null, allData);
        System.assert(!((List<Object>) allData.get('byStaff')).isEmpty());
        System.assert(!((List<Object>) allData.get('byDate')).isEmpty());

        // Matter page variant
        Map<String, Object> matterPageData = TimeEntryDashboardController.getAllChartData(
            matter.Id, monthAgo, today, null, false
        );
        System.assertNotEquals(null, matterPageData);
        System.assert(matterPageData.containsKey('entries'));

        Test.stopTest();
    }

    @isTest
    static void testGetExportEntries() {
        User u = [SELECT Id FROM User WHERE IsActive = true LIMIT 1];
        NEOS_Matter__c matter = new NEOS_Matter__c(Name = 'Export Test Matter', Case_Title__c = 'Export Test Matter');
        insert matter;
        Time_Entry__c te = new Time_Entry__c(
            Staff__c        = u.Id,
            Entry_Date__c   = Date.today().addDays(-3),
            Submit_Hours__c = 1.5,
            NEOS_Matter__c  = matter.Id
        );
        insert te;

        String today    = String.valueOf(Date.today());
        String monthAgo = String.valueOf(Date.today().addDays(-30));

        Test.startTest();

        // Home page — staff filter
        List<Map<String, Object>> byStaff = TimeEntryDashboardController.getExportEntries(
            null, monthAgo, today, new List<String>{ u.Id }, false
        );
        System.assertNotEquals(null, byStaff);
        System.assert(!byStaff.isEmpty());
        System.assert(byStaff[0].containsKey('staff'));
        System.assert(byStaff[0].containsKey('date'));
        System.assert(byStaff[0].containsKey('hours'));
        System.assert(byStaff[0].containsKey('matter'));

        // Matter page — record scoped
        List<Map<String, Object>> byMatter = TimeEntryDashboardController.getExportEntries(
            matter.Id, monthAgo, today, null, false
        );
        System.assertNotEquals(null, byMatter);
        System.assert(!byMatter.isEmpty());

        // mineOnly
        List<Map<String, Object>> mine = TimeEntryDashboardController.getExportEntries(
            null, monthAgo, today, null, true
        );
        System.assertNotEquals(null, mine);

        // blank dates fallback
        List<Map<String, Object>> blankDates = TimeEntryDashboardController.getExportEntries(
            null, '', '', null, false
        );
        System.assertNotEquals(null, blankDates);

        Test.stopTest();
    }
}
