import {ScatterplotLayer} from '@deck.gl-community/react-fiber/layers';
import {useAirports} from '@/hooks/use-airports';
import {useAppStore} from '@/stores/app';
import type {Airport} from '@/server/airports';

/**
 * Airports scatterplot layer with hover and click interactions
 */
export function AirportsLayer() {
  const selected = useAppStore(state => state.selected);
  const hovered = useAppStore(state => state.hovered);
  const setSelected = useAppStore(state => state.setSelected);
  const setHovered = useAppStore(state => state.setHovered);

  const {data} = useAirports();

  return (
    <ScatterplotLayer<Airport>
      data={data}
      getFillColor={d => {
        if (selected === d.id) {
          return [255, 0, 0, 200]; // Red for selected
        }
        if (hovered === d.id) {
          return [255, 165, 0, 200]; // Orange for hovered
        }
        return [0, 128, 255, 160]; // Blue default
      }}
      getPosition={d => d.coordinates}
      getRadius={d => {
        if (selected === d.id) {
          return 8000; // Larger for selected
        }
        if (hovered === d.id) {
          return 6000; // Medium for hovered
        }
        return 4000; // Default size
      }}
      id="airports-layer"
      onClick={info => {
        if (info.object) {
          setSelected(info.object.id);
        }
      }}
      onHover={info => {
        setHovered(info.object?.id ?? null);
      }}
      pickable
      updateTriggers={{
        getFillColor: [selected, hovered],
        getRadius: [selected, hovered]
      }}
    />
  );
}
