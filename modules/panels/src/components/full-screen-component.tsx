// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
/** @jsxImportSource preact */
import {render} from 'preact';
import {
  PanelComponent,
  type PanelComponentProps,
  type PanelPlacement
} from '../panels/panel-component';
import {FullScreenController, type FullScreenMode} from '../lib/full-screen-controller';

/** Props for the fullscreen affordance. Mount it inside its target visualization host. */
export type FullScreenComponentProps = PanelComponentProps & {
  /** Existing visualization host, including this component's mounted button. */
  target: HTMLElement;
  /** PanelManager placement; defaults to bottom-right. */
  placement?: PanelPlacement;
  /** Accessible entry button text. */
  enterLabel?: string;
  /** Accessible exit button text. */
  exitLabel?: string;
  /** Called when native or fallback fullscreen changes. */
  onChange?: (mode: FullScreenMode) => void;
  /** Reports an entry/exit error that cannot be handled by the viewport fallback. */
  onError?: (error: unknown) => void;
};

/** Standalone fullscreen button with native fullscreen and an iPhone-compatible viewport fallback. */
export class FullScreenComponent extends PanelComponent<FullScreenComponentProps> {
  /** Default appearance and placement. The target must be supplied by the caller. */
  static defaultProps: Required<FullScreenComponentProps> = {
    ...PanelComponent.defaultProps,
    id: 'full-screen-component',
    target: undefined!,
    placement: 'bottom-right',
    enterLabel: 'Enter fullscreen',
    exitLabel: 'Exit fullscreen',
    onChange: undefined!,
    onError: undefined!
  };
  /** Root class for themed fullscreen controls. */
  className = 'deck-widget-fullscreen';
  /** Placement used by PanelManager. */
  placement: PanelPlacement = 'bottom-right';
  #root: HTMLElement | null = null;
  #controller: FullScreenController | null = null;

  /** Create a fullscreen button for a host managed by the application. */
  constructor(props: FullScreenComponentProps) {
    super({...FullScreenComponent.defaultProps, ...props});
    this.placement = this.props.placement;
  }

  /** Update labels, callbacks, placement, or the target. Changing targets exits the old target. */
  override setProps(props: Partial<FullScreenComponentProps>): void {
    if (props.placement !== undefined) this.placement = props.placement;
    super.setProps(props);
  }

  /** Release fullscreen ownership and DOM when the component is removed. */
  override onRemove(): void {
    this.#controller?.destroy();
    this.#controller = null;
    if (this.#root) render(null, this.#root);
    this.#root = null;
    super.onRemove();
  }

  /** Mount or update the affordance without replacing the visualization's content. */
  override onRenderHTML(root: HTMLElement): void {
    this.#root = root;
    root.classList.add('deck-widget', this.className);
    Object.assign(
      root.style,
      {position: 'absolute', pointerEvents: 'auto', zIndex: '99'},
      this.props.style
    );
    if (this.#controller?.target !== this.props.target) {
      this.#controller?.destroy();
      this.#controller = new FullScreenController({
        target: this.props.target,
        getInitialFocus: () => this.#root?.querySelector('button') ?? null,
        onChange: mode => {
          this.#render();
          this.props.onChange?.(mode);
        }
      });
    }
    this.#render();
  }

  #render(): void {
    if (!this.#root || !this.#controller) return;
    const active = this.#controller.active;
    const label = active ? this.props.exitLabel : this.props.enterLabel;
    render(
      <button
        type="button"
        className={active ? 'deck-widget-fullscreen-exit' : 'deck-widget-fullscreen-enter'}
        aria-label={label}
        aria-pressed={active}
        title={label}
        style={{
          minWidth: '44px',
          minHeight: '44px',
          font: 'inherit',
          cursor: 'pointer',
          border: 'var(--button-stroke, 1px solid #52637b)',
          borderRadius: 'var(--button-corner-radius, 6px)',
          background: 'var(--button-background, #142238)',
          color: 'var(--button-text, white)'
        }}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation();
          void this.#controller?.toggle().catch(error => this.props.onError?.(error));
        }}
      >
        <span aria-hidden="true">{active ? '↙' : '⛶'}</span>
      </button>,
      this.#root
    );
  }
}
