// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DeckPlayground, PlaygroundDataSourceManager} from '@deck.gl-community/playground';
import {createPlaygroundRegistry} from './registry';
import {TEMPLATES as GALLERY_TEMPLATES} from './templates';
import {createEditablePlaygroundControls} from './editable-controls';
import {createDataSourcesPanel, UploadedSources} from './data-sources-panel';
import {createWebMcpButton} from './webmcp-button';

const TOOL_TEMPLATES = ['imported-points', 'scatterplot', 'arcs', 'geojson', 'heatmap'];

const TEMPLATES = {
  'imported-points': {
    name: 'Imported points',
    description: 'Replace the points source with JSON or Arrow rows containing position: [x, y].',
    views: {'@@type': 'OrthographicView', id: 'plot'},
    initialViewState: {target: [0, 0, 0], zoom: 1},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: 'datasource://points',
        getPosition: '@@=position',
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: [40, 120, 220],
        pickable: true
      }
    ]
  },
  ...GALLERY_TEMPLATES
};

/** Mounts a page-owned editor, preview and browser tools with one shared source. */
export function mountStandalonePlayground(
  container: HTMLElement,
  {enableTools = true}: {enableTools?: boolean} = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
  root.innerHTML = `
    <header style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid #d5dbe3;font:13px system-ui">
      <strong style="margin-right:auto">deck.gl Playground</strong>
      <span data-webmcp></span>
    </header>
    <div style="padding:4px 12px;font:12px system-ui">The points source accepts rows with position: [x, y]. Imported rows stay in this page until it closes or reloads.</div>
    <output data-error role="status" hidden style="padding:4px 12px;color:#b42318;font:12px system-ui"></output>
    <div data-preview style="position:relative;flex:1;min-height:0"></div>
  `;
  container.append(root);
  const errorStatus = root.querySelector<HTMLOutputElement>('[data-error]')!;
  const {
    button: toggle,
    setState: setToolState,
    destroy: destroyToolButton
  } = createWebMcpButton(root.querySelector<HTMLElement>('[data-webmcp]')!);
  const sources = new PlaygroundDataSourceManager();
  sources.add({
    dataSourceId: 'points',
    dataSource: {
      data: [
        {position: [-40, -20], label: 'West'},
        {position: [0, 20], label: 'Center'},
        {position: [40, -20], label: 'East'}
      ]
    }
  });
  const uploads = new UploadedSources(sources);
  const editing = createEditablePlaygroundControls();
  const playground = new DeckPlayground({
    parentElement: root.querySelector<HTMLElement>('[data-preview]')!,
    templates: TEMPLATES,
    registry: createPlaygroundRegistry(editing.constants),
    dataSources: sources,
    panels: [createDataSourcesPanel(uploads)],
    onChange(value) {
      editing.onChange(value);
      errorStatus.hidden = true;
    },
    onError(error) {
      editing.suspend();
      errorStatus.textContent = error.message.slice(0, 300);
      errorStatus.hidden = false;
    }
  });
  editing.connect(playground);
  let active = true;
  let unregister: (() => void) | null = null;
  toggle.onclick = async () => {
    if (toggle.getAttribute('aria-disabled') === 'true') return;
    if (unregister) {
      unregister();
      unregister = null;
      setToolState('disabled');
      return;
    }
    setToolState('initializing');
    try {
      unregister = await playground.registerWebMCP({
        templates: TOOL_TEMPLATES,
        dataSources: {manager: sources, read: ['points'], write: ['points']}
      });
      if (!active) {
        unregister?.();
        return;
      }
      setToolState(unregister ? 'active' : 'unavailable');
    } catch {
      if (!active) return;
      setToolState('unavailable', 'Browser tools could not connect. Click to retry.');
    }
  };
  if (enableTools) toggle.click();

  return () => {
    active = false;
    destroyToolButton();
    uploads.finalize();
    playground.finalize();
    void sources.finalize();
    root.remove();
  };
}
