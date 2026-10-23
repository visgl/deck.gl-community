import {DockedPanelContainer, type DockedPanelContainerProps} from './docked-panel-container';
import type {PanelDockSide} from '../panels/panel-container-state';

/** Content, docking, and controlled/uncontrolled pin options. */
export type PinnablePanelContainerProps = DockedPanelContainerProps & {
  /** Docking edge. Default right. */
  side?: PanelDockSide;
  /** Controlled pin state. */
  pinned?: boolean;
  /** Initial uncontrolled pin state. Default false. */
  defaultPinned?: boolean;
  /** Called on user pin/unpin requests, including controlled usage. */
  onPinnedChange?: (pinned: boolean) => void;
};

/** Panel that switches between an anchored overlay and canvas chrome. */
export class PinnablePanelContainer extends DockedPanelContainer<PinnablePanelContainerProps> {
  static defaultProps = {
    ...DockedPanelContainer.defaultProps,
    id: 'pinnable-panel-container',
    side: 'right' as const,
    resizable: true,
    pinned: undefined,
    defaultPinned: false,
    onPinnedChange: undefined
  };
  private uncontrolledPinned: boolean;

  /** Creates a floating or initially pinned panel. */
  constructor(props: PinnablePanelContainerProps = {}) {
    super(props);
    this.uncontrolledPinned = this.props.defaultPinned;
    this.placement = this.props.placement;
  }

  get side(): PanelDockSide {
    return this.props.side;
  }
  get isPinned(): boolean {
    return this.props.pinned ?? this.uncontrolledPinned;
  }
  protected override get isPinnable(): boolean {
    return true;
  }

  override setProps(props: Partial<PinnablePanelContainerProps>): void {
    if (props.placement !== undefined) this.placement = props.placement;
    // Retain the last controlled value when returning to uncontrolled usage.
    if (this.props.pinned !== undefined && 'pinned' in props && props.pinned === undefined) {
      this.uncontrolledPinned = this.props.pinned;
    }
    super.setProps(props);
  }

  protected override changePinned(pinned: boolean): void {
    if (!this.canPin) return;
    if (this.props.pinned === undefined) this.uncontrolledPinned = pinned;
    this.props.onPinnedChange?.(pinned);
    this.updateHTML();
  }
}
