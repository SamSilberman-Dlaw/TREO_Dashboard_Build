import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getDashboardData from '@salesforce/apex/SeniorDashboardController.getDashboardData';

const REFRESH_MS  = 5 * 60 * 1000;
const DAILY_GOAL  = 8;

const STATUS_LABELS = { atrisk: 'At Risk', caution: 'Needs Attention', ontrack: 'On Track' };
const FILTER_LABELS = { all: 'All', atrisk: 'At Risk', caution: 'Attention', ontrack: 'On Track' };

export default class SeniorDashboard extends NavigationMixin(LightningElement) {

    @track isLoading         = false;
    @track isRefreshing      = false;
    @track matterHealth      = [];
    @track teamStats         = [];
    @track matterFilter      = 'all';
    @track lastRefreshLabel  = '';

    matterCount          = 0;
    upcomingDeadlines    = 0;
    behindCount          = 0;
    teamMemberCount      = 0;
    myHoursToday         = 0;
    myHoursWeek          = 0;
    firstName            = '';
    teamGroupName        = '';

    _rawMatterHealth = [];
    _refreshInterval = null;

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
        this.myHoursToday       = data.myHoursToday       || 0;
        this.myHoursWeek        = data.myHoursWeek        || 0;
        this.firstName          = data.firstName          || '';
        this.teamGroupName      = data.teamGroupName      || '';

        this._rawMatterHealth = this._processMatterHealth(data.matterHealth || []);
        this.teamStats        = this._processTeamStats(data.teamStats       || []);
        this._applyMatterFilter();
    }

    _processMatterHealth(rows) {
        return rows.map(m => {
            const dl        = m.nextDeadline;
            const daysAway  = dl ? dl.daysAway : null;
            const dlLabel   = daysAway == null ? '' : daysAway === 0 ? 'Today' : daysAway === 1 ? '1 day' : `${daysAway} days`;
            const dlUrgent  = daysAway != null && daysAway <= 7;
            const dlCaution = daysAway != null && daysAway <= 14;
            const lastEntry = m.lastEntryDate
                ? this._fmtDate(m.lastEntryDate)
                : 'Never';
            return {
                ...m,
                statusLabel:    STATUS_LABELS[m.status] || m.status,
                statusClass:    `sd-matter-status sd-matter-status--${m.status}`,
                rowClass:       `sd-matter-row sd-matter-row--${m.status}`,
                dlLabel,
                dlType:         dl ? dl.eventType : '',
                dlUrgent,
                dlCaution,
                lastEntryLabel: lastEntry,
                hasDeadline:    !!dl,
                hasOverdue:     m.overdueTasks > 0,
                hasTeamLabel:   !!(m.associateName || m.lssName),
                teamLabel:      [m.associateName, m.lssName].filter(Boolean).join(' · ')
            };
        });
    }

    _processTeamStats(rows) {
        return rows.map(s => {
            const hrs    = Number(s.hoursToday) || 0;
            const pct    = Math.min(Math.round(hrs / DAILY_GOAL * 100), 100);
            const status = hrs >= DAILY_GOAL ? 'ontrack' : hrs >= 4 ? 'caution' : 'behind';
            const initials = String(s.firstName || s.name || '').slice(0, 2).toUpperCase();
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

    /* ── Getters ── */

    get refreshBtnLabel()     { return this.isRefreshing ? '…' : '↻'; }
    get myHoursTodayDisplay() { return Number(this.myHoursToday).toFixed(1); }
    get myHoursWeekDisplay()  { return Number(this.myHoursWeek).toFixed(1); }
    get hasMatterHealth()     { return this.matterHealth.length > 0; }
    get hasTeamStats()        { return this.teamStats.length > 0; }
    get todayLabel()          { return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }

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
        const n = this.matterHealth.length;
        const total = this._rawMatterHealth.length;
        return this.matterFilter === 'all'
            ? `My Matters (${total})`
            : `My Matters — ${FILTER_LABELS[this.matterFilter]} (${n} of ${total})`;
    }

    get teamPanelHeader() {
        const n    = this.teamStats.length;
        const name = this.teamGroupName || 'My Team';
        return `${name} — Today${n > 0 ? ` (${n})` : ''}`;
    }

    get emptyMatterMessage() {
        if (this._rawMatterHealth.length === 0) return 'No matters assigned to you as Senior Attorney.';
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

    /* ── Helpers ── */

    _fmtDate(isoStr) {
        if (!isoStr) return '';
        const [y, m, d] = isoStr.split('-').map(Number);
        return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
}
