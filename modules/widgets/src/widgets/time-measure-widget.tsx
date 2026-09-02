/** @jsxImportSource preact */
import {Deck, Widget} from '@deck.gl/core';
import {render} from 'preact';

import {IconButton, makeTextIcon, WidgetTooltip} from '@deck.gl-community/panels';

import type {PickingInfo, Viewport, WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {
  EventManager,
  MjolnirGestureEvent,
  MjolnirKeyEvent,
  MjolnirPointerEvent
} from 'mjolnir.js';

const RANGE_BOUNDARY_DRAG_RADIUS_PX = 8;
const RANGE_BOUNDARY_PAN_INTERCEPT_PRIORITY = 100;

/** Absolute time range selected by the time-measure widget. */
export type TimeMeasureRange = {
  /** Start timestamp of the measured range in milliseconds. */
  startTimeMs: number;
  /** End timestamp of the measured range in milliseconds. */
  endTimeMs: number;
};

/** Props accepted by {@link TimeMeasureWidget}. */
export type TimeMeasureWidgetProps = WidgetProps & {
  /** Widget placement within the deck widget layout. */
  placement?: WidgetPlacement;
  /** Deck view id that owns the widget root. */
  viewId?: string | null;
  /** View to listen to for interactions. Defaults to 'main'. */
  eventViewId?: string | string[] | null;
  /** View to use for projecting pointer -> time. Defaults to event view. */
  projectionViewId?: string | null;
  /** Trigger label shown while no range is selected. */
  label?: string;
  /** Trigger label shown after a range has been selected. */
  activeLabel?: string;
  /** Optional command id metadata used by external command wiring. */
  commandId?: string;
  /** Optional caller-owned HTML renderer for the trigger tooltip. */
  renderTooltipHTML?: ({widget}: {widget: TimeMeasureWidget}) => HTMLElement | string;
  /** Called when time-range selection starts. */
  onActivate?: () => void;
  /** Called when time-range selection completes or is cleared. */
  onDeactivate?: () => void;
  /** Called when the completed measured range changes. */
  onRangeChange?: (range: TimeMeasureRange | null) => void;
  /** Called when any time-measure interaction state changes. */
  onSelectionChange?: (selection: TimeMeasureSelectionState) => void;
};

/** Current time-measure interaction state. */
export type TimeMeasureSelectionState = {
  /** Current interaction phase for range selection. */
  phase: 'idle' | 'selecting-start' | 'selecting-end' | 'selected';
  /** Time under the cursor while the widget is active. */
  cursorTimeMs: number | null;
  /** Provisional start timestamp while selecting a range. */
  draftStartTimeMs: number | null;
  /** Completed selected time range, or null when none is selected. */
  range: TimeMeasureRange | null;
  /** Completed range boundary currently under the pointer. */
  hoveredBoundary?: 'start' | 'end' | null;
  /** Completed range boundary currently being repositioned. */
  adjustingBoundary?: 'start' | 'end' | null;
};

/** Deck widget that lets users measure a time range by interacting with a time-oriented view. */
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
    commandId: 'time-measure.toggle',
    renderTooltipHTML: undefined!,
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
  /** Completed boundary currently under the pointer. */
  #hoveredBoundary: 'start' | 'end' | null = null;
  /** Completed boundary currently being repositioned. */
  #adjustingBoundary: 'start' | 'end' | null = null;
  /** Completed range to restore when adjusting one boundary is cancelled. */
  #rangeBeforeAdjustment: TimeMeasureRange | null = null;
  /** Command id registered for toggling the measure-time interaction. */
  commandId = TimeMeasureWidget.defaultProps.commandId;

  /** Creates a time-measure widget. */
  constructor(props: TimeMeasureWidgetProps = {}) {
    super(props);
    this.setProps(this.props);
  }

  /** Performs the measure-time trigger action for external command wiring. */
  static performAction({widget}: {widget: TimeMeasureWidget}): void {
    widget.#handleWidgetCommand();
  }

  /** Updates time-measure widget props. */
  setProps(props: Partial<TimeMeasureWidgetProps>): void {
    this.placement = props.placement ?? this.placement;
    this.viewId = props.viewId ?? this.viewId;
    this.#eventViewId = props.eventViewId ?? this.#eventViewId;
    this.#projectionViewId = props.projectionViewId ?? this.#projectionViewId;
    this.commandId = props.commandId ?? this.commandId;
    super.setProps(props);
  }

  onAdd({deck, viewId}: {deck: Deck; viewId: string | null}): HTMLDivElement | void {
    if (viewId && !this.viewId) {
      this.viewId = viewId;
    }
    // @ts-expect-error accessing protected member
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const eventManager = deck?.eventManager!;
    this.#attachEventListeners(eventManager, deck.getCanvas());
    return this.onCreateRootElement();
  }

  onRemove(): void {
    this.#detachEventListeners();
  }

  onRenderHTML(rootElement: HTMLElement): void {
    const appearance = this.#getAppearance();
    const tooltipHTML = this.props.renderTooltipHTML?.({widget: this});
    render(
      <WidgetTooltip label={appearance.title} html={tooltipHTML} placement="right">
        <IconButton
          icon={appearance.icon}
          color={appearance.color}
          ariaLabel={appearance.title}
          className={appearance.isActive ? 'deck-widget-button-active' : ''}
          onClick={() => TimeMeasureWidget.performAction({widget: this})}
        />
      </WidgetTooltip>,
      rootElement
    );
  }

  onHover(info: PickingInfo, event: MjolnirPointerEvent | MjolnirGestureEvent): void {
    if (!this.#matchesEventView(info)) {
      this.#setHoveredBoundary(null);
      return;
    }

    if (this.#phase === 'selected') {
      const timeMs = this.#eventToTimeMs(info, event);
      this.#setHoveredBoundary(timeMs === null ? null : this.#getAdjustedBoundary(info, timeMs));
      return;
    }

    if (!this.#isSelecting()) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null) {
      return;
    }
    this.#cursorTimeMs = timeMs;
    this.#emitSelectionChange();
  }

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
    if (this.#isRightButtonEvent(event)) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event);
    if (timeMs === null) {
      return;
    }

    const adjustedBoundary = this.#isUnmodifiedPrimaryButtonEvent(event)
      ? this.#getAdjustedBoundary(info, timeMs)
      : null;
    if (adjustedBoundary && this.#timeMeasureRange) {
      this.#consumeDragEvent(event);
      this.#dragSelecting = true;
      this.#beginRangeAdjustment(adjustedBoundary, timeMs);
      return;
    }

    if (!srcEvent?.shiftKey) {
      return;
    }
    this.#consumeDragEvent(event);
    this.#dragSelecting = true;
    this.#beginDragSelection(timeMs);
  }

  onDrag(info: PickingInfo, event: MjolnirGestureEvent): void {
    if (!this.#dragSelecting) {
      return;
    }
    this.#consumeDragEvent(event);
    if (!this.#matchesEventView(info)) {
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event, {preferEventPosition: true});
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
    this.#consumeDragEvent(event);
    this.#dragSelecting = false;
    if (!this.#matchesEventView(info)) {
      this.#cancelSelection();
      return;
    }
    const timeMs = this.#eventToTimeMs(info, event, {preferEventPosition: true});
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
    if (
      event.srcEvent.key === 'Shift' &&
      !event.srcEvent.metaKey &&
      !event.srcEvent.ctrlKey &&
      !event.srcEvent.altKey &&
      this.#phase === 'selected' &&
      this.#timeMeasureRange
    ) {
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

  /** Stops the view controller before async picking dispatches the matching boundary drag. */
  #handlePanStart = (event: MjolnirGestureEvent) => {
    if (
      this.#phase !== 'selected' ||
      !this.#timeMeasureRange ||
      !this.#isUnmodifiedPrimaryButtonEvent(event)
    ) {
      return;
    }
    const center = event.offsetCenter ?? event.center;
    if (!center || !this.#isEventPointInConfiguredView(center.x, center.y)) {
      return;
    }
    const viewport = this.#getProjectionViewport({} as PickingInfo);
    if (!viewport) {
      return;
    }
    const cursorX = center.x - viewport.x;
    const startX = viewport.project([this.#timeMeasureRange.startTimeMs, 0])[0];
    const endX = viewport.project([this.#timeMeasureRange.endTimeMs, 0])[0];
    const startDistance = Math.abs(cursorX - startX);
    const endDistance = Math.abs(cursorX - endX);
    if (Math.min(startDistance, endDistance) > RANGE_BOUNDARY_DRAG_RADIUS_PX) {
      return;
    }
    const [cursorTimeMs] = viewport.unproject([cursorX, 0]);
    if (!Number.isFinite(cursorTimeMs)) {
      return;
    }
    this.#consumeDragEvent(event, {stopImmediatePropagation: true});
    this.#dragSelecting = true;
    this.#beginRangeAdjustment(startDistance <= endDistance ? 'start' : 'end', cursorTimeMs);
  };

  #attachEventListeners(
    eventManager?: EventManager | null,
    eventSourceElement?: HTMLElement | null
  ) {
    if (!eventManager) {
      return;
    }
    this.#detachEventListeners();
    this.#eventManager = eventManager;
    eventManager.on('keydown', this.#handleKeyDown);
    eventManager.on('keyup', this.#handleKeyUp);
    eventManager.on('panstart', this.#handlePanStart, {
      priority: RANGE_BOUNDARY_PAN_INTERCEPT_PRIORITY,
      srcElement:
        !eventSourceElement || eventManager.getElement() === eventSourceElement
          ? 'root'
          : eventSourceElement
    });
  }

  #detachEventListeners() {
    if (!this.#eventManager) {
      return;
    }
    this.#eventManager.off('keydown', this.#handleKeyDown);
    this.#eventManager.off('keyup', this.#handleKeyUp);
    this.#eventManager.off('panstart', this.#handlePanStart);
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
    this.#hoveredBoundary = null;
    this.#adjustingBoundary = null;
    this.#rangeBeforeAdjustment = null;
    this.props.onActivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #beginDragSelection(startTimeMs: number) {
    this.#rangeBeforeAdjustment = null;
    this.#updateRange(null, {suppressEmit: false});
    this.#phase = 'selecting-end';
    this.#draftStartTimeMs = startTimeMs;
    this.#cursorTimeMs = startTimeMs;
    this.#hoveredBoundary = null;
    this.#adjustingBoundary = null;
    this.props.onActivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  /** Starts a live adjustment while preserving the completed range for cancellation. */
  #beginRangeAdjustment(boundary: 'start' | 'end', cursorTimeMs: number) {
    const range = this.#timeMeasureRange;
    if (!range) {
      return;
    }
    this.#rangeBeforeAdjustment = {...range};
    this.#phase = 'selecting-end';
    this.#draftStartTimeMs = boundary === 'start' ? range.endTimeMs : range.startTimeMs;
    this.#cursorTimeMs = cursorTimeMs;
    this.#hoveredBoundary = boundary;
    this.#adjustingBoundary = boundary;
    this.props.onActivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  /** Returns the nearest completed range boundary within the fixed screen-space drag radius. */
  #getAdjustedBoundary(info: PickingInfo, cursorTimeMs: number): 'start' | 'end' | null {
    const range = this.#timeMeasureRange;
    const viewport = this.#getProjectionViewport(info);
    if (!range || !viewport) {
      return null;
    }
    const cursorX = viewport.project([cursorTimeMs, 0])[0];
    const startX = viewport.project([range.startTimeMs, 0])[0];
    const endX = viewport.project([range.endTimeMs, 0])[0];
    const startDistance = Math.abs(cursorX - startX);
    const endDistance = Math.abs(cursorX - endX);
    if (Math.min(startDistance, endDistance) > RANGE_BOUNDARY_DRAG_RADIUS_PX) {
      return null;
    }
    return startDistance <= endDistance ? 'start' : 'end';
  }

  /** Returns whether a root-relative event point belongs to a configured interaction view. */
  #isEventPointInConfiguredView(x: number, y: number): boolean {
    const eventViewId = this.#eventViewId;
    if (!eventViewId) {
      return true;
    }
    const deck = this.deck;
    if (!deck?.isInitialized) {
      return false;
    }
    const allowedViewIds = Array.isArray(eventViewId) ? eventViewId : [eventViewId];
    return deck
      .getViewports()
      .some(viewport => allowedViewIds.includes(viewport.id) && viewport.containsPixel({x, y}));
  }

  /** Emits completed-boundary hover changes without affecting ordinary selection callbacks. */
  #setHoveredBoundary(boundary: 'start' | 'end' | null) {
    if (boundary === this.#hoveredBoundary || this.#adjustingBoundary) {
      return;
    }
    this.#hoveredBoundary = boundary;
    this.#emitSelectionChange();
  }

  /** Consumes a measurement drag before deck.gl's pan controller handles the gesture. */
  #consumeDragEvent(
    event: MjolnirGestureEvent,
    {stopImmediatePropagation = false}: {stopImmediatePropagation?: boolean} = {}
  ) {
    event.preventDefault();
    if (stopImmediatePropagation) {
      event.stopImmediatePropagation?.();
    }
    event.stopPropagation();
  }

  /** Returns whether a gesture is driven by the secondary pointer button. */
  #isRightButtonEvent(event: MjolnirGestureEvent): boolean {
    const srcEvent = event.srcEvent as MouseEvent | PointerEvent | undefined;
    return Boolean(event.rightButton || srcEvent?.button === 2 || (srcEvent?.buttons ?? 0) & 2);
  }

  /** Returns whether a gesture is an unmodified primary-button or touch interaction. */
  #isUnmodifiedPrimaryButtonEvent(event: MjolnirGestureEvent): boolean {
    const srcEvent = event.srcEvent as MouseEvent | PointerEvent | TouchEvent | undefined;
    if (
      this.#isRightButtonEvent(event) ||
      srcEvent?.altKey ||
      srcEvent?.ctrlKey ||
      srcEvent?.metaKey ||
      srcEvent?.shiftKey
    ) {
      return false;
    }
    const buttons = srcEvent && 'buttons' in srcEvent ? srcEvent.buttons : null;
    if (typeof buttons === 'number' && (buttons & ~1) !== 0) {
      return false;
    }
    const button = srcEvent && 'button' in srcEvent ? srcEvent.button : null;
    if (typeof button !== 'number' || button === 0) {
      return true;
    }
    // PointerEvent panstart may originate from pointermove, where button is -1.
    return button === -1 && buttons === 1;
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

  #eventToTimeMs(
    info: PickingInfo,
    event: MjolnirGestureEvent | MjolnirPointerEvent,
    {preferEventPosition = false}: {preferEventPosition?: boolean} = {}
  ): number | null {
    const projectionViewport = this.#getProjectionViewport(info);
    if (!projectionViewport) {
      return null;
    }
    const pickingCoordinate =
      info.coordinate &&
      Number.isFinite(info.coordinate[0]) &&
      (!projectionViewport.id || info.viewport?.id === projectionViewport.id)
        ? (info.coordinate[0] as number)
        : null;
    if (!preferEventPosition && pickingCoordinate !== null) {
      return pickingCoordinate;
    }
    const center = (event as any).offsetCenter ?? (event as any).center;
    if (!center) {
      return pickingCoordinate;
    }
    const x = 'x' in center ? center.x : Array.isArray(center) ? center[0] : null;
    if (typeof x !== 'number') {
      return null;
    }
    const offsetX: number = x - projectionViewport.x;
    const [timeMs] = projectionViewport.unproject([offsetX, 0]);
    return Number.isFinite(timeMs) ? timeMs : null;
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
    return deck.getViewports().find(viewport => viewport.id === projectionViewId) ?? null;
  }

  #finalizeRange(range: TimeMeasureRange) {
    this.#updateRange(range, {suppressEmit: false});
    this.#phase = 'selected';
    this.#draftStartTimeMs = null;
    this.#cursorTimeMs = null;
    this.#dragSelecting = false;
    this.#hoveredBoundary = null;
    this.#adjustingBoundary = null;
    this.#rangeBeforeAdjustment = null;
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
    const restoredRange = this.#rangeBeforeAdjustment;
    this.#updateRange(restoredRange, {suppressEmit: restoredRange !== null});
    this.#phase = restoredRange ? 'selected' : 'idle';
    this.#draftStartTimeMs = null;
    this.#cursorTimeMs = null;
    this.#dragSelecting = false;
    this.#hoveredBoundary = null;
    this.#adjustingBoundary = null;
    this.#rangeBeforeAdjustment = null;
    this.props.onDeactivate?.();
    this.#emitSelectionChange();
    this.updateHTML();
  }

  #isSelecting(): boolean {
    return this.#phase === 'selecting-start' || this.#phase === 'selecting-end';
  }

  #handleWidgetCommand() {
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
      range: this.#timeMeasureRange,
      hoveredBoundary: this.#hoveredBoundary,
      adjustingBoundary: this.#adjustingBoundary
    });
  }

  #getAppearance(): {
    color?: string;
    icon: string;
    isActive: boolean;
    title: string;
  } {
    const completedColor = '#000000';
    const selectingColor = '#4b5563';

    if (this.#phase === 'selecting-start' || this.#phase === 'selecting-end') {
      return {
        color: selectingColor,
        icon: makeTextIcon(this.#phase === 'selecting-start' ? '│' : '││'),
        isActive: true,
        title: 'Select time range…'
      };
    }

    if (this.#phase === 'selected' && this.#timeMeasureRange) {
      return {
        color: completedColor,
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
