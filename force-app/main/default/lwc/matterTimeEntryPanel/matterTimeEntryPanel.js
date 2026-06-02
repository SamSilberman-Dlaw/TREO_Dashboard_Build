import { LightningElement, api, wire, track } from 'lwc';
import { getRecord, getFieldValue }          from 'lightning/uiRecordApi';
import { NavigationMixin }                   from 'lightning/navigation';
import { ShowToastEvent }                    from 'lightning/platformShowToastEvent';
import CURRENT_USER_ID                       from '@salesforce/user/Id';
import MATTER_NAME                           from '@salesforce/schema/NEOS_Matter__c.Name';
import MATTER_RT_NAME                        from '@salesforce/schema/NEOS_Matter__c.RecordType.Name';
import getEligibleStaff                      from '@salesforce/apex/OperationsConsoleController.getEligibleStaff';
import submitTimeEntries                     from '@salesforce/apex/OperationsConsoleController.submitTimeEntries';

const NOTE_MAX = 32768;

export default class MatterTimeEntryPanel extends NavigationMixin(LightningElement) {

    @api recordId;

    @track draftEntries     = [];
    @track eligibleStaff    = [];
    @track isSubmitting     = false;
    @track showValidation   = false;
    @track submittedEntries = [];
    @track submittedCount   = 0;

    _panelView    = 'fill';
    _batchDate    = '';
    _entryCounter = 0;
    _cardTitle    = '';
    _staffLoaded  = false;
    _recordLoaded = false;

    @wire(getRecord, { recordId: '$recordId', fields: [MATTER_NAME, MATTER_RT_NAME] })
    wiredRecord({ data }) {
        if (!data) return;
        const name         = getFieldValue(data, MATTER_NAME)    || '';
        const rt           = getFieldValue(data, MATTER_RT_NAME) || '';
        this._cardTitle    = rt ? `${name} | ${rt}` : name;
        this._recordLoaded = true;
        this._initIfReady();
    }

    @wire(getEligibleStaff)
    wiredStaff({ data }) {
        if (!data) return;
        this.eligibleStaff = data;
        this._staffLoaded  = true;
        this._initIfReady();
    }

    _initIfReady() {
        if (!this._staffLoaded || !this._recordLoaded) return;
        if (this.draftEntries.length === 0) this._addBlankEntry();
    }

    _addBlankEntry() {
        this._entryCounter++;
        this.draftEntries = [...this.draftEntries, {
            _id:              String(this._entryCounter),
            cardTitle:        this._cardTitle,
            matterId:         this.recordId,
            staffId:          CURRENT_USER_ID,
            entryDate:        this._todayIso(),
            hours:            '',
            taskNote:         '',
            hoursClass:       this._hoursClass(''),
            taskNoteClass:    this._taskNoteClass(''),
            collapsed:        false,
            collapseIcon:     '▲',
            collapsedSummary: '',
            noteLength:       0,
            noteCounterClass: 'te-note-counter'
        }];
    }

    /* ── Helpers ── */

    _todayIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    _isEntryValid(d) {
        return d.matterId && d.staffId && parseFloat(d.hours) > 0 && d.taskNote && d.taskNote.trim().length > 0;
    }

    _hoursClass(hours) {
        const base = 'te-input te-input--hours';
        if (!this.showValidation) return base;
        return (!hours || parseFloat(hours) <= 0) ? base + ' te-input--error' : base;
    }

    _taskNoteClass(taskNote) {
        const base = 'te-textarea';
        if (!this.showValidation) return base;
        return (!taskNote || !taskNote.trim()) ? base + ' te-input--error' : base;
    }

    _collapsedSummary(hours, note) {
        const h = (hours && parseFloat(hours) > 0) ? `${parseFloat(hours)}h` : null;
        const n = note && note.trim()
            ? (note.trim().length > 60 ? note.trim().substring(0, 60) + '…' : note.trim())
            : null;
        if (h && n) return `${h} · ${n}`;
        return h || n || '';
    }

    _noteCounterClass(length) {
        if (length > NOTE_MAX - 200)  return 'te-note-counter te-note-counter--error';
        if (length > NOTE_MAX - 5000) return 'te-note-counter te-note-counter--warn';
        return 'te-note-counter';
    }

    /* ── Getters ── */

    get isFillView()    { return this._panelView === 'fill'; }
    get isSuccessView() { return this._panelView === 'success'; }

    get staffComboOptions() {
        return this.eligibleStaff.map(s => ({ label: s.name, value: s.id }));
    }

    get allCollapseLabel() {
        return this.draftEntries.some(d => !d.collapsed) ? 'Collapse All' : 'Expand All';
    }

    get draftCountLabel() {
        const n = this.draftEntries.length;
        return `${n} ${n === 1 ? 'entry' : 'entries'}`;
    }

    get hasDraftEntries()      { return this.draftEntries.length > 0; }
    get hasMultipleEntries()   { return this.draftEntries.length > 1; }

    get draftTotalDisplay() {
        const t = this.draftEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
        return t.toFixed(1) + ' hrs';
    }

    get submitDisabled() {
        return this.isSubmitting || this.draftEntries.length === 0;
    }

    get submitLabel() {
        if (this.isSubmitting) return 'Submitting…';
        const n = this.draftEntries.length;
        return n > 0 ? `Submit ${n} ${n === 1 ? 'Entry' : 'Entries'}` : 'Submit Entries';
    }

    get readyEntriesLabel() {
        if (!this.hasDraftEntries) return '';
        if (this.showValidation) {
            const invalid = this.draftEntries.filter(d => !this._isEntryValid(d)).length;
            if (invalid > 0) return `${invalid} ${invalid === 1 ? 'entry is' : 'entries are'} incomplete — please fix before submitting`;
        }
        const ready = this.draftEntries.filter(d => this._isEntryValid(d)).length;
        const total = this.draftEntries.length;
        if (ready === total) return `All ${total} ${total === 1 ? 'entry' : 'entries'} ready`;
        return `${ready} of ${total} ${total === 1 ? 'entry' : 'entries'} ready`;
    }

    get readyEntriesLabelClass() {
        if (this.showValidation && this.draftEntries.some(d => !this._isEntryValid(d))) {
            return 'te-ready-label te-ready-label--error';
        }
        return 'te-ready-label';
    }

    get successCountLabel() {
        const n = this.submittedCount;
        return `${n} ${n === 1 ? 'entry' : 'entries'} recorded`;
    }

    /* ── Entry handlers ── */

    handleEntryField(e) {
        const id    = e.target.dataset.id;
        const field = e.target.dataset.field;
        const val   = e.target.value;
        this.draftEntries = this.draftEntries.map(d => {
            if (d._id !== id) return d;
            const updated = { ...d, [field]: val };
            if (field === 'hours') {
                updated.hoursClass       = this._hoursClass(val);
                updated.collapsedSummary = this._collapsedSummary(val, d.taskNote);
            }
            if (field === 'taskNote') {
                updated.taskNoteClass    = this._taskNoteClass(val);
                updated.noteLength       = val.length;
                updated.noteCounterClass = this._noteCounterClass(val.length);
                updated.collapsedSummary = this._collapsedSummary(d.hours, val);
            }
            return updated;
        });
    }

    handleQuickHours(e) {
        const id    = e.currentTarget.dataset.id;
        const hours = e.currentTarget.dataset.hours;
        this.draftEntries = this.draftEntries.map(d => {
            if (d._id !== id) return d;
            return {
                ...d,
                hours,
                hoursClass:       this._hoursClass(hours),
                collapsedSummary: this._collapsedSummary(hours, d.taskNote)
            };
        });
    }

    handleStaffChange(e) {
        const id  = e.target.dataset.id;
        const val = e.detail.value;
        this.draftEntries = this.draftEntries.map(d => d._id === id ? { ...d, staffId: val } : d);
    }

    handleBatchDateChange(e) {
        this._batchDate = e.target.value;
        if (!this._batchDate) return;
        this.draftEntries = this.draftEntries.map(d => ({ ...d, entryDate: this._batchDate }));
    }

    toggleCardCollapse(e) {
        const id = e.currentTarget.dataset.id;
        this.draftEntries = this.draftEntries.map(d => {
            if (d._id !== id) return d;
            const collapsed = !d.collapsed;
            return { ...d, collapsed, collapseIcon: collapsed ? '▼' : '▲' };
        });
    }

    toggleAllCollapse() {
        const collapse = this.draftEntries.some(d => !d.collapsed);
        this.draftEntries = this.draftEntries.map(d => ({
            ...d, collapsed: collapse, collapseIcon: collapse ? '▼' : '▲'
        }));
    }

    removeDraftEntry(e) {
        const id = e.currentTarget.dataset.id;
        this.draftEntries = this.draftEntries.filter(d => d._id !== id);
        if (this.draftEntries.length === 0) this._addBlankEntry();
    }

    duplicateEntry(e) {
        const id     = e.currentTarget.dataset.id;
        const source = this.draftEntries.find(d => d._id === id);
        if (!source) return;
        this._entryCounter++;
        const clone = {
            ...source,
            _id:              String(this._entryCounter),
            hours:            '',
            taskNote:         '',
            hoursClass:       this._hoursClass(''),
            taskNoteClass:    this._taskNoteClass(''),
            collapsed:        false,
            collapseIcon:     '▲',
            collapsedSummary: '',
            noteLength:       0,
            noteCounterClass: 'te-note-counter'
        };
        const idx     = this.draftEntries.findIndex(d => d._id === id);
        const updated = [...this.draftEntries];
        updated.splice(idx + 1, 0, clone);
        this.draftEntries = updated;
    }

    /* ── Submit ── */

    submitAllEntries() {
        this.showValidation = true;
        this.draftEntries = this.draftEntries.map(d => ({
            ...d,
            hoursClass:    this._hoursClass(d.hours),
            taskNoteClass: this._taskNoteClass(d.taskNote)
        }));
        if (!this.draftEntries.every(d => this._isEntryValid(d))) return;

        this.isSubmitting = true;
        const payload = this.draftEntries.map(d => ({
            matterId:  d.matterId,
            hours:     d.hours,
            taskNote:  d.taskNote,
            staffId:   d.staffId,
            entryDate: d.entryDate
        }));

        submitTimeEntries({ entries: payload })
            .then(() => {
                const staffMap = {};
                this.eligibleStaff.forEach(s => { staffMap[s.id] = s.name; });
                this.submittedEntries = this.draftEntries.map(d => {
                    const [y, m, dy] = d.entryDate.split('-').map(Number);
                    const dateLabel  = new Date(y, m - 1, dy).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    return {
                        _id:       d._id,
                        cardTitle: d.cardTitle,
                        matterId:  d.matterId,
                        staffName: staffMap[d.staffId] || '',
                        dateLabel,
                        hours:     d.hours,
                        taskNote:  d.taskNote
                    };
                });
                this.submittedCount = this.draftEntries.length;
                this._panelView     = 'success';
                this.draftEntries   = [];
                this.showValidation = false;
            })
            .catch(err => {
                const msg = (err && err.body && err.body.message) ? err.body.message : 'Submit failed.';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            })
            .finally(() => { this.isSubmitting = false; });
    }

    handleSubmitMore() {
        this._panelView       = 'fill';
        this._batchDate       = '';
        this.submittedEntries = [];
        this._addBlankEntry();
    }

    handleOpenMatterById(e) {
        const matterId = e.currentTarget.dataset.id;
        if (!matterId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: matterId, actionName: 'view' }
        });
    }
}
