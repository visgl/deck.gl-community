import {SnappingStrategy} from './snapping/snapping-strategy';

/**
 * Optional interface that edit modes can implement to provide a snapping
 * strategy to SnappableMode.
 *
 * Modes without this hook retain source-handle snapping when wrapped.
 * Return undefined to explicitly opt out of snapping.
 */
export interface SnappableEditMode {
  /** Returns the mode-specific policy, or undefined to disable snapping. */
  getSnappingStrategy(): SnappingStrategy | undefined;
}
