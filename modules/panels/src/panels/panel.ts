import {h, render} from 'preact';
import {useLayoutEffect, useReducer} from 'preact/hooks';

import {PanelComponent, type PanelComponentProps, type PanelPlacement} from './panel-component';
import {PanelThemeScope} from './panel-theme-scope';

import type {PanelThemeDefinition} from '../lib/panel-theme';
import type {ComponentChildren} from 'preact';

/** Stable panel identifier used for container state. */
export type PanelId = string;

/** Light/dark theme modes used for panel-scoped overrides. */
export type PanelThemeMode = 'light' | 'dark';

/** Public theme override options for panels. */
export type PanelTheme =
  | 'inherit'
  | 'light'
  | 'dark'
  | 'sleek-light'
  | 'sleek-dark'
  | 'invert'
  | PanelThemeDefinition;

/**
 * Props used to construct one panel definition.
 */
export type PanelProps = PanelComponentProps & {
  /** Stable id used for expansion/selection bookkeeping. */
  id?: PanelId;
  /** Visible heading text for the panel. */
  title?: string;
  /** Renderable panel body. */
  content?: ComponentChildren;
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
export abstract class Panel<PropsT extends PanelProps = PanelProps> extends PanelComponent<PropsT> {
  /** Defaults shared by every panel type. */
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
  private listeners = new Set<() => void>();

  /** Create a definition, applying defaults even for explicitly undefined optional props. */
  constructor(props: PropsT) {
    super(
      resolvePanelProps(
        props,
        (new.target as typeof Panel).defaultProps as Partial<PropsT>
      ) as PropsT
    );
  }

  /** Current heading, derived from props. */
  get title(): string {
    return this.props.title;
  }
  /** Reactive content surface, safe to embed in another panel. */
  get content(): ComponentChildren {
    return h(PanelContent, {panel: this});
  }
  /** Theme override for this panel subtree. */
  get theme(): PanelTheme | undefined {
    return this.props.theme;
  }
  /** Whether compositions should disable interaction with this panel. */
  get disabled(): boolean | undefined {
    return this.props.disabled;
  }
  /** Whether collapsed compositions retain this panel's content. */
  get keepMounted(): boolean | undefined {
    return this.props.keepMounted;
  }

  /** Render the body from current props. Specialized panels override this method. */
  renderContent(): ComponentChildren {
    return this.props.content;
  }

  /** Child definitions observed along with this panel's own props. */
  getChildPanels(): ReadonlyArray<Panel> {
    return [];
  }

  /** @internal Subscribe a rendered surface to this panel tree. */
  subscribe(listener: () => void, includeChildren = true): () => void {
    this.listeners.add(listener);
    const cleanups = includeChildren
      ? this.getChildPanels().map(panel => panel.subscribe(listener))
      : [];
    return () => {
      this.listeners.delete(listener);
      cleanups.forEach(cleanup => cleanup());
    };
  }

  /** Merge typed public props and refresh every mounted content surface. */
  override setProps(props: Partial<PropsT>): void {
    super.setProps(
      resolvePanelProps(props, (this.constructor as typeof Panel).defaultProps as Partial<PropsT>)
    );
    for (const listener of this.listeners) listener();
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

/** Keeps nested content reactive without remounting its component tree on prop updates. */
function PanelContent({panel}: {panel: Panel}) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  useLayoutEffect(() => panel.subscribe(() => refresh(undefined)));
  return panel.renderContent();
}

/** Undefined optional values restore declared defaults; controlled props without defaults stay undefined. */
function resolvePanelProps<PropsT extends PanelProps>(
  props: Partial<PropsT>,
  defaults: Partial<PropsT>
): Partial<PropsT> {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) => [
      key,
      value === undefined && Object.hasOwn(defaults, key) ? defaults[key as keyof PropsT] : value
    ])
  ) as Partial<PropsT>;
}
