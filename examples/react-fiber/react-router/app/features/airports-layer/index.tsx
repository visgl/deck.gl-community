import {useMemo} from 'react';
import {ScatterplotLayer} from '@deck.gl/layers';
import {useSelected} from '@/hooks/use-selected';
import {useHover} from '@/hooks/use-hover';
import type {Airport} from '@/data-access/airports/types';

interface AirportsLayerProps {
  data: Airport[];
}

/**
 * Airports scatterplot layer with hover and click interactions
 */
export function AirportsLayer({data}: AirportsLayerProps) {
  const [selected, setSelected] = useSelected();
  const [hovered, setHovered] = useHover();

  const layer = useMemo(
    () =>
      new ScatterplotLayer<Airport>({
        id: 'airports-layer',
        data,
        getPosition: d => d.coordinates,
        getFillColor: d => {
          if (selected === d.id) {
            return [255, 0, 0, 200];
          }
          if (hovered === d.id) {
            return [255, 165, 0, 200];
          }
          return [0, 128, 255, 160];
        },
        getRadius: d => {
          if (selected === d.id) {
            return 8000;
          }
          if (hovered === d.id) {
            return 6000;
          }
          return 4000;
        },
        pickable: true,
        onClick: info => {
          if (info.object) {
            setSelected(info.object.id);
          }
        },
        onHover: info => {
          setHovered(info.object?.id ?? null);
        },
        updateTriggers: {
          getFillColor: [selected, hovered],
          getRadius: [selected, hovered]
        }
      }),
    [data, selected, hovered, setSelected, setHovered]
  );

  return <layer layer={layer} />;
}
