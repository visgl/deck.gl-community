import {useSuspenseQuery} from '@tanstack/react-query';
import {getAirports} from '@/server/airports';
import {useAppStore} from '@/stores/app';

export function useAirports() {
  const search = useAppStore(state => state.search);

  return useSuspenseQuery({
    queryKey: ['airports', search],
    queryFn: () => getAirports({data: {search}})
  });
}
