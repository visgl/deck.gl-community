/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';

import { asPanelContainer, WidgetContainerRenderer } from './widget-containers';

import type { WidgetContainer, WidgetPanel } from './widget-containers';
import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

/** Static card widget properties. */
export type BoxWidgetProps = WidgetProps & {
  /** The content container to show inside the box. */
  container?: WidgetContainer;
  /** Optional shorthand panel. When supplied, shown directly inside the box. */
  panel?: WidgetPanel;
  /** Placement anchor for the box. */
  placement?: WidgetPlacement;
  /** Optional box header title. */
  title?: string;
  /** Box width in pixels. */
  widthPx?: number;
};

const BOX_WIDGET_CLASS = 'deck-widget-box';

/**
 * Normalizes box width configuration into a practical render value.
 */
function normalizeBoxWidthPx(widthPx: number): number {
  const clamped = Math.max(220, Math.floor(widthPx));
  return Number.isFinite(clamped) ? clamped : 360;
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
        id: 'empty-box-panel',
        title: '',
        content: <div />,
      },
    },
  };
}

function BoxWidgetView({
  container,
  title,
  widthPx,
}: {
  container: WidgetContainer;
  title?: string;
  widthPx: number;
}) {
  return (
    <section style={BOX_WIDGET_STYLE(widthPx)} aria-label={title ?? 'Box widget'}>
      {title ? (
        <header style={BOX_HEADER_STYLE}>
          <span>{title}</span>
        </header>
      ) : null}
      <div style={BOX_CONTENT_STYLE}>
        <WidgetContainerRenderer container={container} />
      </div>
    </section>
  );
}

/**
 * A reusable deck widget that renders a static themed card assembled from widget containers.
 */
export class BoxWidget extends Widget<BoxWidgetProps> {
  static defaultProps: Required<BoxWidgetProps> = {
    ...Widget.defaultProps,
    id: 'box-widget',
    placement: 'bottom-left',
    title: undefined!,
    widthPx: 360,
    panel: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-box-panel',
          title: '',
          content: <div />,
        },
      },
    },
  };

  className = BOX_WIDGET_CLASS;
  placement: WidgetPlacement = BoxWidget.defaultProps.placement;
  title: string | undefined = BoxWidget.defaultProps.title;
  widthPx = BoxWidget.defaultProps.widthPx;
  #container: WidgetContainer = BoxWidget.defaultProps.container;
  #rootElement: HTMLElement | null = null;

  constructor(props: Partial<BoxWidgetProps> = {}) {
    super({
      ...BoxWidget.defaultProps,
      ...props,
      container: asContainer(props.container, props.panel),
    } as BoxWidgetProps);
    this.setProps(this.props);
  }

  setProps(props: Partial<BoxWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if ('title' in props) {
      this.title = props.title;
    }
    if (props.widthPx !== undefined) {
      this.widthPx = normalizeBoxWidthPx(props.widthPx);
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
    rootElement.style.margin = '0';
    this.#render();
  }

  #render = () => {
    if (!this.#rootElement) {
      return;
    }

    render(
      <BoxWidgetView container={this.#container} title={this.title} widthPx={this.widthPx} />,
      this.#rootElement,
    );
  };
}

const BOX_WIDGET_STYLE = (widthPx: number): JSX.CSSProperties => ({
  margin: 'var(--widget-margin, 12px)',
  width: `${widthPx}px`,
  maxWidth: `min(84vw, ${widthPx}px)`,
  pointerEvents: 'auto',
  border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.35))',
  borderRadius: '12px',
  background: 'var(--menu-background, rgba(255, 255, 255, 0.96))',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0 18px 40px rgba(15, 23, 42, 0.16))',
  overflow: 'hidden',
});

const BOX_HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: '10px',
  padding: '14px 16px 10px',
  fontSize: '18px',
  fontWeight: 700,
  lineHeight: 1.2,
  color: 'var(--button-text, currentColor)',
};

const BOX_CONTENT_STYLE: JSX.CSSProperties = {
  padding: '0 16px 14px',
};
