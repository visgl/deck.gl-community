import {Suspense} from 'react';
import {createFileRoute} from '@tanstack/react-router';
import {MapClient} from '@/modules/map';
import {AirportsLayer} from '@/features/airports-layer';
import {AirportsList} from '@/features/airports-list';
import {AirportsCard} from '@/features/airports-card';
import {SearchBox} from '@/components/search-box';
import {useAppStore} from '@/stores/app';

export const Route = createFileRoute('/')({
  component: HomePage
});

function HomePage() {
  const selected = useAppStore(state => state.selected);

  return (
    <div style={{height: '100vh', position: 'relative', width: '100vw'}}>
      <Suspense fallback={<LoadingFallback />}>
        <MapClient>
          <AirportsLayer />
        </MapClient>
        <AirportsList />
        <SearchBox />
        {selected !== null && <AirportsCard />}
      </Suspense>
    </div>
  );
}

function LoadingFallback() {
  return (
    <div
      style={{
        alignItems: 'center',
        display: 'flex',
        height: '100vh',
        justifyContent: 'center',
        width: '100vw'
      }}
    >
      <div>Loading...</div>
    </div>
  );
}
