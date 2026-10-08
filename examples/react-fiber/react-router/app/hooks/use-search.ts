import {useQueryState, parseAsString} from 'nuqs';

/**
 * Hook for search query state (synced to URL)
 */
export function useSearch() {
  return useQueryState('q', parseAsString.withDefault(''));
}
