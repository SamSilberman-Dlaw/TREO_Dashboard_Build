import { LightningElement, api, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import getMatterDetail from '@salesforce/apex/DlawConsoleController.getMatterDetail';

export default class MatterPreviewDrawer extends NavigationMixin(LightningElement) {
    @api matterId;
    @api deadline;

    @track matterDetail = null;
    @track isLoading    = true;

    @wire(getMatterDetail, { matterId: '$matterId' })
    wiredMatter({ data, error }) {
        this.isLoading = false;
        if (data)  this.matterDetail = data;
        if (error) this.matterDetail = null;
    }

    get hasDeadline()          { return !!this.deadline; }
    get hasOpenTasks()         { return this.matterDetail?.openTasks?.length > 0; }
    get hasUpcomingDeadlines() { return this.matterDetail?.upcomingDeadlines?.length > 0; }

    get deadlineHighlightClass() {
        const color = this.deadline?.priorityColor || 'purple';
        return `deadline-highlight deadline-highlight--${color}`;
    }

    get formattedDeadlineDate() {
        if (!this.deadline?.deadlineDate) return '';
        return new Date(this.deadline.deadlineDate).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
            hour: 'numeric', minute: '2-digit'
        });
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
    }

    handleOverlayClick(event) {
        if (event.target === event.currentTarget) this.handleClose();
    }

    handleOpenMatter() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.matterId, actionName: 'view' }
        });
    }
}
