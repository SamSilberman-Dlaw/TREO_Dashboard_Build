import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDashboardData from '@salesforce/apex/SeniorDashboardController.getDashboardData';

const REFRESH_MS  = 5 * 60 * 1000;
const DAILY_GOAL  = 8;

const STATUS_LABELS = { atrisk: 'At Risk', caution: 'Caution', ontrack: 'On Track' };
const FILTER_LABELS = { all: 'All', atrisk: 'At Risk', caution: 'Caution', ontrack: 'On Track' };

const STAGE_COLORS = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444',
    '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16'
];

export default class SeniorDashboard extends NavigationMixin(LightningElement) {

    @track isLoading         = false;
    @track isRefreshing      = false;
    @track matterHealth      = [];
    @track teamStats         = [];
    @track chartMembers      = [];
    @track matterFilter      = 'all';
    @track lastRefreshLabel  = '';

    matterCount          = 0;
    upcomingDeadlines    = 0;
    behindCount          = 0;
    teamMemberCount      = 0;
    teamHoursToday       = 0;
    teamHoursWeek        = 0;
    firstName            = '';
    teamGroupName        = '';
    chartStageOrder      = [];

    _rawMatterHealth     = [];
    _rawChartMembers     = [];
    _refreshInterval     = null;
    _activeDrillMemberId = null;
    _activeDrillStage    = null;

    connectedCallback() {
        this._load();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._refreshInterval = setInterval(() => this._silentRefresh(), REFRESH_MS);
    }

    disconnectedCallback() {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = null;
        }
    }

    /* ── Data ── */

    _load() {
        this.isLoading = true;
        getDashboardData()
            .then(data => this._applyData(data))
            .catch(err => {
                this.isLoading = false;
                const msg = err?.body?.message || 'Could not load senior dashboard. Please refresh.';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            });
    }

    _silentRefresh() {
        getDashboardData()
            .then(data => this._applyData(data))
            .catch(() => {});
    }

    handleRefresh() {
        this.isRefreshing = true;
        getDashboardData()
            .then(data => { this._applyData(data); this.isRefreshing = false; })
            .catch(() => { this.isRefreshing = false; });
    }

    _applyData(data) {
        this.isLoading          = false;
        this.lastRefreshLabel   = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        this.matterCount        = data.matterCount        || 0;
        this.upcomingDeadlines  = data.upcomingDeadlineCount || 0;
        this.behindCount        = data.behindCount        || 0;
        this.teamMemberCount    = data.teamMemberCount    || 0;
        this.teamHoursToday     = data.teamHoursToday     || 0;
        this.teamHoursWeek      = data.teamHoursWeek      || 0;
        this.firstName          = data.firstName          || '';
        this.teamGroupName      = data.teamGroupName      || '';

        this._rawMatterHealth = this._processMatterHealth(data.matterHealth || []);
        this.teamStats        = this._processTeamStats(data.teamStats       || []);
        this._applyMatterFilter();

        const chart = data.managerChart || {};
        this.chartStageOrder  = chart.stageOrder || [];
        this._rawChartMembers = chart.members    || [];
        this._buildChartRows();
    }

    _processMatterHealth(rows) {
        return rows.map(m => {
            const dl        = m.nextDeadline;
            const daysAway  = dl ? dl.daysAway : null;
            const dlLabel   = daysAway == null ? '' : daysAway === 0 ? 'Today' : daysAway === 1 ? '1 day' : `${daysAway} days`;
            const dlUrgent  = daysAway != null && daysAway <= 7;
            const dlCaution = daysAway != null && daysAway <= 14;
            const hasEntry    = !!m.lastEntryDate;
            const lastEntry   = hasEntry ? this._fmtDate(m.lastEntryDate) : 'No entries';
            return {
                ...m,
                statusLabel:     STATUS_LABELS[m.status] || m.status,
                statusClass:     `sd-matter-status sd-matter-status--${m.status}`,
                rowClass:        `sd-matter-row sd-matter-row--${m.status}`,
                dlLabel,
                dlType:          dl ? dl.eventType : '',
                dlUrgent,
                dlCaution,
                lastEntryLabel:  lastEntry,
                lastEntryClass:  `sd-matter-entry${hasEntry ? '' : ' sd-matter-entry--never'}`,
                hasDeadline:     !!dl,
                hasOverdue:      m.overdueTasks > 0,
                hasTeamLabel:    !!(m.associateName || m.lssName),
                teamLabel:       [m.associateName, m.lssName].filter(Boolean).join(' · '),
                hasRecordType:   !!m.recordType
            };
        });
    }

    _processTeamStats(rows) {
        return rows.map(s => {
            const hrs    = Number(s.hoursToday) || 0;
            const pct    = Math.min(Math.round(hrs / DAILY_GOAL * 100), 100);
            const status   = hrs > 0 ? 'ontrack' : 'behind';
            const parts    = String(s.name || '').split(' ');
            const initials = (String(s.firstName || parts[0] || '').slice(0, 1)
                + (parts.length > 1 ? parts[parts.length - 1].slice(0, 1) : '')).toUpperCase();
            return {
                ...s,
                hoursDisplay:  Number(s.hoursToday).toFixed(1),
                weekDisplay:   Number(s.hoursWeek).toFixed(1),
                barWidth:      `${pct}%`,
                barClass:      `sd-team-bar sd-team-bar--${status}`,
                avatarClass:   `sd-team-avatar sd-team-avatar--${status}`,
                statusClass:   `sd-team-status sd-team-status--${status}`,
                initials
            };
        });
    }

    _applyMatterFilter() {
        this.matterHealth = this.matterFilter === 'all'
            ? this._rawMatterHealth
            : this._rawMatterHealth.filter(m => m.status === this.matterFilter);
    }

    _buildChartRows() {
        const stageOrder = this.chartStageOrder;
        this.chartMembers = this._rawChartMembers.map(m => {
            const total    = m.total || 0;
            const segments = (m.segments || []).map(seg => {
                const si      = stageOrder.indexOf(seg.stage);
                const color   = STAGE_COLORS[(si >= 0 ? si : 0) % STAGE_COLORS.length];
                const pct     = total > 0 ? (seg.count / total) * 100 : 0;
                const isActive = this._activeDrillMemberId === m.id && this._activeDrillStage === seg.stage;
                return {
                    ...seg,
                    style:     `width:${pct.toFixed(1)}%;background-color:${color}`,
                    btnClass:  `sd-chart-seg${isActive ? ' sd-chart-seg--active' : ''}`,
                    tooltip:   `${seg.stage}: ${seg.count} matter${seg.count !== 1 ? 's' : ''}`,
                    showLabel: pct >= 10
                };
            });

            const showDrill    = this._activeDrillMemberId === m.id && !!this._activeDrillStage;
            const activeSeg    = showDrill ? (m.segments || []).find(s => s.stage === this._activeDrillStage) : null;
            const drillMatters = activeSeg ? (activeSeg.matters || []) : [];

            return {
                ...m,
                segments,
                hasSegments:   segments.length > 0,
                showDrill,
                drillTitle:    showDrill ? `${m.firstName} — ${this._activeDrillStage} (${drillMatters.length})` : '',
                drillStage:    this._activeDrillStage || '',
                drillCloseTip: `Close ${m.firstName}`,
                drillMatters
            };
        });
    }

    /* ── Getters ── */

    get refreshBtnLabel()           { return this.isRefreshing ? '…' : '↻'; }
    get teamHoursTodayDisplay()     { return Number(this.teamHoursToday).toFixed(1); }
    get teamHoursWeekDisplay()      { return Number(this.teamHoursWeek).toFixed(1); }
    get hasMatterHealth()           { return this.matterHealth.length > 0; }
    get hasTeamStats()              { return this.teamStats.length > 0; }
    get showChartSection()          { return this.teamStats.length > 0; }
    get hasChartData()              { return this.chartMembers.some(m => m.hasSegments); }
    get todayLabel()                { return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }

    get teamHoursTodayCardClass() {
        return this.teamHoursToday > 0 ? 'sd-sc sd-sc--blue' : 'sd-sc sd-sc--gray';
    }
    get teamHoursWeekCardClass() {
        return this.teamHoursWeek > 0 ? 'sd-sc sd-sc--indigo' : 'sd-sc sd-sc--gray';
    }
    get teamHoursWeekPerPerson() {
        if (!this.teamMemberCount) return '';
        const avg = (Number(this.teamHoursWeek) / this.teamMemberCount).toFixed(1);
        return `~${avg}h / person`;
    }
    get behindCountSub() {
        if (this.behindCount === 0) return `All ${this.teamMemberCount} on track`;
        return `of ${this.teamMemberCount} members`;
    }

    get behindCardClass() {
        return this.behindCount > 0 ? 'sd-sc sd-sc--red' : 'sd-sc sd-sc--green';
    }
    get behindIconClass() {
        return this.behindCount > 0 ? 'sd-sc-icon sd-sc-icon--red' : 'sd-sc-icon sd-sc-icon--green';
    }
    get upcomingCardClass() {
        return this.upcomingDeadlines > 0 ? 'sd-sc sd-sc--orange' : 'sd-sc sd-sc--gray';
    }

    get matterFilterBtns() {
        return ['all', 'atrisk', 'caution', 'ontrack'].map(f => ({
            key:    f,
            label:  FILTER_LABELS[f],
            cls:    'sd-filter-btn' + (this.matterFilter === f ? ' sd-filter-btn--active' : ''),
            count:  f === 'all' ? this._rawMatterHealth.length
                                : this._rawMatterHealth.filter(m => m.status === f).length
        }));
    }

    get matterPanelHeader() {
        const n     = this.matterHealth.length;
        const total = this._rawMatterHealth.length;
        const name  = this.teamGroupName || 'Team';
        return this.matterFilter === 'all'
            ? `${name} Matters (${total})`
            : `${name} Matters — ${FILTER_LABELS[this.matterFilter]} (${n} of ${total})`;
    }

    get teamPanelHeader() {
        const n    = this.teamStats.length;
        const name = this.teamGroupName || 'My Team';
        return `${name} — Today${n > 0 ? ` (${n})` : ''}`;
    }

    get chartPanelHeader() {
        const name  = this.teamGroupName || 'My Team';
        const total = this.chartMembers.reduce((s, m) => s + (m.total || 0), 0);
        return `${name} — Matters by Stage · ${total} active`;
    }

    get chartStageLegend() {
        return this.chartStageOrder.map((stage, i) => ({
            stage,
            dotStyle: `background-color:${STAGE_COLORS[i % STAGE_COLORS.length]}`
        }));
    }

    get emptyMatterMessage() {
        if (this._rawMatterHealth.length === 0) return 'No matters found for your team.';
        return `No ${FILTER_LABELS[this.matterFilter].toLowerCase()} matters.`;
    }

    /* ── Handlers ── */

    setMatterFilter(e) {
        this.matterFilter = e.currentTarget.dataset.filter;
        this._applyMatterFilter();
    }

    handleMatterClick(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: id, actionName: 'view' }
        });
    }

    handleChartSegmentClick(e) {
        const memberId = e.currentTarget.dataset.memberId;
        const stage    = e.currentTarget.dataset.stage;
        if (this._activeDrillMemberId === memberId && this._activeDrillStage === stage) {
            this._activeDrillMemberId = null;
            this._activeDrillStage    = null;
        } else {
            this._activeDrillMemberId = memberId;
            this._activeDrillStage    = stage;
        }
        this._buildChartRows();
    }

    /* ── Helpers ── */

    _fmtDate(isoStr) {
        if (!isoStr) return '';
        const [y, m, d] = isoStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}
