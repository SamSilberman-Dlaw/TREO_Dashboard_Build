import { LightningElement, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getConsoleData    from '@salesforce/apex/OperationsConsoleController.getConsoleData';
import completeTask      from '@salesforce/apex/OperationsConsoleController.completeTask';
import searchMatters     from '@salesforce/apex/OperationsConsoleController.searchMatters';
import getRecentMatters  from '@salesforce/apex/OperationsConsoleController.getRecentMatters';
import getEligibleStaff  from '@salesforce/apex/OperationsConsoleController.getEligibleStaff';
import submitTimeEntries from '@salesforce/apex/OperationsConsoleController.submitTimeEntries';

const DOT_CLASSES = {
    'SOL':                                 'deadline-dot deadline-dot--red',
    'Trial':                               'deadline-dot deadline-dot--purple',
    'Class Cert - Hearing':                'deadline-dot deadline-dot--orange',
    'Discovery Cutoff':                    'deadline-dot deadline-dot--blue',
    'Opposition to MSJ':                   'deadline-dot deadline-dot--indigo',
    'PMK Depo':                            'deadline-dot deadline-dot--green',
    'Client Deposition':                   'deadline-dot deadline-dot--teal',
    'Hearing':                             'deadline-dot deadline-dot--yellow',
    'Deadline':                            'deadline-dot deadline-dot--indigo',
    'Motion Deadline':                     'deadline-dot deadline-dot--pink',
    'Motion for Summary Judgment Hearing': 'deadline-dot deadline-dot--lime',
    'Discovery Deadline':                  'deadline-dot deadline-dot--cyan',
    'Federal - Hearing':                   'deadline-dot deadline-dot--slate',
    'Federal - Trial':                     'deadline-dot deadline-dot--rose'
};
const TYPE_BADGE_CLASSES = {
    'SOL':                                 'type-badge type-badge--red',
    'Trial':                               'type-badge type-badge--purple',
    'Class Cert - Hearing':                'type-badge type-badge--orange',
    'Discovery Cutoff':                    'type-badge type-badge--blue',
    'Opposition to MSJ':                   'type-badge type-badge--indigo',
    'PMK Depo':                            'type-badge type-badge--green',
    'Client Deposition':                   'type-badge type-badge--teal',
    'Hearing':                             'type-badge type-badge--yellow',
    'Deadline':                            'type-badge type-badge--indigo',
    'Motion Deadline':                     'type-badge type-badge--pink',
    'Motion for Summary Judgment Hearing': 'type-badge type-badge--lime',
    'Discovery Deadline':                  'type-badge type-badge--cyan',
    'Federal - Hearing':                   'type-badge type-badge--slate',
    'Federal - Trial':                     'type-badge type-badge--rose'
};
const DAY_NAMES  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REFRESH_MS = 5 * 60 * 1000;
const RING_R     = 20;
const RING_CIRC  = 2 * Math.PI * RING_R;
const NOTE_MAX   = 32768;

export default class DlawOperationsConsole extends NavigationMixin(LightningElement) {

    /* ── Dashboard state ── */
    @track isLoading           = false;
    @track isRefreshing        = false;
    lastRefreshLabel           = '';
    @track criticalDeadlines   = [];
    @track todayDeadlines      = [];
    @track weekDeadlines       = [];
    @track monthDeadlines      = [];
    @track beyondDeadlines     = [];
    dlTodayCollapsed           = false;
    dlWeekCollapsed            = false;
    dlMonthCollapsed           = false;
    dlBeyondCollapsed          = false;
    @track todayAssociate      = [];
    @track weekAssociate       = [];
    @track monthAssociate      = [];
    @track beyondAssociate     = [];
    @track myTasks             = [];
    todayGroupCollapsed        = false;
    weekGroupCollapsed         = false;
    monthGroupCollapsed        = false;
    beyondGroupCollapsed       = false;
    @track _tooltipEvent       = null;
    _tooltipX                  = 0;
    _tooltipY                  = 0;
    @track last7ByDate         = [];
    @track drawerOpen          = false;
    @track selectedDeadline    = null;

    /* ── Picker state ── */
    @track pickerMatters   = [];
    @track isPickerLoading = false;
    @track eligibleStaff   = [];

    /* ── Entry cards ── */
    @track draftEntries      = [];
    @track isSubmitting      = false;
    @track showValidation    = false;
    @track submittedCount    = 0;
    @track submittedEntries  = [];

    _panelView              = 'pick';
    _batchDate              = '';
    _focusInsideComponent   = false;
    _taskFilter             = 'week';
    _deadlinesFilter        = '270';
    _assocFilter            = 'month';
    _assocFilterType        = '';
    _filterType             = '';
    _handleFocusIn          = null;
    _handleFocusOut         = null;
    _rawTasks               = [];
    _rawCriticalDeadlines   = [];
    _rawAssocEvents         = [];
    todayHours           = 0;
    last7Hours           = 0;
    openTaskCount        = 0;
    overdueTaskCount     = 0;
    _currentUserId       = '';
    firstName            = '';
    _pickerTab           = 'my';
    _pickerSearch        = '';
    _allPickerMatters    = [];
    _entryCounter        = 0;
    _searchTimer         = null;
    _refreshInterval     = null;
    _handleKeyDown       = null;
    _handleBeforeUnload  = null;

    connectedCallback() {
        this._load();
        this._loadPickerMatters();
        getEligibleStaff()
            .then(data => { this.eligibleStaff = data; })
            .catch(() => {});
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._refreshInterval = setInterval(() => this._silentRefresh(), REFRESH_MS);
        this._handleFocusIn  = (e) => {
            const tag = (e.target && e.target.tagName) || '';
            this._focusInsideComponent = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
        };
        this._handleFocusOut = () => { this._focusInsideComponent = false; };
        this.template.addEventListener('focusin',  this._handleFocusIn);
        this.template.addEventListener('focusout', this._handleFocusOut);
        this._handleKeyDown = this._onKeyDown.bind(this);
        // eslint-disable-next-line @lwc/lwc/no-document-query
        document.addEventListener('keydown', this._handleKeyDown);
        this._handleBeforeUnload = this._onBeforeUnload.bind(this);
        // eslint-disable-next-line @lwc/lwc/no-document-query
        window.addEventListener('beforeunload', this._handleBeforeUnload);
    }

    disconnectedCallback() {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = null;
        }
        if (this._searchTimer) clearTimeout(this._searchTimer);
        if (this._handleFocusIn) {
            this.template.removeEventListener('focusin',  this._handleFocusIn);
            this.template.removeEventListener('focusout', this._handleFocusOut);
            this._handleFocusIn  = null;
            this._handleFocusOut = null;
        }
        if (this._handleKeyDown) {
            // eslint-disable-next-line @lwc/lwc/no-document-query
            document.removeEventListener('keydown', this._handleKeyDown);
            this._handleKeyDown = null;
        }
        if (this._handleBeforeUnload) {
            // eslint-disable-next-line @lwc/lwc/no-document-query
            window.removeEventListener('beforeunload', this._handleBeforeUnload);
            this._handleBeforeUnload = null;
        }
    }

    _onKeyDown(e) {
        if (e.key === 'Escape' && !this._focusInsideComponent && this._panelView === 'fill') {
            this.handleBackToPick();
        }
    }

    _onBeforeUnload(e) {
        if (this.draftEntries.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    }

    /* ── Data load ── */

    _load() {
        this.isLoading = true;
        getConsoleData()
            .then(data => this._applyConsoleData(data))
            .catch(err => {
                this.isLoading = false;
                const msg = (err && err.body && err.body.message)
                    ? err.body.message : 'Could not load console data. Please refresh the page.';
                this.dispatchEvent(new ShowToastEvent({
                    title: 'Error loading data', message: msg, variant: 'error'
                }));
            });
    }

    _silentRefresh() {
        getConsoleData()
            .then(data => this._applyConsoleData(data))
            .catch(() => {});
    }

    _fireDailyStats() {
        this.dispatchEvent(new CustomEvent('dailystats', {
            bubbles:  true,
            composed: true,
            detail: {
                todayHours:   this.todayHours,
                draftCount:   this.draftEntries.length,
                overdueCount: this.overdueTaskCount
            }
        }));
    }

    handleRefresh() {
        this.isRefreshing = true;
        getConsoleData()
            .then(data => { this._applyConsoleData(data); this.isRefreshing = false; })
            .catch(() => { this.isRefreshing = false; });
    }

    _applyConsoleData(data) {
        this.isLoading        = false;
        this.lastRefreshLabel = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        this.todayHours       = data.todayHours       || 0;
        this.last7Hours       = data.last7Hours       || 0;
        this.openTaskCount    = data.openTaskCount    || 0;
        this.overdueTaskCount = data.overdueTaskCount || 0;
        this._currentUserId   = data.currentUserId   || '';
        this.firstName        = data.firstName       || '';

        this._rawCriticalDeadlines = data.criticalDeadlines || [];
        this._rawAssocEvents       = data.myEvents           || [];
        this._applyEventsFilter();

        this.last7ByDate = this._processLast7(data.last7ByDate || []);

        this._rawTasks = data.myTasks || [];
        this.myTasks   = this._processTasks(this._filterTasks(this._rawTasks));

        this._fireDailyStats();
    }

    /* ── Data processors ── */

    _processDeadlines(rows) {
        return rows.map(dl => {
            const fmtDate = isoStr => {
                if (!isoStr) return '';
                const [y, m, d] = isoStr.substring(0, 10).split('-').map(Number);
                return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
            };
            const dateLabel    = dl.isAllDay ? fmtDate(dl.startDate) : this._fmtDatetime(dl.startDate);
            const endDateLabel = dl.endDate  ? (dl.isAllDay ? fmtDate(dl.endDate) : this._fmtDatetime(dl.endDate)) : '';
            return {
                ...dl,
                dotClass:       DOT_CLASSES[dl.eventType]        || 'deadline-dot deadline-dot--blue',
                typeBadgeClass: TYPE_BADGE_CLASSES[dl.eventType] || 'type-badge type-badge--blue',
                daysLabel:      this._daysLabel(dl.daysAway),
                dateLabel,
                endDateLabel,
                description:    this._cleanDescription(dl.description)
            };
        });
    }

    _cleanDescription(text) {
        if (!text) return '';
        return text
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/https?:\/\/\S+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    _processAssocEvents(rows) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return rows.map(ev => {
            const dotClass       = 'deadline-dot deadline-dot--blue';
            const typeBadgeClass = 'type-badge type-badge--blue';
            const isAllDay  = ev.isAllDay || (ev.startDate && ev.startDate.endsWith('T00:00:00Z'));
            const timeLabel = (!isAllDay && ev.startDate) ? this._fmtTime(ev.startDate) : '';
            const endLabel  = (!isAllDay && ev.endDate)   ? this._fmtTime(ev.endDate)   : '';
            const timeRange = timeLabel && endLabel ? `${timeLabel} – ${endLabel}` : timeLabel;
            const dateLabel = isAllDay
                ? new Date(ev.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : this._fmtDatetime(ev.startDate);
            if (ev.isToday) return { ...ev, dotClass, typeBadgeClass, timeLabel, endLabel, timeRange, dayLabel: 'Today', dateLabel, daysLabel: 'Today' };
            const daysAway = ev.daysAway != null ? ev.daysAway : null;
            const dayLabel = (daysAway != null && daysAway <= 7)
                ? this._fmtDay(ev.startDate)
                : (ev.startDate
                    ? new Date(ev.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '');
            const daysLabel = this._daysLabel(daysAway);
            return { ...ev, dotClass, typeBadgeClass, timeLabel, endLabel, timeRange, dayLabel, dateLabel, daysLabel };
        });
    }

    _filterByRange(rows, filter) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let cutoff;
        if (filter === 'week') {
            cutoff = new Date(today);
            cutoff.setDate(today.getDate() + 7);
        } else if (filter === 'month') {
            cutoff = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
        } else {
            const d = parseInt(filter, 10);
            if (!d) return rows;
            cutoff = new Date(today.getTime() + d * 86400000);
        }
        return rows.filter(ev => !ev.startDate || new Date(ev.startDate) <= cutoff);
    }

    _applyEventsFilter() {
        const dateFiltered = this._filterByRange(this._rawCriticalDeadlines, this._deadlinesFilter);
        const typeFiltered = dateFiltered.filter(dl => !this._filterType || dl.eventType === this._filterType);
        const processedDl  = this._processDeadlines(typeFiltered);
        this.criticalDeadlines = processedDl;
        const dlToday    = new Date(); dlToday.setHours(0, 0, 0, 0);
        const dlEndWeek  = new Date(dlToday); dlEndWeek.setDate(dlToday.getDate() + (6 - dlToday.getDay()));
        const dlEndMonth = new Date(dlToday.getFullYear(), dlToday.getMonth() + 1, 0);
        this.todayDeadlines  = processedDl.filter(dl => dl.daysAway === 0);
        this.weekDeadlines   = processedDl.filter(dl => dl.daysAway > 0 && dl.startDate && new Date(dl.startDate) <= dlEndWeek);
        this.monthDeadlines  = processedDl.filter(dl => dl.daysAway > 0 && dl.startDate && new Date(dl.startDate) > dlEndWeek && new Date(dl.startDate) <= dlEndMonth);
        this.beyondDeadlines = processedDl.filter(dl => dl.daysAway > 0 && (!dl.startDate || new Date(dl.startDate) > dlEndMonth));
        const assocDateFiltered = this._filterByRange(this._rawAssocEvents, this._assocFilter);
        const assocFiltered = assocDateFiltered.filter(e => !this._assocFilterType || e.eventType === this._assocFilterType);
        const processed = this._processAssocEvents(assocFiltered);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(today);
        endOfWeek.setDate(today.getDate() + (6 - today.getDay()));
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        this.todayAssociate  = processed.filter(e => e.isToday);
        this.weekAssociate   = processed.filter(e => !e.isToday && e.startDate && new Date(e.startDate) <= endOfWeek);
        this.monthAssociate  = processed.filter(e => !e.isToday && e.startDate && new Date(e.startDate) > endOfWeek && new Date(e.startDate) <= endOfMonth);
        this.beyondAssociate = processed.filter(e => !e.isToday && (!e.startDate || new Date(e.startDate) > endOfMonth));
    }

    _processTasks(rows) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return rows.map(t => {
            const { label, cls } = this._taskDueInfo(t.dueDate, today);
            return {
                ...t,
                isCompleted:   false,
                dueLabel:      label,
                dueBadgeClass: cls,
                hasMatterLink: !!t.matterId,
                rowClass:      'tasks-row'
            };
        });
    }

    _filterTasks(rows) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let cutoff;
        if (this._taskFilter === 'week') {
            cutoff = new Date(today);
            cutoff.setDate(today.getDate() + (6 - today.getDay()));
        } else if (this._taskFilter === 'month') {
            cutoff = new Date(today);
            cutoff.setDate(today.getDate() + 30);
        } else {
            cutoff = new Date(today);
            cutoff.setDate(today.getDate() + parseInt(this._taskFilter, 10));
        }
        return rows.filter(t => {
            if (!t.dueDate) return true;
            return this._parseLocalDate(t.dueDate) <= cutoff;
        });
    }

    _processLast7(rows) {
        const maxHrs = rows.reduce((m, r) => Math.max(m, Number(r.hours || 0)), 0);
        return rows.map(r => {
            const dt         = this._parseLocalDate((r.date || '').slice(0, 10));
            const valid      = dt && !isNaN(dt.getTime());
            const dayLabel   = valid ? DAY_NAMES[dt.getDay()] : '';
            const hoursLabel = Number(r.hours).toFixed(1) + 'h';
            const dateLabel  = valid
                ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                : '';
            const pct        = maxHrs > 0 ? Math.round(Number(r.hours) / maxHrs * 100) : 0;
            return {
                ...r,
                dayLabel,
                hoursLabel,
                tooltipLabel: `${dateLabel}: ${hoursLabel}`,
                barStyle:     `width:${pct}%`,
                sparkStyle:   `height:${maxHrs > 0 ? Math.max(Math.round(Number(r.hours) / maxHrs * 36), 3) : 3}px`
            };
        });
    }

    /* ── Helpers ── */

    _daysLabel(n) {
        if (n == null) return '';
        if (n === 0)   return 'Today';
        if (n === 1)   return '1 day';
        return `${n} days`;
    }

    _fmtDatetime(isoStr) {
        if (!isoStr) return '';
        return new Date(isoStr).toLocaleDateString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    _fmtTime(isoStr) {
        if (!isoStr) return '';
        return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    _fmtDay(isoStr) {
        if (!isoStr) return '';
        return DAY_NAMES[new Date(isoStr).getDay()];
    }

    _parseLocalDate(dateStr) {
        if (!dateStr) return null;
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(y, m - 1, d);
    }

    _taskDueInfo(dueDateStr, todayMidnight) {
        if (!dueDateStr) return { label: 'No due date', cls: 'due-badge due-badge--default' };
        const due  = this._parseLocalDate(dueDateStr);
        const diff = Math.round((due - todayMidnight) / 86400000);
        if (diff < 0)   return { label: 'Overdue',         cls: 'due-badge due-badge--overdue' };
        if (diff === 0) return { label: 'Due Today',       cls: 'due-badge due-badge--today' };
        if (diff === 1) return { label: 'Due Tomorrow',    cls: 'due-badge due-badge--tomorrow' };
        if (diff <= 7)  return { label: `Due in ${diff}d`, cls: 'due-badge due-badge--soon' };
        return {
            label: `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
            cls:   'due-badge due-badge--default'
        };
    }

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

    _withChecks(matters) {
        const checkedIds = new Set(this.pickerMatters.filter(m => m.checked).map(m => m.id));
        const addedIds   = new Set(this.draftEntries.map(d => d.matterId));
        return matters.map(m => {
            const checked = checkedIds.has(m.id);
            const isAdded = addedIds.has(m.id);
            const parts   = [];
            if (m.seniorAttorney) parts.push(`Sr: ${m.seniorAttorney}`);
            if (m.associateAtty)  parts.push(`Assoc: ${m.associateAtty}`);
            if (m.lssParalegal)   parts.push(`LSS: ${m.lssParalegal}`);
            return {
                ...m,
                checked,
                isAdded,
                rowClass:       'picker-row' + (checked ? ' picker-row--checked' : '') + (isAdded && !checked ? ' picker-row--added' : ''),
                staffDetail:    parts.join(' · '),
                hasStaffDetail: parts.length > 0
            };
        });
    }

    _syncPickerAddedState() {
        const addedIds = new Set(this.draftEntries.map(d => d.matterId));
        this.pickerMatters = this.pickerMatters.map(m => {
            const isAdded = addedIds.has(m.id);
            const cls = 'picker-row'
                + (m.checked ? ' picker-row--checked' : '')
                + (isAdded && !m.checked ? ' picker-row--added' : '');
            return { ...m, isAdded, rowClass: cls };
        });
    }

    /* ── Getters ── */

    get todayLabel()        { return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
    get todayHoursDisplay() { return Number(this.todayHours).toFixed(1) + ' hrs'; }
    get last7HoursDisplay() { return Number(this.last7Hours).toFixed(1) + ' hrs'; }
    get last7AvgDisplay()   { return (Number(this.last7Hours) / 7).toFixed(1); }
    get hasOverdueTasks()   { return this.overdueTaskCount > 0; }
    get hasDaysToNext()     { return this.daysToNext >= 0; }
    get daysToNextLabel()   { return this._daysLabel(this.daysToNext); }
    get refreshBtnLabel()   { return this.isRefreshing ? '…' : '↻'; }
    get successCountLabel() {
        const n = this.submittedCount;
        return `${n} ${n === 1 ? 'entry' : 'entries'} recorded`;
    }

    get todayProgressStyle() {
        const pct    = Math.min(Number(this.todayHours) / 8, 1);
        const offset = RING_CIRC * (1 - pct);
        return `stroke-dasharray: ${RING_CIRC.toFixed(2)}; stroke-dashoffset: ${offset.toFixed(2)};`;
    }

    get todayProgressSub() {
        const hrs = Number(this.todayHours);
        if (hrs >= 8) return 'Goal reached ✓';
        return `${(8 - hrs).toFixed(1)} hrs to goal`;
    }

    get summaryTasksCardClass() {
        return this.overdueTaskCount > 0 ? 'sc sc--red sc--clickable' : 'sc sc--green sc--clickable';
    }

    get summaryTasksIconClass() {
        return this.overdueTaskCount > 0 ? 'sc-icon-wrap sc-icon-wrap--red' : 'sc-icon-wrap sc-icon-wrap--green';
    }

    get summaryTasksValueClass() {
        return this.overdueTaskCount > 0 ? 'sc-value sc-value--red' : 'sc-value sc-value--green';
    }

    get criticalCount() { return this.criticalDeadlines.length; }

    get eventsToday() {
        return this._rawAssocEvents.filter(e => e.isToday).length;
    }

    get eventsTodayCardClass() {
        return this.eventsToday > 0 ? 'sc sc--teal sc--clickable' : 'sc sc--gray sc--clickable';
    }

    get eventsTodayIconClass() {
        return this.eventsToday > 0 ? 'sc-icon-wrap sc-icon-wrap--teal' : 'sc-icon-wrap sc-icon-wrap--gray';
    }

    get eventsTodaySub() {
        if (this.eventsToday === 0) return 'Nothing scheduled';
        const now = new Date();
        const next = this._rawAssocEvents.find(e => e.isToday && e.startDate && new Date(e.startDate) > now);
        if (next) return `Next at ${this._fmtTime(next.startDate)}`;
        return this._rawAssocEvents.some(e => e.isToday) ? 'All done for today' : 'On your calendar';
    }

    get hasCriticalDeadlines()   { return this.criticalDeadlines.length > 0; }
    get hasTodayDeadlines()      { return this.todayDeadlines.length > 0; }
    get hasWeekDeadlines()       { return this.weekDeadlines.length > 0; }
    get hasMonthDeadlines()      { return this.monthDeadlines.length > 0; }
    get hasBeyondDeadlines()     { return this.beyondDeadlines.length > 0; }
    get dlTodayIcon()   { return this.dlTodayCollapsed   ? '▸' : '▾'; }
    get dlWeekIcon()    { return this.dlWeekCollapsed    ? '▸' : '▾'; }
    get dlMonthIcon()   { return this.dlMonthCollapsed   ? '▸' : '▾'; }
    get dlBeyondIcon()  { return this.dlBeyondCollapsed  ? '▸' : '▾'; }
    get hasDaysToNext()         { return this.daysToNext >= 0; }
    get daysToNext() {
        return this.criticalDeadlines.length > 0 && this.criticalDeadlines[0].daysAway != null
            ? this.criticalDeadlines[0].daysAway : -1;
    }
    get hasTodayAssociate()     { return this.todayAssociate.length > 0; }
    get hasWeekAssociate()      { return this.weekAssociate.length > 0; }
    get hasMonthAssociate()     { return this.monthAssociate.length > 0; }
    get hasBeyondAssociate()    { return this.beyondAssociate.length > 0; }
    get hasAssociateEvents()    { return this.todayAssociate.length > 0 || this.weekAssociate.length > 0 || this.monthAssociate.length > 0 || this.beyondAssociate.length > 0; }
    get hasTasks()              { return this.myTasks.length > 0; }

    get todayGroupIcon()  { return this.todayGroupCollapsed  ? '▸' : '▾'; }
    get weekGroupIcon()   { return this.weekGroupCollapsed   ? '▸' : '▾'; }
    get monthGroupIcon()  { return this.monthGroupCollapsed  ? '▸' : '▾'; }
    get beyondGroupIcon() { return this.beyondGroupCollapsed ? '▸' : '▾'; }
    get hasLast7Data()          { return this.last7ByDate.length > 0; }

    get typeFilters() {
        return [
            { key: 'SOL',                                 label: 'SOL'                                 },
            { key: 'Trial',                               label: 'Trial'                               },
            { key: 'Class Cert - Hearing',                label: 'Class Cert - Hearing'                },
            { key: 'Discovery Cutoff',                    label: 'Discovery Cutoff'                    },
            { key: 'Opposition to MSJ',                   label: 'Opposition to MSJ'                   },
            { key: 'PMK Depo',                            label: 'PMK Depo'                            },
            { key: 'Client Deposition',                   label: 'Client Deposition'                   },
            { key: 'Hearing',                             label: 'Hearing'                             },
            { key: 'Motion Deadline',                     label: 'Motion Deadline'                     },
            { key: 'Motion for Summary Judgment Hearing', label: 'Motion for Summary Judgment Hearing' },
            { key: 'Discovery Deadline',                  label: 'Discovery Deadline'                  },
            { key: 'Federal - Hearing',                   label: 'Federal - Hearing'                   },
            { key: 'Federal - Trial',                     label: 'Federal - Trial'                     }
        ].sort((a, b) => a.label.localeCompare(b.label));
    }

    get dlFilterWeekClass()  { return 'task-filter-btn' + (this._deadlinesFilter === 'week'  ? ' task-filter-btn--active' : ''); }
    get dlFilter1MClass()    { return 'task-filter-btn' + (this._deadlinesFilter === 'month' ? ' task-filter-btn--active' : ''); }
    get dlFilter3MClass()    { return 'task-filter-btn' + (this._deadlinesFilter === '90'    ? ' task-filter-btn--active' : ''); }
    get dlFilter6MClass()    { return 'task-filter-btn' + (this._deadlinesFilter === '180'   ? ' task-filter-btn--active' : ''); }
    get dlFilter9MClass()    { return 'task-filter-btn' + (this._deadlinesFilter === '270'   ? ' task-filter-btn--active' : ''); }
    get dlFilter12MClass()   { return 'task-filter-btn' + (this._deadlinesFilter === '360'   ? ' task-filter-btn--active' : ''); }

    get assocFilterWeekClass()  { return 'task-filter-btn' + (this._assocFilter === 'week'  ? ' task-filter-btn--active' : ''); }
    get assocFilter1MClass()    { return 'task-filter-btn' + (this._assocFilter === 'month' ? ' task-filter-btn--active' : ''); }
    get assocFilter3MClass()    { return 'task-filter-btn' + (this._assocFilter === '90'    ? ' task-filter-btn--active' : ''); }
    get assocFilter6MClass()    { return 'task-filter-btn' + (this._assocFilter === '180'   ? ' task-filter-btn--active' : ''); }
    get assocFilter9MClass()    { return 'task-filter-btn' + (this._assocFilter === '270'   ? ' task-filter-btn--active' : ''); }
    get assocFilter12MClass()   { return 'task-filter-btn' + (this._assocFilter === '360'   ? ' task-filter-btn--active' : ''); }

    get criticalDeadlinesHeader() {
        const n = this.criticalDeadlines.length;
        return `Critical Deadlines${n > 0 ? ` (${n})` : ''}`;
    }
    get associateEventsHeader() {
        const n = this.todayAssociate.length + this.weekAssociate.length + this.monthAssociate.length + this.beyondAssociate.length;
        return `My Events${n > 0 ? ` (${n})` : ''}`;
    }

    get assocTypeFilters() {
        const types = [...new Set(this._rawAssocEvents.map(e => e.eventType).filter(Boolean))].sort();
        return types.map(t => ({ key: t, label: t }));
    }
    get tasksHeader() {
        const n = this.myTasks.length;
        const labels = { week: 'This Week', month: '1 Month', '90': '3 Months', '180': '6 Months', '270': '9 Months', '360': '12 Months' };
        return `My Tasks — ${labels[this._taskFilter] || 'This Week'}${n > 0 ? ` (${n})` : ''}`;
    }

    get tasksEmptyMessage() {
        const labels = { week: 'this week', month: 'in the next month', '90': 'in the next 3 months', '180': 'in the next 6 months', '270': 'in the next 9 months', '360': 'in the next 12 months' };
        return `No open tasks ${labels[this._taskFilter] || 'in this period'}`;
    }

    get criticalDeadlinesEmptyMessage() {
        const labels = { week: 'this week', month: 'in the next month', '90': 'in the next 3 months', '180': 'in the next 6 months', '270': 'in the next 9 months', '360': 'in the next 12 months' };
        return `No critical deadlines ${labels[this._deadlinesFilter] || 'in this range'}`;
    }

    get taskFilterWeekClass()  { return 'task-filter-btn' + (this._taskFilter === 'week'  ? ' task-filter-btn--active' : ''); }
    get taskFilter1MClass()    { return 'task-filter-btn' + (this._taskFilter === 'month' ? ' task-filter-btn--active' : ''); }
    get taskFilter3MClass()    { return 'task-filter-btn' + (this._taskFilter === '90'    ? ' task-filter-btn--active' : ''); }
    get taskFilter6MClass()    { return 'task-filter-btn' + (this._taskFilter === '180'   ? ' task-filter-btn--active' : ''); }
    get taskFilter9MClass()    { return 'task-filter-btn' + (this._taskFilter === '270'   ? ' task-filter-btn--active' : ''); }
    get taskFilter12MClass()   { return 'task-filter-btn' + (this._taskFilter === '360'   ? ' task-filter-btn--active' : ''); }

    get myTabClass()       { return 'picker-tab' + (this._pickerTab === 'my'  ? ' picker-tab--active' : ''); }
    get allTabClass()      { return 'picker-tab' + (this._pickerTab === 'all' ? ' picker-tab--active' : ''); }
    get pickerSearch()     { return this._pickerSearch; }
    get hasPickerMatters() { return this.pickerMatters.length > 0; }
    get isMyTabEmptyState() {
        return this._pickerTab === 'my' && !this.isPickerLoading && this.pickerMatters.length === 0;
    }
    get pickerCountLabel() {
        const total   = this.pickerMatters.length;
        const checked = this.pickerMatters.filter(m => m.checked).length;
        return `${total} items${checked > 0 ? ` · ${checked} selected` : ''}`;
    }
    get addEntriesDisabled() { return !this.pickerMatters.some(m => m.checked); }
    get addEntriesBtnLabel() {
        const n = this.pickerMatters.filter(m => m.checked).length;
        return n > 0 ? `Add ${n} ${n === 1 ? 'Entry' : 'Entries'} ›` : 'Add Entries ›';
    }

    get staffComboOptions() {
        return this.eligibleStaff.map(s => ({ label: s.name, value: s.id }));
    }

    get isPickView()    { return this._panelView === 'pick'; }
    get isFillView()    { return this._panelView === 'fill'; }
    get isSuccessView() { return this._panelView === 'success'; }

    get batchDate() { return this._batchDate; }

    get draftCountLabel() {
        const n = this.draftEntries.length;
        return `${n} ${n === 1 ? 'entry' : 'entries'}`;
    }

    get allCollapseLabel() {
        return this.draftEntries.some(d => !d.collapsed) ? 'Collapse All' : 'Expand All';
    }

    get hasDraftEntries()   { return this.draftEntries.length > 0; }
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

    /* ── Deadline drawer ── */

    handleDeadlineClick(e) {
        const id = e.currentTarget.dataset.id;
        const dl = this.criticalDeadlines.find(d => d.id === id);
        if (!dl) return;
        this.selectedDeadline = {
            ...dl,
            matterUrl:     dl.matterId ? `/lightning/r/NEOS_Matter__c/${dl.matterId}/view` : '',
            hasMatterLink: !!dl.matterId
        };
        this.drawerOpen = true;
    }

    closeDrawer() {
        this.drawerOpen       = false;
        this.selectedDeadline = null;
    }

    handleTodayTimeReportClick() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: '00OVt00000ClpOLMAZ', actionName: 'view' }
        });
    }

    handleEventsReportClick() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: '00OVt00000C9uIbMAJ', actionName: 'view' }
        });
    }

    handleTasksReportClick() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: '00OVt00000C9pu1MAB', actionName: 'view' }
        });
    }

    handleLast7ReportClick() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: '00OVt00000BNAjVMAX', actionName: 'view' }
        });
    }

    handleOpenMatter() {
        if (!this.selectedDeadline || !this.selectedDeadline.matterId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.selectedDeadline.matterId, actionName: 'view' }
        });
    }

    handleOpenEvent() {
        if (!this.selectedDeadline || !this.selectedDeadline.id) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.selectedDeadline.id, actionName: 'view' }
        });
    }

    handleOpenMatterById(e) {
        const matterId = e.currentTarget.dataset.id;
        if (!matterId) return;
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: matterId, actionName: 'view' }
        });
    }

    /* ── Events range filters (deadlines and associate are independent) ── */

    handleTypeFilter(e) {
        this._filterType = e.target.value;
        this._applyEventsFilter();
    }

    handleAssocTypeFilter(e) {
        this._assocFilterType = e.target.value;
        this._applyEventsFilter();
    }

    handleDeadlinesFilter(e) {
        this._deadlinesFilter = e.currentTarget.dataset.filter;
        this._applyEventsFilter();
    }

    handleAssocFilter(e) {
        this._assocFilter = e.currentTarget.dataset.filter;
        this._applyEventsFilter();
    }

    toggleDlTodayGroup()  { this.dlTodayCollapsed  = !this.dlTodayCollapsed; }
    toggleDlWeekGroup()   { this.dlWeekCollapsed   = !this.dlWeekCollapsed; }
    toggleDlMonthGroup()  { this.dlMonthCollapsed  = !this.dlMonthCollapsed; }
    toggleDlBeyondGroup() { this.dlBeyondCollapsed = !this.dlBeyondCollapsed; }

    toggleTodayGroup()  { this.todayGroupCollapsed  = !this.todayGroupCollapsed; }
    toggleWeekGroup()   { this.weekGroupCollapsed   = !this.weekGroupCollapsed; }
    toggleMonthGroup()  { this.monthGroupCollapsed  = !this.monthGroupCollapsed; }
    toggleBeyondGroup() { this.beyondGroupCollapsed = !this.beyondGroupCollapsed; }

    handleDeadlineMouseEnter(e) {
        const id = e.currentTarget.dataset.id;
        const dl = this.criticalDeadlines.find(d => d.id === id);
        if (!dl) return;
        const rect = e.currentTarget.getBoundingClientRect();
        this._tooltipX = rect.right + 10;
        this._tooltipY = rect.top;
        this._tooltipEvent = {
            subject:     dl.subject    || dl.eventType,
            eventType:   dl.eventType  || '',
            daysLabel:   dl.daysLabel  || '',
            timeRange:   dl.isAllDay ? '' : (dl.dateLabel || ''),
            dayLabel:    dl.endDateLabel || '',
            matterName:  dl.matterName || '',
            attendees:   dl.attendees  || '',
            location:    dl.location   || '',
            description: dl.description || ''
        };
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            const tip = this.template.querySelector('.assoc-event-tooltip');
            if (tip) {
                tip.style.left = `${this._tooltipX}px`;
                tip.style.top  = `${this._tooltipY}px`;
            }
        });
    }

    handleDeadlineMouseLeave() {
        this._tooltipEvent = null;
    }

    handleEventMouseEnter(e) {
        const id  = e.currentTarget.dataset.id;
        const all = [...this.todayAssociate, ...this.weekAssociate, ...this.monthAssociate, ...this.beyondAssociate];
        const ev  = all.find(x => x.id === id);
        if (!ev) return;
        const rect       = e.currentTarget.getBoundingClientRect();
        this._tooltipX   = rect.right + 10;
        this._tooltipY   = rect.top;
        this._tooltipEvent = {
            subject:     ev.subject    || '',
            eventType:   ev.eventType  || '',
            daysLabel:   ev.daysLabel  || '',
            timeRange:   ev.timeRange  || '',
            dayLabel:    ev.isToday ? '' : (ev.dayLabel || ''),
            matterName:  ev.matterName || '',
            attendees:   ev.attendees  || '',
            location:    ev.location   || '',
            description: this._cleanDescription(ev.description)
        };
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            const tip = this.template.querySelector('.assoc-event-tooltip');
            if (tip) {
                tip.style.left = `${this._tooltipX}px`;
                tip.style.top  = `${this._tooltipY}px`;
            }
        });
    }

    handleEventMouseLeave() {
        this._tooltipEvent = null;
    }

    handleMyEventClick(e) {
        const id  = e.currentTarget.dataset.id;
        const all = [...this.todayAssociate, ...this.weekAssociate, ...this.monthAssociate, ...this.beyondAssociate];
        const ev  = all.find(x => x.id === id);
        if (!ev) return;
        this.selectedDeadline = {
            ...ev,
            dotClass:      ev.dotClass || 'deadline-dot deadline-dot--blue',
            eventType:     ev.subject  || ev.eventType || '',
            daysLabel:     ev.daysLabel,
            endDateLabel:  ev.endDate ? this._fmtDatetime(ev.endDate) : '',
            description:   this._cleanDescription(ev.description),
            hasMatterLink: !!ev.matterId,
            matterUrl:     ev.matterId ? `/lightning/r/NEOS_Matter__c/${ev.matterId}/view` : ''
        };
        this.drawerOpen = true;
    }

    get isTooltipVisible() { return !!this._tooltipEvent; }
    get tooltipEvent()     { return this._tooltipEvent; }

    /* ── Task filter ── */

    handleTaskFilter(e) {
        this._taskFilter = e.currentTarget.dataset.filter;
        this.myTasks     = this._processTasks(this._filterTasks(this._rawTasks));
    }

    /* ── Task completion ── */

    handleTaskComplete(e) {
        const taskId  = e.target.dataset.id;
        const taskIdx = this.myTasks.findIndex(t => t.id === taskId);
        if (taskIdx === -1 || this.myTasks[taskIdx].isCompleted) return;
        const originalTask = this.myTasks[taskIdx];
        // eslint-disable-next-line no-alert
        if (!window.confirm(`Mark "${originalTask.subject}" as complete?`)) {
            e.target.checked = false;
            return;
        }

        this.myTasks = this.myTasks.map(t => t.id === taskId ? {
            ...t,
            isCompleted:   true,
            rowClass:      'tasks-row tasks-row--completed',
            status:        'Completed',
            dueLabel:      'Completed',
            dueBadgeClass: 'due-badge due-badge--done'
        } : t);

        completeTask({ taskId })
            .then(() => {
                // eslint-disable-next-line @lwc/lwc/no-async-operation
                setTimeout(() => {
                    this._rawTasks     = this._rawTasks.filter(t => t.id !== taskId);
                    this.myTasks       = this.myTasks.filter(t => t.id !== taskId);
                    this.openTaskCount = Math.max(0, this.openTaskCount - 1);
                }, 900);
            })
            .catch(err => {
                this.myTasks = this.myTasks.map(t => t.id === taskId ? originalTask : t);
                const msg = (err && err.body && err.body.message) ? err.body.message : 'Could not complete task.';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            });
    }

    /* ── Matter picker ── */

    _loadPickerMatters() {
        this.isPickerLoading = true;
        getRecentMatters({ myOnly: this._pickerTab === 'my' })
            .then(data => {
                this._allPickerMatters = data;
                this.pickerMatters     = this._withChecks(data);
                this.isPickerLoading   = false;
            })
            .catch(() => { this.isPickerLoading = false; });
    }

    switchPickerTab(e) {
        this._pickerTab    = e.currentTarget.dataset.tab;
        this._pickerSearch = '';
        this.pickerMatters = [];
        this._loadPickerMatters();
    }

    switchToAllCases() {
        this._pickerTab    = 'all';
        this._pickerSearch = '';
        this.pickerMatters = [];
        this._loadPickerMatters();
    }

    handlePickerSearch(e) {
        this._pickerSearch = e.target.value;
        if (this._searchTimer) clearTimeout(this._searchTimer);

        if (this._pickerSearch.trim().length === 0) {
            this.pickerMatters = this._withChecks(this._allPickerMatters);
            return;
        }
        if (this._pickerSearch.trim().length < 2) {
            const q = this._pickerSearch.toLowerCase();
            this.pickerMatters = this._withChecks(
                this._allPickerMatters.filter(m => m.name.toLowerCase().includes(q))
            );
            return;
        }
        this._searchTimer = setTimeout(() => {
            searchMatters({ query: this._pickerSearch, myOnly: this._pickerTab === 'my' })
                .then(data => { this.pickerMatters = this._withChecks(data); })
                .catch(() => {});
        }, 300);
    }

    toggleMatterCheck(e) {
        const id = e.currentTarget.dataset.id;
        this.pickerMatters = this.pickerMatters.map(m => {
            if (m.id !== id) return m;
            const checked = !m.checked;
            const cls = 'picker-row'
                + (checked ? ' picker-row--checked' : '')
                + (m.isAdded && !checked ? ' picker-row--added' : '');
            return { ...m, checked, rowClass: cls };
        });
    }

    addSelectedAsEntries() {
        const selected  = this.pickerMatters.filter(m => m.checked);
        if (!selected.length) return;
        const existingIds = new Set(this.draftEntries.map(d => d.matterId));
        const toAdd       = selected.filter(m => !existingIds.has(m.id));
        const today       = this._todayIso();
        const date        = this._batchDate || today;
        const newEntries  = toAdd.map(m => {
            this._entryCounter++;
            return {
                _id:              String(this._entryCounter),
                cardTitle:        m.recordType ? `${m.name} | ${m.recordType}` : m.name,
                matterId:         m.id,
                staffId:          this._currentUserId,
                entryDate:        date,
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
        });
        if (newEntries.length) {
            this.draftEntries = [...this.draftEntries, ...newEntries];
            this._fireDailyStats();
        }
        this._syncPickerAddedState();
        this._panelView = 'fill';
    }

    /* ── Entry card handlers ── */

    handleStaffChange(e) {
        const id  = e.target.dataset.id;
        const val = e.detail.value;
        this.draftEntries = this.draftEntries.map(d => d._id === id ? { ...d, staffId: val } : d);
    }

    handleEntryField(e) {
        const id    = e.target.dataset.id;
        const field = e.target.dataset.field;
        const val   = e.target.value;
        this.draftEntries = this.draftEntries.map(d => {
            if (d._id !== id) return d;
            const updated = { ...d, [field]: val };
            if (field === 'hours') {
                updated.hoursClass        = this._hoursClass(val);
                updated.collapsedSummary  = this._collapsedSummary(val, d.taskNote);
            }
            if (field === 'taskNote') {
                updated.taskNoteClass     = this._taskNoteClass(val);
                updated.noteLength        = val.length;
                updated.noteCounterClass  = this._noteCounterClass(val.length);
                updated.collapsedSummary  = this._collapsedSummary(d.hours, val);
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

    handleBatchDateChange(e) {
        this._batchDate = e.target.value;
        if (!this._batchDate) return;
        this.draftEntries = this.draftEntries.map(d => ({ ...d, entryDate: this._batchDate }));
    }

    removeDraftEntry(e) {
        const id = e.currentTarget.dataset.id;
        this.draftEntries = this.draftEntries.filter(d => d._id !== id);
        this._fireDailyStats();
        this._syncPickerAddedState();
        if (this.draftEntries.length === 0) this._panelView = 'pick';
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
        const idx = this.draftEntries.findIndex(d => d._id === id);
        const updated = [...this.draftEntries];
        updated.splice(idx + 1, 0, clone);
        this.draftEntries = updated;
        this._fireDailyStats();
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

    handleBackToPick() { this._panelView = 'pick'; }

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
                const todayIso = this._todayIso();
                const addedToday = this.draftEntries
                    .filter(d => d.staffId === this._currentUserId && d.entryDate === todayIso)
                    .reduce((s, d) => s + parseFloat(d.hours), 0);
                if (addedToday > 0) this.todayHours = Number(this.todayHours) + addedToday;

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
                this._fireDailyStats();
                this._syncPickerAddedState();
                this._silentRefresh();
            })
            .catch(err => {
                const msg = (err && err.body && err.body.message) ? err.body.message : 'Submit failed.';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            })
            .finally(() => { this.isSubmitting = false; });
    }

    handleSubmitMore() {
        this._panelView       = 'pick';
        this._batchDate       = '';
        this.submittedEntries = [];
        this.pickerMatters    = this.pickerMatters.map(m => ({
            ...m, checked: false, isAdded: false, rowClass: 'picker-row'
        }));
    }
}
