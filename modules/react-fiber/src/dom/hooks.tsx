import {selectors, useStore} from '../shared/index';

export function useDeckgl() {
  return useStore(selectors.deckgl);
}
