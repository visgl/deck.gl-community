// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useEffect, useState} from 'react';
import DeckGL from '@deck.gl/react';
import {HtmlOverlayItem, HtmlClusterOverlay} from '@deck.gl-community/react';
import Map from 'react-map-gl/maplibre';

const DATA_URL = 'https://cors-tube.vercel.app/?url=https://whc.unesco.org/en/list/georss/';

const INITIAL_VIEW_STATE = {
  longitude: 20,
  latitude: 40,
  zoom: 3
};

class WorldHeritage extends HtmlClusterOverlay {
  getAllObjects() {
    return this.props.data;
  }

  getObjectCoordinates(object) {
    return [object.lng, object.lat];
  }

  renderObject(coordinates, object) {
    if (this.getZoom() > 5) {
      return (
        <HtmlOverlayItem
          style={{
            background: 'red',
            padding: 4,
            color: 'white',
            fontSize: 12,
            lineHeight: '10px',
            maxWidth: 300
          }}
          key={object.name}
          coordinates={coordinates}
        >
          {object.title}
        </HtmlOverlayItem>
      );
    }

    return (
      <HtmlOverlayItem
        style={{background: 'red', padding: 4}}
        key={object.name}
        coordinates={coordinates}
      />
    );
  }

  renderCluster(coordinates, clusterId, pointCount) {
    return (
      <HtmlOverlayItem
        style={{
          background: 'blue',
          padding: 4,
          color: 'white',
          width: 40,
          height: 40,
          borderRadius: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        key={`${clusterId}-cluster`}
        coordinates={coordinates}
      >
        {pointCount}
      </HtmlOverlayItem>
    );
  }
}

export function App() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((response) => response.text())
      .then((text) => {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        const items = Array.from(xmlDoc.getElementsByTagName('item')).map((item) => {
          const title = item.getElementsByTagName('title')[0]?.textContent;
          const description = item.getElementsByTagName('description')[0]?.textContent || '';
          const link = item.getElementsByTagName('link')[0]?.textContent;
          const lat = Number(item.getElementsByTagName('geo:lat')[0]?.textContent);
          const lng = Number(item.getElementsByTagName('geo:long')[0]?.textContent);

          return {
            title,
            description: description.replace(/<.+?>/gi, ''),
            image: (/src='(.+?)'/.exec(description) || [])[1],
            link,
            lat,
            lng
          };
        });

        setData(items);
      });
  }, []);

  return (
    <DeckGL initialViewState={INITIAL_VIEW_STATE} controller={true}>
      <Map />
      {data ? <WorldHeritage data={data} /> : <div>Loading...</div>}
    </DeckGL>
  );
}
