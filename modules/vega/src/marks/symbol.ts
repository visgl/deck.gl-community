// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Extends the Microsoft Research SandDance scene stagers; see ../../UPSTREAM.md.

import {base} from '../base';
import {colorFromString} from '../color';
import type {MarkStager} from './interfaces';
import type {SceneSymbol} from 'vega';

type SymbolItem = SceneSymbol & {z?: number; angle?: number};

/** Circles and squares retain Vega's area-based size, group offsets and opacity. */
const stageSymbol: MarkStager = (_options, stage, scene, x, y) => {
  base.vega.sceneVisit(scene, (item: SymbolItem) => {
    if (item.shape && item.shape !== 'circle' && item.shape !== 'square') {
      throw new Error(`Unsupported Vega symbol shape: ${item.shape}. Use circle or square.`);
    }
    const fillColor = colorFromString(item.fill) || [0, 0, 0, 0];
    const strokeColor = colorFromString(item.stroke) || [0, 0, 0, 0];
    fillColor[3] *= (item.opacity ?? 1) * (item.fillOpacity ?? 1);
    strokeColor[3] *= (item.opacity ?? 1) * (item.strokeOpacity ?? 1);
    const position: [number, number, number] = [
      x + (item.x || 0),
      -(y + (item.y || 0)),
      stage.view === '3d' ? item.z || 0 : 0
    ];
    const size = Math.max(0, item.size ?? 64);
    if (item.shape === 'square') {
      const halfSize = Math.sqrt(size) / 2;
      stage.polygonData.push({
        datum: item.datum,
        positions: [
          [-halfSize, -halfSize],
          [halfSize, -halfSize],
          [halfSize, halfSize],
          [-halfSize, halfSize]
        ].map(([dx, dy]) => {
          const angle = (-(item.angle ?? 0) * Math.PI) / 180;
          return [
            position[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
            position[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
            position[2]
          ];
        }),
        fillColor,
        strokeColor,
        strokeWidth: item.strokeWidth ?? 1,
        depth: 0
      });
      return;
    }
    stage.symbolData ??= [];
    stage.symbolData.push({
      datum: item.datum,
      position,
      radius: Math.sqrt(size / Math.PI),
      fillColor,
      strokeColor,
      strokeWidth: item.strokeWidth ?? 1
    });
  });
};
export default stageSymbol;
