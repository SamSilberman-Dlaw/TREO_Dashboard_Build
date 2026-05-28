import { LightningElement, api, track } from 'lwc';
import searchMatters from '@salesforce/apex/DlawConsoleController.searchMatters';

export default class TimeEntryRow extends LightningElement {
    @api entry      = {};
    @api isExpanded = false;
    @api entryIndex = 1;

    @track matterResults = [];
    @track showDropdown  = false;

    _searchTimer = null;

    get hoursFormatted() {
        return (parseFloat(this.entry?.hours) || 0).toFixed(1);
    }

    // ── Field change handlers ────────────────────────────────────────────

    handleFieldChange(event) {
        const field = event.currentTarget.dataset.field;
        this._emit(field, event.target.value);
    }

    handleHoursChange(event) {
        this._emit('hours', parseFloat(event.target.value) || 0);
    }

    handleBillableChange(event) {
        this._emit('isBillable', event.target.checked);
    }

    // ── Matter search ────────────────────────────────────────────────────

    handleMatterFocus() {
        if (this.matterResults.length > 0) this.showDropdown = true;
    }

    handleMatterInput(event) {
        const val = event.target.value;
        this._emit('matterName', val);
        clearTimeout(this._searchTimer);
        if (val.length >= 2) {
            this._searchTimer = setTimeout(() => this._searchMatters(val), 280);
        } else {
            this.showDropdown = false;
        }
    }

    handleSelectMatter(event) {
        const id   = event.currentTarget.dataset.id;
        const name = event.currentTarget.dataset.name;
        this._emit('matterId',   id);
        this._emit('matterName', name);
        this.showDropdown = false;
    }

    async _searchMatters(term) {
        try {
            this.matterResults = await searchMatters({ searchTerm: term });
            this.showDropdown  = this.matterResults.length > 0;
        } catch (_) {
            this.showDropdown = false;
        }
    }

    // ── Row-level actions ────────────────────────────────────────────────

    handleDelete() {
        this.dispatchEvent(new CustomEvent('deleteentry', {
            detail: { localId: this.entry._localId },
            bubbles: true, composed: true
        }));
    }

    handleDuplicate() {
        this.dispatchEvent(new CustomEvent('duplicateentry', {
            detail: { ...this.entry },
            bubbles: true, composed: true
        }));
    }

    // ── Private ──────────────────────────────────────────────────────────

    _emit(field, value) {
        this.dispatchEvent(new CustomEvent('entrychange', {
            detail: { localId: this.entry._localId, field, value },
            bubbles: true, composed: true
        }));
    }
}
