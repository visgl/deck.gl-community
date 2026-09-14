import {Suspense} from 'react';
import {useLoaderData} from 'react-router';
import {fetchAirports} from '@/data-access/airports/server';
import type {Airport} from '@/data-access/airports/types';
import {MapClient} from '@/modules/map';
import {AirportsLayer} from '@/features/airports-layer';
import {AirportsList} from '@/features/airports-list';
import {AirportsCard} from '@/features/airports-card';
import {SearchBox} from '@/components/search-box';
import {NuqsAdapter} from 'nuqs/adapters/react-router/v7';

export async function loader({request}: {request: Request}) {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') ?? '';

  const airports = await fetchAirports(search);

  return {airports, search};
}

export default function Home() {
  const {airports} = useLoaderData<{airports: Airport[]; search: string}>();

  return (
    <NuqsAdapter>
      <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@^4/dist/maplibre-gl.css" />
      <MapClient>
        <AirportsLayer data={airports} />
      </MapClient>
      <AirportsList data={airports} />
      <SearchBox />
      <Suspense fallback={<div>Loading airport details...</div>}>
        <AirportsCard />
      </Suspense>
    </NuqsAdapter>
  );
}
