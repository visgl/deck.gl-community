import { Position } from '../geojson-types';
import { EditHandle, ModeHandler } from './mode-handler';

// TODO edit-modes: delete handlers once EditMode fully implemented
export class ViewHandler extends ModeHandler {
  getCursor({ isDragging }: { isDragging: boolean }): string {
    return isDragging ? 'grabbing' : 'grab';
  }

  getEditHandles(picks?: Array<Record<string, any>>, mapCoords?: Position): EditHandle[] {
    return [];
  }
}
