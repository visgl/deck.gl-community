// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelManager, TextEditorPanel} from '@deck.gl-community/panels';

export type PlaygroundTemplate = Record<string, unknown> | string;

export type PlaygroundProps = {
  /** Element into which the playground UI is mounted. */
  parentElement: HTMLElement;
  /** Named JSON documents shown in the template selector. */
  templates: Record<string, PlaygroundTemplate>;
  /** Optional template selected on startup; defaults to the first template. */
  initialTemplate?: string;
  /** Optional JSON Schema passed to Monaco for diagnostics and completion. */
  jsonSchema?: Record<string, unknown>;
  /** Converts an edited document into the value consumed by the renderer. */
  parse?: (text: string) => unknown;
  /** Called whenever the current document changes. */
  onChange?: (value: unknown, text: string) => void;
  /** Renders the current value into the supplied preview element. */
  render?: (previewElement: HTMLElement, value: unknown) => void | (() => void);
};

/**
 * A standalone JSON editor and preview surface for deck.gl applications.
 *
 * The editor is implemented with `TextEditorPanel` and lifecycle is managed
 * by `PanelManager`, so applications can install this package without using
 * React or deck.gl's widget manager.
 */
export class Playground {
  readonly parentElement: HTMLElement;
  readonly previewElement: HTMLDivElement;
  private readonly editorElement: HTMLDivElement;
  private readonly selectorElement: HTMLSelectElement;
  private readonly panelManager: PanelManager;
  private readonly props: PlaygroundProps;
  private templates: Record<string, PlaygroundTemplate>;
  private currentTemplate: string;
  private editorPanel?: TextEditorPanel;
  private previewCleanup?: () => void;
  private readonly resizeObserver: ResizeObserver;

  constructor(props: PlaygroundProps) {
    this.props = props;
    this.parentElement = props.parentElement;
    this.templates = props.templates;
    const templateNames = Object.keys(this.templates);
    this.currentTemplate = props.initialTemplate ?? templateNames[0] ?? '';
    if (!this.currentTemplate || this.templates[this.currentTemplate] === undefined) {
      throw new Error('Playground requires at least one template');
    }

    this.parentElement.classList.add('deckgl-playground');
    ensurePlaygroundStyles(this.parentElement.ownerDocument);
    this.parentElement.replaceChildren();
    const editorPane = this.parentElement.ownerDocument.createElement('div');
    editorPane.className = 'deckgl-playground-editor-pane';
    this.editorElement = this.parentElement.ownerDocument.createElement('div');
    this.editorElement.className = 'deckgl-playground-editor';
    this.selectorElement = this.parentElement.ownerDocument.createElement('select');
    this.selectorElement.setAttribute('aria-label', 'JSON template');
    for (const name of templateNames) {
      const option = this.parentElement.ownerDocument.createElement('option');
      option.value = name;
      option.textContent = name;
      this.selectorElement.append(option);
    }
    this.selectorElement.value = this.currentTemplate;
    this.selectorElement.addEventListener('change', this.handleTemplateChange);
    editorPane.append(this.selectorElement, this.editorElement);

    this.previewElement = this.parentElement.ownerDocument.createElement('div');
    this.previewElement.className = 'deckgl-playground-preview';
    this.parentElement.append(editorPane, this.previewElement);
    this.panelManager = new PanelManager({parentElement: this.editorElement});
    this.resizeObserver = new ResizeObserver(this.handleEditorResize);
    this.resizeObserver.observe(this.editorElement);
    this.setTemplate(this.currentTemplate);
  }

  /** Selects a named document and updates the editor and preview. */
  setTemplate(name: string): void {
    const template = this.templates[name];
    if (template === undefined) {
      throw new Error(`Unknown playground template: ${name}`);
    }
    this.currentTemplate = name;
    this.selectorElement.value = name;
    this.setText(typeof template === 'string' ? template : JSON.stringify(template, null, 2));
  }

  /** Replaces the current document text. */
  setText(text: string): void {
    this.editorPanel = new TextEditorPanel({
      id: 'playground-editor',
      title: 'JSON',
      value: text,
      onValueChange: this.handleTextChange,
      language: 'json',
      jsonSchema: this.props.jsonSchema
    });
    this.editorPanel.placement = 'fill';
    this.panelManager.setProps({components: [this.editorPanel]});
    this.handleEditorResize();
    this.handleTextChange(text);
  }

  /** Updates the available documents while retaining the current selection when possible. */
  setTemplates(templates: Record<string, PlaygroundTemplate>): void {
    this.templates = templates;
    this.selectorElement.replaceChildren();
    for (const name of Object.keys(templates)) {
      const option = this.parentElement.ownerDocument.createElement('option');
      option.value = name;
      option.textContent = name;
      this.selectorElement.append(option);
    }
    const nextTemplate =
      templates[this.currentTemplate] !== undefined
        ? this.currentTemplate
        : Object.keys(templates)[0];
    if (!nextTemplate) {
      throw new Error('Playground requires at least one template');
    }
    this.setTemplate(nextTemplate);
  }

  /** Unmounts the editor and removes all playground-owned DOM. */
  finalize(): void {
    this.selectorElement.removeEventListener('change', this.handleTemplateChange);
    this.resizeObserver.disconnect();
    this.previewCleanup?.();
    this.panelManager.finalize();
    this.parentElement.replaceChildren();
    this.parentElement.classList.remove('deckgl-playground');
  }

  private readonly handleTemplateChange = () => this.setTemplate(this.selectorElement.value);

  private readonly handleEditorResize = () => {
    this.panelManager.onRedraw({
      viewports: [
        {
          id: 'root',
          x: 0,
          y: 0,
          width: this.editorElement.clientWidth,
          height: this.editorElement.clientHeight
        }
      ],
      layers: []
    });
  };

  private readonly handleTextChange = (text: string) => {
    let value: unknown;
    try {
      value = this.props.parse ? this.props.parse(text) : JSON.parse(text);
    } catch {
      return;
    }
    this.props.onChange?.(value, text);
    this.previewCleanup?.();
    this.previewElement.replaceChildren();
    this.previewCleanup = this.props.render?.(this.previewElement, value) || undefined;
  };
}

export {PanelManager, TextEditorPanel};
export * from './geojson/index';
export * from './schemas/index';

function ensurePlaygroundStyles(document: Document): void {
  if (document.getElementById('deckgl-playground-styles')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'deckgl-playground-styles';
  style.textContent = `
    .deckgl-playground { display: flex; flex-direction: row; align-items: stretch; width: 100%; height: 100%; overflow: hidden; }
    .deckgl-playground-editor-pane { flex: 0 1 40%; min-width: 240px; display: flex; flex-direction: column; align-items: stretch; }
    .deckgl-playground-editor-pane select { flex: 0 0 34px; box-sizing: border-box; padding: 5px 35px 5px 5px; font-size: 16px; border: 1px solid #ccc; }
    .deckgl-playground-editor { position: relative; flex: 1 1 auto; min-height: 0; }
    .deckgl-playground-preview { position: relative; flex: 1 1 60%; min-width: 0; }
  `;
  document.head.append(style);
}
