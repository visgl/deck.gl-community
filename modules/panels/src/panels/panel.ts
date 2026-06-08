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
  static defaultProps: Required<PanelProps> = {
    ...PanelComponent.defaultProps,
    id: 'panel',
    title: 'Panel',
    content: null,
    theme: 'inherit',
    disabled: false,
    keepMounted: false
  };

  placement: PanelPlacement = 'top-left';
  className = 'deck-widget-panel';
  title: string;
  content: ComponentChildren;
  theme?: PanelTheme;
  disabled?: boolean;
  keepMounted?: boolean;

  constructor(props: PanelProps) {
    super(props);
    this.title = this.props.title;
    this.content = this.props.content;
    this.theme = this.props.theme;
    this.disabled = this.props.disabled;
    this.keepMounted = this.props.keepMounted;
  }

  override setProps(props: Partial<PanelProps>): void {
    const nextProps = {...this.props, ...props} as Required<PanelProps>;
    this.title = nextProps.title;
    this.content = nextProps.content;
    this.theme = nextProps.theme;
    this.disabled = nextProps.disabled;
    this.keepMounted = nextProps.keepMounted;
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    render(h(PanelThemeScope, {panel: this}, this.content), rootElement);
  }

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
