import { LightningElement, wire, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getShellConfig from '@salesforce/apex/DlawShellController.getShellConfig';

const LS_KEY = 'dlaw_workspace_tab';

const TAB_TITLES = {
    operations:      'D.Law — Docket',
    timeEntry:       'D.Law — Firm Time Entries',
    calendar:        'D.Law — Firm Calendar',
    seniorDashboard: 'D.Law — Senior Dashboard'
};

export default class DlawWorkspace extends LightningElement {
    @track activeTab    = null;
    @track config       = null;
    @track todayHours   = null;  // null until ops console reports in
    @track draftCount   = 0;
    @track overdueCount = 0;

    _keydownHandler = null;

    @wire(getShellConfig)
    wiredConfig({ data, error }) {
        if (data) {
            this.config = data;
        } else if (error) {
            this.config = { userName: '', profile: '', tabs: { operations: false, timeEntry: false, calendar: false, seniorDashboard: false } };
        } else {
            return;
        }

        const saved = this._getSavedTab();
        if (saved && this._tabVisible(saved)) {
            this.activeTab = saved;
        } else if (this.showOperations) {
            this.activeTab = 'operations';
        } else if (this.showTimeEntry) {
            this.activeTab = 'timeEntry';
        } else if (this.showCalendar) {
            this.activeTab = 'calendar';
        } else if (this.showSeniorDashboard) {
            this.activeTab = 'seniorDashboard';
        }

        this._updateTitle();
    }

    connectedCallback() {
        this._keydownHandler = this._handleKeydown.bind(this);
        window.addEventListener('keydown', this._keydownHandler);
    }

    disconnectedCallback() {
        if (this._keydownHandler) {
            window.removeEventListener('keydown', this._keydownHandler);
        }
    }

    // ── Visibility flags ──────────────────────────────────────────────────

    get isReady()              { return !!this.config; }
    get showOperations()       { return !!this.config?.tabs?.operations; }
    get showTimeEntry()        { return !!this.config?.tabs?.timeEntry; }
    get showCalendar()         { return !!this.config?.tabs?.calendar; }
    get showSeniorDashboard()  { return !!this.config?.tabs?.seniorDashboard; }

    // ── Active state ──────────────────────────────────────────────────────

    get isOperationsActive()      { return this.activeTab === 'operations'; }
    get isCalendarActive()        { return this.activeTab === 'calendar'; }
    get isTimeEntryActive()       { return this.activeTab === 'timeEntry'; }
    get isSeniorDashboardActive() { return this.activeTab === 'seniorDashboard'; }

    // ── Tab button classes ─────────────────────────────────────────────────

    get operationsTabClass()      { return this._tabCls('operations'); }
    get calendarTabClass()        { return this._tabCls('calendar'); }
    get timeEntryTabClass()       { return this._tabCls('timeEntry'); }
    get seniorDashboardTabClass() { return this._tabCls('seniorDashboard'); }

    // ── Panel classes ──────────────────────────────────────────────────────

    get operationsPanelClass()      { return this._panelCls('operations'); }
    get calendarPanelClass()        { return this._panelCls('calendar'); }
    get timeEntryPanelClass()       { return this._panelCls('timeEntry'); }
    get seniorDashboardPanelClass() { return this._panelCls('seniorDashboard'); }

    // ── Header display ─────────────────────────────────────────────────────

    get firstName()         { return this.config?.userName || ''; }
    get profileName()       { return this.config?.profile || ''; }
    get profileBadgeLabel() { return this.config?.role || this.config?.profile || ''; }

    // ── Time Entry tab badge (today hours + draft indicator) ───────────────

    get showTodayBadge() {
        return this.showTimeEntry && this.draftCount > 0;
    }

    get todayBadgeLabel() {
        return `${this.draftCount} draft`;
    }

    get todayBadgeClass() {
        return 'tab-badge tab-badge--draft';
    }

    // ── Operations tab badge (overdue tasks) ───────────────────────────────

    get showOverdueBadge() {
        return this.showOperations && this.overdueCount > 0;
    }

    get overdueCountLabel() { return String(this.overdueCount); }

    // ── Handlers ──────────────────────────────────────────────────────────

    handleTabClick(event) {
        const tab = event.currentTarget.dataset.tab;
        if (tab === this.activeTab) return;
        if (!this._trySwitch()) return;
        this.activeTab = tab;
        this._saveTab(tab);
        this._updateTitle();
    }

    handleDailyStats(event) {
        const { todayHours, draftCount, overdueCount } = event.detail;
        if (todayHours   !== undefined) this.todayHours   = todayHours;
        if (draftCount   !== undefined) this.draftCount   = draftCount;
        if (overdueCount !== undefined) this.overdueCount = overdueCount;
    }

    // ── Private helpers ────────────────────────────────────────────────────

    _trySwitch() {
        if (this.activeTab === 'timeEntry' && this.draftCount > 0) {
            const n = this.draftCount;
            this.dispatchEvent(new ShowToastEvent({
                title:   'Unsaved Draft Entries',
                message: `You have ${n} unsaved draft entr${n === 1 ? 'y' : 'ies'} — submit or remove before switching tabs.`,
                variant: 'warning',
                mode:    'dismissible'
            }));
            return false;
        }
        return true;
    }

    _handleKeydown(event) {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;

        const visibleTabs = ['operations', 'timeEntry', 'calendar'].filter(t => this._tabVisible(t));
        const idx = parseInt(event.key, 10) - 1;
        if (idx >= 0 && idx < visibleTabs.length) {
            const tab = visibleTabs[idx];
            if (tab !== this.activeTab && this._trySwitch()) {
                this.activeTab = tab;
                this._saveTab(tab);
                this._updateTitle();
            }
        }
    }

    _updateTitle() {
        if (this.activeTab) {
            document.title = TAB_TITLES[this.activeTab] || 'D.Law';
        }
    }

    _tabVisible(tab) {
        if (tab === 'operations')      return this.showOperations;
        if (tab === 'calendar')        return this.showCalendar;
        if (tab === 'timeEntry')       return this.showTimeEntry;
        if (tab === 'seniorDashboard') return this.showSeniorDashboard;
        return false;
    }

    _tabCls(tab) {
        return `tab-btn${this.activeTab === tab ? ' tab-btn--active' : ''}`;
    }

    _panelCls(tab) {
        return `tab-panel${this.activeTab === tab ? ' tab-panel--active' : ''}`;
    }

    _getSavedTab() {
        try { return window.localStorage?.getItem(LS_KEY) || null; } catch (_) { return null; }
    }

    _saveTab(tab) {
        try { window.localStorage?.setItem(LS_KEY, tab); } catch (_) {}
    }
}
