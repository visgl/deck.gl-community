/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {render} from 'preact';
import {
  PanelContainer,
  type PanelContainerProps,
  type PanelPlacement
} from '../panels/panel-container';
import {PanelThemeScope} from '../panels/panel-theme-scope';

import type {Panel} from '../panels/panel';
import type {JSX} from 'preact';

/**
 * Props for {@link BoxPanelContainer}.
 */
export type BoxPanelContainerProps = PanelContainerProps & {
  /** Panel content rendered inside the box shell. */
  panel?: Panel;
  /** Placement anchor used when mounted by {@link PanelManager}. */
  placement?: PanelPlacement;
  /** Optional header title shown above the panel content. */
  title?: string;
  /** Preferred box width in pixels. */
  widthPx?: number;
  /** Whether the header toggles the open state. */
  collapsible?: boolean;
  /** Initial open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  /** Callback fired when the open state changes. */
  onOpenChange?: (open: boolean) => void;
};

function normalizeBoxWidthPx(widthPx: number): number {
  const clamped = Math.max(220, Math.floor(widthPx));
  return Number.isFinite(clamped) ? clamped : 360;
}

function BoxPanelContainerView({
  panel,
  title,
  widthPx,
  maxHeightPx,
  open,
  collapsible,
  onOpenChange
}: {
  panel?: Panel;
  title?: string;
  widthPx: number;
  maxHeightPx?: number;
  open: boolean;
  collapsible: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <section
      style={BOX_STYLE(widthPx, maxHeightPx)}
      aria-label={title ?? 'Panel box'}
      onPointerDown={stopBoxPanelEventPropagation}
      onPointerMove={stopBoxPanelEventPropagation}
      onPointerUp={stopBoxPanelEventPropagation}
      onMouseDown={stopBoxPanelEventPropagation}
      onMouseMove={stopBoxPanelEventPropagation}
      onMouseUp={stopBoxPanelEventPropagation}
      onTouchStart={stopBoxPanelEventPropagation}
      onTouchMove={stopBoxPanelEventPropagation}
      onTouchEnd={stopBoxPanelEventPropagation}
      onClick={stopBoxPanelEventPropagation}
      onContextMenu={stopBoxPanelEventPropagation}
      onWheel={stopBoxPanelEventPropagation}
    >
      {title ? (
        <header style={BOX_HEADER_STYLE}>
          {collapsible ? (
            <button
              type="button"
              aria-expanded={open}
              style={BOX_HEADER_BUTTON_STYLE}
              onClick={() => onOpenChange(!open)}
            >
              <span>{title}</span>
              <span aria-hidden="true" style={BOX_HEADER_CHEVRON_STYLE(open)}>
                {open ? '▾' : '▸'}
              </span>
            </button>
          ) : (
            <span>{title}</span>
          )}
        </header>
      ) : null}
      <div style={BOX_CONTENT_STYLE(open)}>
        {panel ? <PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope> : null}
      </div>
    </section>
  );
}

/**
 * Fixed-size standalone panel container for compact, always-available content.
 */
export class BoxPanelContainer extends PanelContainer<BoxPanelContainerProps> {
  /** Default props applied before caller-provided box container props. */
  static defaultProps: Required<BoxPanelContainerProps> = {
    ...PanelContainer.defaultProps,
    id: 'box-panel-container',
    placement: 'bottom-left',
    title: undefined!,
    widthPx: 360,
    collapsible: true,
    defaultOpen: true,
    open: undefined!,
    onOpenChange: undefined!,
    panel: undefined!
  };

  /** Root CSS class applied to the mounted box container. */
  className = 'deck-widget-box';
  /** Placement anchor used by panel hosts. */
  placement: PanelPlacement = BoxPanelContainer.defaultProps.placement;
  /** Optional header title shown above panel content. */
  title: string | undefined = BoxPanelContainer.defaultProps.title;
  /** Normalized preferred box width in pixels. */
  widthPx = BoxPanelContainer.defaultProps.widthPx;
  /** Whether the header toggles the open state. */
  collapsible = BoxPanelContainer.defaultProps.collapsible;
  /** Current controlled or uncontrolled open state. */
  isOpen = BoxPanelContainer.defaultProps.defaultOpen;
  #panel: Panel | undefined = BoxPanelContainer.defaultProps.panel;
  #rootElement: HTMLElement | null = null;
  #maxHeightPx: number | undefined = undefined;
  #hasOpenStateInitialized = false;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;

  /** Creates one compact box panel container. */
  constructor(props: Partial<BoxPanelContainerProps> = {}) {
    super({
      ...BoxPanelContainer.defaultProps,
      ...props
    } as BoxPanelContainerProps);
    this.setProps(this.props);
  }

  /** Updates box container props and refreshes mounted content when present. */
  override setProps(props: Partial<BoxPanelContainerProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if ('title' in props) {
      this.title = props.title;
    }
    if (props.widthPx !== undefined) {
      this.widthPx = normalizeBoxWidthPx(props.widthPx);
    }
    if (props.collapsible !== undefined) {
      this.collapsible = props.collapsible;
    }
    this.#setOpenProps(props);
    if ('panel' in props) {
      this.#panel = props.panel;
    }

    this.#render();
    super.setProps(props);
  }

  /** Unmounts box content from the current root element. */
  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  /** Renders box chrome and panel content into a mounted root element. */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    rootElement.style.margin = '0';
    this.#render();
  }

  /** Refreshes viewport-relative box bounds after the host viewport changes. */
  override onViewportChange(): void {
    this.#render();
  }

  #handleOpenChange = (nextOpen: boolean) => {
    if (!this.#isControlled) {
      this.isOpen = nextOpen;
    }
    this.#openChange?.(nextOpen);
    this.#render();
  };

  #render = () => {
    if (!this.#rootElement) {
      return;
    }
    this.#maxHeightPx = getBoxHostMaxHeightPx(this.#rootElement);

    render(
      <BoxPanelContainerView
        panel={this.#panel}
        title={this.title}
        widthPx={this.widthPx}
        maxHeightPx={this.#maxHeightPx}
        open={this.isOpen}
        collapsible={this.collapsible}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement
    );
  };

  #setOpenProps(props: Partial<BoxPanelContainerProps>): void {
    this.#isControlled = props.open !== undefined;
    if (props.onOpenChange !== undefined) {
      this.#openChange = props.onOpenChange;
    }
    if (props.open !== undefined) {
      this.isOpen = props.open;
      this.#hasOpenStateInitialized = true;
      return;
    }
    if (!this.#hasOpenStateInitialized && props.defaultOpen !== undefined) {
      this.isOpen = props.defaultOpen;
      this.#hasOpenStateInitialized = true;
    }
  }
}

function stopBoxPanelEventPropagation(event: Event): void {
  event.stopPropagation();
}

function getBoxHostMaxHeightPx(rootElement: HTMLElement): number | undefined {
  let element = rootElement.parentElement;
  while (element) {
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    const clipsOverflow =
      style?.overflow === 'hidden' ||
      style?.overflowX === 'hidden' ||
      style?.overflowY === 'hidden';
    if (clipsOverflow && element.clientHeight > 0) {
      const availableHeight =
        element.getBoundingClientRect().bottom - rootElement.getBoundingClientRect().top;
      return availableHeight > 0 ? availableHeight : element.clientHeight;
    }
    element = element.parentElement;
  }
  return undefined;
}

const BOX_STYLE = (widthPx: number, maxHeightPx?: number): JSX.CSSProperties => ({
  width: `${widthPx}px`,
  maxWidth: `min(84vw, ${widthPx}px)`,
  ...(maxHeightPx === undefined ? {} : {maxHeight: `${maxHeightPx}px`}),
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'auto',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: '12px',
  background: 'var(--menu-background, rgba(255, 255, 255, 0.96))',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0 18px 40px rgba(15, 23, 42, 0.16))',
  overflow: 'hidden'
});

const BOX_HEADER_STYLE: JSX.CSSProperties = {
  padding: '14px 16px 10px',
  fontSize: '18px',
  fontWeight: 700,
  lineHeight: 1.2,
  color: 'var(--button-text, currentColor)'
};

const BOX_HEADER_BUTTON_STYLE: JSX.CSSProperties = {
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  border: 'none',
  background: 'none',
  color: 'inherit',
  padding: '0',
  margin: '0',
  cursor: 'pointer',
  font: 'inherit',
  textAlign: 'left'
};

const BOX_HEADER_CHEVRON_STYLE = (open: boolean): JSX.CSSProperties => ({
  fontSize: '18px',
  lineHeight: 1,
  color: 'var(--button-icon-idle, #616166)',
  transform: open ? 'translateY(1px)' : 'translateY(-1px)'
});

const BOX_CONTENT_STYLE = (open: boolean): JSX.CSSProperties => ({
  display: open ? 'block' : 'none',
  flex: '1 1 auto',
  minHeight: 0,
  overflowX: 'hidden',
  overflowY: 'auto',
  touchAction: 'pan-y',
  overscrollBehavior: 'contain',
  padding: '0 16px 16px'
});
