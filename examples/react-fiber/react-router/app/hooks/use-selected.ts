import {useQueryState, parseAsInteger} from 'nuqs';

/**
 * Hook for selected airport state (synced to URL)
 */
export function useSelected() {
  return useQueryState('selected', parseAsInteger.withDefault(0));
}
