import type {SpanRef} from '../../trace/index';

/**
 * Commands and queries that a mounted deck-backed trace graph exposes to the global controller.
 */
export type ImperativeDeckControllerTarget = {
  /** Pans the viewport toward earlier times. */
  panLeft: () => void;
  /** Pans the viewport toward later times. */
  panRight: () => void;
  /** Pans the viewport upward. */
  panUp: () => void;
  /** Pans the viewport downward. */
  panDown: () => void;
  /** Pans the viewport upward by the fast keyboard navigation step. */
  panUpFast: () => void;
  /** Pans the viewport downward by the fast keyboard navigation step. */
  panDownFast: () => void;
  /** Zooms the viewport in along the horizontal axis. */
  zoomInHorizontal: () => void;
  /** Zooms the viewport out along the horizontal axis. */
  zoomOutHorizontal: () => void;
  /** Zooms the viewport to the requested span ref. */
  zoomToSpanRef: (spanRef: SpanRef) => void;
  /** Centers the viewport horizontally on the requested absolute trace time. */
  centerOnTime: (timeMs: number) => void;
  /** Tracks the requested absolute trace time at the preferred horizontal screen anchor. */
  trackTime: (timeMs: number) => void;
  /** Fits the viewport vertically to the current graph bounds while preserving horizontal state. */
  fitYToBounds: () => void;
  /** Centers the viewport horizontally on the requested time and fits the current graph vertically. */
  centerOnTimeAndFitY: (timeMs: number) => void;
  /** Resets the viewport to the current graph bounds. */
  resetView: () => void;
  /** Expands or collapses every valid process row in the current graph set. */
  expandAllProcesses: (expand: boolean) => void;
  /** Returns whether every valid process row is currently expanded. */
  areAllProcessesExpanded: () => boolean;
};

/**
 * Global deck command facade that delegates to the currently attached trace graph target.
 */
export class ImperativeDeckController {
  private target: ImperativeDeckControllerTarget | null = null;

  /** Attaches the current active trace graph target. */
  attach(target: ImperativeDeckControllerTarget | null): void {
    this.target = target;
  }

  /** Detaches the active target, optionally only if it matches the provided target. */
  detach(target?: ImperativeDeckControllerTarget | null): void {
    if (target === undefined || target === null || this.target === target) {
      this.target = null;
    }
  }

  /** Zooms to the requested span ref when a target is attached. */
  zoomToSpanRef(spanRef: SpanRef): void {
    this.target?.zoomToSpanRef(spanRef);
  }

  /** Centers the attached target horizontally on the requested absolute trace time when available. */
  centerOnTime(timeMs: number): void {
    this.target?.centerOnTime(timeMs);
  }

  /** Tracks the attached target horizontally at the preferred screen anchor when available. */
  trackTime(timeMs: number): void {
    this.target?.trackTime(timeMs);
  }

  /** Fits the attached target vertically to its graph bounds when available. */
  fitYToBounds(): void {
    this.target?.fitYToBounds();
  }

  /** Centers the attached target on time and fits its vertical graph extent when available. */
  centerOnTimeAndFitY(timeMs: number): void {
    this.target?.centerOnTimeAndFitY(timeMs);
  }

  /** Pans the attached target toward earlier times when available. */
  panLeft(): void {
    this.target?.panLeft();
  }

  /** Pans the attached target toward later times when available. */
  panRight(): void {
    this.target?.panRight();
  }

  /** Pans the attached target upward when available. */
  panUp(): void {
    this.target?.panUp();
  }

  /** Pans the attached target downward when available. */
  panDown(): void {
    this.target?.panDown();
  }

  /** Pans the attached target upward by the fast keyboard navigation step when available. */
  panUpFast(): void {
    this.target?.panUpFast();
  }

  /** Pans the attached target downward by the fast keyboard navigation step when available. */
  panDownFast(): void {
    this.target?.panDownFast();
  }

  /** Zooms the attached target in along the horizontal axis when available. */
  zoomInHorizontal(): void {
    this.target?.zoomInHorizontal();
  }

  /** Zooms the attached target out along the horizontal axis when available. */
  zoomOutHorizontal(): void {
    this.target?.zoomOutHorizontal();
  }

  /** Resets the attached target view when available. */
  resetView(): void {
    this.target?.resetView();
  }

  /** Expands or collapses all processes when a target is attached. */
  expandAllProcesses(expand: boolean): void {
    this.target?.expandAllProcesses(expand);
  }

  /** Returns whether the attached target currently has all processes expanded. */
  areAllProcessesExpanded(): boolean {
    return this.target?.areAllProcessesExpanded() ?? false;
  }
}

export const imperativeDeckController = new ImperativeDeckController();

/** @deprecated Use `ImperativeDeckControllerTarget` instead. */
export type DeckControllerTarget = ImperativeDeckControllerTarget;

/** @deprecated Use `ImperativeDeckController` instead. */
export const DeckController = ImperativeDeckController;

/** @deprecated Use `imperativeDeckController` instead. */
export const deckController = imperativeDeckController;
