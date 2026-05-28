import { LightningElement, api, track } from 'lwc';
import searchMatters from '@salesforce/apex/DlawConsoleController.searchMatters';

const BLANK_ENTRY = () => ({
    _localId: '',
    matterId: '', matterName: '',
    taskId: '', taskName: '',
    hours: 0, narrative: '',
    isBillable: true
});

export default class MultiTimeEntryPanel extends LightningElement {
    @api draftEntries    = [];
    @api isExpanded      = false;
    @api totalTodayHours = 0;

    @track newEntry     = BLANK_ENTRY();
    @track matterResults = [];
    @track showDropdown  = false;

    _searchTimer = null;

    get panelTitle() { return this.isExpanded ? 'MULTI TIME ENTRY' : 'QUICK TIME ENTRY'; }

    get hasDraftEntries() { return this.draftEntries && this.draftEntries.length > 0; }

    get indexedEntries() {
        return (this.draftEntries || []).map((e, i) => ({ ...e, _index: i + 1 }));
    }

    get draftTotal() {
        return (this.draftEntries || []).reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
    }

    get draftTotalFormatted()   { return this.draftTotal.toFixed(1); }
    get totalTodayFormatted()   { return (this.totalTodayHours || 0).toFixed(1); }

    // ── Quick form handlers ──────────────────────────────────────────────

    handleMatterInput(event) {
        const val = event.target.value;
        this.newEntry = { ...this.newEntry, matterName: val, matterId: '' };
        clearTimeout(this._searchTimer);
        if (val.length >= 2) {
            this._searchTimer = setTimeout(() => this._searchMatters(val), 280);
        } else {
            this.showDropdown = false;
        }
    }

    handleMatterFocus() {
        if (this.matterResults.length > 0) this.showDropdown = true;
    }

    handleMatterBlur() {
        setTimeout(() => { this.showDropdown = false; }, 200);
    }

    handleSelectMatter(event) {
        const id   = event.currentTarget.dataset.id;
        const name = event.currentTarget.dataset.name;
        this.newEntry    = { ...this.newEntry, matterId: id, matterName: name };
        this.showDropdown = false;
    }

    handleTaskInput(event)      { this.newEntry = { ...this.newEntry, taskName: event.target.value }; }
    handleHoursInput(event)     { this.newEntry = { ...this.newEntry, hours: parseFloat(event.target.value) || 0 }; }
    handleNarrativeInput(event) { this.newEntry = { ...this.newEntry, narrative: event.target.value }; }

    handleAddQuickEntry() {
        this.dispatchEvent(new CustomEvent('addentry', {
            detail: { ...this.newEntry }, bubbles: true
        }));
        this.newEntry    = BLANK_ENTRY();
        this.showDropdown = false;
    }

    handleAddBlankEntry() {
        this.dispatchEvent(new CustomEvent('addentry', { detail: {}, bubbles: true }));
    }

    // ── Entry row events (bubble up to parent) ───────────────────────────

    handleEntryChange(event) {
        this.dispatchEvent(new CustomEvent('entrychange', {
            detail: event.detail, bubbles: true
        }));
    }

    handleDeleteEntry(event) {
        this.dispatchEvent(new CustomEvent('entrychange', {
            detail: { localId: event.detail.localId, deleted: true }, bubbles: true
        }));
    }

    handleDuplicateEntry(event) {
        this.dispatchEvent(new CustomEvent('addentry', {
            detail: { ...event.detail }, bubbles: true
        }));
    }

    // ── Submit / save ────────────────────────────────────────────────────

    handleSaveDraft() { this.dispatchEvent(new CustomEvent('savedraft',      { bubbles: true })); }
    handleSubmit()    { this.dispatchEvent(new CustomEvent('submitentries',   { bubbles: true })); }

    // ── Private ──────────────────────────────────────────────────────────

    async _searchMatters(term) {
        try {
            this.matterResults = await searchMatters({ searchTerm: term });
            this.showDropdown  = this.matterResults.length > 0;
        } catch (_) {
            this.showDropdown = false;
        }
    }
}
