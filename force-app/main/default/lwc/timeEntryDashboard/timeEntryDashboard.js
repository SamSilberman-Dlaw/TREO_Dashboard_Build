import { LightningElement, api, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/ChartJS';
import getAllChartData    from '@salesforce/apex/TimeEntryDashboardController.getAllChartData';
import getAccurateTotals from '@salesforce/apex/TimeEntryDashboardController.getAccurateTotals';
import getTeams          from '@salesforce/apex/TimeEntryDashboardController.getTeams';

const CHART_COLORS = [
    '#0176d3', '#1b96ff', '#032d60', '#0e56c4',
    '#22a5f7', '#5eabf5', '#9dc9f5', '#c9e4fb'
];

const DONUT_COLORS = [
    '#0176d3', '#1b96ff', '#032d60', '#0e56c4',
    '#22a5f7', '#5eabf5', '#9dc9f5', '#c9e4fb',
    '#77b9f2', '#aacff5'
];

const STAFF_COLORS = [
    '#0176d3', '#e06b25', '#2e844a', '#ba0517',
    '#7c3aed', '#c27400', '#0e56c4', '#1a7f3c'
];

export default class TimeEntryDashboard extends LightningElement {

    @api recordId;

    @track startDate  = '';
    @track endDate    = '';
    @track selectedStaffIds = [];
    @track staffDropdownOpen = false;
    @track staffOptions      = [];
    @track selectedTeamId    = '';
    @track teamOptions       = [];
    @track viewMode        = 'all';
    _teamsData             = [];
    @track isLoading       = false;
    @track hasData         = false;
    @track barHasData      = false;
    @track lineHasData     = false;
    @track donutHasData    = false;
    @track hbarHasData     = false;
    @track tableEntries    = [];
    @track sortedBy        = 'date';
    @track sortedDirection = 'desc';
    _rawEntries = [];

    totalHours     = 0;
    entryCount     = 0;
    staffCount     = 0;
    matterCount    = 0;
    prevTotalHours = 0;
    prevEntryCount = 0;

    @track staffTruncated = false;
    @track _drillOpen       = false;
    @track _drillType       = '';
    @track _drillSearch     = '';
    @track _drillSortField  = 'hours';
    @track _drillSortDir    = 'desc';
    _byStaff                = [];
    _byMatter               = [];
    _byDate                 = [];

    _activePreset      = '30';
    _chartjsLoaded     = false;
    _barChart          = null;
    _lineChart         = null;
    _donutChart        = null;
    _hBarChart         = null;
    _pendingRender     = null;
    _loadDebounceTimer = null;
    _chartStaffFilter  = null;
    _chartMatterFilter = null;


    connectedCallback() {
        this._applyPreset('30');
        getTeams()
            .then(teams => {
                this._teamsData = teams;
                this.teamOptions = [
                    { label: 'All Teams', value: '' },
                    ...teams.map(t => ({ label: t.name, value: t.id }))
                ];
            })
            .catch(() => {});

        loadScript(this, CHARTJS + '/chart.umd.min.js')
            .then(() => {
                this._chartjsLoaded = true;
                this._load();
            })
            .catch(() => {});
    }

    /* ── Getters ── */

    get isHomeMode() {
        return !this.recordId;
    }

    get donutTitle() {
        return this.isHomeMode ? 'Top Matters' : 'Staff Share';
    }

    get totalHoursDisplay() {
        return Number(this.totalHours).toFixed(1);
    }

    get dateRangeLabel() {
        if (!this.startDate || !this.endDate) return '';
        const fmt = str => {
            const [year, month, day] = str.split('-').map(Number);
            return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        return `${fmt(this.startDate)} – ${fmt(this.endDate)}`;
    }

    get hasActiveFilter() {
        return this.selectedStaffIds.length > 0 || !!this.selectedTeamId;
    }

    get staffFilterLabel() {
        if (this.selectedStaffIds.length === 0) return 'All Staff';
        if (this.selectedStaffIds.length === 1) {
            const match = this.staffOptions.find(o => o.value === this.selectedStaffIds[0]);
            return match ? match.label : '1 Selected';
        }
        return this.selectedStaffIds.length + ' Selected';
    }

    get staffOptionsForDropdown() {
        const selected = new Set(this.selectedStaffIds);
        return this.staffOptions
            .filter(o => o.value)
            .map(o => ({ label: o.label, value: o.value, checked: selected.has(o.value) }));
    }

    get hasStaffOptions() {
        return this.staffOptions.filter(o => o.value).length > 0;
    }

    get hasEntries() {
        return this.tableEntries.length > 0;
    }

    get tableColumns() {
        return [
            { label: 'Staff', fieldName: 'staff', sortable: true },
            { label: 'Date',  fieldName: 'date',  type: 'date-local', sortable: true,
              typeAttributes: { year: 'numeric', month: 'short', day: 'numeric' } },
            { label: 'Hours', fieldName: 'hours', type: 'number', sortable: true,
              typeAttributes: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
              cellAttributes: { alignment: 'left' } },
            { label: 'Notes', fieldName: 'notes', sortable: true, wrapText: true }
        ];
    }

    get chartFilterLabel() {
        return this._chartStaffFilter || this._chartMatterFilter || '';
    }

    get hasChartFilter() {
        return !!(this._chartStaffFilter || this._chartMatterFilter);
    }

    get prevPeriodLabel() {
        const map = { '7': 'prev 7 days', '15': 'prev 15 days', '30': 'prev 30 days', '90': 'prev 90 days', 'mtd': 'prev month' };
        return map[this._activePreset] || 'prev period';
    }

    get totalHoursDelta()  { return this._computeDelta(this.totalHours,  this.prevTotalHours); }
    get entryCountDelta()  { return this._computeDelta(this.entryCount,  this.prevEntryCount); }

    _computeDelta(curr, prev) {
        if (prev === 0 && curr === 0) return null;
        if (prev === 0) return { label: 'New', cls: 'delta delta--positive' };
        const pct = Math.round((curr - prev) / prev * 100);
        if (pct === 0) return { label: '±0%', cls: 'delta delta--neutral' };
        return { label: (pct > 0 ? '+' : '') + pct + '%', cls: pct > 0 ? 'delta delta--positive' : 'delta delta--negative' };
    }

    /* ── Drill-down modal ── */

    get drillTitle() {
        const map = { hours: 'Total Hours', entries: 'Entries', matters: 'Matters', staff: 'Staff Members' };
        return `${map[this._drillType] || ''} · ${this.dateRangeLabel}`;
    }

    get drillSubtitle() {
        const src = this._drillType === 'matters' ? this._byMatter : this._byStaff;
        const totalH = (src || []).reduce((s, r) => s + Number(r.hours || 0), 0);
        const totalE = (src || []).reduce((s, r) => s + Number(r.count || 0), 0);
        const count  = (src || []).length;
        const label  = this._drillType === 'matters' ? 'matters' : 'staff';
        return `${count} ${label} · ${totalH.toFixed(1)}h · ${totalE} entries`;
    }

    get drillRows() {
        const src = this._drillType === 'matters' ? this._byMatter : this._byStaff;
        let rows = (src || []).map((r, i) => ({
            id:      String(i),
            name:    r.name  || 'Unknown',
            hours:   Number(r.hours || 0),
            entries: Number(r.count || 0)
        }));
        if (this._drillSearch) {
            const q = this._drillSearch.toLowerCase();
            rows = rows.filter(r => (r.name || '').toLowerCase().includes(q));
        }
        const field = this._drillSortField || 'hours';
        const dir   = this._drillSortDir === 'asc' ? 1 : -1;
        return rows.slice().sort((a, b) => {
            const av = a[field] ?? '';
            const bv = b[field] ?? '';
            return av < bv ? -dir : av > bv ? dir : 0;
        });
    }

    get drillColumns() {
        const nameLabel  = this._drillType === 'matters' ? 'Matter' : 'Staff';
        const hoursCol   = { label: 'Hours',   fieldName: 'hours',   type: 'number', sortable: true,
                             typeAttributes: { minimumFractionDigits: 1, maximumFractionDigits: 1 },
                             cellAttributes: { alignment: 'left' } };
        const entriesCol = { label: 'Entries', fieldName: 'entries', type: 'number', sortable: true,
                             cellAttributes: { alignment: 'left' } };
        return [
            { label: nameLabel, fieldName: 'name', sortable: true },
            hoursCol,
            entriesCol
        ];
    }

    handleHoursCardClick()   { this._openDrill('hours'); }
    handleEntriesCardClick() { this._openDrill('entries'); }
    handleMattersCardClick() { this._openDrill('matters'); }
    handleStaffCardClick()   { this._openDrill('staff'); }

    _openDrill(type) {
        this._drillType      = type;
        this._drillSearch    = '';
        this._drillSortField = 'hours';
        this._drillSortDir   = 'desc';
        this._drillOpen      = true;
    }

    closeDrill() { this._drillOpen = false; }

    handleDrillSort(e) {
        this._drillSortField = e.detail.fieldName;
        this._drillSortDir   = e.detail.sortDirection;
    }

    handleDrillSearch(e) {
        this._drillSearch = e.target.value;
    }

    handleDrillExport() {
        const cols = this.drillColumns;
        const rows = this.drillRows;
        const header = cols.map(c => c.label).join(',');
        const body   = rows.map(r =>
            cols.map(c => {
                const v = r[c.fieldName] ?? '';
                return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
            }).join(',')
        ).join('\n');
        const link = this.template.querySelector('.ted-export-link');
        link.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(header + '\n' + body);
        link.download = `${this._drillType}-breakdown.csv`;
        link.click();
    }

    clearChartFilter() {
        this._chartStaffFilter  = null;
        this._chartMatterFilter = null;
        this.tableEntries = this._sortEntries(this._rawEntries);
        if (this._barChart) {
            this._barChart.data.datasets[0].backgroundColor =
                this._barChart.data.labels.map(() => CHART_COLORS[0]);
            this._barChart.update('none');
        }
        if (this._hBarChart) {
            this._hBarChart.data.datasets[0].backgroundColor =
                this._hBarChart.data.labels.map(() => CHART_COLORS[1]);
            this._hBarChart.update('none');
        }
    }

    get staffDisplay() {
        if (this.selectedStaffIds.length === 1) {
            const match = this.staffOptions.find(o => o.value === this.selectedStaffIds[0]);
            return match ? match.label : this.staffCount;
        }
        if (this.selectedStaffIds.length > 1) {
            return this.selectedStaffIds.length + ' Staff';
        }
        if (this.selectedTeamId) {
            const match = this.teamOptions.find(o => o.value === this.selectedTeamId);
            return match ? match.label : this.staffCount;
        }
        return this.staffCount;
    }

    get btnAll()  { return 'preset-btn' + (this.viewMode === 'all'  ? ' preset-btn--active' : ''); }
    get btnMine() { return 'preset-btn' + (this.viewMode === 'mine' ? ' preset-btn--active' : ''); }
    get isAllView() { return this.viewMode === 'all'; }

    get btn7d()  { return this._presetClass('7'); }
    get btn15d() { return this._presetClass('15'); }
    get btn30d() { return this._presetClass('30'); }
    get btn90d() { return this._presetClass('90'); }
    get btnMtd() { return this._presetClass('mtd'); }

    _presetClass(p) {
        return 'preset-btn' + (this._activePreset === p ? ' preset-btn--active' : '');
    }

    /* ── Date presets ── */

    setPreset(e) {
        const p = e.currentTarget.dataset.preset;
        this._activePreset = p;
        this._applyPreset(p);
        this._load();
    }

    _applyPreset(p) {
        const today = new Date();
        const fmt = d => d.toISOString().slice(0, 10);
        this.endDate = fmt(today);

        if (p === 'mtd') {
            this.startDate = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
        } else if (p === 'ytd') {
            this.startDate = fmt(new Date(today.getFullYear(), 0, 1));
        } else {
            const d = new Date(today);
            d.setDate(d.getDate() - parseInt(p, 10) + 1);
            this.startDate = fmt(d);
        }
    }

    handleStartDate(e) {
        this.startDate     = e.target.value;
        this._activePreset = '';
        this._loadDebounced();
    }

    handleEndDate(e) {
        this.endDate       = e.target.value;
        this._activePreset = '';
        this._loadDebounced();
    }

    _loadDebounced() {
        clearTimeout(this._loadDebounceTimer);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._loadDebounceTimer = setTimeout(() => this._load(), 300);
    }

    setView(e) {
        this.viewMode = e.currentTarget.dataset.view;
        if (this.viewMode === 'mine') {
            this.selectedStaffIds = [];
            this.selectedTeamId   = '';
            this.staffDropdownOpen = false;
        }
        this._load();
    }

    toggleStaffDropdown() {
        this.staffDropdownOpen = !this.staffDropdownOpen;
    }

    closeStaffDropdown() {
        this.staffDropdownOpen = false;
    }

    handleStaffCheckbox(e) {
        const val     = e.target.value;
        const checked = e.target.checked;
        if (checked) {
            if (!this.selectedStaffIds.includes(val)) {
                this.selectedStaffIds = [...this.selectedStaffIds, val];
            }
        } else {
            this.selectedStaffIds = this.selectedStaffIds.filter(id => id !== val);
        }
        this.selectedTeamId = '';
        this._load();
    }

    handleTeamChange(e) {
        this.selectedTeamId   = e.target.value;
        if (this.selectedTeamId) this.selectedStaffIds = [];
        this.staffDropdownOpen = false;
        this._load();
    }

    clearFilters() {
        this.selectedStaffIds  = [];
        this.selectedTeamId    = '';
        this.staffDropdownOpen = false;
        this._load();
    }

    /* ── Data load ── */

    _load() {
        if (!this._chartjsLoaded) return;
        this.isLoading = true;
        this._chartStaffFilter  = null;
        this._chartMatterFilter = null;

        let staffIds = this.selectedStaffIds.slice();
        if (staffIds.length === 0 && this.selectedTeamId) {
            const team = this._teamsData.find(t => t.id === this.selectedTeamId);
            staffIds = team ? (team.memberIds || []) : [];
        }

        const params = {
            recordId:  this.recordId || null,
            startDate: this.startDate,
            endDate:   this.endDate,
            staffIds,
            mineOnly:  this.viewMode === 'mine'
        };

        getAllChartData(params)
            .then(raw => {
                const data = {
                    byStaff:        raw.byStaff        || [],
                    staffList:      raw.staffList       || [],
                    staffTruncated: raw.staffTruncated  || false,
                    totalHours:     raw.totalHours      || 0,
                    entryCount:     raw.entryCount      || 0,
                    staffCount:     raw.staffCount      || 0,
                    matterCount:    raw.matterCount     || 0,
                    prevTotalHours: raw.prevTotalHours  || 0,
                    prevEntryCount: raw.prevEntryCount  || 0,
                    entries:        raw.entries         || [],
                    byDate:         raw.byDate          || [],
                    byMatter:       raw.byMatter        || [],
                    byStaffByDate:  raw.byStaffByDate   || []
                };

                this.isLoading      = false;
                this.hasData        = data.byStaff.length > 0 || data.byDate.length > 0;
                this.totalHours     = data.totalHours;
                this.entryCount     = data.entryCount;
                this.staffCount     = data.staffCount;
                this.prevTotalHours = data.prevTotalHours;
                this.prevEntryCount = data.prevEntryCount;
                this.staffTruncated = data.staffTruncated;
                this.matterCount    = data.matterCount;
                this._byStaff       = data.byStaff  || [];
                this._byMatter      = data.byMatter || [];
                this._byDate        = data.byDate   || [];

                this.barHasData   = data.byStaff.length > 0;
                this.lineHasData  = data.byDate.length  > 0;
                const donutRows   = this.isHomeMode ? data.byMatter : data.byStaff;
                this.donutHasData = donutRows.length > 0;
                this.hbarHasData  = data.byMatter.length > 0;

                if (!this.isHomeMode && data.entries.length > 0) {
                    this._rawEntries  = data.entries;
                    this.tableEntries = this._sortEntries(this._applyChartFilter(data.entries));
                }

                if (data.staffList.length > 0) {
                    // Merge into existing list — never shrink when a filter is active
                    const existing = new Map(
                        this.staffOptions.filter(o => o.value).map(o => [o.value, o])
                    );
                    for (const s of data.staffList) { existing.set(s.value, s); }
                    const sorted = [...existing.values()].sort((a, b) =>
                        String(a.label || '').localeCompare(String(b.label || ''))
                    );
                    this.staffOptions = [{ label: 'All Staff', value: '' }, ...sorted];
                }

                if (this.hasData) {
                    // defer one tick so canvas elements are in the DOM
                    // eslint-disable-next-line @lwc/lwc/no-async-operation
                    this._pendingRender = setTimeout(() => this._renderCharts(data), 0);
                }

                // Fire accurate totals in a separate Apex transaction (own 50K budget).
                // Charts already rendered with approximate values; summary cards update
                // silently when this resolves. Failures fall back without error shown.
                getAccurateTotals(params)
                    .then(totals => {
                        if (totals) {
                            this.totalHours  = totals.totalHours;
                            this.entryCount  = totals.entryCount;
                            this.staffCount  = totals.staffCount;
                            if (!this.recordId) this.matterCount = totals.matterCount;
                        }
                    })
                    // eslint-disable-next-line no-unused-vars
                    .catch(_err => {});
            })
            .catch(err => {
                this.isLoading = false;
                const msg = (err && err.body && err.body.message)
                    ? err.body.message
                    : 'Could not load dashboard data. Please refresh the page.';
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error loading data',
                    message: msg,
                    variant: 'error'
                }));
            });
    }

    /* ── Chart rendering ── */

    _renderCharts(data) {
        this._renderBar((data.byStaff || []).slice(0, 20));
        this._renderLine(data.byDate   || [], data.byStaffByDate || []);
        this._renderDonut(
            this.isHomeMode ? (data.byMatter || []) : (data.byStaff || [])
        );
        if (this.isHomeMode) {
            this._renderHBar(data.byMatter || []);
        }
    }

    _datalabelsPlugin(formatFn, fontSize = 11) {
        return {
            id: 'datalabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
                ctx.fillStyle = '#3e3e3c';
                chart.data.datasets.forEach((ds, dsIndex) => {
                    const meta = chart.getDatasetMeta(dsIndex);
                    if (meta.hidden) return;
                    meta.data.forEach((bar, index) => {
                        const raw = ds.data[index];
                        if (!raw || Number(raw) <= 0) return;
                        const { x, y } = bar;
                        const label = formatFn ? formatFn(raw) : raw;
                        if (chart.options.indexAxis === 'y') {
                            ctx.textAlign = 'left';
                            ctx.textBaseline = 'middle';
                            ctx.fillText(label, x + 5, y);
                        } else {
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'bottom';
                            ctx.fillText(label, x, y - 4);
                        }
                    });
                });
                ctx.restore();
            }
        };
    }

    _renderBar(byStaff) {
        const canvas = this.template.querySelector('[data-id="bar-chart"]');
        if (!canvas) return;
        if (this._barChart) { this._barChart.destroy(); }

        const totalHrs = byStaff.reduce((s, r) => s + Number(r.hours || 0), 0);
        const getColors = () => byStaff.map(r =>
            this._chartStaffFilter === null || this._chartStaffFilter === r.name
                ? CHART_COLORS[0] : 'rgba(1,118,211,0.25)'
        );

        // eslint-disable-next-line no-undef
        this._barChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: byStaff.map(r => r.name || 'Unknown'),
                datasets: [{
                    label: 'Hours',
                    data:  byStaff.map(r => Number(r.hours || 0).toFixed(2)),
                    backgroundColor: getColors(),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, elements) => {
                    event.native.target.style.cursor = (!this.isHomeMode && elements.length) ? 'pointer' : 'default';
                },
                onClick: (_event, elements) => {
                    if (this.isHomeMode || !elements.length) return;
                    const label = byStaff[elements[0].index].name;
                    this._chartStaffFilter  = this._chartStaffFilter === label ? null : label;
                    this._chartMatterFilter = null;
                    this.tableEntries = this._sortEntries(this._applyChartFilter(this._rawEntries));
                    this._barChart.data.datasets[0].backgroundColor = getColors();
                    this._barChart.update('none');
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const row = byStaff[ctx.dataIndex];
                                const pct = totalHrs > 0 ? Math.round(Number(ctx.parsed.y) / totalHrs * 100) : 0;
                                return ` ${Number(ctx.parsed.y).toFixed(1)}h · ${row ? row.count || 0 : 0} entries (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => v + 'h' }
                    },
                    x: { grid: { display: false }, ticks: { font: { size: 11 } } }
                }
            },
            plugins: [this._datalabelsPlugin(v => {
                const pct = totalHrs > 0 ? Math.round(Number(v) / totalHrs * 100) : 0;
                return `${pct}%`;
            })]
            });
    }

    _renderLine(byDate, byStaffByDate) {
        const canvas = this.template.querySelector('[data-id="line-chart"]');
        if (!canvas) return;
        if (this._lineChart) { this._lineChart.destroy(); }

        const today = new Date().toISOString().slice(0, 10);
        const rangeDays = (this.startDate && this.endDate)
            ? Math.round((new Date(this.endDate) - new Date(this.startDate)) / 86400000)
            : 30;

        const groupRows = (rows) => {
            const noToday = rows.filter(r => String(r.date).substring(0, 10) !== today);
            if (rangeDays > 365) return this._groupByMonth(noToday);
            if (rangeDays > 90)  return this._groupByWeek(noToday);
            return noToday.filter(r => {
                const [y, m, d] = String(r.date).substring(0, 10).split('-').map(Number);
                return new Date(y, m - 1, d).getDay() % 6 !== 0;
            });
        };

        const toLabel = (r) => {
            if (rangeDays > 365) {
                const [y, m] = r.date.substring(0, 7).split('-').map(Number);
                return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            }
            const [y, m, d] = String(r.date).substring(0, 10).split('-').map(Number);
            return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };

        const isMultiStaff = this.selectedStaffIds.length >= 2
            && byStaffByDate && byStaffByDate.length >= 2;

        let datasets, labels, singlePoints;

        if (isMultiStaff) {
            const staffRows = byStaffByDate.slice(0, STAFF_COLORS.length).map(s => ({
                name: s.staffName,
                pts:  groupRows(s.byDate || [])
            }));
            const allKeys = new Set();
            staffRows.forEach(s => s.pts.forEach(p => allKeys.add(p.date)));
            const sortedKeys = [...allKeys].sort();
            labels = sortedKeys.map(dk => toLabel({ date: dk }));
            datasets = staffRows.map((s, i) => {
                const ptMap = new Map(s.pts.map(p => [p.date, Number(p.hours || 0)]));
                return {
                    label: s.name,
                    data:  sortedKeys.map(dk => (ptMap.get(dk) || 0).toFixed(2)),
                    borderColor:          STAFF_COLORS[i],
                    backgroundColor:      'transparent',
                    borderWidth: 2,
                    pointRadius: rangeDays > 90 ? 4 : 3,
                    pointBackgroundColor: STAFF_COLORS[i],
                    fill: false,
                    tension: 0.3
                };
            });
        } else {
            singlePoints = groupRows(byDate);
            labels = singlePoints.map(toLabel);
            const ctx = canvas.getContext('2d');
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
            gradient.addColorStop(0, 'rgba(1, 118, 211, 0.28)');
            gradient.addColorStop(1, 'rgba(1, 118, 211, 0.0)');
            datasets = [{
                label: 'Hours',
                data:  singlePoints.map(r => Number(r.hours || 0).toFixed(2)),
                borderColor:          CHART_COLORS[0],
                backgroundColor:      gradient,
                borderWidth: 2,
                pointRadius: rangeDays > 90 ? 4 : 3,
                pointBackgroundColor: CHART_COLORS[0],
                fill: true,
                tension: 0.3
            }];
        }

        // eslint-disable-next-line no-undef
        this._lineChart = new Chart(canvas, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: isMultiStaff,
                        position: 'top',
                        labels: { boxWidth: 12, padding: 8, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            title: ctxArr => ctxArr[0].label,
                            label: ctx => {
                                if (isMultiStaff) {
                                    return ` ${ctx.dataset.label}: ${Number(ctx.parsed.y).toFixed(1)}h`;
                                }
                                const row = singlePoints ? singlePoints[ctx.dataIndex] : null;
                                return ` ${Number(ctx.parsed.y).toFixed(1)}h · ${row ? row.count || 0 : 0} entries`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => v + 'h' }
                    },
                    x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45 } }
                }
            }
        });
    }

    _groupByWeek(byDate) {
        const buckets = new Map();
        for (const row of byDate) {
            const [y, m, d] = String(row.date).substring(0, 10).split('-').map(Number);
            const dt  = new Date(y, m - 1, d);
            const dow = dt.getDay();
            const mon = new Date(dt);
            mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
            const key = mon.toISOString().slice(0, 10);
            const cur = buckets.get(key) || { date: key, hours: 0, count: 0 };
            cur.hours += Number(row.hours || 0);
            cur.count += (row.count || 0);
            buckets.set(key, cur);
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([, v]) => v);
    }

    _groupByMonth(byDate) {
        const buckets = new Map();
        for (const row of byDate) {
            const key = String(row.date).substring(0, 7);
            const cur = buckets.get(key) || { date: key + '-01', hours: 0, count: 0 };
            cur.hours += Number(row.hours || 0);
            cur.count += (row.count || 0);
            buckets.set(key, cur);
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([, v]) => v);
    }

    _renderDonut(rows) {
        const canvas = this.template.querySelector('[data-id="donut-chart"]');
        if (!canvas) return;
        if (this._donutChart) { this._donutChart.destroy(); }

        const total = rows.reduce((s, r) => s + Number(r.hours || 0), 0);

        // eslint-disable-next-line no-undef
        this._donutChart = new Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: rows.map(r => r.name || 'Unknown'),
                datasets: [{
                    data: rows.map(r => Number(r.hours || 0).toFixed(2)),
                    backgroundColor: DONUT_COLORS.slice(0, rows.length),
                    borderWidth: 2,
                    borderColor: '#fff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = total > 0 ? Math.round(Number(ctx.parsed) / total * 100) : 0;
                                return ` ${Number(ctx.parsed).toFixed(1)}h (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
    }

    _renderHBar(byMatter) {
        const canvas = this.template.querySelector('[data-id="hbar-chart"]');
        if (!canvas) return;
        if (this._hBarChart) { this._hBarChart.destroy(); }

        const totalHrs = byMatter.reduce((s, r) => s + Number(r.hours || 0), 0);
        const getColors = () => byMatter.map(r =>
            this._chartMatterFilter === null || this._chartMatterFilter === r.name
                ? CHART_COLORS[1] : 'rgba(27,150,255,0.25)'
        );

        // eslint-disable-next-line no-undef
        this._hBarChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: byMatter.map(r => r.name || 'Unknown'),
                datasets: [{
                    label: 'Hours',
                    data:  byMatter.map(r => Number(r.hours || 0).toFixed(2)),
                    backgroundColor: getColors(),
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, elements) => {
                    event.native.target.style.cursor = (!this.isHomeMode && elements.length) ? 'pointer' : 'default';
                },
                onClick: (_event, elements) => {
                    if (this.isHomeMode || !elements.length) return;
                    const label = byMatter[elements[0].index].name;
                    this._chartMatterFilter = this._chartMatterFilter === label ? null : label;
                    this._chartStaffFilter  = null;
                    this.tableEntries = this._sortEntries(this._applyChartFilter(this._rawEntries));
                    this._hBarChart.data.datasets[0].backgroundColor = getColors();
                    this._hBarChart.update('none');
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = totalHrs > 0 ? Math.round(Number(ctx.parsed.x) / totalHrs * 100) : 0;
                                return ` ${Number(ctx.parsed.x).toFixed(1)}h (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => v + 'h' }
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            font: { size: 11 },
                            callback(value) {
                                const label = this.getLabelForValue(value);
                                return label && label.length > 25 ? label.substring(0, 25) + '…' : label;
                            }
                        },
                        afterFit(scale) { scale.width = 210; }
                    }
                }
            },
            plugins: [this._datalabelsPlugin(v => `${Number(v).toFixed(1)}h`)]
        });
    }

    /* ── Table sort + chart filter ── */

    _applyChartFilter(entries) {
        let result = entries;
        if (this._chartStaffFilter)  result = result.filter(r => r.staff  === this._chartStaffFilter);
        if (this._chartMatterFilter) result = result.filter(r => r.matter === this._chartMatterFilter);
        return result;
    }

    handleSort(e) {
        this.sortedBy        = e.detail.fieldName;
        this.sortedDirection = e.detail.sortDirection;
        this.tableEntries    = this._sortEntries(this._applyChartFilter(this._rawEntries));
    }

    _sortEntries(entries) {
        const dir   = this.sortedDirection === 'asc' ? 1 : -1;
        const field = this.sortedBy;
        return [...entries].sort((a, b) => {
            const av = a[field] ?? '';
            const bv = b[field] ?? '';
            return av < bv ? -dir : av > bv ? dir : 0;
        });
    }

    disconnectedCallback() {
        if (this._pendingRender) clearTimeout(this._pendingRender);
        [this._barChart, this._lineChart, this._donutChart, this._hBarChart].forEach(c => {
            if (c) c.destroy();
        });
    }
}
