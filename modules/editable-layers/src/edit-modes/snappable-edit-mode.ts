import {SnappingStrategy} from './snapping/snapping-strategy';

/**
 * Optional interface that edit modes can implement to provide a snapping
 * strategy to SnappableMode.
 *
 * Modes that do not implement this interface are treated as non-snappable and
 * cannot be wrapped in SnappableMode.
 */
export interface SnappableEditMode {
  getSnappingStrategy(): SnappingStrategy | undefined;
}
