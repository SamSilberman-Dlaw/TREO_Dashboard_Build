import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import CHARTJS from '@salesforce/resourceUrl/ChartJS';
import getChartData     from '@salesforce/apex/CalendarEventDashboardController.getChartData';
import getFilterOptions from '@salesforce/apex/CalendarEventDashboardController.getFilterOptions';

const CHART_COLORS = [
    '#0176d3', '#1b96ff', '#032d60', '#0e56c4',
    '#22a5f7', '#5eabf5', '#9dc9f5', '#c9e4fb'
];

const RSVP_COLORS = {
    accepted:  '#2e844a',
    tentative: '#fe9339',
    noResp:    '#9aa7b5',
    declined:  '#ba0517'
};

export default class CalendarEventDashboard extends LightningElement {

    @track startDate      = '';
    @track endDate        = '';
    @track selectedType   = '';
    @track typeOptions    = [];
    @track selectedUserId = '';
    @track userOptions    = [];
    @track viewMode       = 'all';
    @track isLoading      = false;
    @track hasData        = false;
    @track barHasData     = false;
    @track lineHasData    = false;
    @track rsvpHasData    = false;
    @track matterHasData  = false;
    @track tableEntries   = [];
    @track sortedBy        = 'startDate';
    @track sortedDirection = 'asc';
    _rawEntries = [];

    totalEvents        = 0;
    upcomingCount      = 0;
    totalAttendees     = 0;
    acceptanceRate     = 0;
    prevTotalEvents    = 0;
    prevTotalAttendees = 0;

    _activePreset      = '30';
    _chartjsLoaded     = false;
    _barChart          = null;
    _lineChart         = null;
    _rsvpChart         = null;
    _matterChart       = null;
    _pendingRender     = null;
    _loadDebounceTimer = null;
    _chartTypeFilter   = null;
    _chartMatterFilter = null;

    connectedCallback() {
        this._applyPreset('30');
        getFilterOptions()
            .then(opts => { this.typeOptions = opts || []; })
            .catch(() => {});

        loadScript(this, CHARTJS + '/chart.umd.min.js')
            .then(() => {
                this._chartjsLoaded = true;
                this._load();
            })
            .catch(() => {});
    }

    /* ── Getters ── */

    get totalEventsDisplay()    { return this.totalEvents; }
    get totalAttendeesDisplay() { return this.totalAttendees; }
    get acceptanceRateDisplay() { return `${Number(this.acceptanceRate).toFixed(1)}%`; }

    get dateRangeLabel() {
        if (!this.startDate || !this.endDate) return '';
        const fmt = str => {
            const [year, month, day] = str.split('-').map(Number);
            return new Date(year, month - 1, day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        };
        return `${fmt(this.startDate)} – ${fmt(this.endDate)}`;
    }

    get upcomingTableTitle() {
        return this.upcomingCount > 0
            ? `Upcoming Events (${this.upcomingCount})`
            : 'Upcoming Events';
    }

    get hasActiveFilter() {
        return !!(this.selectedType || this.selectedUserId);
    }

    get hasUserOptions() {
        return this.userOptions.length > 1 && this.viewMode !== 'mine';
    }

    get chartFilterLabel() {
        return this._chartTypeFilter || this._chartMatterFilter || '';
    }

    get hasChartFilter() {
        return !!(this._chartTypeFilter || this._chartMatterFilter);
    }

    get prevPeriodLabel() {
        const map = {
            '7': 'prev 7 days', '14': 'prev 14 days', '30': 'prev 30 days',
            '3m': 'prev 3 mo', '6m': 'prev 6 mo', '9m': 'prev 9 mo',
            '1y': 'prev 1 yr', '2y': 'prev 2 yr'
        };
        return map[this._activePreset] || 'prev period';
    }

    get totalEventsDelta()    { return this._computeDelta(this.totalEvents,    this.prevTotalEvents); }
    get totalAttendeesDelta() { return this._computeDelta(this.totalAttendees, this.prevTotalAttendees); }

    _computeDelta(curr, prev) {
        if (prev === 0 && curr === 0) return null;
        if (prev === 0) return { label: 'New', cls: 'delta delta--positive' };
        const pct = Math.round((curr - prev) / prev * 100);
        if (pct === 0) return { label: '±0%', cls: 'delta delta--neutral' };
        return { label: (pct > 0 ? '+' : '') + pct + '%', cls: pct > 0 ? 'delta delta--positive' : 'delta delta--negative' };
    }

    get hasEntries() {
        return this.tableEntries.length > 0;
    }

    get tableColumns() {
        return [
            { label: 'Subject',   fieldName: 'subject',   sortable: true, wrapText: true },
            { label: 'Type',      fieldName: 'eventType', sortable: true, wrapText: true },
            { label: 'Start',     fieldName: 'startDate', type: 'date', sortable: true,
              typeAttributes: { year: 'numeric', month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit' } },
            { label: 'End',       fieldName: 'endDate',   type: 'date', sortable: true,
              typeAttributes: { year: 'numeric', month: 'short', day: 'numeric',
                                hour: '2-digit', minute: '2-digit' } },
            { label: 'Matter',    fieldName: 'matterUrl', type: 'url', sortable: true, wrapText: true,
              typeAttributes: { label: { fieldName: 'matter' }, target: '_blank' } },
            { label: 'Attendees', fieldName: 'attendeeList', sortable: true, wrapText: true }
        ];
    }

    get btnAll()  { return 'preset-btn' + (this.viewMode === 'all'  ? ' preset-btn--active' : ''); }
    get btnMine() { return 'preset-btn' + (this.viewMode === 'mine' ? ' preset-btn--active' : ''); }

    get btn7d()  { return this._presetClass('7'); }
    get btn14d() { return this._presetClass('14'); }
    get btn30d() { return this._presetClass('30'); }
    get btn3m()  { return this._presetClass('3m'); }
    get btn6m()  { return this._presetClass('6m'); }
    get btn9m()  { return this._presetClass('9m'); }
    get btn1y()  { return this._presetClass('1y'); }
    get btn2y()  { return this._presetClass('2y'); }

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
        const fmt   = d => d.toISOString().slice(0, 10);
        this.startDate = fmt(today);

        if (p === '3m') {
            this.endDate = fmt(new Date(today.getFullYear(), today.getMonth() + 3, today.getDate()));
        } else if (p === '6m') {
            this.endDate = fmt(new Date(today.getFullYear(), today.getMonth() + 6, today.getDate()));
        } else if (p === '9m') {
            this.endDate = fmt(new Date(today.getFullYear(), today.getMonth() + 9, today.getDate()));
        } else if (p === '1y') {
            this.endDate = fmt(new Date(today.getFullYear() + 1, today.getMonth(), today.getDate()));
        } else if (p === '2y') {
            this.endDate = fmt(new Date(today.getFullYear() + 2, today.getMonth(), today.getDate()));
        } else if (p === '3y') {
            this.endDate = fmt(new Date(today.getFullYear() + 3, today.getMonth(), today.getDate()));
        } else {
            const d = new Date(today);
            d.setDate(d.getDate() + parseInt(p, 10) - 1);
            this.endDate = fmt(d);
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

    clearChartFilter() {
        this._chartTypeFilter   = null;
        this._chartMatterFilter = null;
        this.tableEntries = this._sortEntries(this._rawEntries);
        if (this._barChart) {
            this._barChart.data.datasets[0].backgroundColor =
                this._barChart.data.labels.map(() => CHART_COLORS[0]);
            this._barChart.update('none');
        }
        if (this._matterChart) {
            this._matterChart.data.datasets[0].backgroundColor =
                this._matterChart.data.labels.map(() => CHART_COLORS[1]);
            this._matterChart.update('none');
        }
    }

    setView(e) {
        this.viewMode = e.currentTarget.dataset.view;
        this._load();
    }

    handleTypeChange(e) {
        this.selectedType = e.target.value;
        this._load();
    }

    handleUserChange(e) {
        this.selectedUserId = e.target.value;
        this._load();
    }

    clearFilters() {
        this.selectedType   = '';
        this.selectedUserId = '';
        this._load();
    }

    /* ── Data load ── */

    _load() {
        if (!this._chartjsLoaded) return;
        this.isLoading = true;
        this._chartTypeFilter   = null;
        this._chartMatterFilter = null;

        getChartData({
            startDate: this.startDate,
            endDate:   this.endDate,
            eventType: this.selectedType   || null,
            mineOnly:  this.viewMode === 'mine',
            userId:    this.selectedUserId || null
        })
        .then(data => {
            this.isLoading     = false;
            this.totalEvents        = data.totalEvents        || 0;
            this.upcomingCount      = data.upcomingCount      || 0;
            this.totalAttendees     = data.totalAttendees     || 0;
            this.acceptanceRate     = data.acceptanceRate     || 0;
            this.prevTotalEvents    = data.prevTotalEvents    || 0;
            this.prevTotalAttendees = data.prevTotalAttendees || 0;

            this.hasData      = (data.byType || []).length > 0 || (data.byDate || []).length > 0;
            this.barHasData   = (data.byType    || []).length > 0;
            this.lineHasData  = (data.byDate    || []).length > 0;
            this.rsvpHasData  = (data.rsvpByType || []).length > 0;
            this.matterHasData = (data.byMatter  || []).length > 0;

            this._rawEntries  = data.upcoming || [];
            this.tableEntries = this._sortEntries(this._applyChartFilter(this._rawEntries));

            if (data.userList && data.userList.length > 0) {
                this.userOptions = [{ label: 'All Users', value: '' }, ...data.userList];
            }

            if (this.hasData) {
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                this._pendingRender = setTimeout(() => this._renderCharts(data), 0);
            }
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
        this._renderBar(data.byType       || []);
        this._renderLine(data.byDate      || []);
        this._renderRsvp(data.rsvpByType  || []);
        this._renderMatter(data.byMatter  || []);
    }

    _datalabelsPlugin(formatFn) {
        return {
            id: 'datalabels',
            afterDatasetsDraw(chart) {
                const { ctx } = chart;
                ctx.save();
                ctx.font = '600 11px Inter, system-ui, sans-serif';
                ctx.fillStyle = '#3e3e3c';
                chart.data.datasets.forEach((ds, dsIndex) => {
                    const meta = chart.getDatasetMeta(dsIndex);
                    if (meta.hidden) return;
                    meta.data.forEach((bar, index) => {
                        const raw = ds.data[index];
                        if (!raw || raw <= 0) return;
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

    _renderBar(byType) {
        const canvas = this.template.querySelector('[data-id="bar-chart"]');
        if (!canvas) return;
        if (this._barChart) { this._barChart.destroy(); }

        const total = byType.reduce((s, r) => s + (r.count || 0), 0);
        const getColors = () => byType.map(r =>
            this._chartTypeFilter === null || this._chartTypeFilter === r.name
                ? CHART_COLORS[0] : 'rgba(1,118,211,0.25)'
        );

        // eslint-disable-next-line no-undef
        this._barChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: byType.map(r => r.name),
                datasets: [{
                    label: 'Events',
                    data:  byType.map(r => r.count || 0),
                    backgroundColor: getColors(),
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                },
                onClick: (_event, elements) => {
                    if (!elements.length) return;
                    const label = byType[elements[0].index].name;
                    this._chartTypeFilter   = this._chartTypeFilter === label ? null : label;
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
                                const pct = total > 0 ? Math.round(ctx.parsed.y / total * 100) : 0;
                                return ` ${ctx.parsed.y} events (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 } }
                    }
                }
            },
            plugins: [this._datalabelsPlugin()]
        });
    }

    _renderLine(byDate) {
        const canvas = this.template.querySelector('[data-id="line-chart"]');
        if (!canvas) return;
        if (this._lineChart) { this._lineChart.destroy(); }

        const rangeDays = (this.startDate && this.endDate)
            ? Math.round((new Date(this.endDate) - new Date(this.startDate)) / 86400000)
            : 30;

        let points, labelFn;
        if (rangeDays > 365) {
            points  = this._groupByMonth(byDate);
            labelFn = r => {
                const [y, m] = r.date.substring(0, 7).split('-').map(Number);
                return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            };
        } else if (rangeDays > 90) {
            points  = this._groupByWeek(byDate);
            labelFn = r => {
                const [y, m, d] = r.date.split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            };
        } else {
            points  = byDate;
            labelFn = r => {
                const [y, m, d] = String(r.date).substring(0, 10).split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            };
        }

        const ctx = canvas.getContext('2d');
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
        gradient.addColorStop(0, 'rgba(1, 118, 211, 0.28)');
        gradient.addColorStop(1, 'rgba(1, 118, 211, 0.0)');

        // eslint-disable-next-line no-undef
        this._lineChart = new Chart(canvas, {
            type: 'line',
            data: {
                labels: points.map(labelFn),
                datasets: [{
                    label: 'Events',
                    data:  points.map(r => r.count || 0),
                    borderColor:     CHART_COLORS[0],
                    backgroundColor: gradient,
                    borderWidth: 2,
                    pointRadius: rangeDays > 90 ? 4 : 3,
                    pointBackgroundColor: CHART_COLORS[0],
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            title: ctxArr => ctxArr[0].label,
                            label: ctx => ` ${ctx.parsed.y} event${ctx.parsed.y !== 1 ? 's' : ''}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 11 }, maxRotation: 45 }
                    }
                }
            }
        });
    }

    _groupByWeek(rows) {
        const buckets = new Map();
        for (const row of rows) {
            const [y, m, d] = String(row.date).substring(0, 10).split('-').map(Number);
            const dt  = new Date(y, m - 1, d);
            const dow = dt.getDay();
            const mon = new Date(dt);
            mon.setDate(dt.getDate() - (dow === 0 ? 6 : dow - 1));
            const key = mon.toISOString().slice(0, 10);
            buckets.set(key, (buckets.get(key) || 0) + (row.count || 0));
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([date, count]) => ({ date, count }));
    }

    _groupByMonth(rows) {
        const buckets = new Map();
        for (const row of rows) {
            const key = String(row.date).substring(0, 7);
            buckets.set(key, (buckets.get(key) || 0) + (row.count || 0));
        }
        return [...buckets.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, count]) => ({ date: key + '-01', count }));
    }

    _renderRsvp(rsvpByType) {
        const canvas = this.template.querySelector('[data-id="rsvp-chart"]');
        if (!canvas) return;
        if (this._rsvpChart) { this._rsvpChart.destroy(); }

        // eslint-disable-next-line no-undef
        this._rsvpChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: rsvpByType.map(r => r.name),
                datasets: [
                    { label: 'Accepted',    data: rsvpByType.map(r => r.accepted  || 0), backgroundColor: RSVP_COLORS.accepted,  stack: 'rsvp' },
                    { label: 'Tentative',   data: rsvpByType.map(r => r.tentative || 0), backgroundColor: RSVP_COLORS.tentative, stack: 'rsvp' },
                    { label: 'No Response', data: rsvpByType.map(r => r.noResp    || 0), backgroundColor: RSVP_COLORS.noResp,    stack: 'rsvp' },
                    { label: 'Declined',    data: rsvpByType.map(r => r.declined  || 0), backgroundColor: RSVP_COLORS.declined,  stack: 'rsvp' }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10, font: { size: 11 } } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const row = rsvpByType[ctx.dataIndex];
                                const total = (row.accepted || 0) + (row.tentative || 0) + (row.noResp || 0) + (row.declined || 0);
                                const pct = total > 0 ? Math.round(ctx.parsed.y / total * 100) : 0;
                                return ` ${ctx.dataset.label}: ${ctx.parsed.y} (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' }
                    }
                }
            }
        });
    }

    _renderMatter(byMatter) {
        const canvas = this.template.querySelector('[data-id="matter-chart"]');
        if (!canvas) return;
        if (this._matterChart) { this._matterChart.destroy(); }

        const total = byMatter.reduce((s, r) => s + (r.count || 0), 0);
        const getColors = () => byMatter.map(r =>
            this._chartMatterFilter === null || this._chartMatterFilter === r.name
                ? CHART_COLORS[1] : 'rgba(27,150,255,0.25)'
        );

        // eslint-disable-next-line no-undef
        this._matterChart = new Chart(canvas, {
            type: 'bar',
            data: {
                labels: byMatter.map(r => r.name || 'Unknown'),
                datasets: [{
                    label: 'Events',
                    data:  byMatter.map(r => r.count || 0),
                    backgroundColor: getColors(),
                    borderRadius: 4
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                onHover: (event, elements) => {
                    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
                },
                onClick: (_event, elements) => {
                    if (!elements.length) return;
                    const label = byMatter[elements[0].index].name;
                    this._chartMatterFilter  = this._chartMatterFilter === label ? null : label;
                    this._chartTypeFilter    = null;
                    this.tableEntries = this._sortEntries(this._applyChartFilter(this._rawEntries));
                    this._matterChart.data.datasets[0].backgroundColor = getColors();
                    this._matterChart.update('none');
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const pct = total > 0 ? Math.round(ctx.parsed.x / total * 100) : 0;
                                return ` ${ctx.parsed.x} events (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.06)' },
                        border: { display: false },
                        ticks: { font: { size: 11 }, callback: v => Number.isInteger(v) ? v : '' }
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
            plugins: [this._datalabelsPlugin()]
        });
    }

    /* ── Table sort + chart filter ── */

    _applyChartFilter(entries) {
        let result = entries;
        if (this._chartTypeFilter)   result = result.filter(r => r.eventType === this._chartTypeFilter);
        if (this._chartMatterFilter) result = result.filter(r => r.matter    === this._chartMatterFilter);
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
        [this._barChart, this._lineChart, this._rsvpChart, this._matterChart].forEach(c => {
            if (c) c.destroy();
        });
    }
}
