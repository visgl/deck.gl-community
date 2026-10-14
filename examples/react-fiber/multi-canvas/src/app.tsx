import {Deck, MapView} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {ZoomWidget} from '@deck.gl/widgets';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
import {DeckCanvas} from '@deck.gl-community/react-fiber';
import {useEffect, useMemo, useRef, useState} from 'react';
import {CITY_PANELS} from './cities';
import type {CityPanel, Landmark} from './cities';
import '@deck.gl/widgets/stylesheet.css';
import './style.css';

const INITIAL_VIEW_STATE = Object.fromEntries(CITY_PANELS.map(city => [city.id, city.viewState]));
const CITY_TITLES = Object.fromEntries(CITY_PANELS.map(city => [city.id, city.title]));

function CityCanvas({
  deck,
  city,
  hoveredLandmark,
  onHover
}: {
  deck: Deck<any>;
  city: CityPanel;
  hoveredLandmark: Landmark | null;
  onHover: (landmark: Landmark | null) => void;
}) {
  const view = useMemo(() => new MapView({id: city.id, controller: true}), [city]);
  const widgets = useMemo(
    () => [new ZoomWidget({id: `${city.id}-zoom`, viewId: city.id, placement: 'top-right'})],
    [city]
  );
  const layers = useMemo(
    () => [
      new BasemapLayer({id: `${city.id}-basemap`, style: city.mapStyle}),
      new ScatterplotLayer<Landmark>({
        id: `${city.id}-landmarks`,
        data: city.landmarks,
        pickable: true,
        autoHighlight: true,
        parameters: {depthCompare: 'always'},
        radiusUnits: 'pixels',
        radiusMinPixels: 18,
        radiusMaxPixels: 36,
        stroked: true,
        lineWidthMinPixels: 3,
        getPosition: landmark => landmark.position,
        getRadius: landmark => (hoveredLandmark?.id === landmark.id ? 28 : 20),
        getFillColor: landmark =>
          hoveredLandmark?.id === landmark.id
            ? [255, 215, 110]
            : hoveredLandmark?.cityId === landmark.cityId
              ? [255, 122, 89]
              : [84, 196, 255],
        getLineColor: [255, 255, 255],
        updateTriggers: {getRadius: hoveredLandmark?.id, getFillColor: hoveredLandmark?.id},
        onHover: info => onHover(info.object || null)
      })
    ],
    [city, hoveredLandmark, onHover]
  );
  return (
    <DeckCanvas
      deck={deck}
      id={`canvas-${city.id}`}
      views={view}
      layers={layers}
      widgets={widgets}
      className="city-canvas"
      aria-label={`${city.title} interactive map`}
    />
  );
}

/** React port of deck.gl's multi-canvas-cities example, using one shared Deck. */
export function App() {
  const mapGrid = useRef<HTMLDivElement>(null);
  const [deck, setDeck] = useState<Deck<any> | null>(null);
  const [hoveredLandmark, setHoveredLandmark] = useState<Landmark | null>(null);
  const [showSydney, setShowSydney] = useState(true);
  useEffect(() => {
    const instance = new Deck({
      parent: mapGrid.current!,
      _canvases: [],
      views: [],
      initialViewState: INITIAL_VIEW_STATE,
      getTooltip: ({object}) => (object ? `${object.name}\n${CITY_TITLES[object.cityId]}` : null)
    });
    setDeck(instance);
    return () => instance.finalize();
  }, []);

  return (
    <main>
      <header>
        <p className="eyebrow">deck.gl-community / React Fiber</p>
        <h1>Four cities. One Deck.</h1>
        <p>
          Independent canvases share one device and rendering loop. Drag to pan, scroll to zoom, and
          hover a landmark.
        </p>
        <div className="toolbar">
          <span role="status">
            {hoveredLandmark
              ? `${hoveredLandmark.name} in ${CITY_TITLES[hoveredLandmark.cityId]}`
              : 'Hover any highlighted landmark'}
          </span>
          <button type="button" onClick={() => setShowSydney(value => !value)}>
            {showSydney ? 'Remove Sydney canvas' : 'Add Sydney canvas'}
          </button>
        </div>
      </header>
      <div className="map-grid" ref={mapGrid}>
        {CITY_PANELS.filter(city => showSydney || city.id !== 'sydney').map(city => (
          <section className="city-panel" key={city.id}>
            <div className="city-heading">
              <h2>{city.title}</h2>
              <p>{city.subtitle}</p>
            </div>
            {deck && (
              <CityCanvas
                deck={deck}
                city={city}
                hoveredLandmark={hoveredLandmark}
                onHover={setHoveredLandmark}
              />
            )}
          </section>
        ))}
      </div>
      <footer>
        Adapted from{' '}
        <a href="https://github.com/visgl/deck.gl/pull/10492">
          deck.gl's multi-canvas cities example
        </a>
        . <a href="https://github.com/visgl/deck.gl/issues/10392">DeckCanvas RFC</a>
      </footer>
    </main>
  );
}
