/** @jsxImportSource preact */
import {Deck, Widget} from '@deck.gl/core';
import {render} from 'preact';

import {IconButton, makeTextIcon} from '../widget-components/icon-button';

import type {PickingInfo, Viewport, WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {
  EventManager,
  MjolnirGestureEvent,
  MjolnirKeyEvent,
  MjolnirPointerEvent
} from 'mjolnir.js';

export type TimeMeasureRange = {startTimeMs: number; endTimeMs: number};

type TimeMeasureWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  viewId?: string | null;
  /** View to listen to for interactions. Defaults to 'main'. */
  eventViewId?: string | string[] | null;
  /** View to use for projecting pointer -> time. Defaults to event view. */
  projectionViewId?: string | null;
  label?: string;
  activeLabel?: string;
  onActivate?: () => void;
  onDeactivate?: () => void;
  onRangeChange?: (range: TimeMeasureRange | null) => void;
  onSelectionChange?: (selection: TimeMeasureSelectionState) => void;
};

export type TimeMeasureSelectionState = {
  phase: 'idle' | 'selecting-start' | 'selecting-end' | 'selected';
  cursorTimeMs: number | null;
  draftStartTimeMs: number | null;
  range: TimeMeasureRange | null;
};

export class TimeMeasureWidget extends Widget<TimeMeasureWidgetProps, null> {
  static defaultProps: Required<TimeMeasureWidgetProps> = {
    ...Widget.defaultProps,
    id: 'time-measure',
    placement: 'top-left',
    viewId: null,
    eventViewId: 'main',
    projectionViewId: 'main',
    label: 'Measure time',
    activeLabel: 'Time range selected',
    onActivate: undefined!,
    onDeactivate: undefined!,
    onRangeChange: undefined!,
    onSelectionChange: undefined!
  };

  className = 'deck-widget-time-measure';
  placement: WidgetPlacement = 'top-left';

  /** Current selection phase. */
  #phase: TimeMeasureSelectionState['phase'] = 'idle';
  /** Track the latest measured range. */
  #timeMeasureRange: TimeMeasureRange | null = null;
  /** Provisional start anchor while selecting. */
  #draftStartTimeMs: number | null = null;
  /** Cursor-projected time while selecting. */
  #cursorTimeMs: number | null = null;
  /** Viewport to listen to for interactions. */
  #eventViewId: string | string[] | null = 'main';
  /** Viewport to use for coordinate projection. */
  #projectionViewId: string | null = null;
  #eventManager?: EventManager | null;
  #dragSelecting = false;

  constructor(props: TimeMeasureWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  setProps(props: Partial<TimeMeasureWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId ?? this.viewId;
    this.#eventViewId = props.eventViewId ?? this.#eventViewId;
    this.#projectionViewId = props.projectionViewId ?? this.#projectionViewId;
    super.setProps(props);
  }

  onAdd({deck, viewId}: {deck: Deck; viewId: string | null}): HTMLDivElement | void {
    if (viewId && !this.viewId) {
      this.viewId = viewId;
    }
    // @ts-expect-error accessing protected member
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const eventManager = deck?.eventManager;
    this.#attachEventListeners(eventManager);
    return this.onCreateRootElement();
  }

  onRemove(): void {
    this.#detachEventListeners();
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const appearance = this.#getAppearance();
    render(
      <IconButton
        icon={appearance.icon}
        color={appearance.color}
        title={appearance.title}
        className={appearance.isActive ? 'deck-widget-button-active' : ''}
        onClick={() => this.#handleWidgetClick()}
      />,
      rootElement
    );
  }

  onHover(info: PickingInfo, event: MjolnirPointerEvent | MjolnirGestureEvent): void {
    if (!this.#isSelecting() || !this.#shouldHandleEvent(info)) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null) {
      return;
    }
    this.#cursorTimeMs = timeMs;
    this.#emitSelectionChange();
  }

  // eslint-disable-next-line complexity
  onClick(info: PickingInfo, event: MjolnirGestureEvent): void {
    if (this.#dragSelecting) {
      return;
    }
    if (!this.#isSelecting() || !this.#shouldHandleEvent(info)) {
      return;
    }

    if (event.srcEvent?.button === 2 || event.rightButton) {
      this.#cancelSelection();
      return;
    }

    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null || event.srcEvent?.button !== 0) {
      return;
    }

    if (this.#phase === 'selecting-start') {
      this.#draftStartTimeMs = timeMs;
      this.#phase = 'selecting-end';
      this.#cursorTimeMs = timeMs;
      this.#emitSelectionChange();
      this.updateHTML();
      return;
    }

    if (this.#phase === 'selecting-end' && this.#draftStartTimeMs !== null) {
      const [startTimeMs, endTimeMs] =
        this.#draftStartTimeMs <= timeMs
          ? [this.#draftStartTimeMs, timeMs]
          : [timeMs, this.#draftStartTimeMs];
      this.#finalizeRange({startTimeMs, endTimeMs});
    }
  }

  onDragStart(info: PickingInfo, event: MjolnirGestureEvent): void {
    if (!this.#matchesEventView(info)) {
      return;
    }
    if (this.#dragSelecting || this.#isSelecting()) {
      return;
    }
    const srcEvent = event?.srcEvent as MouseEvent | PointerEvent | undefined;
    if (!srcEvent?.shiftKey) {
      return;
    }
    if (srcEvent.button === 2 || event.rightButton) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null) {
      return;
    }
    srcEvent.preventDefault?.();
    srcEvent.stopPropagation?.();
    this.#dragSelecting = true;
    this.#beginDragSelection(timeMs);
  }

  onDrag(info: PickingInfo, event: MjolnirGestureEvent): void {
    if (!this.#dragSelecting || !this.#matchesEventView(info)) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null) {
      return;
    }
    this.#cursorTimeMs = timeMs;
    this.#emitSelectionChange();
  }

  onDragEnd(info: PickingInfo, event: MjolnirGestureEvent): void {
    if (!this.#dragSelecting) {
      return;
    }
    this.#dragSelecting = false;
    if (!this.#matchesEventView(info)) {
      this.#cancelSelection();
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null || this.#draftStartTimeMs === null) {
      this.#cancelSelection();
      return;
    }
    const [startTimeMs, endTimeMs] =
      this.#draftStartTimeMs <= timeMs
        ? [this.#draftStartTimeMs, timeMs]
        : [timeMs, this.#draftStartTimeMs];
    this.#finalizeRange({startTimeMs, endTimeMs});
  }

  #handleKeyDown = (event: MjolnirKeyEvent) => {
    if (event.srcEvent.key === 'Shift' && this.#phase === 'selected' && this.#timeMeasureRange) {
      this.#cancelSelection();
      return;
    }
    if (event.srcEvent.key === 'Escape' && this.#isSelecting()) {
      this.#cancelSelection();
    }
  };

  #handleKeyUp = (event: MjolnirKeyEvent) => {
    if (event.srcEvent.key === 'Escape' && this.#isSelecting()) {
      this.#cancelSelection();
    }
  };

  #attachEventListeners(eventManager?: EventManager | null) {
    if (!eventManager) {
      return;
    }
    this.#detachEventListeners();
    this.#eventManager = eventManager;
    eventManager.on('keydown', this.#handleKeyDown);
    eventManager.on('keyup', this.#handleKeyUp);
  }

  #detachEventListeners() {
    if (!this.#eventManager) {
      return;
    }
    this.#eventManager.off('keydown', this.#handleKeyDown);
    this.#eventManager.off('keyup', this.#handleKeyUp);
    this.#eventManager = null;
  }

  #toggleActive() {
    if (this.#isSelecting()) {
      this.#cancelSelection();
      return;
    }

    if (this.#phase === 'selected') {
      this.#beginSelection({resetRange: true});
      return;
    }

    this.#beginSelection({resetRange: true});
  }

  #beginSelection({resetRange}: {resetRange: boolean}) {
    if (resetRange) {
      this.#updateRange(null, {suppressEmit: false});
    }
    this.#phase = 'selecting-start';
    this.#draftStartTimeMs = null;
    this.#cursorTimeMs = null;
    this.#dragSelecting = false;
    this.props.onActivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #beginDragSelection(startTimeMs: number) {
    this.#updateRange(null, {suppressEmit: false});
    this.#phase = 'selecting-end';
    this.#draftStartTimeMs = startTimeMs;
    this.#cursorTimeMs = startTimeMs;
    this.props.onActivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #shouldHandleEvent(info: PickingInfo): boolean {
    if (!this.#isSelecting()) {
      return false;
    }
    return this.#matchesEventView(info);
  }

  #matchesEventView(info: PickingInfo): boolean {
    const eventViewId = this.#eventViewId;
    if (!eventViewId) {
      return true;
    }
    const viewportId = info.viewport?.id;
    if (!viewportId) {
      return false;
    }
    if (Array.isArray(eventViewId)) {
      return eventViewId.includes(viewportId);
    }
    return viewportId === eventViewId;
  }

  // eslint-disable-next-line complexity
  #eventToTimeMs(
    info: PickingInfo,
    event: MjolnirGestureEvent | MjolnirPointerEvent
  ): number | null {
    const projectionViewport = this.#getProjectionViewport(info);
    if (!projectionViewport) {
      return null;
    }
    if (info.coordinate && Number.isFinite(info.coordinate[0])) {
      if (!projectionViewport.id || info.viewport?.id === projectionViewport.id) {
        return info.coordinate[0];
      }
    }
    const center = (event as any).offsetCenter ?? (event as any).center;
    if (!center) {
      return null;
    }
    const x = 'x' in center ? center.x : Array.isArray(center) ? center[0] : null;
    if (typeof x !== 'number') {
      return null;
    }
    const offsetX: number = x - projectionViewport.x;
    const [timeMs] = projectionViewport.unproject([offsetX, 0]);
    return timeMs ?? null;
  }

  #getProjectionViewport(info: PickingInfo): Viewport | null {
    const projectionViewId =
      this.#projectionViewId ??
      (Array.isArray(this.#eventViewId) ? this.#eventViewId[0] : this.#eventViewId);
    if (!projectionViewId) {
      return info.viewport ?? null;
    }
    if (info.viewport?.id === projectionViewId) {
      return info.viewport ?? null;
    }
    const deck = this.deck;
    if (!deck?.isInitialized) {
      return info.viewport ?? null;
    }
    return deck.getViewports().find((viewport) => viewport.id === projectionViewId) ?? null;
  }

  #finalizeRange(range: TimeMeasureRange) {
    this.#updateRange(range, {suppressEmit: false});
    this.#phase = 'selected';
    this.#draftStartTimeMs = null;
    this.#cursorTimeMs = null;
    this.#dragSelecting = false;
    this.props.onDeactivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #updateRange(
    range: TimeMeasureRange | null,
    {suppressEmit = false}: {suppressEmit?: boolean} = {}
  ) {
    this.#timeMeasureRange = range ? {...range} : null;
    if (!suppressEmit) {
      this.props.onRangeChange?.(this.#timeMeasureRange);
    }
  }

  #cancelSelection() {
    this.#updateRange(null);
    this.#phase = 'idle';
    this.#draftStartTimeMs = null;
    this.#cursorTimeMs = null;
    this.#dragSelecting = false;
    this.props.onDeactivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #isSelecting(): boolean {
    return this.#phase === 'selecting-start' || this.#phase === 'selecting-end';
  }

  #handleWidgetClick() {
    if (this.#isSelecting()) {
      this.#cancelSelection();
      return;
    }
    this.#toggleActive();
  }

  #emitSelectionChange() {
    this.props.onSelectionChange?.({
      phase: this.#phase,
      cursorTimeMs: this.#cursorTimeMs,
      draftStartTimeMs: this.#draftStartTimeMs,
      range: this.#timeMeasureRange
    });
  }

  #getAppearance(): {
    color?: string;
    icon: string;
    isActive: boolean;
    title: string;
  } {
    const focusColor = '#10374b';
    const activeColor = '#1a95d3';

    if (this.#phase === 'selecting-start' || this.#phase === 'selecting-end') {
      return {
        color: activeColor,
        icon: makeTextIcon(this.#phase === 'selecting-start' ? '│' : '││'),
        isActive: true,
        title: 'Select time range…'
      };
    }

    if (this.#phase === 'selected' && this.#timeMeasureRange) {
      return {
        color: focusColor,
        icon: makeTextIcon('Δt'),
        isActive: true,
        title: this.props.activeLabel
      };
    }

    return {
      icon: makeTextIcon('Δt'),
      isActive: false,
      title: this.props.label
    };
  }
}
