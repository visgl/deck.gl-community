import {createContext} from 'preact';
import {useContext} from 'preact/hooks';

/** Edge occupied by a docked panel container. */
export type PanelDockSide = 'left' | 'right' | 'top' | 'bottom';

/** Layout information inherited by all descendants of a chrome container. */
export type PanelContainerState = {
  /** Whether the container is configured to be pinned. */
  pinned: boolean;
  /** Configured docking edge, also available while floating. */
  side: PanelDockSide;
  /** Whether the host supplies a content element and supports docking. */
  canPin: boolean;
};

export const PanelContainerStateContext = createContext<PanelContainerState | undefined>(undefined);

/**
 * Returns the nearest chrome container's reactive layout state, or undefined
 * outside a chrome container. Pin changes update descendants without remounting.
 */
export function usePanelContainerState(): PanelContainerState | undefined {
  return useContext(PanelContainerStateContext);
}
