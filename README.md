# TREO Dashboard — D.Law Salesforce Build

Custom Salesforce Lightning Web Component (LWC) platform built for D.Law's litigation operations. Provides attorneys, paralegals, and senior staff with real-time dashboards for time tracking, matter health, critical deadlines, and team analytics — all surfaced natively inside Salesforce.

---

## Table of Contents

- [Orgs](#orgs)
- [Deploying](#deploying)
- [Architecture Overview](#architecture-overview)
- [Data Model](#data-model)
- [Custom Permissions](#custom-permissions)
- [Components](#components)
  - [dlawOperationsConsole](#dlawoperationsconsole)
  - [timeEntryDashboard](#timentrydashboard)
  - [seniorDashboard](#seniordashboard)
  - [dlawWorkspace](#dlawworkspace)
  - [matterTimeEntryPanel](#mattertimeentrypanel)
  - [multiTimeEntryPanel](#multitimeentrypanel)
  - [criticalDeadlinesPanel](#criticaldeadlinespanel)
  - [associateEventsPanel](#associateeventspanel)
  - [myTasksPanel](#mytaskspanel)
  - [matterPreviewDrawer](#matterpreviewdrawer)
  - [dlawSectionHeader](#dlawsectionheader)
  - [timeEntryRow](#timeentryrow)
- [Apex Controllers](#apex-controllers)
  - [TimeEntryDashboardController](#timeentrydashboardcontroller)
  - [SeniorDashboardController](#seniordashboardcontroller)
  - [dlawConsoleController](#dlawconsolecontroller)
  - [dlawShellController](#dlawshellcontroller)
  - [OperationsConsoleController](#operationsconsolecontroller)
- [Docs](#docs)

---

## Orgs

| Alias | Username | Type |
|---|---|---|
| `Prod` | sam.s@d.law | Production |
| `sb2026` | sam.s@d.law.sb2026 | Sandbox |
| `samfr` | sam.s@d.law.samfr | Sandbox |

---

## Deploying

Always deploy to a sandbox first and verify before pushing to production.

```bash
# Deploy a single LWC component to sandbox
sf project deploy start \
  --source-dir force-app/main/default/lwc/<component> \
  --target-org sb2026

# Deploy an Apex class + its test to sandbox
sf project deploy start \
  --source-dir force-app/main/default/classes/<ClassName> \
  --target-org sb2026

# Deploy to production — always specify tests
sf project deploy start \
  --source-dir force-app/main/default/lwc/<component> \
  --source-dir force-app/main/default/classes/<ClassName> \
  --target-org Prod \
  --test-level RunSpecifiedTests \
  --tests <TestClassName>

# Check connected orgs
sf org list
```

### Test classes per controller

| Controller | Test Class |
|---|---|
| `TimeEntryDashboardController` | `TimeEntryDashboardControllerTest` |
| `OperationsConsoleController` | `OperationsConsoleControllerTest` |
| `SeniorDashboardController` | *(inline with controller)* |
| `dlawConsoleController` | *(inline with controller)* |

> **Coverage requirement:** Salesforce production deployments require ≥75% test coverage per Apex class. The `TimeEntryDashboardController` test suite covers all public methods including `getExportEntries`.

---

## Architecture Overview

```
Home Page (App Builder)
├── dlawWorkspace                  ← tab shell, permission-gated
│   ├── dlawOperationsConsole      ← primary attorney-facing console
│   │   ├── criticalDeadlinesPanel
│   │   ├── associateEventsPanel
│   │   ├── myTasksPanel
│   │   └── multiTimeEntryPanel    ← time entry form
│   └── seniorDashboard            ← senior/exec view (permission-gated)
│
Matter Record Page (App Builder)
├── timeEntryDashboard             ← analytics dashboard (home + matter mode)
└── matterTimeEntryPanel           ← time entry form scoped to matter
```

All components are **pure LWC** — no Aura wrappers. Chart rendering uses **Chart.js** (loaded via Static Resource `ChartJS`). Navigation uses `lightning/navigation` (`NavigationMixin`).

---

## Data Model

### `Time_Entry__c`

The core object for all time tracking. Every submitted entry maps to one record.

| Field | API Name | Type | Notes |
|---|---|---|---|
| Staff | `Staff__c` | Lookup → User | Attorney or paralegal who logged the time |
| Matter | `NEOS_Matter__c` | Lookup → `NEOS_Matter__c` | The matter the time was billed to |
| Entry Date | `Entry_Date__c` | Date | Date the work occurred |
| Submitted Hours | `Submit_Hours__c` | Number | Hours billed (supports decimals, e.g. 0.1) |
| Notes | `Notes__c` | Long Text | Task narrative / billing description |
| Status | `Status__c` | Picklist | Draft, Submitted, etc. |
| Billable | `Billable__c` | Checkbox | Whether the entry is billable |

### `NEOS_Matter__c`

Litigation matters (cases). Referenced as a lookup from `Time_Entry__c` and used throughout the dashboards for matter-scoped filtering.

### `Deadline__c`

Tracks critical litigation deadlines surfaced in `criticalDeadlinesPanel`.

| Field | API Name | Notes |
|---|---|---|
| Matter | `Matter__c` | Parent matter |
| Deadline Date | `Deadline_Date__c` | Date of the deadline |
| Deadline Type | `Deadline_Type__c` | Picklist (SOL, Trial, etc.) |
| Assigned Attorney | `Assigned_Attorney__c` | Lookup → User |
| Status | `Status__c` | Open / Closed |

### `Matter__c` (local schema object)

Used for field definitions referenced in the matter preview drawer and time entry panels. The production matter object is `NEOS_Matter__c`.

---

## Custom Permissions

| Permission API Name | Controls |
|---|---|
| `View_Executive_Dashboard` | Shows the exec eye icon and team-switching controls in `seniorDashboard` |
| `View_Other_Dockets` | Allows viewing dockets not assigned to the current user |
| `View_Team_Dockets` | Allows viewing team-level docket information |

Assign via Permission Sets in Setup.

---

## Components

### `dlawOperationsConsole`

The primary home page panel for attorneys and paralegals. Aggregates all daily work context into a single screen.

**Sections:**
- **Time Metrics bar** — today's hours, week hours, and entry count for the current user
- **Critical Deadlines** — upcoming deadlines from `Deadline__c`, colour-coded by type
- **Associate Events** — upcoming calendar events for the user's team
- **My Tasks** — open tasks assigned to the current user
- **Time Entry Form** — powered by `multiTimeEntryPanel`

**Key behaviours:**
- Loads all data in a single `getConsoleData()` call on mount
- Refresh button reloads all sections simultaneously
- Time entry form auto-populates today's date

---

### `timeEntryDashboard`

The analytics dashboard for time entries. Works in two modes depending on context:

| Mode | Context | Behaviour |
|---|---|---|
| **Home mode** | Placed on the Home page (no `recordId`) | Shows firm-wide or filtered analytics across all matters |
| **Matter mode** | Placed on a Matter record page (has `recordId`) | Scopes all data to that single matter |

#### Filters

| Filter | Description |
|---|---|
| **Date preset** | 7d / 15d / 30d / 90d / MTD / This Week / Last Week |
| **Custom date range** | Free-form start and end date pickers |
| **Staff** | Multi-select dropdown; filters all charts and the entry table |
| **Team** | Selects all members of a Salesforce Public Group (team) |
| **View mode** | All entries vs. My Entries only |

#### Charts (home mode)

| Chart | Description |
|---|---|
| **Hours by Staff** | Vertical bar chart, top 20 staff. Click a bar to filter the entry table. |
| **Hours Over Time** | Line chart by calendar date. Multi-staff mode shows per-staff series. |
| **Top Matters** | Doughnut chart of top 10 matters by hours. Custom HTML legend below canvas. |
| **Hours by Matter** | Horizontal bar chart, top 10 matters. Click a bar to filter the entry table. |

All charts are rendered with **Chart.js** via a `loadScript` call to the `ChartJS` static resource. Charts are destroyed and re-created on each data load to avoid stale state.

#### Drill-down modals

- **Total Hours card** → opens a drill modal showing hours/entries breakdown by matter or staff
- **Entry Count card** → opens a drill modal showing entries by date
- **Staff card** → opens a multi-staff drill listing all entries with search and sort
- **Individual staff bar** → opens a single-staff entry detail modal
- **View All Entries** button → bulk-loads all staff entries for the current filter

#### CSV Export

All exports call `getExportEntries` (LIMIT 50,000) at click time — never limited by what's displayed on screen.

**Filename format:** `{Scope}_{Type}_{Period}.csv`
- Scope: individual name, team name, `DLaw`, or `My-Entries`
- Period: preset label (e.g. `This-Week`) or `MonDD-MonDD-YYYY` for custom ranges

**CSV header rows (always present):**
```
D.Law Time Entries
Period,<human-readable range>
Filter,<staff or team name>     ← only when scope is not firm-wide
Exported,<today's date>

Staff,Date,Matter,Hours,Notes
...data rows...
```

#### `@api` properties

| Property | Type | Description |
|---|---|---|
| `recordId` | String | Matter ID when placed on a record page; omit for home mode |

---

### `seniorDashboard`

Executive and senior staff view of team performance. Gated behind the `View_Executive_Dashboard` custom permission.

**Features:**
- Team hours today and this week with delta indicators
- Matter health panel — flags matters that are behind on time entries
- Per-member stacked bar chart of hours by day
- "View As" team switcher for users with exec permissions
- Refreshable with a single button

**Exec eye icon** appears only when the user holds `View_Executive_Dashboard`. Without it, the component renders a standard senior view.

---

### `dlawWorkspace`

Tab shell wrapping the home page experience. Uses `dlawShellController.getShellConfig()` to determine which tabs are visible based on the current user's permissions and profile. Manages tab state and visibility without page navigation.

---

### `matterTimeEntryPanel`

Identical time entry UI to the panel inside `dlawOperationsConsole`, but designed for the Matter record page. Auto-loads the current matter (`recordId`) — no matter picker is shown.

- Entry cards with staff, date, hours presets, and narrative
- **+** button creates additional entry cards for the same matter
- Set All Dates batch bar
- Submit all entries in a single Apex call

---

### `multiTimeEntryPanel`

The reusable time entry form used by both `dlawOperationsConsole` and `matterTimeEntryPanel`. Manages a list of `timeEntryRow` child components.

**Entry lifecycle:**
1. User selects matter (or matter is pre-loaded from `recordId`)
2. Entry cards created via **+** or on initial load
3. Collapse/Expand All, Set All Dates available when ≥2 cards exist
4. `submitTimeEntries()` called with all entries in one bulk insert

---

### `criticalDeadlinesPanel`

Displays upcoming litigation deadlines filtered from `Deadline__c`. Colour-coded by deadline type:

| Type | Colour |
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

### `associateEventsPanel`

Shows upcoming calendar events for the current user's team. Events are pulled from `Calendar_Event__c` and grouped by date.

---

### `myTasksPanel`

Lists open tasks (`Task`) assigned to the current user. Supports marking tasks complete inline, which calls `completeTask()` and removes the task from the list without a full reload.

---

### `matterPreviewDrawer`

Slide-in drawer providing a quick preview of a matter's key details (case title, assigned attorney, status, estimated hours). Triggered by clicking a matter name in the entry table or drill modal. Uses `getMatterDetail()` to load data.

---

### `dlawSectionHeader`

Shared header component used across panels for consistent section titles, action buttons, and refresh controls.

---

### `timeEntryRow`

Individual time entry card rendered inside `multiTimeEntryPanel`. Manages its own state (matter, date, hours, narrative) and emits change events upward. Hours presets: 0.1, 0.5, 1, 2, 3, 4, 5.

---

## Apex Controllers

### `TimeEntryDashboardController`

Serves `timeEntryDashboard`. Designed around a single large SOQL query (`getAllChartData`) to stay well within Salesforce governor limits.

| Method | Signature | Description |
|---|---|---|
| `getAllChartData` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Primary data method. One raw SELECT (LIMIT 45,000) aggregated in Apex to produce all chart datasets, totals, and previous-period deltas. |
| `getExportEntries` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Dedicated export query. Returns up to 50,000 raw entries with all fields needed for CSV. Called only at export time — never used for display. |
| `getAccurateTotals` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Separate aggregate query for exact COUNT/SUM/COUNT_DISTINCT totals. Called in a second transaction to get accurate figures when the main query is capped. |
| `getTeams` | `()` | Returns Salesforce Public Groups from the `ALLOWED_GROUP_NAMES` allowlist with their member User IDs. Cached. |
| `getAllStaffEntries` | `(staffIds, startDate, endDate)` | Fetches entries for multiple staff for the drill modal display (LIMIT 2,000). |
| `getStaffEntries` | `(staffId, startDate, endDate)` | Fetches entries for a single staff member for the drill modal display (LIMIT 2,000). |
| `getChartData` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Legacy multi-query version of `getAllChartData`. Retained for backward compatibility. |
| `getStaffAndTotals` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Legacy combined method. Retained for test backward compatibility. |
| `getByDate` | `(recordId, startDate, endDate, staffIds, mineOnly)` | Returns daily hour/entry counts for the line chart. |
| `getByMatter` | `(startDate, endDate, staffIds, mineOnly)` | Returns top matters by hours (LIMIT 45,000 raw rows, top 10 returned). |

**Governor limit strategy:**
- `getAllChartData` uses a single `SELECT` with no `ORDER BY` and no secondary aggregates to avoid scan costs. All sorting and aggregation happens in Apex maps.
- The raw query is capped at 45,000 rows; a `dataCapped` flag is returned to the UI when the limit is hit.
- Previous-period totals use whatever row budget remains after the main query (max `49,500 - mainRows`).
- `getExportEntries` runs in its own transaction (separate button click) so it gets a fresh 50,000-row budget.

**Team allowlist** (groups resolvable via `getTeams`):

```
Team Roman, Team Natalie, Team Enoch, Team DK, Team Arsine,
Team Alvin, Team Adam, Paralegals, Litigation Assistants,
Law Motion, Senior Counsel
```

**Test class:** `TimeEntryDashboardControllerTest` — 12 tests, covers all public methods including export, matter-scoped queries, staff filters, `mineOnly`, and blank date fallbacks.

---

### `SeniorDashboardController`

Serves `seniorDashboard`.

| Method | Description |
|---|---|
| `getTeamList()` | Returns all teams available for exec "View As" switching |
| `getDashboardData(viewAsGroupName)` | Returns team hours (today + week), matter health, and per-member chart data for the specified team or the current user's team |

---

### `dlawConsoleController`

Serves `dlawOperationsConsole` and related panels.

| Method | Description |
|---|---|
| `getTimeMetrics()` | Today's and this week's hours + entry count for the current user |
| `getCriticalDeadlines()` | Upcoming `Deadline__c` records, ordered by deadline date |
| `getAssociateEvents()` | Upcoming `Calendar_Event__c` records for the current user's team |
| `getMyTasks()` | Open `Task` records assigned to the current user |
| `getDraftTimeEntries()` | Saved-but-not-submitted time entries for the current user |
| `saveTimeEntries(entriesJson)` | Upserts entries as drafts |
| `submitTimeEntries(entriesJson)` | Bulk inserts `Time_Entry__c` records and marks them submitted |
| `completeTask(taskId)` | Marks a task as complete |
| `getMatterDetail(matterId)` | Returns matter fields for the preview drawer |
| `searchMatters(searchTerm)` | SOSL-based matter search for the matter picker |

---

### `dlawShellController`

Serves `dlawWorkspace`.

| Method | Description |
|---|---|
| `getShellConfig()` | Returns visibility flags for each workspace tab based on the current user's permissions and profile |

---

### `OperationsConsoleController`

Legacy controller retained alongside `dlawConsoleController`. Serves older versions of `dlawOperationsConsole` and `matterTimeEntryPanel`.

| Method | Description |
|---|---|
| `getConsoleData()` | Combined load of deadlines, events, tasks, and today's hours |
| `getEligibleStaff()` | Active TREO staff + current user for the staff picker |
| `submitTimeEntries(entries)` | Bulk inserts `Time_Entry__c` records |
| `searchMatters()` / `getRecentMatters()` | Matter picker data sources |

**Test class:** `OperationsConsoleControllerTest` — 14 tests

---

## Docs

| File | Description |
|---|---|
| `docs/dlaw-training-guide.html` | User training guide for the Operations Console — walkthrough of time entry, matter picker, and daily workflow |
| `docs/orb-picker.html` | UI prototype for the orb-based matter picker interaction |
