// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {parse, type Spec} from 'vega';
import {ViewGl} from '../../modules/vega/src';

/** Runs a declarative Vega document. Controls are native Vega signal bindings. */
export function createVegaView(host: HTMLElement, spec: Spec) {
  const runtime = parse(spec);
  const controls = host.ownerDocument.createElement('div');
  const chart = host.ownerDocument.createElement('div');
  controls.style.cssText =
    'padding:12px;display:flex;gap:16px;flex-wrap:wrap;background:#fff;color:#172033';
  chart.style.cssText = 'position:relative;flex:1;min-height:100px';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.append(controls, chart);
  const markOrdinals = new Map<object, Map<unknown, number>>();
  let nextOrdinal = 0;
  let view: InstanceType<typeof ViewGl>;
  const has3dSignal = spec.signals?.some(signal => signal.name === 'is3d');
  view = new ViewGl(runtime, {
    bind: controls,
    getView: () => (has3dSignal && view.signal('is3d') ? '3d' : '2d'),
    presenterConfig: {
      onSceneRectAssignCubeOrdinal: (datum: object, item?: {mark?: object}) => {
        const mark = item?.mark ?? datum;
        let ordinals = markOrdinals.get(mark);
        if (!ordinals) {
          ordinals = new Map();
          markOrdinals.set(mark, ordinals);
        }
        const key = datum;
        if (!ordinals.has(key)) ordinals.set(key, nextOrdinal++);
        return ordinals.get(key);
      },
      transitionDurations: {position: 1200, size: 1200, color: 600, view: 1200}
    }
  });
  try {
    view.renderer('deck.gl').initialize(chart);
    let finalized = false;
    return {
      view,
      ready: view.runAsync(),
      finalize() {
        if (finalized) return;
        finalized = true;
        view.finalize();
        controls.remove();
        chart.remove();
      }
    };
  } catch (error) {
    view.finalize();
    throw error;
  }
}
