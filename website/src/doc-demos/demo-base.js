import React, {useEffect, useMemo, useRef} from 'react';
import {Deck} from '@deck.gl/core';
import {Map} from 'maplibre-gl';
import {useColorMode} from '@docusaurus/theme-common';
import {MAPBOX_STYLES} from '../constants/defaults';
import {gotoLayerSource} from './codepen-automation';
import styles from './demo-base.module.css';

const INITIAL_VIEW_STATE = {
  longitude: -122.4,
  latitude: 37.74,
  zoom: 11,
  maxZoom: 20,
  pitch: 30,
  bearing: 0
};

const TOOLTIP_STYLE = {
  padding: '4px',
  background: 'rgba(0, 0, 0, 0.8)',
  color: '#fff',
  maxWidth: '300px',
  fontSize: '10px',
  zIndex: 9
};

/* eslint-disable no-eval */
function evalObject(source, globals, output) {
  return eval(`(function evalObject(globals){
    Object.assign(globalThis, globals);
    ${
      output
        ? `${source}
      return {${output.join(',')}};`
        : `return ${source};`
    }
  })`)(globals);
}

export function makeLayerDemo(config) {
  const {
    Layer,
    getTooltip,
    props,
    mapStyle = true,
    initialViewState = INITIAL_VIEW_STATE,
    imports
  } = config;
  config.initialViewState = initialViewState;

  const _getTooltip = getTooltip && eval(getTooltip);
  const styledGetTooltip = pickingInfo => {
    const text = _getTooltip && _getTooltip(pickingInfo);
    return (
      text && {
        text,
        style: TOOLTIP_STYLE
      }
    );
  };

  const layerProps = evalObject(props, imports);

  function Demo() {
    const {colorMode} = useColorMode();

    const layer = useMemo(() => new Layer(layerProps), []);
    const deckHost = useRef(null);
    const mapHost = useRef(null);
    const mapRef = useRef(null);

    useEffect(() => {
      const {longitude, latitude, zoom, bearing, pitch} = initialViewState;
      const map = mapHost.current
        ? new Map({
            container: mapHost.current,
            center: [longitude, latitude],
            zoom,
            bearing,
            pitch,
            interactive: false
          })
        : null;
      mapRef.current = map;
      const deck = new Deck({
        parent: deckHost.current,
        pickingRadius: 5,
        initialViewState,
        getTooltip: styledGetTooltip,
        controller: true,
        layers: [layer],
        onResize: () => {
          map?.resize();
        },
        onViewStateChange: ({viewState}) => {
          const {longitude, latitude, zoom, bearing, pitch} = viewState;
          map?.jumpTo({center: [longitude, latitude], zoom, bearing, pitch});
        }
      });
      return () => {
        mapRef.current = null;
        deck.finalize();
        map?.remove();
      };
    }, [layer]);

    useEffect(() => {
      mapRef.current?.setStyle(colorMode === 'dark' ? MAPBOX_STYLES.DARK : MAPBOX_STYLES.LIGHT);
    }, [colorMode]);

    return (
      <div className={styles.demoPlaceholder}>
        {mapStyle && <div ref={mapHost} className={styles.demoContainer} />}
        <div ref={deckHost} className={styles.demoContainer} />
        <div className={styles.demoSourceLink} onClick={() => gotoLayerSource(config, layer)}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <path d="M0 0h24v24H0V0z" fill="none" />
            <path
              fill="currentcolor"
              d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"
            />
          </svg>
          Edit on Codepen
        </div>
      </div>
    );
  }
  return React.memo(Demo);
}
