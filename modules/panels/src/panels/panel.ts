import {h, render} from 'preact';

import {PanelComponent, type PanelComponentProps, type PanelPlacement} from './panel-component';
import {PanelThemeScope} from './panel-theme-scope';

import type {ComponentChildren} from 'preact';

/** Stable panel identifier used for container state. */
export type PanelId = string;

/** Light/dark theme modes used for panel-scoped overrides. */
export type PanelThemeMode = 'light' | 'dark';

/** Public theme override options for panels. */
export type PanelTheme = 'inherit' | 'light' | 'dark' | 'invert';

/**
 * Props used to construct one panel definition.
 */
export type PanelProps = PanelComponentProps & {
  /** Stable id used for expansion/selection bookkeeping. */
  id: PanelId;
  /** Visible heading text for the panel. */
  title: string;
  /** Renderable panel body. */
  content: ComponentChildren;
  /** Optional theme override applied to this panel subtree. */
  theme?: PanelTheme;
  /** If true, the panel can not be interacted with and will not switch/expand. */
  disabled?: boolean;
  /** If true, keep the panel mounted when collapsed. */
  keepMounted?: boolean;
};

/**
 * Base class for titled panel content rendered directly or by panel containers.
 */
export abstract class Panel extends PanelComponent<PanelProps> {
  /** Default props applied before caller-provided panel props. */
  static defaultProps: Required<PanelProps> = {
    ...PanelComponent.defaultProps,
    id: 'panel',
    title: 'Panel',
    content: null,
    theme: 'inherit',
    disabled: false,
    keepMounted: false
  };

  /** Default standalone placement used when a panel is mounted directly. */
  placement: PanelPlacement = 'top-left';
  /** Root CSS class applied when a panel is mounted directly. */
  className = 'deck-widget-panel';
  /** Visible panel heading text. */
  title: string;
  /** Renderable panel body. */
  content: ComponentChildren;
  /** Optional panel-scoped theme override. */
  theme?: PanelTheme;
  /** Whether the panel should be treated as disabled by parent compositions. */
  disabled?: boolean;
  /** Whether parent compositions should keep collapsed content mounted. */
  keepMounted?: boolean;

  /** Creates one titled panel definition. */
  constructor(props: PanelProps) {
    super(props);
    this.title = this.props.title;
    this.content = this.props.content;
    this.theme = this.props.theme;
    this.disabled = this.props.disabled;
    this.keepMounted = this.props.keepMounted;
  }

  /** Updates panel props and refreshes direct mounted content when present. */
  override setProps(props: Partial<PanelProps>): void {
    const nextProps = {...this.props, ...props} as Required<PanelProps>;
    this.title = nextProps.title;
    this.content = nextProps.content;
    this.theme = nextProps.theme;
    this.disabled = nextProps.disabled;
    this.keepMounted = nextProps.keepMounted;
    super.setProps(props);
  }

  /** Renders themed panel content into a mounted root element. */
  override onRenderHTML(rootElement: HTMLElement): void {
    render(h(PanelThemeScope, {panel: this}, this.content), rootElement);
  }

  /** Unmounts direct panel content from the current root element. */
  override onRemove(): void {
    if (this.rootElement) {
      render(null, this.rootElement);
    }
  }
}

/** Shared props for panel list containers. */
export type PanelListContainerProps = {
  /** Optional class name applied to the outer container. */
  className?: string;
  /** Ordered panels rendered by the container. */
  panels: ReadonlyArray<Panel>;
};
