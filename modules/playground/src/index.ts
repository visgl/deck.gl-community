// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelManager, TextEditorPanel} from '@deck.gl-community/panels';

export type PlaygroundTemplateMetadata = {
  /** Human-readable card title; defaults to the template key. */
  title?: string;
  /** Short explanation shown below the card title. */
  description?: string;
  /** Optional screenshot URL used as the card thumbnail. */
  screencap?: string;
};
export type PlaygroundTemplate = Record<string, unknown> | string;

type TemplateWithMetadata = Record<string, unknown> & {metadata?: PlaygroundTemplateMetadata};

export type PlaygroundProps = {
  /** Element into which the playground UI is mounted. */
  parentElement: HTMLElement;
  /** Named JSON documents shown in the example card picker. */
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
  private readonly selectorElement: HTMLDivElement;
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
    this.selectorElement = this.parentElement.ownerDocument.createElement('div');
    this.selectorElement.className = 'deckgl-playground-template-picker';
    this.selectorElement.setAttribute('role', 'listbox');
    this.selectorElement.setAttribute('aria-label', 'JSON examples');
    this.renderTemplateCards();
    this.selectorElement.addEventListener('click', this.handleTemplateClick);
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
    this.renderTemplateCards();
    const document = getTemplateDocument(template);
    this.setText(typeof document === 'string' ? document : JSON.stringify(document, null, 2));
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
    this.renderTemplateCards();
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
    this.selectorElement.removeEventListener('click', this.handleTemplateClick);
    this.resizeObserver.disconnect();
    this.previewCleanup?.();
    this.panelManager.finalize();
    this.parentElement.replaceChildren();
    this.parentElement.classList.remove('deckgl-playground');
  }

  private readonly handleTemplateClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-template]');
    if (card?.dataset.template) this.setTemplate(card.dataset.template);
  };

  private renderTemplateCards(): void {
    const document = this.parentElement.ownerDocument;
    this.selectorElement.replaceChildren();
    for (const [name, template] of Object.entries(this.templates)) {
      const metadata = getTemplateMetadata(name, template);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'deckgl-playground-template-card';
      card.dataset.template = name;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(name === this.currentTemplate));
      if (metadata.screencap) {
        card.style.backgroundImage = `linear-gradient(180deg, rgba(9,16,29,0.05), rgba(9,16,29,0.8)), url(${JSON.stringify(metadata.screencap)})`;
      }
      const title = document.createElement('strong');
      title.textContent = metadata.title ?? name;
      const description = document.createElement('span');
      description.textContent = metadata.description ?? '';
      card.append(title, description);
      this.selectorElement.append(card);
    }
  }

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
    .deckgl-playground-editor-pane { flex: 0 1 40%; min-width: 240px; display: flex; flex-direction: column; align-items: stretch; gap: 8px; }
    .deckgl-playground-template-picker { flex: 0 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; max-height: 210px; overflow: auto; padding: 8px; background: #f5f7fa; }
    .deckgl-playground-template-card { display: flex; min-height: 88px; flex-direction: column; justify-content: flex-end; gap: 4px; padding: 10px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff center / cover no-repeat; color: #172033; text-align: left; cursor: pointer; }
    .deckgl-playground-template-card:hover, .deckgl-playground-template-card[aria-selected="true"] { border-color: #2878d8; box-shadow: 0 0 0 2px rgba(40,120,216,0.2); }
    .deckgl-playground-template-card span { font-size: 11px; line-height: 1.3; opacity: 0.78; }
    .deckgl-playground-editor { position: relative; flex: 1 1 auto; min-height: 0; }
    .deckgl-playground-preview { position: relative; flex: 1 1 60%; min-width: 0; }
  `;
  document.head.append(style);
}

function getTemplateMetadata(
  name: string,
  template: PlaygroundTemplate
): PlaygroundTemplateMetadata {
  if (typeof template === 'object' && template && 'metadata' in template) {
    return (template as TemplateWithMetadata).metadata ?? {title: name};
  }
  return {title: name};
}

function getTemplateDocument(template: PlaygroundTemplate): PlaygroundTemplate {
  if (typeof template === 'object' && template && 'metadata' in template) {
    const {metadata: _metadata, ...document} = template as TemplateWithMetadata;
    return document;
  }
  return template;
}
