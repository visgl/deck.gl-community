// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo} from '@deck.gl/core';
import type {DeckPlayground} from '@deck.gl-community/playground';
import {
  EditModeTrayWidget,
  ViewMode,
  ModifyMode,
  TransformMode,
  DrawPointMode,
  DrawLineStringMode,
  DrawPolygonMode,
  type EditAction,
  type FeatureCollection
} from '@deck.gl-community/editable-layers';

const MODES = [
  {id: 'ViewMode', mode: ViewMode, label: 'Select', title: 'Select features'},
  {id: 'ModifyMode', mode: ModifyMode, label: 'Edit', title: 'Edit vertices'},
  {id: 'TransformMode', mode: TransformMode, label: 'Move', title: 'Move, rotate, and scale'},
  {id: 'DrawPointMode', mode: DrawPointMode, label: 'Point', title: 'Draw a point'},
  {id: 'DrawLineStringMode', mode: DrawLineStringMode, label: 'Line', title: 'Draw a line'},
  {id: 'DrawPolygonMode', mode: DrawPolygonMode, label: 'Area', title: 'Draw a polygon'}
];

type Document = Record<string, unknown> & {layers: Record<string, unknown>[]};

/** Connects the existing edit-mode widget and editable callbacks to the example's JSON document. */
export function createEditablePlaygroundControls() {
  let playground: DeckPlayground | undefined;
  let document: Document | undefined;
  const getLayer = () =>
    document?.layers.find(
      layer =>
        layer['@@type'] === 'EditableGeoJsonLayer' && layer.onEdit === '@@#playgroundEditFeatures'
    );
  const updateLayer = (changes: Record<string, unknown>) => {
    const layer = getLayer();
    if (!playground || !document || !layer) return;
    playground.setText(
      JSON.stringify(
        {
          ...document,
          layers: document.layers.map(candidate =>
            candidate === layer ? {...layer, ...changes} : candidate
          )
        },
        null,
        2
      )
    );
  };
  const widget = new EditModeTrayWidget({
    id: 'playground-edit-modes',
    placement: 'bottom-right',
    layout: 'horizontal',
    // Let Deck's corner container measure the tray so it stays inside the preview.
    style: {position: 'relative', margin: '12px'},
    modes: MODES,
    onSelectMode: ({id}) => updateLayer({mode: `@@#${id}`})
  });
  return {
    constants: {
      playgroundEditModeTray: widget,
      playgroundSelectFeature: (info: PickingInfo) => {
        const layer = getLayer();
        if (!layer || layer.mode !== '@@#ViewMode') return;
        let pickedLayer = info.layer;
        while (pickedLayer && pickedLayer.id !== layer.id) pickedLayer = pickedLayer.parent;
        const selectedFeatureIndexes =
          info.picked && pickedLayer && info.index >= 0 ? [info.index] : [];
        updateLayer({selectedFeatureIndexes});
      },
      playgroundEditFeatures: (event: EditAction<FeatureCollection>) => {
        updateLayer({data: event.updatedData});
      }
    },
    connect(instance: DeckPlayground) {
      playground = instance;
    },
    onChange(value: unknown) {
      document =
        value && typeof value === 'object' && Array.isArray((value as Document).layers)
          ? (value as Document)
          : undefined;
      const mode = MODES.find(option => getLayer()?.mode === `@@#${option.id}`);
      widget.setProps({selectedModeId: mode?.id ?? null, activeMode: mode?.mode ?? null});
    },
    suspend() {
      // Avoid replacing an invalid JSON draft in response to a map interaction.
      document = undefined;
    }
  };
}
