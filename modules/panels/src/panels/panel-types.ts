import type {ComponentChildren} from 'preact';

/** Stable panel identifier used for container state. */
export type PanelId = string;

/** Light/dark theme modes used for panel-scoped overrides. */
export type PanelThemeMode = 'light' | 'dark';

/** Public theme override options for panels. */
export type PanelTheme = 'inherit' | 'light' | 'dark' | 'invert';

/**
 * Describes one entry rendered by panel containers.
 */
export type Panel = {
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

/** Shared props for panel list containers. */
export type PanelListContainerProps = {
  /** Optional class name applied to the outer container. */
  className?: string;
  /** Ordered panels rendered by the container. */
  panels: ReadonlyArray<Panel>;
};
