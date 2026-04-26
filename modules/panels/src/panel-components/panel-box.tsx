/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {h, render} from 'preact';
import {PanelContainer, type PanelContainerProps, type PanelPlacement} from '../panel-container';
import {PanelContentRenderer, asPanelContainer} from '../panels/panel-containers';

import type {PanelContentContainer, Panel} from '../panels/panel-containers';
import type {JSX} from 'preact';

/**
 * Props for {@link PanelBox}.
 */
export type PanelBoxProps = PanelContainerProps & {
  /** One pre-built container definition to render. */
  container?: PanelContentContainer;
  /** Convenience single-panel input converted into a container automatically. */
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
        id: 'empty-panel-box-panel',
        title: '',
        content: h('div', {})
      }
    }
  };
}

function PanelBoxView({
  container,
  title,
  widthPx,
  open,
  collapsible,
  onOpenChange
}: {
  container: PanelContentContainer;
  title?: string;
  widthPx: number;
  open: boolean;
  collapsible: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  return (
    <section style={BOX_STYLE(widthPx)} aria-label={title ?? 'Panel box'}>
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
        <PanelContentRenderer container={container} />
      </div>
    </section>
  );
}

/**
 * Fixed-size standalone panel container for compact, always-available content.
 */
export class PanelBox extends PanelContainer<PanelBoxProps> {
  static defaultProps: Required<PanelBoxProps> = {
    ...PanelContainer.defaultProps,
    id: 'panel-box',
    placement: 'bottom-left',
    title: undefined!,
    widthPx: 360,
    collapsible: true,
    defaultOpen: true,
    open: undefined!,
    onOpenChange: undefined!,
    panel: undefined!,
    container: {
      kind: 'panel',
      props: {
        panel: {
          id: 'empty-panel-box-panel',
          title: '',
          content: h('div', {})
        }
      }
    }
  };

  className = 'deck-widget-box';
  placement: PanelPlacement = PanelBox.defaultProps.placement;
  title: string | undefined = PanelBox.defaultProps.title;
  widthPx = PanelBox.defaultProps.widthPx;
  collapsible = PanelBox.defaultProps.collapsible;
  isOpen = PanelBox.defaultProps.defaultOpen;
  #container: PanelContentContainer = PanelBox.defaultProps.container;
  #rootElement: HTMLElement | null = null;
  #hasOpenStateInitialized = false;
  #isControlled = false;
  #openChange: ((open: boolean) => void) | undefined = undefined;

  constructor(props: Partial<PanelBoxProps> = {}) {
    super({
      ...PanelBox.defaultProps,
      ...props,
      container: resolveContainer(props.container, props.panel)
    } as PanelBoxProps);
    this.setProps(this.props);
  }

  override setProps(props: Partial<PanelBoxProps>): void {
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
    rootElement.style.margin = '0';
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

    render(
      <PanelBoxView
        container={this.#container}
        title={this.title}
        widthPx={this.widthPx}
        open={this.isOpen}
        collapsible={this.collapsible}
        onOpenChange={this.#handleOpenChange}
      />,
      this.#rootElement
    );
  };

  #setOpenProps(props: Partial<PanelBoxProps>): void {
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

const BOX_STYLE = (widthPx: number): JSX.CSSProperties => ({
  width: `${widthPx}px`,
  maxWidth: `min(84vw, ${widthPx}px)`,
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
  padding: '0 16px 16px'
});
