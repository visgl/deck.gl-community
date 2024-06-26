import {FeatureCollection, Feature, Position} from '../utils/geojson-types';
import {
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent
} from '../edit-modes/types';
import {ModeHandler, EditAction, EditHandle} from './mode-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class CompositeModeHandler extends ModeHandler {
  handlers: Array<ModeHandler>;
  options: Record<string, any>;

  constructor(handlers: Array<ModeHandler>, options: Record<string, any> = {}) {
    super();
    this.handlers = handlers;
    this.options = options;
  }

  _coalesce<T>(
    callback: (arg0: ModeHandler) => T,
    resultEval: ((arg0: T) => boolean | null | undefined) | null = null
  ): T | undefined {
    let result: T | undefined;

    for (let i = 0; i < this.handlers.length; i++) {
      // eslint-disable-next-line callback-return
      result = callback(this.handlers[i]);
      if (resultEval ? resultEval(result) : result) {
        break;
      }
    }

    return result;
  }

  setFeatureCollection(featureCollection: FeatureCollection): void {
    this.handlers.forEach((handler) => handler.setFeatureCollection(featureCollection));
  }

  setModeConfig(modeConfig: any): void {
    this.handlers.forEach((handler) => handler.setModeConfig(modeConfig));
  }

  setSelectedFeatureIndexes(indexes: number[]): void {
    this.handlers.forEach((handler) => handler.setSelectedFeatureIndexes(indexes));
  }

  handleClick(event: ClickEvent): EditAction | null | undefined {
    return this._coalesce((handler) => handler.handleClick(event));
  }

  handlePointerMove(event: PointerMoveEvent): {
    editAction: EditAction | null | undefined;
    cancelMapPan: boolean;
  } {
    return this._coalesce(
      (handler) => handler.handlePointerMove(event),
      (result) => result && Boolean(result.editAction)
    ) as any; // TODO
  }

  handleStartDragging(event: StartDraggingEvent): EditAction | null | undefined {
    return this._coalesce((handler) => handler.handleStartDragging(event));
  }

  handleStopDragging(event: StopDraggingEvent): EditAction | null | undefined {
    return this._coalesce((handler) => handler.handleStopDragging(event));
  }

  getTentativeFeature(): Feature | null | undefined {
    return this._coalesce((handler) => handler.getTentativeFeature());
  }

  getEditHandles(picks?: Array<Record<string, any>>, mapCoords?: Position): EditHandle[] {
    // TODO: Combine the handles *BUT* make sure if none of the results have
    // changed to return the same object so that "editHandles !== this.state.editHandles"
    // in editable-geojson-layer works.
    return this._coalesce(
      (handler) => handler.getEditHandles(picks, mapCoords),
      (handles) => Array.isArray(handles) && handles.length > 0
    ) as any; // TODO
  }

  getCursor({isDragging}: {isDragging: boolean}): string {
    return this._coalesce((handler) => handler.getCursor({isDragging})) as any; // TODO
  }
}
