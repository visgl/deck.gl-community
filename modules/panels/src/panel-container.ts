// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Supported placement anchors for standalone panel containers.
 */
export type PanelPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';

/**
 * Shared props supported by standalone panel containers.
 */
export type PanelContainerProps = {
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
   * Optional explicit container element for direct mounting.
   */
  _container?: string | HTMLDivElement | null;
};

/**
 * Base class for panel-managed UI containers that render into a DOM host.
 */
export abstract class PanelContainer<PropsT extends PanelContainerProps = PanelContainerProps> {
  static defaultProps: Required<PanelContainerProps> = {
    id: 'panel-container',
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
   * Placement anchor used by `PanelManager` or deck.gl's panel manager.
   */
  abstract placement: PanelPlacement;
  /**
   * Root class name.
   */
  abstract className: string;

  /**
   * Optional deck/panel-manager references populated by host environments.
   */
  panelManager?: unknown;
  deck?: unknown;
  rootElement?: HTMLDivElement | null;

  constructor(props: PropsT) {
    this.props = {
      ...(this.constructor as typeof PanelContainer).defaultProps,
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
    const rootElement = this.onAdd(params);
    if (rootElement) {
      return rootElement;
    }
    return this.onCreateRootElement();
  }

  /**
   * Called when the container is mounted.
   */
  onAdd(_params: {deck: unknown; viewId: string | null}): HTMLDivElement | void {}

  /**
   * Called when the container is removed.
   */
  onRemove(): void {}

  /**
   * Optional deck integration hooks.
   */
  onViewportChange(_viewport: unknown): void {}
  onRedraw(_params: {viewports: unknown[]; layers: unknown[]}): void {}
  onHover(_info: unknown, _event: unknown): void {}
  onClick(_info: unknown, _event: unknown): void {}
  onDrag(_info: unknown, _event: unknown): void {}
  onDragStart(_info: unknown, _event: unknown): void {}
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
