import { LightningElement, api } from 'lwc';

export default class CriticalDeadlinesPanel extends LightningElement {
    @api deadlines = [];
    @api isCompact = false;

    get containerClass() {
        return `deadlines-container${this.isCompact ? ' deadlines-container--compact' : ''}`;
    }

    get hasDeadlines() {
        return this.deadlines && this.deadlines.length > 0;
    }

    get formattedDeadlines() {
        return (this.deadlines || []).map(d => {
            const color = d.priorityColor || 'purple';
            const date = d.deadlineDate ? new Date(d.deadlineDate) : null;
            return {
                ...d,
                dotClass: `priority-dot priority-dot--${color}`,
                daysLabel: `${d.daysRemaining}d`,
                formattedDate: date
                    ? date.toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric',
                          hour: 'numeric', minute: '2-digit'
                      })
                    : ''
            };
        });
    }

    handleClick(event) {
        const row = event.currentTarget;
        const dl = (this.deadlines || []).find(d => d.id === row.dataset.id);
        if (!dl) return;
        this.dispatchEvent(new CustomEvent('deadlineclick', {
            detail: dl, bubbles: true, composed: true
        }));
    }
}
