import {useEffect} from 'react';
import type {ReactNode} from 'react';
import {Deckgl, useDeckgl} from '@deck.gl-community/react-fiber';
import {PARAMETERS} from './constants';
import {connect} from './maplibre';
import {useSelected} from '@/hooks/use-selected';

interface MapClientProps {
  children?: ReactNode;
}

/**
 * Map component with deck.gl + Maplibre integration
 */
export function MapClient({children}: MapClientProps) {
  const deckglInstance = useDeckgl();
  const [, setSelected] = useSelected();

  const handleClick = (pickInfo: {picked?: boolean}) => {
    if (!pickInfo.picked) {
      setSelected(0);
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
      <Deckgl interleaved parameters={PARAMETERS} onClick={handleClick}>
        {children}
      </Deckgl>
    </div>
  );
}
