// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Supported placement anchors for panel-managed components.
 */
export type PanelPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';

/**
 * Shared props supported by panel-managed components.
 */
export type PanelComponentProps = {
  /**
   * Stable id used for reconciliation.
   */
  id?: string;
  /**
   * CSS inline style overrides applied to the root element.
   */
  style?: Partial<CSSStyleDeclaration>;
  /**
   * Additional CSS class applied to the root element.
   */
  className?: string;
  /**
   * Optional explicit host element for direct mounting.
   */
  _container?: string | HTMLElement | null;
};

/**
 * Base class for panel-managed UI components that render into a DOM host.
 */
export abstract class PanelComponent<PropsT extends PanelComponentProps = PanelComponentProps> {
  /** Default props applied before caller-provided component props. */
  static defaultProps: Required<PanelComponentProps> = {
    id: 'panel-component',
    style: {},
    className: '',
    _container: null
  };

  /**
   * Stable id.
   */
  id: string;
  /**
   * Current props with defaults applied.
   */
  props: Required<PropsT>;
  /**
   * Optional view target used by deck integrations.
   */
  viewId?: string | null = null;
  /**
   * Placement anchor used by `PanelManager` or deck.gl's widget manager.
   */
  abstract placement: PanelPlacement;
  /**
   * Root class name.
   */
  abstract className: string;

  /** Host manager reference populated by standalone and deck environments. */
  panelManager?: unknown;
  /** Deck instance reference populated when a deck host mounts the component. */
  deck?: unknown;
  /** Mounted root element populated while the component is attached to a host. */
  rootElement?: HTMLDivElement | null;
  /**
   * Optional explicit mount host from the current props.
   */
  get _container(): string | HTMLElement | null {
    return this.props._container;
  }

  /** Creates one panel-managed component with defaults applied. */
  constructor(props: PropsT) {
    this.props = {
      ...(this.constructor as typeof PanelComponent).defaultProps,
      ...props
    } as Required<PropsT>;
    this.id = this.props.id;
  }

  /**
   * Updates props and refreshes rendered DOM when mounted.
   */
  setProps(props: Partial<PropsT>): void {
    const oldProps = this.props;
    const nextProps = {
      ...oldProps,
      ...props
    } as Required<PropsT>;
    const rootElement = this.rootElement;

    if (rootElement && oldProps.className !== nextProps.className) {
      if (oldProps.className) {
        rootElement.classList.remove(oldProps.className);
      }
      if (nextProps.className) {
        rootElement.classList.add(nextProps.className);
      }
    }

    if (rootElement && !areStylesEqual(oldProps.style, nextProps.style)) {
      removeStyles(rootElement, oldProps.style);
      applyStyles(rootElement, nextProps.style);
    }

    this.props = nextProps;
    this.id = nextProps.id;
    this.updateHTML();
  }

  /**
   * Re-renders into the mounted root element.
   */
  updateHTML(): void {
    if (this.rootElement) {
      this.onRenderHTML(this.rootElement);
    }
  }

  /**
   * Creates the top-level host element.
   */
  protected onCreateRootElement(): HTMLDivElement {
    const element = document.createElement('div');
    for (const className of ['deck-widget', this.className, this.props.className]) {
      if (className) {
        element.classList.add(className);
      }
    }
    applyStyles(element, this.props.style);
    return element;
  }

  /**
   * Host hook that renders content into the supplied root element.
   */
  abstract onRenderHTML(rootElement: HTMLElement): void;

  /**
   * Internal mount hook used by standalone and deck hosts.
   */
  _onAdd(params: {deck: unknown; viewId: string | null}): HTMLDivElement {
    this.deck = params.deck;
    this.viewId = params.viewId;
    const rootElement = this.onAdd(params);
    if (rootElement) {
      this.rootElement = rootElement;
      return rootElement;
    }
    this.rootElement = this.onCreateRootElement();
    return this.rootElement;
  }

  /**
   * Called when the component is mounted.
   */
  onAdd(_params: {deck: unknown; viewId: string | null}): HTMLDivElement | void {}

  /**
   * Called when the component is removed.
   */
  onRemove(): void {}

  /** Called when a host viewport changes. */
  onViewportChange(_viewport: unknown): void {}
  /** Called after a host redraw with current viewports and layers. */
  onRedraw(_params: {viewports: unknown[]; layers: unknown[]}): void {}
  /** Called when the host forwards a hover event. */
  onHover(_info: unknown, _event: unknown): void {}
  /** Called when the host forwards a click event. */
  onClick(_info: unknown, _event: unknown): void {}
  /** Called when the host forwards a drag event. */
  onDrag(_info: unknown, _event: unknown): void {}
  /** Called when the host forwards a drag-start event. */
  onDragStart(_info: unknown, _event: unknown): void {}
  /** Called when the host forwards a drag-end event. */
  onDragEnd(_info: unknown, _event: unknown): void {}
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration> | undefined) {
  if (!styles) {
    return;
  }
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined && value !== null) {
      element.style.setProperty(toKebabCase(key), String(value));
    }
  }
}

function removeStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration> | undefined) {
  if (!styles) {
    return;
  }
  for (const key of Object.keys(styles)) {
    element.style.removeProperty(toKebabCase(key));
  }
}

function areStylesEqual(
  left: Partial<CSSStyleDeclaration> | undefined,
  right: Partial<CSSStyleDeclaration> | undefined
): boolean {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left ?? {});
  const rightKeys = Object.keys(right ?? {});
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    key => left?.[key as keyof CSSStyleDeclaration] === right?.[key as keyof CSSStyleDeclaration]
  );
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
}
