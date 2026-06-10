import {PopupWidget} from '@deck.gl/widgets';
import {createRoot} from 'react-dom/client';

import type {PopupWidgetProps} from '@deck.gl/widgets';
import type {ReactNode} from 'react';
import type {Root} from 'react-dom/client';

/** Stable widget id used for the deck.gl hover popup bridge. */
export const TRACE_HOVER_POPUP_WIDGET_ID = 'tracevis-hover-popup';
const TRACE_HOVER_POPUP_ARROW_SIZE = 12;
// deck.gl gives each placement container the same base z-index, so the hover popup needs
// its placement layer promoted or it can render underneath other widget groups.
const TRACE_HOVER_POPUP_LAYER_Z_INDEX = '2103';

/**
 * Props accepted by the tracevis React-to-`PopupWidget` bridge.
 */
type TraceHoverPopupWidgetProps = Omit<PopupWidgetProps, 'content' | 'marker'> & {
  /** React subtree rendered into the popup body. */
  reactContent?: ReactNode;
  /** Whether the popup should be visible for the current hover target. */
  isVisible?: boolean;
};

/**
 * deck.gl popup widget that renders React hover-card content into one stable DOM host.
 */
export class TraceHoverPopupWidget extends PopupWidget {
  /** Stable DOM node passed into `PopupWidget` as `content.element`. */
  #contentElement: HTMLDivElement | null;
  /** Stable React root mounted into `#contentElement`. */
  #contentRoot: Root | null;
  /** Whether the popup should currently be open. */
  #isVisible = false;
  /** deck.gl-managed placement wrapper whose stacking context is temporarily promoted. */
  #placementContainer: HTMLElement | null = null;
  /** Original z-index restored when the popup unmounts or re-parents. */
  #placementContainerZIndex = '';
  /** Latest deck/world popup anchor. */
  #position: [number, number] = [0, 0];
  /** Latest React subtree rendered into the popup body. */
  #reactContent: ReactNode = null;

  /**
   * Creates one trace hover popup widget with tracevis-friendly defaults.
   */
  constructor(props: Partial<TraceHoverPopupWidgetProps> = {}) {
    const {isVisible, reactContent, ...popupProps} = props;
    const contentElement = createPopupContentElement();
    super({
      ...popupProps,
      id: TRACE_HOVER_POPUP_WIDGET_ID,
      arrow: TRACE_HOVER_POPUP_ARROW_SIZE,
      marker: null,
      content: {element: contentElement},
      position: popupProps.position ?? [0, 0],
      defaultIsOpen: true,
      closeButton: false,
      closeOnClickOutside: false,
      placement: 'top',
      style: {
        background: 'transparent',
        boxShadow: 'none',
        padding: '0px',
        pointerEvents: 'none',
        zIndex: '1000'
      }
    });
    this.#contentElement = contentElement;
    this.#contentRoot = contentElement ? createRoot(contentElement) : null;
    this.#reactContent = reactContent ?? null;
    this.#isVisible = isVisible === true;
    if (popupProps.position) {
      this.#position = [popupProps.position[0] ?? 0, popupProps.position[1] ?? 0];
    }
    this.isOpen = this.#isVisible;
  }

  /**
   * Updates the popup visibility, anchor, and React content without recreating the widget instance.
   */
  setTraceHoverPopupProps(props: Partial<TraceHoverPopupWidgetProps>): void {
    const {isVisible, reactContent, ...popupProps} = props;
    if ('reactContent' in props) {
      this.#reactContent = reactContent ?? null;
    }
    if ('isVisible' in props) {
      this.#isVisible = isVisible === true;
    }
    if ('position' in props && props.position) {
      this.#position = [props.position[0] ?? 0, props.position[1] ?? 0];
    }

    this.isOpen = this.#isVisible;
    renderPopupReactContent(this.#contentRoot, this.#isVisible ? this.#reactContent : null);
    super.setProps({
      ...popupProps,
      arrow: TRACE_HOVER_POPUP_ARROW_SIZE,
      content: {element: this.#contentElement},
      marker: null,
      position: this.#position
    });
  }

  /**
   * Returns the stable React host element used by the popup bridge.
   */
  getContentElement(): HTMLDivElement | null {
    return this.#contentElement;
  }

  /**
   * Raises the popup root above the standard deck widget stack before delegating to deck.gl.
   */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.#promotePlacementContainer(rootElement);
    rootElement.style.setProperty('--menu-background', 'hsl(var(--muted))');
    rootElement.style.pointerEvents = 'none';
    rootElement.style.zIndex = '1000';
    renderPopupReactContent(this.#contentRoot, this.#isVisible ? this.#reactContent : null);
    super.onRenderHTML(rootElement);
  }

  /**
   * Unmounts the React subtree before the widget is removed from deck.gl.
   */
  override onRemove(): void {
    this.#restorePlacementContainer();
    renderPopupReactContent(this.#contentRoot, null);
    if (this.#contentRoot) {
      this.#contentRoot.unmount();
    }
    this.#contentRoot = null;
    this.#contentElement = null;
    super.onRemove();
  }

  /**
   * Raises the popup placement container above other widget placement layers.
   */
  #promotePlacementContainer(rootElement: HTMLElement): void {
    const placementContainer = rootElement.parentElement;
    if (!placementContainer || placementContainer === this.#placementContainer) {
      return;
    }

    this.#restorePlacementContainer();
    this.#placementContainer = placementContainer;
    this.#placementContainerZIndex = placementContainer.style.zIndex;
    placementContainer.style.zIndex = TRACE_HOVER_POPUP_LAYER_Z_INDEX;
  }

  /**
   * Restores the placement container stacking order when the popup widget unmounts.
   */
  #restorePlacementContainer(): void {
    if (!this.#placementContainer) {
      return;
    }
    this.#placementContainer.style.zIndex = this.#placementContainerZIndex;
    this.#placementContainer = null;
    this.#placementContainerZIndex = '';
  }
}

/**
 * Creates the stable DOM host used by the popup widget's `content.element` bridge.
 */
function createPopupContentElement(): HTMLDivElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const element = document.createElement('div');
  element.style.pointerEvents = 'none';
  return element;
}

/**
 * Flushes one React subtree update into the popup host so widget renders stay in sync with hover.
 */
function renderPopupReactContent(root: Root | null, content: ReactNode): void {
  if (!root) {
    return;
  }
  root.render(content);
}
