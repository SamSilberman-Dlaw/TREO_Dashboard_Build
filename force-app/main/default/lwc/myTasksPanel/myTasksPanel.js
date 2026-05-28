import { LightningElement, api } from 'lwc';

export default class MyTasksPanel extends LightningElement {
    @api tasks    = [];
    @api isCompact = false;

    get containerClass() {
        return `tasks-container${this.isCompact ? ' tasks-container--compact' : ''}`;
    }

    get hasTasks() { return this.tasks && this.tasks.length > 0; }

    get formattedTasks() {
        const today    = this._startOfDay(new Date());
        const tomorrow = this._startOfDay(new Date(today.getTime() + 86400000));

        return (this.tasks || []).map(t => {
            const due = t.dueDate ? this._startOfDay(new Date(t.dueDate)) : null;
            let dueDateLabel = '';
            let dueLabelClass = 'task-due';

            if (t.isCompleted) {
                dueDateLabel  = 'Completed';
                dueLabelClass = 'task-due task-due--done';
            } else if (t.isOverdue) {
                dueDateLabel  = 'OVERDUE';
                dueLabelClass = 'task-due task-due--overdue';
            } else if (due) {
                if (due.getTime() === today.getTime()) {
                    dueDateLabel  = 'Due Today';
                    dueLabelClass = 'task-due task-due--today';
                } else if (due.getTime() === tomorrow.getTime()) {
                    dueDateLabel = 'Due Tomorrow';
                } else {
                    dueDateLabel = 'Due ' + due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }
            }

            return {
                ...t,
                dueDateLabel,
                dueLabelClass,
                rowClass: [
                    'task-row',
                    t.isCompleted ? 'task-row--done'    : '',
                    t.isOverdue   ? 'task-row--overdue' : ''
                ].join(' ').trim(),
                estimatedHoursFormatted: t.estimatedHours ? Number(t.estimatedHours).toFixed(1) : ''
            };
        });
    }

    handleCheckboxChange(event) {
        event.preventDefault();
        const taskId = event.target.dataset.id;
        const task   = (this.tasks || []).find(t => t.id === taskId);
        if (task && !task.isCompleted) {
            this.dispatchEvent(new CustomEvent('taskcomplete', {
                detail: task, bubbles: true, composed: true
            }));
        }
    }

    handleAddTime(event) {
        const taskId = event.currentTarget.dataset.id;
        const task   = (this.tasks || []).find(t => t.id === taskId);
        if (task) {
            this.dispatchEvent(new CustomEvent('addtime', {
                detail: task, bubbles: true, composed: true
            }));
        }
    }

    _startOfDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
}
