/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {h, render} from 'preact';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {PanelContentRenderer, asPanelContainer} from '../panels/panel-containers';

import type {PanelContentContainer, Panel} from '../panels/panel-containers';
import type {JSX} from 'preact';

/**
 * Props for {@link PanelFullScreen}.
 */
export type PanelFullScreenProps = PanelContainerProps & {
  /** One pre-built container definition to render. */
  container?: PanelContentContainer;
  /** Convenience single-panel input converted into a container automatically. */
  panel?: Panel;
  /** Placement anchor used when mounted by {@link PanelManager}. */
  placement?: PanelPlacement;
  /** Optional header title shown above the content. */
  title?: string;
  /** Outer inset applied between the host bounds and the full-screen panel. */
  marginPx?: number;
};

function normalizeMarginPx(marginPx: number): number {
  const clamped = Math.max(0, Math.floor(marginPx));
  return Number.isFinite(clamped) ? clamped : 24;
}

function resolveContainer(container?: PanelContentContainer, panel?: Panel): PanelContentContainer {
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
        id: 'empty-panel-full-screen-panel',
        title: '',
        content: h('div', {})
      }
    }
  };
}

function stopFullScreenPanelEventPropagation(event: Event): void {
  event.stopPropagation();
}

function PanelFullScreenView({
  container,
  title,
  marginPx
}: {
  container: PanelContentContainer;
  title?: string;
  marginPx: number;
}) {
  return (
    <section
      style={FULL_SCREEN_PANEL_STYLE(marginPx)}
      aria-label={title ?? 'Full-screen panel'}
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
      {title ? <header style={FULL_SCREEN_HEADER_STYLE}>{title}</header> : null}
      <div style={FULL_SCREEN_CONTENT_STYLE}>
        <PanelContentRenderer container={container} />
      </div>
    </section>
  );
}

/**
 * Fill-placement panel container for focused, workspace-style layouts.
 */
export class PanelFullScreen extends PanelContainer<PanelFullScreenProps> {
  static defaultProps: Required<PanelFullScreenProps> = {
    ...PanelContainer.defaultProps,
    id: 'panel-full-screen',
    placement: 'fill',
    title: undefined!,
    marginPx: 24,
    panel: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-panel-full-screen-panel',
          title: '',
          content: h('div', {})
        }
      }
    }
  };

  className = 'deck-widget-full-screen-panel';
  placement: PanelPlacement = PanelFullScreen.defaultProps.placement;
  title: string | undefined = PanelFullScreen.defaultProps.title;
  marginPx = PanelFullScreen.defaultProps.marginPx;
  #container: PanelContentContainer = PanelFullScreen.defaultProps.container;
  #rootElement: HTMLElement | null = null;

  constructor(props: Partial<PanelFullScreenProps> = {}) {
    super({
      ...PanelFullScreen.defaultProps,
      ...props,
      container: resolveContainer(props.container, props.panel)
    } as PanelFullScreenProps);
    this.setProps(this.props);
  }

  override setProps(props: Partial<PanelFullScreenProps>): void {
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
      this.#container = resolveContainer(undefined, props.panel);
    }

    this.#render();
    super.setProps(props);
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
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
      <PanelFullScreenView
        container={this.#container}
        title={this.title}
        marginPx={this.marginPx}
      />,
      this.#rootElement
    );
  };
}

const FULL_SCREEN_PANEL_STYLE = (marginPx: number): JSX.CSSProperties => ({
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

const FULL_SCREEN_HEADER_STYLE: JSX.CSSProperties = {
  padding: '18px 22px 12px',
  fontSize: '24px',
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  color: 'var(--button-text, currentColor)'
};

const FULL_SCREEN_CONTENT_STYLE: JSX.CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  padding: '0 22px 22px'
};
