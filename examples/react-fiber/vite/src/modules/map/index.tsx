import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {DeckGL} from '@deck.gl-community/react-fiber/maplibre';
import type {MapLibreOverlay} from '@deck.gl-community/react-fiber/maplibre';
import {PARAMETERS} from './constants';
import {connect} from './maplibre';
import {useAppStore} from '@/stores/app';

interface MapClientProps {
  children?: ReactNode;
}

/**
 * Map component with deck.gl + Maplibre integration
 */
export function MapClient({children}: MapClientProps) {
  const [deckglInstance, setDeckglInstance] = useState<MapLibreOverlay | null>(null);
  const setSelected = useAppStore(state => state.setSelected);

  const handleClick = (pickInfo: {picked?: boolean}) => {
    if (!pickInfo.picked) {
      setSelected(null);
    }
  };

  useEffect(() => {
    if (deckglInstance) {
      const cleanup = connect(deckglInstance);
      return cleanup;
    }
  }, [deckglInstance]);

  return (
    <div id="maplibre" style={{inset: 0, position: 'absolute'}}>
      <DeckGL
        interleaved
        parameters={PARAMETERS}
        onClick={handleClick}
        onDeckglChange={setDeckglInstance}
      >
        {children}
      </DeckGL>
    </div>
  );
}
