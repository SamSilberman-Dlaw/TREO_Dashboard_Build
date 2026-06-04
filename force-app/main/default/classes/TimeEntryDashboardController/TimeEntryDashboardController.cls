public without sharing class TimeEntryDashboardController {

    private static final Set<String> ALLOWED_GROUP_NAMES = new Set<String>{
        'Team Roman', 'Team Natalie', 'Team Enoch', 'Team DK', 'Team Arsine',
        'Team Alvin', 'Team Adam', 'Paralegals', 'Litigation Assistants',
        'Law Motion', 'Senior Counsel'
    };

    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getTeams() {
        List<Group> groups = [
            SELECT Id, Name FROM Group
            WHERE Type = 'Regular' AND Name IN :ALLOWED_GROUP_NAMES
            ORDER BY Name ASC
        ];

        Set<Id> groupIds = new Set<Id>();
        List<Map<String, Object>> teams = new List<Map<String, Object>>();
        Map<Id, List<Id>> membersByGroup = new Map<Id, List<Id>>();

        for (Group g : groups) {
            groupIds.add(g.Id);
            membersByGroup.put(g.Id, new List<Id>());
            Map<String, Object> t = new Map<String, Object>();
            t.put('id',   g.Id);
            t.put('name', g.Name);
            teams.add(t);
        }

        for (GroupMember gm : [
            SELECT GroupId, UserOrGroupId FROM GroupMember WHERE GroupId IN :groupIds
        ]) {
            if (gm.UserOrGroupId.getSObjectType() == User.SObjectType) {
                membersByGroup.get(gm.GroupId).add(gm.UserOrGroupId);
            }
        }

        for (Map<String, Object> t : teams) {
            t.put('memberIds', membersByGroup.get((Id) t.get('id')));
        }

        return teams;
    }

    @AuraEnabled(cacheable=true)
    public static Map<String, Object> getChartData(
        String recordId,
        String startDate,
        String endDate,
        List<String> staffIds,
        Boolean mineOnly
    ) {
        try {
        Date startD = String.isNotBlank(startDate)
            ? Date.valueOf(startDate)
            : Date.today().addDays(-30);
        Date endD = String.isNotBlank(endDate)
            ? Date.valueOf(endDate)
            : Date.today();

        Id matterId = String.isNotBlank(recordId) ? (Id) recordId : null;

        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) {
            staffIdSet.add(UserInfo.getUserId());
        } else if (staffIds != null) {
            for (String s : staffIds) {
                if (String.isNotBlank(s)) staffIdSet.add((Id) s);
            }
        }

        Boolean scopedToMatter = (matterId != null);
        Boolean filterStaff    = !staffIdSet.isEmpty();

        /* ── By Staff + Staff dropdown (combined to reduce SOQL row scans) ── */
        List<Map<String, Object>> byStaff  = new List<Map<String, Object>>();
        List<Map<String, Object>> staffList = new List<Map<String, Object>>();
        String staffQuery =
            'SELECT Staff__c sid, Staff__r.Name sname, SUM(Submit_Hours__c) hrs, COUNT(Id) cnt ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD ' +
            'AND Staff__c != null';
        if (scopedToMatter) staffQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    staffQuery += ' AND Staff__c IN :staffIdSet';
        staffQuery += ' GROUP BY Staff__c, Staff__r.Name ORDER BY SUM(Submit_Hours__c) DESC LIMIT 51';

        for (AggregateResult ar : Database.query(staffQuery)) {
            Map<String, Object> row = new Map<String, Object>();
            row.put('name',  ar.get('sname'));
            row.put('hours', ar.get('hrs'));
            row.put('count', ar.get('cnt'));
            byStaff.add(row);
            Map<String, Object> opt = new Map<String, Object>();
            opt.put('value', String.valueOf(ar.get('sid')));
            opt.put('label', ar.get('sname'));
            staffList.add(opt);
        }
        Boolean staffTruncated = byStaff.size() > 20;
        while (byStaff.size() > 20) byStaff.remove(byStaff.size() - 1);

        /* ── By Date ── */
        List<Map<String, Object>> byDate = new List<Map<String, Object>>();
        String dateQuery =
            'SELECT Entry_Date__c edate, SUM(Submit_Hours__c) hrs, COUNT(Id) cnt ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) dateQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    dateQuery += ' AND Staff__c IN :staffIdSet';
        dateQuery += ' GROUP BY Entry_Date__c ORDER BY Entry_Date__c ASC';

        for (AggregateResult ar : Database.query(dateQuery)) {
            Map<String, Object> row = new Map<String, Object>();
            row.put('date',  String.valueOf(ar.get('edate')));
            row.put('hours', ar.get('hrs'));
            row.put('count', ar.get('cnt'));
            byDate.add(row);
        }

        /* ── By Matter (home page donut) ── */
        List<Map<String, Object>> byMatter = new List<Map<String, Object>>();
        if (!scopedToMatter) {
            String matterQuery =
                'SELECT NEOS_Matter__r.Name mname, SUM(Submit_Hours__c) hrs ' +
                'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
            if (filterStaff) matterQuery += ' AND Staff__c IN :staffIdSet';
            matterQuery += ' GROUP BY NEOS_Matter__r.Name ORDER BY SUM(Submit_Hours__c) DESC LIMIT 10';

            for (AggregateResult ar : Database.query(matterQuery)) {
                Map<String, Object> row = new Map<String, Object>();
                row.put('name',  ar.get('mname'));
                row.put('hours', ar.get('hrs'));
                byMatter.add(row);
            }
        }

        /* ── Summary totals + matter count (combined to reduce SOQL row scans) ── */
        String totalQuery =
            'SELECT COUNT(Id) cnt, SUM(Submit_Hours__c) hrs, COUNT_DISTINCT(NEOS_Matter__c) matters, COUNT_DISTINCT(Staff__c) staffCnt ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) totalQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    totalQuery += ' AND Staff__c IN :staffIdSet';

        Decimal totalHrs = 0;
        Integer totalCnt = 0;
        Integer matterCount = 0;
        Integer staffCount = 0;
        List<AggregateResult> totalResults = Database.query(totalQuery);
        if (!totalResults.isEmpty()) {
            AggregateResult tr = totalResults[0];
            totalHrs    = tr.get('hrs')      != null ? (Decimal)  tr.get('hrs')      : 0;
            totalCnt    = tr.get('cnt')      != null ? (Integer)  tr.get('cnt')      : 0;
            staffCount  = tr.get('staffCnt') != null ? Integer.valueOf(String.valueOf(tr.get('staffCnt'))) : 0;
            if (!scopedToMatter) {
                matterCount = tr.get('matters') != null ? Integer.valueOf(String.valueOf(tr.get('matters'))) : 0;
            }
        }

        /* ── Entry list (matter page only) ── */
        List<Map<String, Object>> entries = new List<Map<String, Object>>();
        if (scopedToMatter) {
            for (Time_Entry__c te : [
                SELECT Id, Staff__r.Name, Entry_Date__c, Submit_Hours__c, Notes__c
                FROM Time_Entry__c
                WHERE NEOS_Matter__c = :matterId
                  AND Entry_Date__c >= :startD AND Entry_Date__c <= :endD
                ORDER BY Entry_Date__c DESC LIMIT 200
            ]) {
                Map<String, Object> row = new Map<String, Object>();
                row.put('id',    te.Id);
                row.put('staff', te.Staff__r.Name);
                row.put('date',  String.valueOf(te.Entry_Date__c));
                row.put('hours', te.Submit_Hours__c);
                row.put('notes', te.Notes__c);
                entries.add(row);
            }
        }

        // staffList already built in combined staff query above

        /* ── Previous period totals (for delta indicators) ── */
        Integer periodDays  = startD.daysBetween(endD);
        if (periodDays < 0) periodDays = 0;
        Date prevEndD   = startD.addDays(-1);
        Date prevStartD = prevEndD.addDays(-periodDays);
        String prevTotalQuery =
            'SELECT COUNT(Id) cnt, SUM(Submit_Hours__c) hrs FROM Time_Entry__c ' +
            'WHERE Entry_Date__c >= :prevStartD AND Entry_Date__c <= :prevEndD';
        if (scopedToMatter) prevTotalQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    prevTotalQuery += ' AND Staff__c IN :staffIdSet';
        Decimal prevTotalHrs = 0;
        Integer prevTotalCnt = 0;
        List<AggregateResult> prevResults = Database.query(prevTotalQuery);
        if (!prevResults.isEmpty()) {
            AggregateResult pr = prevResults[0];
            prevTotalHrs = pr.get('hrs') != null ? (Decimal) pr.get('hrs') : 0;
            prevTotalCnt = pr.get('cnt') != null ? (Integer) pr.get('cnt') : 0;
        }

        Map<String, Object> result = new Map<String, Object>();
        result.put('byStaff',       byStaff);
        result.put('byDate',        byDate);
        result.put('byMatter',      byMatter);
        result.put('entries',       entries);
        result.put('staffList',     staffList);
        result.put('totalHours',    totalHrs);
        result.put('entryCount',    totalCnt);
        result.put('matterCount',   matterCount);
        result.put('staffCount',    staffCount);
        result.put('staffTruncated', staffTruncated);
        result.put('prevTotalHours', prevTotalHrs);
        result.put('prevEntryCount', prevTotalCnt);
        return result;
        } catch (Exception e) {
            throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage());
        }
    }

    /* ── Single-query chart data ─────────────────────────────────────────────
       ONE SOQL query, no ORDER BY, no aggregates — counts only returned rows.
       Everything (byStaff, byDate, byMatter, totals) is aggregated in Apex.
       Row count: exactly min(matching, 45000). Always under the 50K limit.   ── */

    @AuraEnabled
    public static Map<String, Object> getAllChartData(
        String recordId, String startDate, String endDate,
        List<String> staffIds, Boolean mineOnly
    ) {
        try {
        Date startD   = String.isNotBlank(startDate) ? Date.valueOf(startDate) : Date.today().addDays(-30);
        Date endD     = String.isNotBlank(endDate)   ? Date.valueOf(endDate)   : Date.today();
        Id   matterId = String.isNotBlank(recordId)  ? (Id) recordId           : null;
        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) { staffIdSet.add(UserInfo.getUserId()); }
        else if (staffIds != null) { for (String s : staffIds) { if (String.isNotBlank(s)) staffIdSet.add((Id) s); } }
        Boolean scopedToMatter = (matterId != null);
        Boolean filterStaff    = !staffIdSet.isEmpty();

        // No ORDER BY — avoids Salesforce scanning the full result set for sorting.
        // No secondary aggregate queries — those scan all matching rows too.
        String rawQ =
            'SELECT Id, Staff__c, Staff__r.Name, Entry_Date__c, Submit_Hours__c, ' +
            'NEOS_Matter__c, NEOS_Matter__r.Name, Notes__c ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) rawQ += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    rawQ += ' AND Staff__c IN :staffIdSet';
        rawQ += ' LIMIT 45000';

        Map<Id, Decimal>              staffHrs     = new Map<Id, Decimal>();
        Map<Id, Integer>              staffCnts    = new Map<Id, Integer>();
        Map<Id, String>               staffNames   = new Map<Id, String>();
        Map<Id, Map<String, Decimal>> staffDateHrs = new Map<Id, Map<String, Decimal>>();
        Map<String, Decimal> dateHrs     = new Map<String, Decimal>();
        Map<String, Integer> dateCnts    = new Map<String, Integer>();
        Map<Id, Decimal>     matterHrs   = new Map<Id, Decimal>();
        Map<Id, Integer>     matterCnts  = new Map<Id, Integer>();
        Map<Id, String>      matterNames = new Map<Id, String>();
        Set<Id> uniqueStaff   = new Set<Id>();
        Set<Id> uniqueMatters = new Set<Id>();
        Decimal totalHrs = 0;
        Integer totalCnt = 0;
        List<Time_Entry__c> entryRows = new List<Time_Entry__c>();

        List<Time_Entry__c> rows = (List<Time_Entry__c>) Database.query(rawQ);
        for (Time_Entry__c te : rows) {
            Decimal hrs = te.Submit_Hours__c != null ? te.Submit_Hours__c : 0;
            totalHrs += hrs;
            totalCnt++;
            if (te.Staff__c != null) {
                uniqueStaff.add(te.Staff__c);
                if (!staffHrs.containsKey(te.Staff__c)) {
                    staffHrs.put(te.Staff__c, 0); staffCnts.put(te.Staff__c, 0);
                    staffNames.put(te.Staff__c, te.Staff__r != null ? te.Staff__r.Name : '');
                    staffDateHrs.put(te.Staff__c, new Map<String, Decimal>());
                }
                staffHrs.put(te.Staff__c,  staffHrs.get(te.Staff__c)  + hrs);
                staffCnts.put(te.Staff__c, staffCnts.get(te.Staff__c) + 1);
                if (te.Entry_Date__c != null) {
                    String sdk = String.valueOf(te.Entry_Date__c);
                    Map<String, Decimal> sdm = staffDateHrs.get(te.Staff__c);
                    sdm.put(sdk, (sdm.containsKey(sdk) ? sdm.get(sdk) : 0) + hrs);
                }
            }
            if (te.Entry_Date__c != null) {
                String dk = String.valueOf(te.Entry_Date__c);
                if (!dateHrs.containsKey(dk)) { dateHrs.put(dk, 0); dateCnts.put(dk, 0); }
                dateHrs.put(dk,  dateHrs.get(dk)  + hrs);
                dateCnts.put(dk, dateCnts.get(dk) + 1);
            }
            if (te.NEOS_Matter__c != null) {
                uniqueMatters.add(te.NEOS_Matter__c);
                if (!scopedToMatter) {
                    if (!matterHrs.containsKey(te.NEOS_Matter__c)) {
                        matterHrs.put(te.NEOS_Matter__c, 0);
                        matterCnts.put(te.NEOS_Matter__c, 0);
                        matterNames.put(te.NEOS_Matter__c, te.NEOS_Matter__r != null ? te.NEOS_Matter__r.Name : '');
                    }
                    matterHrs.put(te.NEOS_Matter__c, matterHrs.get(te.NEOS_Matter__c) + hrs);
                    matterCnts.put(te.NEOS_Matter__c, matterCnts.get(te.NEOS_Matter__c) + 1);
                }
            }
            if (scopedToMatter) entryRows.add(te);
        }
        Boolean dataCapped = rows.size() == 45000;

        // Previous period — use whatever row budget remains after the main query
        Integer remaining = Math.max(0, 49500 - rows.size());
        Decimal prevTotalHrs = 0;
        Integer prevTotalCnt = 0;
        if (remaining > 0) {
            Integer periodDays = startD.daysBetween(endD);
            if (periodDays < 0) periodDays = 0;
            Date prevEndD   = startD.addDays(-1);
            Date prevStartD = prevEndD.addDays(-periodDays);
            String prevQ =
                'SELECT Submit_Hours__c FROM Time_Entry__c ' +
                'WHERE Entry_Date__c >= :prevStartD AND Entry_Date__c <= :prevEndD';
            if (scopedToMatter) prevQ += ' AND NEOS_Matter__c = :matterId';
            if (filterStaff)    prevQ += ' AND Staff__c IN :staffIdSet';
            prevQ += ' LIMIT ' + remaining;
            for (Time_Entry__c te : (List<Time_Entry__c>) Database.query(prevQ)) {
                prevTotalHrs += te.Submit_Hours__c != null ? te.Submit_Hours__c : 0;
                prevTotalCnt++;
            }
        }

        // byStaff — sorted desc by hours, top 20
        List<String> staffKeys = new List<String>();
        for (Id sid : staffHrs.keySet()) {
            staffKeys.add(String.valueOf(Math.max(0, (Long)(staffHrs.get(sid) * 100))).leftPad(14, '0') + '|' + sid);
        }
        staffKeys.sort();
        List<Map<String, Object>> byStaff      = new List<Map<String, Object>>();
        List<Map<String, Object>> staffList    = new List<Map<String, Object>>();
        List<Map<String, Object>> byStaffByDate = new List<Map<String, Object>>();
        for (Integer i = staffKeys.size() - 1; i >= 0; i--) {
            Id sid = (Id) staffKeys.get(i).split('\\|')[1];
            staffList.add(new Map<String, Object>{ 'value' => String.valueOf(sid), 'label' => staffNames.get(sid) });
            byStaff.add(new Map<String, Object>{ 'name' => staffNames.get(sid), 'hours' => staffHrs.get(sid), 'count' => staffCnts.get(sid) });
            Map<String, Decimal> sdm = staffDateHrs.containsKey(sid) ? staffDateHrs.get(sid) : new Map<String, Decimal>();
            List<String> sdKeys = new List<String>(sdm.keySet());
            sdKeys.sort();
            List<Map<String, Object>> dateList = new List<Map<String, Object>>();
            for (String dk : sdKeys) { dateList.add(new Map<String, Object>{ 'date' => dk, 'hours' => sdm.get(dk) }); }
            byStaffByDate.add(new Map<String, Object>{ 'staffId' => String.valueOf(sid), 'staffName' => staffNames.get(sid), 'byDate' => dateList });
        }
        Boolean staffTruncated = staffList.size() > 20;

        // byDate — sorted asc (ISO date strings sort lexicographically)
        List<String> dateKeys = new List<String>(dateHrs.keySet());
        dateKeys.sort();
        List<Map<String, Object>> byDate = new List<Map<String, Object>>();
        for (String dk : dateKeys) {
            byDate.add(new Map<String, Object>{ 'date' => dk, 'hours' => dateHrs.get(dk), 'count' => dateCnts.get(dk) });
        }

        // byMatter — sorted desc by hours, top 10
        List<Map<String, Object>> byMatter = new List<Map<String, Object>>();
        if (!scopedToMatter) {
            List<String> mKeys = new List<String>();
            for (Id mid : matterHrs.keySet()) {
                mKeys.add(String.valueOf(Math.max(0, (Long)(matterHrs.get(mid) * 100))).leftPad(14, '0') + '|' + mid);
            }
            mKeys.sort();
            for (Integer i = mKeys.size() - 1; i >= 0 && byMatter.size() < 10; i--) {
                Id mid = (Id) mKeys.get(i).split('\\|')[1];
                byMatter.add(new Map<String, Object>{ 'name' => matterNames.get(mid), 'hours' => matterHrs.get(mid), 'count' => matterCnts.get(mid) });
            }
        }

        // entries (matter page) — sort by date desc in Apex, take top 200
        List<Map<String, Object>> entries = new List<Map<String, Object>>();
        if (scopedToMatter && !entryRows.isEmpty()) {
            List<String> eKeys = new List<String>();
            for (Integer i = 0; i < entryRows.size(); i++) {
                String dk = entryRows[i].Entry_Date__c != null ? String.valueOf(entryRows[i].Entry_Date__c) : '0000-00-00';
                eKeys.add(dk + '|' + String.valueOf(i).leftPad(7, '0'));
            }
            eKeys.sort();
            for (Integer i = eKeys.size() - 1; i >= 0 && entries.size() < 200; i--) {
                Integer idx = Integer.valueOf(eKeys.get(i).split('\\|')[1]);
                Time_Entry__c te = entryRows[idx];
                entries.add(new Map<String, Object>{
                    'id' => te.Id, 'staff' => te.Staff__r != null ? te.Staff__r.Name : '',
                    'date' => String.valueOf(te.Entry_Date__c),
                    'hours' => te.Submit_Hours__c, 'notes' => te.Notes__c
                });
            }
        }

        Map<String, Object> result = new Map<String, Object>();
        result.put('byStaff', byStaff); result.put('byDate', byDate); result.put('byMatter', byMatter);
        result.put('byStaffByDate', byStaffByDate);
        result.put('staffList', staffList); result.put('staffTruncated', staffTruncated);
        result.put('entries', entries); result.put('dataCapped', dataCapped);
        result.put('totalHours', totalHrs); result.put('entryCount', totalCnt);
        result.put('staffCount', uniqueStaff.size()); result.put('matterCount', uniqueMatters.size());
        result.put('prevTotalHours', prevTotalHrs); result.put('prevEntryCount', prevTotalCnt);
        return result;
        } catch (Exception e) { throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage()); }
    }

    /* ── Accurate summary totals (separate transaction = own 50K budget) ──────
       Single aggregate query: COUNT, SUM, COUNT_DISTINCT.
       Falls back silently on the JS side if this also exceeds 50K.            ── */
    @AuraEnabled
    public static Map<String, Object> getAccurateTotals(
        String recordId, String startDate, String endDate,
        List<String> staffIds, Boolean mineOnly
    ) {
        try {
        Date startD   = String.isNotBlank(startDate) ? Date.valueOf(startDate) : Date.today().addDays(-30);
        Date endD     = String.isNotBlank(endDate)   ? Date.valueOf(endDate)   : Date.today();
        Id   matterId = String.isNotBlank(recordId)  ? (Id) recordId           : null;
        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) { staffIdSet.add(UserInfo.getUserId()); }
        else if (staffIds != null) { for (String s : staffIds) { if (String.isNotBlank(s)) staffIdSet.add((Id) s); } }
        Boolean scopedToMatter = (matterId != null);
        Boolean filterStaff    = !staffIdSet.isEmpty();

        String q =
            'SELECT COUNT(Id) cnt, SUM(Submit_Hours__c) hrs, ' +
            'COUNT_DISTINCT(NEOS_Matter__c) matters, COUNT_DISTINCT(Staff__c) staffCnt ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) q += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    q += ' AND Staff__c IN :staffIdSet';

        Decimal totalHrs = 0; Integer totalCnt = 0; Integer matterCount = 0; Integer staffCount = 0;
        List<AggregateResult> res = Database.query(q);
        if (!res.isEmpty()) {
            AggregateResult ar = res[0];
            totalHrs   = ar.get('hrs')      != null ? (Decimal)  ar.get('hrs')      : 0;
            totalCnt   = ar.get('cnt')      != null ? (Integer)  ar.get('cnt')      : 0;
            staffCount = ar.get('staffCnt') != null ? Integer.valueOf(String.valueOf(ar.get('staffCnt'))) : 0;
            if (!scopedToMatter) matterCount = ar.get('matters') != null ? Integer.valueOf(String.valueOf(ar.get('matters'))) : 0;
        }

        Map<String, Object> result = new Map<String, Object>();
        result.put('totalHours',  totalHrs);
        result.put('entryCount',  totalCnt);
        result.put('matterCount', matterCount);
        result.put('staffCount',  staffCount);
        return result;
        } catch (Exception e) { throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage()); }
    }

    // Kept for test backward compatibility
    @AuraEnabled
    public static Map<String, Object> getStaffAndTotals(
        String recordId, String startDate, String endDate,
        List<String> staffIds, Boolean mineOnly
    ) {
        try {
        Date startD   = String.isNotBlank(startDate) ? Date.valueOf(startDate) : Date.today().addDays(-30);
        Date endD     = String.isNotBlank(endDate)   ? Date.valueOf(endDate)   : Date.today();
        Id   matterId = String.isNotBlank(recordId)  ? (Id) recordId           : null;
        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) { staffIdSet.add(UserInfo.getUserId()); }
        else if (staffIds != null) { for (String s : staffIds) { if (String.isNotBlank(s)) staffIdSet.add((Id) s); } }
        Boolean scopedToMatter = (matterId != null);
        Boolean filterStaff    = !staffIdSet.isEmpty();

        // Raw SELECT — counts only min(matching, 45000) rows, never blows GROUP BY scan limit
        String rawQ =
            'SELECT Staff__c, Staff__r.Name, Submit_Hours__c ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD AND Staff__c != null';
        if (scopedToMatter) rawQ += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    rawQ += ' AND Staff__c IN :staffIdSet';
        rawQ += ' LIMIT 45000';

        Map<Id, Decimal> staffHrs   = new Map<Id, Decimal>();
        Map<Id, Integer> staffCnts  = new Map<Id, Integer>();
        Map<Id, String>  staffNames = new Map<Id, String>();
        for (Time_Entry__c te : (List<Time_Entry__c>) Database.query(rawQ)) {
            Id sid = te.Staff__c;
            if (!staffHrs.containsKey(sid)) {
                staffHrs.put(sid, 0);
                staffCnts.put(sid, 0);
                staffNames.put(sid, te.Staff__r != null ? te.Staff__r.Name : '');
            }
            staffHrs.put(sid,  staffHrs.get(sid)  + (te.Submit_Hours__c != null ? te.Submit_Hours__c : 0));
            staffCnts.put(sid, staffCnts.get(sid) + 1);
        }

        // Sort by hours desc using zero-padded string key
        List<String> sortKeys = new List<String>();
        for (Id sid : staffHrs.keySet()) {
            Long hk = Math.max(0, (Long)(staffHrs.get(sid) * 100));
            sortKeys.add(String.valueOf(hk).leftPad(14, '0') + '|' + sid);
        }
        sortKeys.sort();

        List<Map<String, Object>> byStaff   = new List<Map<String, Object>>();
        List<Map<String, Object>> staffList = new List<Map<String, Object>>();
        for (Integer i = sortKeys.size() - 1; i >= 0; i--) {
            String[] parts = sortKeys.get(i).split('\\|');
            Id sid = (Id) parts[1];
            Map<String, Object> opt = new Map<String, Object>();
            opt.put('value', String.valueOf(sid));
            opt.put('label', staffNames.get(sid));
            staffList.add(opt);
            if (byStaff.size() < 20) {
                Map<String, Object> row = new Map<String, Object>();
                row.put('name',  staffNames.get(sid));
                row.put('hours', staffHrs.get(sid));
                row.put('count', staffCnts.get(sid));
                byStaff.add(row);
            }
        }
        Boolean staffTruncated = staffList.size() > 20;

        String totalQuery =
            'SELECT COUNT(Id) cnt, SUM(Submit_Hours__c) hrs, COUNT_DISTINCT(NEOS_Matter__c) matters, COUNT_DISTINCT(Staff__c) staffCnt ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) totalQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    totalQuery += ' AND Staff__c IN :staffIdSet';
        Decimal totalHrs = 0; Integer totalCnt = 0; Integer matterCount = 0; Integer staffCount = 0;
        List<AggregateResult> totals = Database.query(totalQuery);
        if (!totals.isEmpty()) {
            AggregateResult tr = totals[0];
            totalHrs   = tr.get('hrs')      != null ? (Decimal) tr.get('hrs')      : 0;
            totalCnt   = tr.get('cnt')      != null ? (Integer) tr.get('cnt')      : 0;
            staffCount = tr.get('staffCnt') != null ? Integer.valueOf(String.valueOf(tr.get('staffCnt'))) : 0;
            if (!scopedToMatter) matterCount = tr.get('matters') != null ? Integer.valueOf(String.valueOf(tr.get('matters'))) : 0;
        }

        Integer periodDays = startD.daysBetween(endD); if (periodDays < 0) periodDays = 0;
        Date prevEndD = startD.addDays(-1); Date prevStartD = prevEndD.addDays(-periodDays);
        String prevQuery = 'SELECT COUNT(Id) cnt, SUM(Submit_Hours__c) hrs FROM Time_Entry__c WHERE Entry_Date__c >= :prevStartD AND Entry_Date__c <= :prevEndD';
        if (scopedToMatter) prevQuery += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    prevQuery += ' AND Staff__c IN :staffIdSet';
        Decimal prevHrs = 0; Integer prevCnt = 0;
        List<AggregateResult> prevRes = Database.query(prevQuery);
        if (!prevRes.isEmpty()) {
            prevHrs = prevRes[0].get('hrs') != null ? (Decimal) prevRes[0].get('hrs') : 0;
            prevCnt = prevRes[0].get('cnt') != null ? (Integer) prevRes[0].get('cnt') : 0;
        }

        List<Map<String, Object>> entries = new List<Map<String, Object>>();
        if (scopedToMatter) {
            for (Time_Entry__c te : [
                SELECT Id, Staff__r.Name, Entry_Date__c, Submit_Hours__c, Notes__c
                FROM Time_Entry__c WHERE NEOS_Matter__c = :matterId
                  AND Entry_Date__c >= :startD AND Entry_Date__c <= :endD
                ORDER BY Entry_Date__c DESC LIMIT 200
            ]) {
                Map<String, Object> row = new Map<String, Object>();
                row.put('id', te.Id); row.put('staff', te.Staff__r.Name);
                row.put('date', String.valueOf(te.Entry_Date__c));
                row.put('hours', te.Submit_Hours__c); row.put('notes', te.Notes__c);
                entries.add(row);
            }
        }

        Map<String, Object> result = new Map<String, Object>();
        result.put('byStaff', byStaff); result.put('staffList', staffList); result.put('staffTruncated', staffTruncated);
        result.put('totalHours', totalHrs); result.put('entryCount', totalCnt);
        result.put('staffCount', staffCount); result.put('matterCount', matterCount);
        result.put('prevTotalHours', prevHrs); result.put('prevEntryCount', prevCnt);
        result.put('entries', entries);
        return result;
        } catch (Exception e) { throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage()); }
    }

    @AuraEnabled
    public static List<Map<String, Object>> getByDate(
        String recordId, String startDate, String endDate,
        List<String> staffIds, Boolean mineOnly
    ) {
        try {
        Date startD   = String.isNotBlank(startDate) ? Date.valueOf(startDate) : Date.today().addDays(-30);
        Date endD     = String.isNotBlank(endDate)   ? Date.valueOf(endDate)   : Date.today();
        Id   matterId = String.isNotBlank(recordId)  ? (Id) recordId           : null;
        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) { staffIdSet.add(UserInfo.getUserId()); }
        else if (staffIds != null) { for (String s : staffIds) { if (String.isNotBlank(s)) staffIdSet.add((Id) s); } }
        Boolean scopedToMatter = (matterId != null);
        Boolean filterStaff    = !staffIdSet.isEmpty();

        String rawQ =
            'SELECT Entry_Date__c, Submit_Hours__c ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (scopedToMatter) rawQ += ' AND NEOS_Matter__c = :matterId';
        if (filterStaff)    rawQ += ' AND Staff__c IN :staffIdSet';
        rawQ += ' LIMIT 45000';

        Map<String, Decimal>  dateHrs  = new Map<String, Decimal>();
        Map<String, Integer>  dateCnts = new Map<String, Integer>();
        for (Time_Entry__c te : (List<Time_Entry__c>) Database.query(rawQ)) {
            String dk = String.valueOf(te.Entry_Date__c);
            if (!dateHrs.containsKey(dk)) { dateHrs.put(dk, 0); dateCnts.put(dk, 0); }
            dateHrs.put(dk,  dateHrs.get(dk)  + (te.Submit_Hours__c != null ? te.Submit_Hours__c : 0));
            dateCnts.put(dk, dateCnts.get(dk) + 1);
        }

        // ISO date strings sort lexicographically = chronologically
        List<String> dateKeys = new List<String>(dateHrs.keySet());
        dateKeys.sort();

        List<Map<String, Object>> byDate = new List<Map<String, Object>>();
        for (String dk : dateKeys) {
            Map<String, Object> row = new Map<String, Object>();
            row.put('date',  dk);
            row.put('hours', dateHrs.get(dk));
            row.put('count', dateCnts.get(dk));
            byDate.add(row);
        }
        return byDate;
        } catch (Exception e) { throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage()); }
    }

    @AuraEnabled
    public static List<Map<String, Object>> getByMatter(
        String startDate, String endDate, List<String> staffIds, Boolean mineOnly
    ) {
        try {
        Date startD = String.isNotBlank(startDate) ? Date.valueOf(startDate) : Date.today().addDays(-30);
        Date endD   = String.isNotBlank(endDate)   ? Date.valueOf(endDate)   : Date.today();
        Set<Id> staffIdSet = new Set<Id>();
        if (mineOnly == true) { staffIdSet.add(UserInfo.getUserId()); }
        else if (staffIds != null) { for (String s : staffIds) { if (String.isNotBlank(s)) staffIdSet.add((Id) s); } }
        Boolean filterStaff = !staffIdSet.isEmpty();

        String rawQ =
            'SELECT NEOS_Matter__c, NEOS_Matter__r.Name, Submit_Hours__c ' +
            'FROM Time_Entry__c WHERE Entry_Date__c >= :startD AND Entry_Date__c <= :endD';
        if (filterStaff) rawQ += ' AND Staff__c IN :staffIdSet';
        rawQ += ' LIMIT 45000';

        Map<Id, Decimal> matterHrs   = new Map<Id, Decimal>();
        Map<Id, String>  matterNames = new Map<Id, String>();
        for (Time_Entry__c te : (List<Time_Entry__c>) Database.query(rawQ)) {
            Id mid = te.NEOS_Matter__c;
            if (mid == null) continue;
            if (!matterHrs.containsKey(mid)) {
                matterHrs.put(mid, 0);
                matterNames.put(mid, te.NEOS_Matter__r != null ? te.NEOS_Matter__r.Name : '');
            }
            matterHrs.put(mid, matterHrs.get(mid) + (te.Submit_Hours__c != null ? te.Submit_Hours__c : 0));
        }

        List<String> sortKeys = new List<String>();
        for (Id mid : matterHrs.keySet()) {
            Long hk = Math.max(0, (Long)(matterHrs.get(mid) * 100));
            sortKeys.add(String.valueOf(hk).leftPad(14, '0') + '|' + mid);
        }
        sortKeys.sort();

        List<Map<String, Object>> byMatter = new List<Map<String, Object>>();
        for (Integer i = sortKeys.size() - 1; i >= 0 && byMatter.size() < 10; i--) {
            String[] parts = sortKeys.get(i).split('\\|');
            Id mid = (Id) parts[1];
            Map<String, Object> row = new Map<String, Object>();
            row.put('name',  matterNames.get(mid));
            row.put('hours', matterHrs.get(mid));
            byMatter.add(row);
        }
        return byMatter;
        } catch (Exception e) { throw new AuraHandledException(e.getTypeName() + ': ' + e.getMessage()); }
    }
}
