// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {useState, useEffect, useRef, useCallback, useMemo, Fragment} from 'react';
import {createRoot} from 'react-dom/client';
import AutoSizer from 'react-virtualized-auto-sizer';
import {Map} from 'react-map-gl';
import {DeckWithMapboxMaps} from './deck-with-mapbox-maps';
import {DeckWithGoogleMaps} from './deck-with-google-maps';

import {FlyToInterpolator} from '@deck.gl/core';
import {JSONConverter, JSONConfiguration, _shallowEqualObjects} from '@deck.gl/json';
import {JSON_CONFIGURATION} from './json-configuration';

import AceEditor from 'react-ace';
import 'brace/mode/json';
import 'brace/theme/github';

import JSON_TEMPLATES from '../json-examples';

const INITIAL_TEMPLATE = Object.keys(JSON_TEMPLATES)[0];

// Set your mapbox token here
const GOOGLE_MAPS_TOKEN = globalThis.process?.env?.GoogleMapsAPIKey; // eslint-disable-line

function isFunctionObject(value) {
  return typeof value === 'object' && '@@function' in value;
}

function addUpdateTriggersForAccessors(json) {
  if (!json || !json.layers) return;

  for (const layer of json.layers) {
    const updateTriggers = {};
    for (const [key, value] of Object.entries(layer)) {
      if ((key.startsWith('get') && typeof value === 'string') || isFunctionObject(value)) {
        // it's an accessor and it's a string
        // we add the value of the accesor to update trigger to refresh when it changes
        updateTriggers[key] = value;
      }
    }
    if (Object.keys(updateTriggers).length) {
      layer.updateTriggers = updateTriggers;
    }
  }
}

export function App() {
  const [text, setText] = useState('');
  const [jsonProps, setJsonProps] = useState<Record<string, any>>({});
  const [initialViewState, setInitialViewState] = useState<Record<string, any> | null>(null);

  const aceRef = useRef(null);
  const initialViewStateRef = useRef(initialViewState);

  // Keep the ref in sync so callbacks always see the latest value
  initialViewStateRef.current = initialViewState;

  // Configure and create the JSON converter instance (once)
  const jsonConverter = useMemo(() => {
    const configuration = new JSONConfiguration(JSON_CONFIGURATION);
    return new JSONConverter({configuration});
  }, []);

  // Handle `json.initialViewState`
  // If we receive new JSON we need to decide if we should update current view state
  // Current heuristic is to compare with last `initialViewState` and only update if changed
  const updateViewState = useCallback(
    (json) => {
      const viewState = json.initialViewState || json.viewState;
      if (viewState) {
        const shouldUpdate =
          !initialViewStateRef.current ||
          !_shallowEqualObjects(viewState, initialViewStateRef.current);

        if (shouldUpdate) {
          setInitialViewState({
            ...viewState
            // Tells deck.gl to animate the camera move to the new tileset
            // transitionDuration: 4000,
            // transitionInterpolator: new FlyToInterpolator()
          });
        }
      }
      return json;
    },
    [jsonConverter]
  );

  // Updates deck.gl JSON props
  const setJSON = useCallback(
    (json) => {
      addUpdateTriggersForAccessors(json);
      const props = jsonConverter.convert(json);
      updateViewState(props);
      setJsonProps(props);
    },
    [jsonConverter, updateViewState]
  );

  // Updates pretty printed text in editor.
  const setEditorText = useCallback((json) => {
    const value = typeof json !== 'string' ? JSON.stringify(json, null, 2) : json;
    setText(value);
  }, []);

  // Updates deck.gl JSON props
  // Called on init, when template is changed, or user types
  const setTemplate = useCallback(
    (value) => {
      const json = JSON_TEMPLATES[value];
      if (json) {
        // Triggers an editor change, which updates the JSON
        setEditorText(json);
        setJSON(json);
      }
    },
    [setEditorText, setJSON]
  );

  // On mount, set the initial template
  useEffect(() => {
    setTemplate(INITIAL_TEMPLATE);
  }, [setTemplate]);

  const onTemplateChange = useCallback(
    (event) => {
      const value = event && event.target && event.target.value;
      setTemplate(value);
    },
    [setTemplate]
  );

  const onEditorChange = useCallback(
    (newText, event) => {
      let json = null;
      // Parse JSON, while capturing and ignoring exceptions
      try {
        json = newText && JSON.parse(newText);
      } catch (error) {
        // ignore error, user is editing and not yet correct JSON
      }
      setEditorText(newText);
      setJSON(json);
    },
    [setEditorText, setJSON]
  );

  const renderJsonSelector = () => {
    return (
      <select name="JSON templates" onChange={onTemplateChange}>
        {Object.entries(JSON_TEMPLATES).map(([key]) => (
          <option key={key} value={key}>
            {key}
          </option>
        ))}
      </select>
    );
  };

  let deckMap;
  if (jsonProps.google === true) {
    deckMap = (
      <DeckWithGoogleMaps
        initialViewState={initialViewState}
        id="json-deck"
        {...jsonProps}
        googleMapsToken={GOOGLE_MAPS_TOKEN}
      />
    );
  } else {
    deckMap = (
      <DeckWithMapboxMaps
        id="json-deck"
        {...jsonProps}
        initialViewState={initialViewState}
        Map={Map}
      />
    );
  }

  return (
    <Fragment>
      {/* Left Pane: Ace Editor and Template Selector */}
      <div id="left-pane">
        {renderJsonSelector()}

        <div id="editor">
          <AutoSizer>
            {({width, height}) => (
              <AceEditor
                width={`${width}px`}
                height={`${height}px`}
                mode="json"
                theme="github"
                onChange={onEditorChange}
                name="AceEditorDiv"
                editorProps={{$blockScrolling: true}}
                ref={instance => {
                  aceRef.current = instance;
                }}
                value={text}
              />
            )}
          </AutoSizer>
        </div>
      </div>

      {/* Right Pane: DeckGL */}
      <div id="right-pane">{deckMap}</div>
    </Fragment>
  );
}

export function renderToDOM(container) {
  createRoot(container).render(<App />);
}
