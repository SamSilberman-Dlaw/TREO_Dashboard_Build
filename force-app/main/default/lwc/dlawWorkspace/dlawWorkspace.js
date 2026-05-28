import { LightningElement, wire, track } from 'lwc';
import getShellConfig from '@salesforce/apex/DlawShellController.getShellConfig';

const LS_KEY = 'dlaw_workspace_tab';

export default class DlawWorkspace extends LightningElement {
    @track activeTab = null;
    @track config    = null;

    @wire(getShellConfig)
    wiredConfig({ data, error }) {
        if (data) {
            this.config = data;
        } else if (error) {
            this.config = { userName: '', profile: '', tabs: { operations: false, timeEntry: false, calendar: false } };
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
        }
    }

    // ── Visibility flags (evaluated server-side via FeatureManagement) ────

    get isReady()        { return !!this.config; }
    get showOperations() { return !!this.config?.tabs?.operations; }
    get showTimeEntry()  { return !!this.config?.tabs?.timeEntry; }
    get showCalendar()   { return !!this.config?.tabs?.calendar; }

    // ── Active state ─────────────────────────────────────────────────────

    get isOperationsActive() { return this.activeTab === 'operations'; }
    get isCalendarActive()   { return this.activeTab === 'calendar'; }
    get isTimeEntryActive()  { return this.activeTab === 'timeEntry'; }

    // ── Tab button classes ────────────────────────────────────────────────

    get operationsTabClass() { return this._tabCls('operations'); }
    get calendarTabClass()   { return this._tabCls('calendar'); }
    get timeEntryTabClass()  { return this._tabCls('timeEntry'); }

    // ── Panel classes (CSS visibility — components stay mounted) ──────────

    get operationsPanelClass() { return this._panelCls('operations'); }
    get calendarPanelClass()   { return this._panelCls('calendar'); }
    get timeEntryPanelClass()  { return this._panelCls('timeEntry'); }

    // ── Header display ────────────────────────────────────────────────────

    get firstName() {
        return this.config?.userName || '';
    }

    get profileName() {
        return this.config?.profile || '';
    }

    get profileBadgeLabel() {
        const p = this.config?.profile || '';
        if (p === 'System Administrator') return 'Admin';
        if (p.includes('Attorney'))       return 'Attorney';
        if (p.includes('TREO'))           return p.replace('TREO ', '');
        return p.split(' ').map(w => w[0]).join('').slice(0, 6);
    }

    get formattedDate() {
        return new Date().toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric'
        });
    }

    // ── Handlers ─────────────────────────────────────────────────────────

    handleTabClick(event) {
        const tab = event.currentTarget.dataset.tab;
        if (tab === this.activeTab) return;
        this.activeTab = tab;
        this._saveTab(tab);
    }

    // ── Private helpers ───────────────────────────────────────────────────

    _tabVisible(tab) {
        if (tab === 'operations') return this.showOperations;
        if (tab === 'calendar')   return this.showCalendar;
        if (tab === 'timeEntry')  return this.showTimeEntry;
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
