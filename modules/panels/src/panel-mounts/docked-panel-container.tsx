/** @jsxImportSource preact */
import {render, type ComponentChildren} from 'preact';
import {ensurePanelChromeStylesheet} from '../lib/panel-styles';
import {
  PanelContainer,
  type PanelContainerProps,
  type PanelPlacement
} from '../panels/panel-container';
import {PanelThemeScope} from '../panels/panel-theme-scope';
import {PanelContainerStateContext, type PanelDockSide} from '../panels/panel-container-state';
import type {PanelManager} from '../panels/panel-manager';

/** Shared sizing and content options for canvas chrome. */
export type DockedPanelContainerProps = PanelContainerProps & {
  /** Optional title; permanent chrome omits its header when absent. */
  title?: string;
  /** Preferred width for left/right docking and floating panels. Default 320. */
  widthPx?: number;
  /** Preferred height for top/bottom docking. Default 240. */
  heightPx?: number;
  /** Follow natural content size until manually resized. Default false. */
  fitContent?: boolean;
  /** Show a keyboard and pointer operated divider while docked. */
  resizable?: boolean;
};

/** Internal common implementation for permanent and pinnable chrome. */
export abstract class DockedPanelContainer<
  PropsT extends DockedPanelContainerProps = DockedPanelContainerProps
> extends PanelContainer<PropsT> {
  static defaultProps = {
    ...PanelContainer.defaultProps,
    title: undefined,
    widthPx: 320,
    heightPx: 240,
    fitContent: false,
    resizable: false
  };

  className = 'deck-panel-chrome';
  placement: PanelPlacement = 'top-left';
  private resizedWidth?: number;
  private resizedHeight?: number;
  private stopDrag?: () => void;
  private eventRoot?: HTMLElement;

  /** Edge assigned by the concrete container. */
  abstract get side(): PanelDockSide;
  /** Permanent chrome is always pinned. */
  get isPinned(): boolean {
    return true;
  }
  /** Whether pin/unpin chrome should be rendered. */
  protected get isPinnable(): boolean {
    return false;
  }
  /** Host docking capability, independent of configured pin state. */
  get canPin(): boolean {
    return Boolean((this.panelManager as PanelManager | undefined)?.contentElement);
  }

  override setProps(props: Partial<PropsT>): void {
    if (props.fitContent === true) {
      this.resizedWidth = undefined;
      this.resizedHeight = undefined;
    }
    if (props.widthPx !== undefined && props.widthPx !== this.props.widthPx)
      this.resizedWidth = undefined;
    if (props.heightPx !== undefined && props.heightPx !== this.props.heightPx)
      this.resizedHeight = undefined;
    super.setProps(props);
  }

  /** @internal Apply a declarative descriptor without treating unchanged fitting as a reset. */
  reconcileProps(props: Partial<PropsT>): void {
    const changes = {...props};
    if (changes.fitContent === this.props.fitContent) delete changes.fitContent;
    this.setProps(changes);
  }

  override onRenderHTML(root: HTMLElement): void {
    if (this.eventRoot !== root) {
      this.removeEventListeners();
      this.eventRoot = root;
      for (const eventType of PANEL_INTERACTION_EVENTS) {
        root.addEventListener(eventType, stopPanelEventPropagation);
      }
    }
    ensurePanelChromeStylesheet(root.ownerDocument);
    root.style.margin = this.isPinned ? '0' : `${this.floatingOffsetPx}px`;
    (this.panelManager as PanelManager | undefined)?.updateDockedContainer?.(this);
    root.hidden = this.isPinned && !this.canPin;
    const {panel, title, fitContent, resizable} = this.props;
    const horizontal = this.side === 'left' || this.side === 'right';
    const width = this.resizedWidth ?? normalizeSize(this.props.widthPx, 320);
    const height = this.resizedHeight ?? normalizeSize(this.props.heightPx, 240);
    root.dataset.side = this.side;
    root.dataset.pinned = String(this.isPinned);
    root.dataset.pinnable = String(this.isPinnable);
    root.style.width =
      this.isPinned && !horizontal
        ? '100%'
        : fitContent && this.resizedWidth === undefined
          ? 'max-content'
          : `${width}px`;
    root.style.height =
      this.isPinned && !horizontal
        ? fitContent && this.resizedHeight === undefined
          ? 'max-content'
          : `${height}px`
        : '';
    const state = {pinned: this.isPinned, side: this.side, canPin: this.canPin};
    render(
      <PanelContainerStateContext.Provider value={state}>
        <section className="deck-panel-chrome-shell" aria-label={title ?? 'Panel'}>
          {title || this.isPinnable || this.hasHeaderActions ? (
            <header className="deck-panel-chrome-header">
              {this.renderHeaderTitle()}
              {this.renderHeaderActions()}
              {this.isPinnable ? (
                <button
                  type="button"
                  disabled={!this.canPin}
                  aria-label={this.isPinned ? 'Unpin panel' : 'Pin panel'}
                  title={this.isPinned ? 'Unpin panel' : 'Pin panel'}
                  aria-pressed={this.isPinned}
                  onClick={() => this.changePinned(!this.isPinned)}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill={this.isPinned ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    focusable="false"
                    style={{transform: this.isPinned ? 'none' : 'rotate(45deg)'}}
                  >
                    <path d="M9 3h6l-1 7 4 4v2H6v-2l4-4-1-7Z" />
                    <path d="M12 16v5" />
                  </svg>
                </button>
              ) : null}
            </header>
          ) : null}
          <div className="deck-panel-chrome-content" hidden={!this.isContentOpen}>
            {panel ? <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope> : null}
          </div>
          {this.isPinned && this.canPin && resizable ? (
            <div
              className="deck-panel-chrome-divider"
              role="separator"
              tabIndex={0}
              aria-label={`Resize ${title ?? 'panel'}`}
              aria-orientation={horizontal ? 'vertical' : 'horizontal'}
              aria-valuemin={0}
              aria-valuemax={Math.floor(this.getSizeLimit())}
              aria-valuenow={Math.round(
                horizontal
                  ? root.getBoundingClientRect().width
                  : root.getBoundingClientRect().height
              )}
              onPointerDown={event => this.startResize(event)}
              onKeyDown={event => {
                const direction = horizontal
                  ? {ArrowLeft: -1, ArrowRight: 1}
                  : {ArrowUp: -1, ArrowDown: 1};
                const delta = direction[event.key];
                if (delta) {
                  event.preventDefault();
                  const bounds = root.getBoundingClientRect();
                  this.resizePanel(
                    (horizontal ? bounds.width : bounds.height) + delta * 10 * this.getResizeSign()
                  );
                }
              }}
            />
          ) : null}
        </section>
      </PanelContainerStateContext.Provider>,
      root
    );
  }

  override onRemove(): void {
    this.stopDrag?.();
    this.removeEventListeners();
    if (this.rootElement) render(null, this.rootElement);
  }

  protected get floatingOffsetPx(): number {
    return 0;
  }

  protected get hasHeaderActions(): boolean {
    return false;
  }

  protected renderHeaderActions(): ComponentChildren {
    return null;
  }

  protected get isContentOpen(): boolean {
    return true;
  }

  protected renderHeaderTitle() {
    return <span>{this.props.title}</span>;
  }

  protected changePinned(_pinned: boolean): void {}

  private removeEventListeners(): void {
    if (this.eventRoot) {
      for (const eventType of PANEL_INTERACTION_EVENTS) {
        this.eventRoot.removeEventListener(eventType, stopPanelEventPropagation);
      }
    }
    this.eventRoot = undefined;
  }

  private getResizeSign(): number {
    return this.side === 'right' || this.side === 'bottom' ? -1 : 1;
  }

  private getSizeLimit(): number {
    const parent = (this.panelManager as PanelManager | undefined)?.parentElement;
    return parent
      ? (this.side === 'left' || this.side === 'right' ? parent.clientWidth : parent.clientHeight) *
          0.45
      : 0;
  }

  private resizePanel(size: number): void {
    const next = Math.max(0, Math.min(size, this.getSizeLimit()));
    if (this.side === 'left' || this.side === 'right') this.resizedWidth = next;
    else this.resizedHeight = next;
    this.updateHTML();
  }

  private startResize(event: PointerEvent): void {
    if (event.button !== 0 || !this.rootElement) return;
    event.preventDefault();
    this.stopDrag?.();
    const divider = event.currentTarget as HTMLElement;
    const horizontal = this.side === 'left' || this.side === 'right';
    const bounds = this.rootElement.getBoundingClientRect();
    const initial = horizontal ? bounds.width : bounds.height;
    const start = horizontal ? event.clientX : event.clientY;
    const side = this.side;
    divider.setPointerCapture(event.pointerId);
    const move = (next: PointerEvent) => {
      if (this.side !== side || !this.isPinned) {
        this.stopDrag?.();
        return;
      }
      this.resizePanel(
        initial + ((horizontal ? next.clientX : next.clientY) - start) * this.getResizeSign()
      );
    };
    const stop = () => {
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('pointerup', stop);
      divider.removeEventListener('pointercancel', stop);
      divider.removeEventListener('lostpointercapture', stop);
      if (divider.hasPointerCapture(event.pointerId))
        divider.releasePointerCapture(event.pointerId);
      this.stopDrag = undefined;
    };
    this.stopDrag = stop;
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('lostpointercapture', stop);
  }
}

function normalizeSize(size: number | undefined, fallback: number): number {
  return Number.isFinite(size) ? Math.max(0, size!) : fallback;
}

// Native listeners also contain touch events on desktop browsers, where Preact
// cannot infer their lowercase names from DOM event properties.
/** @internal Shared gesture guards for panel shells and floating chrome controls. */
export const PANEL_INTERACTION_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'click',
  'dblclick',
  'contextmenu',
  'wheel'
] as const;

function stopPanelEventPropagation(event: Event): void {
  event.stopPropagation();
}
