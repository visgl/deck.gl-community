import {create} from 'zustand';

interface HoverState {
  hovered: number | null;
  setHovered: (id: number | null) => void;
}

/**
 * Zustand store for transient hover state (not persisted to URL)
 */
export const useHoverStore = create<HoverState>(set => ({
  hovered: null,
  setHovered: id => set({hovered: id})
}));
