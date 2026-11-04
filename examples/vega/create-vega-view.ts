// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import './vega-controls.css';
import {parse, type Spec} from 'vega';
import {PanelManager, HeaderPanelContainer, CustomPanel} from '@deck.gl-community/panels';
import {EXAMPLE_PANEL_STYLE} from '../utils/panel-theme';
import {ViewGl} from '../../modules/vega/src';

/** Runs a declarative Vega document. Controls are native Vega signal bindings. */
export function createVegaView(host: HTMLElement, spec: Spec) {
  const runtime = parse(spec);
  const controls = host.ownerDocument.createElement('section');
  controls.className = 'vega-controls';
  controls.setAttribute('aria-label', 'Chart controls');
  controls.hidden = !spec.signals?.some(signal => signal.bind);
  const bindings = host.ownerDocument.createElement('div');
  bindings.className = 'vega-controls-grid';
  controls.append(bindings);
  const chart = host.ownerDocument.createElement('div');
  chart.style.cssText = 'position:relative;flex:1;min-height:100px';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.append(controls, chart);
  const panelManager = new PanelManager({parentElement: host, contentElement: chart});
  if (!controls.hidden) {
    panelManager.setProps({
      components: [
        new HeaderPanelContainer({
          fitContent: true,
          style: EXAMPLE_PANEL_STYLE,
          panel: new CustomPanel({
            id: 'vega-signal-controls',
            title: '',
            onRenderHTML(element) {
              element.append(controls);
              return () => controls.remove();
            }
          })
        })
      ]
    });
  }
  const markOrdinals = new Map<object, Map<unknown, number>>();
  let nextOrdinal = 0;
  let view: InstanceType<typeof ViewGl>;
  const has3dSignal = spec.signals?.some(signal => signal.name === 'is3d');
  view = new ViewGl(runtime, {
    bind: bindings,
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
  let runtimeError: Error | undefined;
  const reportError = view.error.bind(view);
  view.error = error => {
    runtimeError = error instanceof Error ? error : new Error(String(error));
    return reportError(error);
  };
  try {
    view.renderer('deck.gl').initialize(chart);
    let finalized = false;
    return {
      view,
      ready: view.runAsync().then(result => {
        // Vega logs some evaluation/rendering errors instead of rejecting runAsync().
        if (runtimeError) throw runtimeError;
        return result;
      }),
      finalize() {
        if (finalized) return;
        finalized = true;
        view.finalize();
        panelManager.finalize();
        controls.remove();
        chart.remove();
      }
    };
  } catch (error) {
    view.finalize();
    panelManager.finalize();
    throw error;
  }
}
