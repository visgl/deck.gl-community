import {useHoverStore} from '@/stores/hover';

/**
 * Hook for transient hover state
 */
export function useHover() {
  return [useHoverStore(state => state.hovered), useHoverStore(state => state.setHovered)] as const;
}
