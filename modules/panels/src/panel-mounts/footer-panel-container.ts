import {DockedPanelContainer, type DockedPanelContainerProps} from './docked-panel-container';

/** Content and sizing options for {@link FooterPanelContainer}. */
export type FooterPanelContainerProps = DockedPanelContainerProps;

/** Permanent bottom chrome around the manager's content element. */
export class FooterPanelContainer extends DockedPanelContainer<FooterPanelContainerProps> {
  static defaultProps = {...DockedPanelContainer.defaultProps, id: 'footer-panel-container'};
  /** Creates permanent bottom chrome. */
  constructor(props: FooterPanelContainerProps = {}) {
    super(props);
  }
  get side(): 'bottom' {
    return 'bottom';
  }
}
