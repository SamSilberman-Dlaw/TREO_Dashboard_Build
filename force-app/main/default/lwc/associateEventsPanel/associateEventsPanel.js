import { LightningElement, api } from 'lwc';

export default class AssociateEventsPanel extends LightningElement {
    @api events  = [];
    @api isCompact = false;

    get containerClass() {
        return `assoc-container${this.isCompact ? ' assoc-container--compact' : ''}`;
    }

    get hasAnyEvents()  { return this.events && this.events.length > 0; }
    get hasTodayEvents() { return this.todayEvents.length > 0; }
    get hasWeekEvents()  { return this.weekEvents.length > 0; }

    get todayEvents() {
        return (this.events || [])
            .filter(e => e.groupLabel === 'TODAY')
            .map(e => ({
                ...e,
                timeLabel: e.dueDate
                    ? new Date(e.dueDate).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                    : ''
            }));
    }

    get weekEvents() {
        return (this.events || [])
            .filter(e => e.groupLabel === 'THIS_WEEK')
            .map(e => ({
                ...e,
                dayLabel: e.dueDate
                    ? new Date(e.dueDate).toLocaleDateString('en-US', { weekday: 'short' })
                    : ''
            }));
    }
}
