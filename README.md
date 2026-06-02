# TREO Dashboard — D.Law Salesforce Build

Custom Salesforce LWC dashboard and tooling built for D.Law's litigation operations.

## Orgs

| Alias | Username | Type |
|---|---|---|
| `Prod` | sam.s@d.law | Production |
| `sb2026` | sam.s@d.law.sb2026 | Sandbox |
| `samfr` | sam.s@d.law.samfr | Sandbox |

## Deploying

```bash
# Deploy a component to sandbox
sf project deploy start --source-dir force-app/main/default/lwc/<component> --target-org sb2026

# Deploy to production (always run specified tests)
sf project deploy start --source-dir force-app/main/default/lwc/<component> --target-org Prod --test-level RunSpecifiedTests --tests OperationsConsoleControllerTest
```

---

## Components

### `dlawOperationsConsole`
Home page dashboard panel. Displays critical deadlines, associate events, tasks, and a time entry submission form for the current user.

**Time Entry features:**
- Matter picker (My Cases / All Cases tabs, search)
- Entry cards with staff, date, hours presets (0.1, 0.5, 1, 2, 3, 4, 5), and task note
- **+** button on each card to batch-create multiple entries for the same matter
- Collapse/Expand All, Set All Dates batch bar
- Submit all entries in one call

### `matterTimeEntryPanel`
Record page component placed on the Matter (`NEOS_Matter__c`) page. Identical UI and functionality to the time entry panel in `dlawOperationsConsole`, but auto-loads the current matter — no picker needed.

- Placed via App Builder on the Matter record page
- Remove button and Set All Dates bar only appear when 2+ entries exist
- **+** button for batch entries on the same matter

### `dlawWorkspace`
Tab workspace shell wrapping the home page panels. Manages tab visibility via Custom Permissions.

### `dlawOperationsConsole` — Critical Deadlines
Filters `Calendar_Event__c` records by `Event_Type__c`. Supported types and their colors:

| Type | Color |
|---|---|
| SOL | Red |
| Trial | Purple |
| Class Cert - Hearing | Orange |
| Discovery Cutoff | Blue |
| Opposition to MSJ | Indigo |
| PMK Depo | Green |
| Client Deposition | Teal |
| Hearing | Yellow |
| Motion Deadline | Pink |
| Motion for Summary Judgment Hearing | Lime |
| Discovery Deadline | Cyan |
| Federal - Hearing | Slate |
| Federal - Trial | Rose |

---

## Apex Controllers

### `OperationsConsoleController`
Serves `dlawOperationsConsole` and `matterTimeEntryPanel`.

- `getConsoleData()` — loads deadlines, events, tasks, today's hours
- `getEligibleStaff()` — returns active TREO staff + current user
- `submitTimeEntries(entries)` — bulk inserts `Time_Entry__c` records
- `searchMatters()` / `getRecentMatters()` — matter picker data

Test class: `OperationsConsoleControllerTest` (14 tests)

---

## Docs

- `docs/dlaw-training-guide.html` — User training guide for the Operations Console
- `docs/orb-picker.html` — Orb picker UI prototype
