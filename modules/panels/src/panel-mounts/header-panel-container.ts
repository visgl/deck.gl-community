import {DockedPanelContainer, type DockedPanelContainerProps} from './docked-panel-container';

/** Content and sizing options for {@link HeaderPanelContainer}. */
export type HeaderPanelContainerProps = DockedPanelContainerProps;

/** Permanent top chrome around the manager's content element. */
export class HeaderPanelContainer extends DockedPanelContainer<HeaderPanelContainerProps> {
  static defaultProps = {...DockedPanelContainer.defaultProps, id: 'header-panel-container'};
  /** Creates permanent top chrome. */
  constructor(props: HeaderPanelContainerProps = {}) {
    super(props);
  }
  get side(): 'top' {
    return 'top';
  }
}
