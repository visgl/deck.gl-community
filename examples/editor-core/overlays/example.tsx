import React, {useEffect, useState} from 'react';
import DeckGL from '@deck.gl/react';
import StaticMap from 'react-map-gl';
import {INITIAL_COORDS, INITIAL_VIEW_STATE, MAPBOX_ACCESS_TOKEN} from './constants';
import {HtmlOverlay, HtmlOverlayItem} from '@deck.gl-community/react-editable-layers';
import type {WikipediaEntry} from './types';

const styles = {
  mapContainer: {
    alignItems: 'stretch',
    display: 'flex',
    height: '100vh'
  },
  box: {
    background: 'white'
  },
  image: {
    float: 'left',
    margin: 10
  },
  dot: {
    width: '5px',
    heigth: '5px',
    borderRadius: '5px',
    background: 'red'
  }
};

const getWikipediaEntriesNearby = async ({lon, lat}) => {
  const url = `https://en.wikipedia.org/w/api.php?origin=*&action=query&generator=geosearch&ggscoord=${lat}%7C${lon}&format=json&prop=coordinates|pageimages`;
  const response = await fetch(url);

  if (response.ok) {
    return await response.json();
  } else {
    console.error(`HTTP Error: ${response.status}`);
    return {
      status: 400,
      query: {
        pages: []
      }
    };
  }
};

const Example = () => {
  const [data, setData] = useState<WikipediaEntry[] | null>(null);

  useEffect(() => {
    getWikipediaEntriesNearby({lon: INITIAL_COORDS.lon, lat: INITIAL_COORDS.lat}).then((d) => {
      const data = Object.keys(d.query.pages)
        .map((k) => d.query.pages[k])
        .filter((f) => f.thumbnail?.source);
      setData(data);
    });
  }, [setData]);

  return (
    <div style={styles.mapContainer}>
      <link href="https://api.mapbox.com/mapbox-gl-js/v0.47.0/mapbox-gl.css" rel="stylesheet" />
      <DeckGL initialViewState={INITIAL_VIEW_STATE} controller={true}>
        <StaticMap
          mapStyle={'mapbox://styles/mapbox/light-v10'}
          mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
        />
        {data ? (
          <HtmlOverlay>
            {data.map((feature) => (
              <HtmlOverlayItem
                key={feature.pageid}
                coordinates={[feature.coordinates[0].lon, feature.coordinates[0].lat]}
              >
                <img
                  src={feature.thumbnail.source}
                  style={{background: 'cover', width: '50px', height: '50px'}}
                />
              </HtmlOverlayItem>
            ))}
          </HtmlOverlay>
        ) : null}
      </DeckGL>
    </div>
  );
};

export default Example;
