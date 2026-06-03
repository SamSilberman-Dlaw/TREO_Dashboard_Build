@IsTest
public class SeniorDashboardControllerTest {

    private static NEOS_Matter__c createMatter(Id seniorId, Id associateId) {
        NEOS_Matter__c m = new NEOS_Matter__c(
            Name                 = 'Senior Test Matter',
            Case_Title__c        = 'Senior Test Matter',
            CourtJurisdiction__c = 'Test Jurisdiction'
        );
        if (seniorId    != null) m.Senior_Attorney__c    = seniorId;
        if (associateId != null) m.Associate_Attorney__c = associateId;
        insert m;
        return m;
    }

    @IsTest
    static void getDashboardData_returnsExpectedKeys() {
        Id userId = UserInfo.getUserId();
        NEOS_Matter__c m = createMatter(userId, null);

        insert new Time_Entry__c(
            NEOS_Matter__c  = m.Id,
            Submit_Hours__c = 3,
            Staff__c        = userId,
            Entry_Date__c   = Date.today(),
            Notes__c        = 'Test'
        );

        insert new Task(
            Subject      = 'Test Task',
            OwnerId      = userId,
            WhatId       = m.Id,
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(3)
        );

        Test.startTest();
        Map<String, Object> result = SeniorDashboardController.getDashboardData();
        Test.stopTest();

        System.assertNotEquals(null, result);
        System.assert(result.containsKey('matterHealth'),         'Missing matterHealth');
        System.assert(result.containsKey('teamStats'),            'Missing teamStats');
        System.assert(result.containsKey('upcomingDeadlineCount'),'Missing upcomingDeadlineCount');
        System.assert(result.containsKey('behindCount'),          'Missing behindCount');
        System.assert(result.containsKey('teamHoursToday'),       'Missing teamHoursToday');
        System.assert(result.containsKey('currentUserId'),        'Missing currentUserId');
    }

    @IsTest
    static void getDashboardData_noMatters_returnsEmpty() {
        Test.startTest();
        Map<String, Object> result = SeniorDashboardController.getDashboardData();
        Test.stopTest();
        System.assertNotEquals(null, result);
        List<Object> health = (List<Object>) result.get('matterHealth');
        System.assertEquals(0, health.size(), 'No matters should return empty health list');
    }

    @IsTest
    static void getDashboardData_withTeamGroup_includesTeamStats() {
        Id userId = UserInfo.getUserId();

        Group teamGroup = new Group(Name = 'Team Roman', Type = 'Regular');
        insert teamGroup;
        insert new GroupMember(GroupId = teamGroup.Id, UserOrGroupId = userId);

        insert new Time_Entry__c(
            NEOS_Matter__c  = createMatter(userId, null).Id,
            Submit_Hours__c = 5,
            Staff__c        = userId,
            Entry_Date__c   = Date.today(),
            Notes__c        = 'Test'
        );

        Test.startTest();
        Map<String, Object> result = SeniorDashboardController.getDashboardData();
        Test.stopTest();

        System.assertNotEquals(null, result);
        System.assertEquals('Team Roman', result.get('teamGroupName'));
        List<Object> teamStats = (List<Object>) result.get('teamStats');
        System.assertNotEquals(null, teamStats);
        System.assert(!teamStats.isEmpty(), 'Team stats should include the current user');

        Map<String, Object> chart = (Map<String, Object>) result.get('managerChart');
        System.assertNotEquals(null, chart, 'managerChart should be present');
        System.assert(chart.containsKey('members'),    'managerChart missing members');
        System.assert(chart.containsKey('stageOrder'), 'managerChart missing stageOrder');
        List<Object> chartMembers = (List<Object>) chart.get('members');
        System.assert(!chartMembers.isEmpty(), 'Chart should have team members');
    }

    @IsTest
    static void getDashboardData_withOverdueTask_marksAtRisk() {
        Id userId = UserInfo.getUserId();

        Group teamGroup = new Group(Name = 'Team Roman', Type = 'Regular');
        insert teamGroup;
        insert new GroupMember(GroupId = teamGroup.Id, UserOrGroupId = userId);

        NEOS_Matter__c m = createMatter(userId, null);
        insert new Task(
            Subject      = 'Overdue',
            OwnerId      = userId,
            WhatId       = m.Id,
            Status       = 'Not Started',
            ActivityDate = Date.today().addDays(-3)
        );

        Test.startTest();
        Map<String, Object> result = SeniorDashboardController.getDashboardData();
        Test.stopTest();

        List<Object> health = (List<Object>) result.get('matterHealth');
        System.assertEquals(1, health.size());
        Map<String, Object> row = (Map<String, Object>) health[0];
        System.assertEquals('atrisk', row.get('status'), 'Matter with overdue task should be at risk');
    }
}
