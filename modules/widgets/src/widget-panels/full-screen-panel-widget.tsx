/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {
  asPanelContainer,
  WidgetContainerRenderer,
  type WidgetContainer,
  type WidgetPanel
} from '../../../panels/src';
import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

/** Full-screen panel widget properties. */
export type FullScreenPanelWidgetProps = WidgetProps & {
  /** The content container to show inside the full-screen panel. */
  container?: WidgetContainer;
  /** Optional shorthand panel. When supplied, shown directly inside the full-screen panel. */
  panel?: WidgetPanel;
  /** Placement anchor for the full-screen panel. Defaults to deck.gl's fill placement. */
  placement?: WidgetPlacement;
  /** Optional panel header title. */
  title?: string;
  /** Inset from the deck overlay edge in pixels. */
  marginPx?: number;
};

const FULL_SCREEN_PANEL_WIDGET_CLASS = 'deck-widget-full-screen-panel';

/**
 * Normalizes inset margin into a practical render value.
 */
function normalizeMarginPx(marginPx: number): number {
  const clamped = Math.max(0, Math.floor(marginPx));
  return Number.isFinite(clamped) ? clamped : 24;
}

/**
 * Normalizes widget-container/panel inputs into a concrete widget container.
 */
function asContainer(container?: WidgetContainer, panel?: WidgetPanel): WidgetContainer {
  if (container !== undefined) {
    return container;
  }

  if (panel !== undefined) {
    return asPanelContainer(panel);
  }

  return {
    kind: 'panel',
    props: {
      panel: {
        id: 'empty-full-screen-panel',
        title: '',
        content: <div />
      }
    }
  };
}

function FullScreenPanelWidgetView({
  container,
  title,
  marginPx
}: {
  container: WidgetContainer;
  title?: string;
  marginPx: number;
}) {
  return (
    <section
      style={FULL_SCREEN_PANEL_WIDGET_STYLE(marginPx)}
      aria-label={title ?? 'Full-screen panel widget'}
      onPointerDown={stopFullScreenPanelEventPropagation}
      onPointerMove={stopFullScreenPanelEventPropagation}
      onPointerUp={stopFullScreenPanelEventPropagation}
      onMouseDown={stopFullScreenPanelEventPropagation}
      onMouseMove={stopFullScreenPanelEventPropagation}
      onMouseUp={stopFullScreenPanelEventPropagation}
      onTouchStart={stopFullScreenPanelEventPropagation}
      onTouchMove={stopFullScreenPanelEventPropagation}
      onTouchEnd={stopFullScreenPanelEventPropagation}
      onClick={stopFullScreenPanelEventPropagation}
      onContextMenu={stopFullScreenPanelEventPropagation}
      onWheel={stopFullScreenPanelEventPropagation}
    >
      {title ? <header style={FULL_SCREEN_PANEL_HEADER_STYLE}>{title}</header> : null}
      <div style={FULL_SCREEN_PANEL_CONTENT_STYLE}>
        <WidgetContainerRenderer container={container} />
      </div>
    </section>
  );
}

/**
 * Prevents full-screen panel interactions from leaking into the underlying deck canvas.
 */
function stopFullScreenPanelEventPropagation(event: Event): void {
  event.stopPropagation();
}

/**
 * A reusable deck widget that renders one container inside a large inset panel.
 */
export class FullScreenPanelWidget extends Widget<FullScreenPanelWidgetProps> {
  static defaultProps: Required<FullScreenPanelWidgetProps> = {
    ...Widget.defaultProps,
    id: 'full-screen-panel-widget',
    placement: 'fill',
    title: undefined!,
    marginPx: 24,
    panel: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-full-screen-panel',
          title: '',
          content: <div />
        }
      }
    }
  };

  className = FULL_SCREEN_PANEL_WIDGET_CLASS;
  placement: WidgetPlacement = FullScreenPanelWidget.defaultProps.placement;
  title: string | undefined = FullScreenPanelWidget.defaultProps.title;
  marginPx = FullScreenPanelWidget.defaultProps.marginPx;
  #container: WidgetContainer = FullScreenPanelWidget.defaultProps.container;
  #rootElement: HTMLElement | null = null;

  constructor(props: Partial<FullScreenPanelWidgetProps> = {}) {
    super({
      ...FullScreenPanelWidget.defaultProps,
      ...props,
      container: asContainer(props.container, props.panel)
    } as FullScreenPanelWidgetProps);
    this.setProps(this.props);
  }

  setProps(props: Partial<FullScreenPanelWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if ('title' in props) {
      this.title = props.title;
    }
    if (props.marginPx !== undefined) {
      this.marginPx = normalizeMarginPx(props.marginPx);
    }
    if (props.container !== undefined) {
      this.#container = props.container;
    } else if (props.panel !== undefined) {
      this.#container = asContainer(undefined, props.panel);
    }

    this.#render();
    super.setProps(props);
  }

  onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    rootElement.className = className;
    rootElement.style.position = 'absolute';
    rootElement.style.inset = '0';
    rootElement.style.margin = '0';
    rootElement.style.pointerEvents = 'none';
    rootElement.style.zIndex = '30';
    this.#render();
  }

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    render(
      <FullScreenPanelWidgetView
        container={this.#container}
        title={this.title}
        marginPx={this.marginPx}
      />,
      this.#rootElement
    );
  };
}

const FULL_SCREEN_PANEL_WIDGET_STYLE = (marginPx: number): JSX.CSSProperties => ({
  position: 'absolute',
  inset: `${marginPx}px`,
  pointerEvents: 'auto',
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.42))',
  borderRadius: '18px',
  background: 'var(--menu-background, rgba(255, 255, 255, 0.94))',
  backdropFilter: 'var(--menu-backdrop-filter, blur(18px))',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0 28px 80px rgba(15, 23, 42, 0.24))',
  overflow: 'hidden'
});

const FULL_SCREEN_PANEL_HEADER_STYLE: JSX.CSSProperties = {
  padding: '18px 22px 12px',
  fontSize: '24px',
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  color: 'var(--button-text, currentColor)'
};

const FULL_SCREEN_PANEL_CONTENT_STYLE: JSX.CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px 22px'
};
