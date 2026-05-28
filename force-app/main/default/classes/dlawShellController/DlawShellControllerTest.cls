@IsTest
private class DlawShellControllerTest {

    @IsTest
    static void testGetShellConfig() {
        Test.startTest();
        Map<String, Object> config = DlawShellController.getShellConfig();
        Test.stopTest();

        System.assertNotEquals(null, config, 'Config should not be null');
        System.assert(config.containsKey('userName'), 'Config should contain userName');
        System.assert(config.containsKey('profile'),  'Config should contain profile');
        System.assert(config.containsKey('tabs'),     'Config should contain tabs');
        System.assertNotEquals(null, config.get('userName'), 'userName should not be null');
        System.assertNotEquals(null, config.get('profile'),  'profile should not be null');

        Map<String, Boolean> tabs = (Map<String, Boolean>) config.get('tabs');
        System.assert(tabs.containsKey('operations'), 'Tabs should have operations key');
        System.assert(tabs.containsKey('timeEntry'),  'Tabs should have timeEntry key');
        System.assert(tabs.containsKey('calendar'),   'Tabs should have calendar key');
    }
}
