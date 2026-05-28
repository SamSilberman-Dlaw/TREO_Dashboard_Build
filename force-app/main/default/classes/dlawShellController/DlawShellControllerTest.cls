@IsTest
private class DlawShellControllerTest {

    @IsTest
    static void testGetShellConfig() {
        Test.startTest();
        Map<String, Object> config = DlawShellController.getShellConfig();
        Test.stopTest();

        System.assertNotEquals(null, config, 'Config should not be null');
        System.assert(config.containsKey('tabs'),     'Config should contain tabs');
        System.assert(config.containsKey('userName'), 'Config should contain userName');
        System.assert(config.containsKey('profile'),  'Config should contain profile');

        Map<String, Boolean> tabs = (Map<String, Boolean>) config.get('tabs');
        System.assert(tabs.containsKey('operations'), 'Tabs should have operations key');
        System.assert(tabs.containsKey('calendar'),   'Tabs should have calendar key');
        System.assert(tabs.containsKey('timeEntry'),  'Tabs should have timeEntry key');

        System.assertEquals(true,  tabs.get('calendar'),   'Calendar tab should always be visible');
        System.assertEquals(true,  tabs.get('timeEntry'),  'Time Entry tab should always be visible');
    }
}
