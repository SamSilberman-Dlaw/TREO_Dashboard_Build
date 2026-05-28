import { LightningElement, api } from 'lwc';

const SIZE_MAP = {
    small: 'slds-text-heading_small',
    medium: 'slds-text-heading_medium',
    large: 'slds-text-heading_large'
};

export default class DlawSectionHeader extends LightningElement {
    @api label = '';
    @api subtitle = '';
    @api iconName = '';
    @api variant = 'default';
    @api size = 'small';

    get containerClass() {
        const v = this.variant || 'default';
        return `section-header section-header--${v}`;
    }

    get headingClass() {
        return SIZE_MAP[this.size] || SIZE_MAP.small;
    }
}
