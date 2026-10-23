import {DockedPanelContainer, type DockedPanelContainerProps} from './docked-panel-container';

/** Content, sizing, and edge options for permanent side chrome. */
export type SidePanelContainerProps = DockedPanelContainerProps & {
  /** Docking edge. Default left. */
  side?: 'left' | 'right';
};

/** Permanent left or right chrome around the manager's content element. */
export class SidePanelContainer extends DockedPanelContainer<SidePanelContainerProps> {
  static defaultProps = {
    ...DockedPanelContainer.defaultProps,
    id: 'side-panel-container',
    side: 'left' as const
  };
  /** Creates permanent side chrome. */
  constructor(props: SidePanelContainerProps = {}) {
    super(props);
  }
  get side(): 'left' | 'right' {
    return this.props.side;
  }
}
