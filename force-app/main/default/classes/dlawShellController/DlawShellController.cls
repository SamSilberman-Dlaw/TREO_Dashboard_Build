public with sharing class DlawShellController {

    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getShellConfig() {
        try {
            User u = [
                SELECT Profile.Name, UserRole.Name, FirstName, Name
                FROM User
                WHERE Id = :UserInfo.getUserId()
                LIMIT 1
            ];
            String  prof    = u.Profile.Name;
            Boolean isAdmin = prof == 'System Administrator';

            return new Map<String, Object>{
                'userName' => String.isNotBlank(u.FirstName) ? u.FirstName : u.Name,
                'profile'  => prof,
                'role'     => u.UserRole != null ? u.UserRole.Name : null,
                'tabs'     => new Map<String, Boolean>{
                    'operations'      => isAdmin || FeatureManagement.checkPermission('View_Operations_Tab'),
                    'timeEntry'       => isAdmin || FeatureManagement.checkPermission('View_Time_Entry_Tab'),
                    'calendar'        => isAdmin || FeatureManagement.checkPermission('View_Calendar_Tab'),
                    'seniorDashboard' => isAdmin || FeatureManagement.checkPermission('View_Senior_Dashboard')
                }
            };
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }
}
