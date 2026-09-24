import {useEffect, useState} from 'react';
import type {ReactNode} from 'react';
import {DeckGL} from '@deck.gl-community/react-fiber';
import type {DeckglInstance} from '@deck.gl-community/react-fiber';
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
  const [deckglInstance, setDeckglInstance] = useState<DeckglInstance | null>(null);
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
