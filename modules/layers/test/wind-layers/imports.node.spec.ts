// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect} from 'vitest';
import * as WindLayers from '../../src/wind-layers';
import type {WindFieldOptions} from '../../src/wind-layers';

it('exports the reusable wind showcase layers and field utilities', () => {
  expect(WindLayers.WindFieldLayer).toBeDefined();
  expect(WindLayers).not.toHaveProperty('WindLayer');
  expect(WindLayers.ParticleLayer).toBeDefined();
  expect(WindLayers.DelaunayCoverLayer).toBeDefined();
  expect(WindLayers.ElevationLayer).toBeDefined();
  expect(WindLayers.DelaunayInterpolation).toBeDefined();
  expect(WindLayers.createWindField).toBeDefined();
  expect(WindLayers.getWindBounds).toBeDefined();
  expect(WindLayers.parseWindData).toBeDefined();
  expect(WindLayers.sampleWindField).toBeDefined();
  expect(WindLayers.triangulateWindStations).toBeDefined();
});

it('exports typed wind field options', () => {
  const options: WindFieldOptions = {triangles: [[0, 1, 2]]};
  expect(options.triangles).toEqual([[0, 1, 2]]);
});
