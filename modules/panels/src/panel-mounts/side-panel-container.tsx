/** @jsxImportSource preact */
import {DockedPanelContainer, type DockedPanelContainerProps} from './docked-panel-container';
import type {PanelManager} from '../panels/panel-manager';

/** Content, sizing, visibility, and edge options for side chrome. */
export type SidePanelContainerProps = DockedPanelContainerProps & {
  /** Docking edge. Default left. */
  side?: 'left' | 'right';
  /** Show hide and floating restore controls. Default false. */
  hidable?: boolean;
  /** Controlled hidden state, effective when hidable is true. */
  hidden?: boolean;
  /** Initial uncontrolled hidden state. Default false. */
  defaultHidden?: boolean;
  /** Called when the user requests a visibility change. */
  onHiddenChange?: (hidden: boolean) => void;
};

/** Left or right chrome, optionally hidden with a floating restore control. */
export class SidePanelContainer extends DockedPanelContainer<SidePanelContainerProps> {
  static defaultProps = {
    ...DockedPanelContainer.defaultProps,
    id: 'side-panel-container',
    side: 'left' as const,
    hidable: false,
    hidden: undefined,
    defaultHidden: false,
    onHiddenChange: undefined
  };
  private uncontrolledHidden: boolean;
  private restoreButton?: HTMLButtonElement;

  constructor(props: SidePanelContainerProps = {}) {
    super(props);
    this.uncontrolledHidden = this.props.defaultHidden;
  }

  get side(): 'left' | 'right' {
    return this.props.side;
  }

  get isHidden(): boolean {
    return this.props.hidable && (this.props.hidden ?? this.uncontrolledHidden);
  }

  override setProps(props: Partial<SidePanelContainerProps>): void {
    if (this.props.hidden !== undefined && 'hidden' in props && props.hidden === undefined) {
      this.uncontrolledHidden = this.props.hidden;
    }
    super.setProps(props);
  }

  protected override get hasHeaderActions(): boolean {
    return this.props.hidable;
  }

  protected override renderHeaderTitle() {
    return <span>{this.props.title ?? 'Panel'}</span>;
  }

  protected override renderHeaderActions() {
    return this.props.hidable ? (
      <button
        type="button"
        className="deck-panel-chrome-hide"
        aria-label={`Hide ${this.props.title ?? 'side panel'}`}
        title={`Hide ${this.props.title ?? 'side panel'}`}
        onClick={() => this.changeHidden(true)}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d={this.side === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
        </svg>
      </button>
    ) : null;
  }

  override onRenderHTML(root: HTMLElement): void {
    super.onRenderHTML(root);
    root.hidden = !this.canPin || this.isHidden;
    const manager = this.panelManager as PanelManager | undefined;
    const center = manager?.contentElement?.parentElement;
    if (this.isHidden && this.canPin && center) {
      if (!this.restoreButton) {
        this.restoreButton = root.ownerDocument.createElement('button');
        this.restoreButton.type = 'button';
        this.restoreButton.className = 'deck-panel-chrome-restore';
        this.restoreButton.onclick = () => this.changeHidden(false);
        for (const type of [
          'pointerdown',
          'pointerup',
          'click',
          'wheel',
          'touchstart',
          'touchend'
        ]) {
          this.restoreButton.addEventListener(type, event => event.stopPropagation());
        }
      }
      const button = this.restoreButton;
      const icon = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [key, value] of Object.entries({
        width: '18',
        height: '18',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.75',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false'
      }))
        icon.setAttribute(key, value);
      const path = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', this.side === 'left' ? 'm9 18 6-6-6-6' : 'm15 18-6-6 6-6');
      icon.append(path);
      button.replaceChildren(icon);
      button.setAttribute('aria-label', `Show ${this.props.title ?? 'side panel'}`);
      button.title = `Show ${this.props.title ?? 'side panel'}`;
      button.style.left = this.side === 'left' ? '16px' : '';
      button.style.right = this.side === 'right' ? '16px' : '';
      if (button.parentElement !== center) center.append(button);
    } else {
      this.restoreButton?.remove();
    }
  }

  override onRemove(): void {
    this.restoreButton?.remove();
    this.restoreButton = undefined;
    super.onRemove();
  }

  private changeHidden(hidden: boolean): void {
    if (!this.props.hidable) return;
    if (this.props.hidden === undefined) this.uncontrolledHidden = hidden;
    this.props.onHiddenChange?.(hidden);
    this.updateHTML();
  }
}
