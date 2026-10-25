// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import {CustomPanel, TextEditorPanel} from '@deck.gl-community/panels';
import unitLayouts from '../vega/specs/unit-layouts.json';
import barChart from '../vega/specs/bar-chart.json';
import markTransitions from '../vega/mark-transitions/spec.json';
import geospatial from '../vega/geospatial/spec.json';
import mapToStacks from '../vega/map-to-stacks/spec.json';
import type {Spec} from 'vega';
import type {createVegaView} from '../vega/create-vega-view';

let panelCount = 0;

export const VEGA_TEMPLATES = {
  'unit-layouts': {title: 'Unit layouts', spec: unitLayouts},
  'map-to-stacks': {title: 'US map to stacked bars', spec: mapToStacks},
  'bar-chart': {title: 'Bar chart', spec: barChart},
  'mark-transitions': {title: 'Symbols and record transitions', spec: markTransitions},
  geospatial: {title: 'Geospatial projections and symbols', spec: geospatial}
};

/** Page-owned Vega tab. Switching tabs releases its View and restores the deck preview. */
export function createVegaPanel() {
  const editorId = `vega-json-${++panelCount}`;
  let selected = 'unit-layouts';
  let text = JSON.stringify(unitLayouts, null, 2);
  let acceptedText: string | undefined;
  let mountedRoot: HTMLElement | undefined;
  let cleanup: (() => void) | undefined;
  let selectedTab = false;
  const panel = new CustomPanel({
    id: 'vega',
    title: 'Vega',
    onRenderHTML(root) {
      mountedRoot = root;
      if (selectedTab) cleanup = mountEditor(root);
      return () => {
        cleanup?.();
        cleanup = undefined;
        mountedRoot = undefined;
      };
    }
  });
  return {
    panel,
    setActive(active: boolean) {
      if (active === selectedTab) return;
      selectedTab = active;
      cleanup?.();
      cleanup = undefined;
      if (active && mountedRoot) cleanup = mountEditor(mountedRoot);
    }
  };
  function mountEditor(root: HTMLElement) {
    const preview = root
      .closest('.deckgl-playground')!
      .querySelector<HTMLElement>('.deckgl-playground-preview')!;
    const previousIsolation = preview.style.isolation;
    preview.style.isolation = 'isolate';
    const overlay = root.ownerDocument.createElement('div');
    overlay.dataset.vegaPreview = '';
    overlay.style.cssText =
      'position:absolute;inset:0 0 0 var(--deckgl-playground-sidebar-width, min(440px, 80%));background:white;z-index:30';
    preview.append(overlay);
    root.innerHTML = `<label>Vega example <select aria-label="Vega example"></select></label>
        <p>Vega JSON · deck.gl renderer · <a href="https://github.com/microsoft/SandDance" target="_blank" rel="noreferrer">Based on SandDance</a></p>
        <output role="alert" hidden></output><div data-vega-editor></div>`;
    const picker = root.querySelector<HTMLSelectElement>('select')!;
    for (const [key, template] of Object.entries(VEGA_TEMPLATES)) {
      const option = root.ownerDocument.createElement('option');
      option.value = key;
      option.textContent = template.title;
      picker.append(option);
    }
    picker.value = selected;
    const editorHost = root.querySelector<HTMLElement>('[data-vega-editor]')!;
    editorHost.style.cssText = 'height:calc(100vh - 240px);min-height:300px';
    const errorOutput = root.querySelector<HTMLOutputElement>('output')!;
    let active = true;
    let revision = 0;
    let currentHost: HTMLDivElement | undefined;
    let current: ReturnType<typeof createVegaView> | undefined;
    const pending = new Set<ReturnType<typeof createVegaView>>();
    let editor: TextEditorPanel;

    async function updatePreview(nextText: string, restoring = false) {
      if (!restoring) text = nextText;
      const update = restoring ? revision : ++revision;
      let candidate: ReturnType<typeof createVegaView> | undefined;
      let chart: HTMLDivElement | undefined;
      try {
        const spec = JSON.parse(nextText) as Spec;
        const {createVegaView: createView} = await import('../vega/create-vega-view');
        if (!active || (restoring ? Boolean(current) : update !== revision)) return;
        chart = root.ownerDocument.createElement('div');
        chart.style.cssText = 'position:absolute;inset:0;visibility:hidden';
        overlay.append(chart);
        candidate = createView(chart, spec);
        pending.add(candidate);
        await candidate.ready;
        if (!active || (restoring ? Boolean(current) : update !== revision)) {
          candidate.finalize();
          chart.remove();
          return;
        }
        current?.finalize();
        currentHost?.remove();
        current = candidate;
        if (!restoring) acceptedText = nextText;
        currentHost = chart;
        chart.style.visibility = 'visible';
        if (!restoring) errorOutput.hidden = true;
      } catch (error) {
        candidate?.finalize();
        chart?.remove();
        if (active && update === revision) {
          errorOutput.textContent = error instanceof Error ? error.message : String(error);
          errorOutput.hidden = false;
        }
      } finally {
        if (candidate) pending.delete(candidate);
      }
    }
    function renderEditor() {
      editor = new TextEditorPanel({
        id: editorId,
        title: 'Vega JSON',
        value: text,
        language: 'json',
        theme: 'inherit',
        onValueChange: nextText => {
          editor.setProps({value: nextText});
          void updatePreview(nextText);
        }
      });
      editor.onRenderHTML(editorHost);
    }
    picker.onchange = () => {
      selected = picker.value;
      text = JSON.stringify(VEGA_TEMPLATES[selected].spec, null, 2);
      renderEditor();
      void updatePreview(text);
    };
    renderEditor();
    const draft = text;
    if (acceptedText !== undefined && acceptedText !== draft) {
      void updatePreview(acceptedText, true).then(() => {
        if (active && text === draft) void updatePreview(draft);
      });
    } else {
      void updatePreview(draft);
    }
    return () => {
      active = false;
      revision++;
      current?.finalize();
      for (const candidate of pending) candidate.finalize();
      pending.clear();
      render(null, editorHost);
      overlay.remove();
      preview.style.isolation = previousIsolation;
      root.replaceChildren();
    };
  }
}
