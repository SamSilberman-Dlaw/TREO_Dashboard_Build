public with sharing class DlawShellController {

    // Profiles that should NOT see the attorney Operations Console tab
    private static final Set<String> SERVICE_PROFILES = new Set<String>{
        'TREO Service Agent',
        'TREO Service Supervisor'
    };

    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getShellConfig() {
        try {
            User u = [
                SELECT Profile.Name, FirstName, Name
                FROM User
                WHERE Id = :UserInfo.getUserId()
                LIMIT 1
            ];
            String  prof     = u.Profile.Name;
            Boolean isStaff  = SERVICE_PROFILES.contains(prof);
            Boolean isAdmin  = prof == 'System Administrator';

            return new Map<String, Object>{
                'userName'  => String.isNotBlank(u.FirstName) ? u.FirstName : u.Name,
                'profile'   => prof,
                'tabs'      => new Map<String, Boolean>{
                    'operations' => !isStaff || isAdmin,
                    'calendar'   => true,
                    'timeEntry'  => true
                }
            };
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }
}
