// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CustomPanel,
  PanelManager,
  SidebarPanelContainer,
  TabbedPanel,
  TextEditorPanel,
  type Panel
} from '@deck.gl-community/panels';
import {registerPlaygroundTools, type PlaygroundWebMCPOptions} from './playground-webmcp';

let playgroundCount = 0;

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

/** Identity and cancellation scope of one document update. */
export type PlaygroundUpdateContext = {
  /** Selected template key, unchanged while its document is edited. */
  readonly templateId: string;
  /** Snapshot of the selected card's resolved presentation metadata. */
  readonly templateMetadata: Readonly<PlaygroundTemplateMetadata>;
  /** Monotonically increasing update number, local to this playground. */
  readonly revision: number;
  /** Aborted by any newer edit, template selection or finalization. */
  readonly signal: AbortSignal;
};

/** Outcome of the current parse and preview update; not GPU frame completion. */
export type PlaygroundStatus = 'loading' | 'ready' | 'error';

/** Persistent preview lifecycle, shared by all accepted editor updates. */
export type PlaygroundRenderer = {
  /**
   * Updates the preview; resolve only after acceptance and reject invalid input.
   * Check context.signal before committing asynchronous work to the shared preview.
   */
  update: (
    previewElement: HTMLDivElement,
    value: unknown,
    text?: string,
    context?: PlaygroundUpdateContext
  ) => void | Promise<void>;
  /** Releases all renderer resources when the playground unmounts. */
  finalize: () => void;
};

export type PlaygroundProps = {
  /** Element into which the playground UI is mounted. */
  parentElement: HTMLElement;
  /** Named objects or text documents shown in the example card picker. */
  templates: Record<string, PlaygroundTemplate>;
  /** Monaco language identifier; defaults to JSON. Hosts register additional languages. */
  language?: string;
  /** Editor tab and sidebar title; defaults to JSON. */
  editorTitle?: string;
  /** Example picker title; defaults to Examples. */
  examplesTitle?: string;
  /** Preferred sidebar width; defaults to 440 and follows the panel's minimum width. */
  sidebarWidthPx?: number;
  /** Sidebar edge; defaults to left. */
  sidebarSide?: 'left' | 'right';
  /** Extra tabs mounted and cleaned up with the UI; use unique panel IDs. */
  panels?: Panel[];
  /** Card metadata by template name; supplied fields override embedded metadata. */
  templateMetadata?: Record<string, PlaygroundTemplateMetadata>;
  /** Optional template selected on startup; defaults to the first template. */
  initialTemplate?: string;
  /** Optional JSON Schema for diagnostics and completion in JSON mode. */
  jsonSchema?: Record<string, unknown>;
  /** Converts an edited document into the value consumed by the renderer. */
  parse?: (text: string) => unknown;
  /** Observes every explicit template selection, including startup, before parsing. */
  onTemplateChange?: (name: string) => void;
  /** Called after the current parsed document's renderer update succeeds. */
  onChange?: (value: unknown, text: string) => void;
  /** Observes current update outcomes; async updates report loading until settled. */
  onStatusChange?: (status: PlaygroundStatus, context: PlaygroundUpdateContext) => void;
  /** Reports current parse or preview errors, including rejected async updates. */
  onError?: (error: Error) => void;
  /** Persistent renderer. Mutually exclusive with the legacy render callback. */
  renderer?: PlaygroundRenderer;
  /** Renders the current value into the supplied preview element. */
  render?: (previewElement: HTMLElement, value: unknown) => void | (() => void);
};

/**
 * A standalone document editor and application-owned preview surface.
 *
 * The editor is implemented with `TextEditorPanel` and lifecycle is managed
 * by `PanelManager`, so applications can install this package without using
 * React or deck.gl's widget manager.
 */
export class Playground {
  readonly parentElement: HTMLElement;
  readonly previewElement: HTMLDivElement;
  private readonly panelManager: PanelManager;
  private readonly editorId = `playground-editor-${++playgroundCount}`;
  private activeSidebarPanelId = this.editorId;
  private readonly props: PlaygroundProps;
  private templates: Record<string, PlaygroundTemplate>;
  private currentTemplate: string;
  private editorPanel?: TextEditorPanel;
  private sidebarContainer?: SidebarPanelContainer;
  private pickerPanel?: CustomPanel;
  private pickerElement?: HTMLElement;
  private previewCleanup?: () => void;
  private readonly resizeObserver: ResizeObserver;
  private finalized = false;
  private readonly toolLifetime = new AbortController();
  private updateRevision = 0;
  private updateController?: AbortController;

  constructor(props: PlaygroundProps) {
    if (props.renderer && props.render) {
      throw new Error('Supply either renderer or render, not both');
    }
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
    this.previewElement = this.parentElement.ownerDocument.createElement('div');
    this.previewElement.className = 'deckgl-playground-preview';
    const panelRoot = this.parentElement.ownerDocument.createElement('div');
    panelRoot.className = 'deckgl-playground-panels';
    this.parentElement.append(this.previewElement, panelRoot);
    this.panelManager = new PanelManager({parentElement: panelRoot});
    this.pickerPanel = new CustomPanel({
      id: 'playground-example-picker',
      title: props.examplesTitle ?? 'Examples',
      className: 'deckgl-playground-template-picker-panel',
      onRenderHTML: this.renderPicker
    });
    this.sidebarContainer = new SidebarPanelContainer({
      id: 'playground-json-sidebar',
      className: 'deckgl-playground-sidebar',
      title: props.editorTitle ?? 'JSON',
      side: props.sidebarSide ?? 'left',
      widthPx: props.sidebarWidthPx ?? 440,
      placement: props.sidebarSide === 'right' ? 'top-right' : 'top-left',
      triggerLabel: `${props.editorTitle ?? 'JSON'} editor`,
      triggerIcon: '{}',
      button: true,
      defaultOpen: true,
      dockTriggerWhenOpen: false
    });
    this.panelManager.setProps({components: [this.sidebarContainer]});
    this.resizeObserver = new ResizeObserver(this.handleEditorResize);
    this.resizeObserver.observe(this.parentElement);
    try {
      this.setTemplate(this.currentTemplate);
    } catch (error) {
      this.finalize();
      throw error;
    }
  }

  /** Selects a named document and updates the editor and preview. */
  setTemplate(name: string): void {
    this.assertActive();
    const template = this.templates[name];
    if (!Object.hasOwn(this.templates, name) || template === undefined) {
      throw new Error(`Unknown playground template: ${name}`);
    }
    this.currentTemplate = name;
    this.renderPickerCards();
    const document = getTemplateDocument(template);
    this.updateEditor(
      typeof document === 'string' ? document : JSON.stringify(document, null, 2),
      true
    );
  }

  /** Replaces the current document text. */
  setText(text: string): void {
    this.assertActive();
    this.updateEditor(text);
  }

  /** Mounts controlled editor text and processes its matching selection scope. */
  private updateEditor(text: string, templateSelected = false): void {
    const editorPanel = new TextEditorPanel({
      id: this.editorId,
      title: this.props.editorTitle ?? 'JSON',
      value: text,
      onValueChange: this.handleTextChange,
      language: this.props.language ?? 'json',
      jsonSchema: (this.props.language ?? 'json') === 'json' ? this.props.jsonSchema : undefined,
      theme: 'invert'
    });
    editorPanel.placement = 'fill';
    this.editorPanel = editorPanel;
    this.sidebarContainer?.setProps({panel: this.createTabbedPanel(editorPanel)});
    this.handleEditorResize();
    this.handleTextChange(text, templateSelected);
  }

  private createTabbedPanel(editorPanel: TextEditorPanel): TabbedPanel {
    return new TabbedPanel({
      id: 'playground-sidebar-tabs',
      title: 'Playground',
      panels: [editorPanel, this.pickerPanel!, ...(this.props.panels ?? [])],
      tabListLayout: 'scroll',
      activePanelId: this.activeSidebarPanelId,
      onActivePanelIdChange: activePanelId => {
        if (!activePanelId || activePanelId === this.activeSidebarPanelId) {
          return;
        }
        this.activeSidebarPanelId = activePanelId;
        const currentEditorPanel = this.editorPanel;
        if (currentEditorPanel) {
          this.sidebarContainer?.setProps({panel: this.createTabbedPanel(currentEditorPanel)});
        }
      }
    });
  }

  /** Updates the available documents while retaining the current selection when possible. */
  setTemplates(templates: Record<string, PlaygroundTemplate>): void {
    this.assertActive();
    const nextTemplate =
      templates[this.currentTemplate] !== undefined
        ? this.currentTemplate
        : Object.keys(templates)[0];
    if (!nextTemplate) {
      throw new Error('Playground requires at least one template');
    }
    this.templates = templates;
    this.setTemplate(nextTemplate);
  }

  /**
   * Exposes approved templates, optional source grants and camera reset through WebMCP.
   * Returns an unregister function, or null when the browser API is unavailable.
   * Registration is opt-in and also ends when this playground is finalized.
   * Exposed templates, renderers and callbacks must be trusted by the application.
   */
  async registerWebMCP(options: PlaygroundWebMCPOptions): Promise<(() => void) | null> {
    this.assertActive();
    for (const name of options.templates) {
      if (!Object.hasOwn(this.templates, name)) {
        throw new Error('WebMCP templates must exist in the playground');
      }
    }
    return registerPlaygroundTools(this, options, this.toolLifetime.signal);
  }

  /** Unmounts the editor and removes all playground-owned DOM. */
  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    this.updateController?.abort();
    this.toolLifetime.abort();
    this.resizeObserver.disconnect();
    try {
      this.previewCleanup?.();
      this.props.renderer?.finalize();
    } finally {
      try {
        this.panelManager.finalize();
      } finally {
        this.parentElement.replaceChildren();
        this.parentElement.classList.remove('deckgl-playground');
      }
    }
  }

  /** Throws when a caller attempts to reuse an unmounted playground. */
  protected assertActive(): void {
    if (this.finalized) throw new Error('Playground has been finalized');
  }

  private readonly renderPicker = (rootElement: HTMLElement) => {
    this.pickerElement = rootElement;
    this.renderPickerCards();
    rootElement.addEventListener('click', this.handleTemplateClick);
    return () => {
      rootElement.removeEventListener('click', this.handleTemplateClick);
      if (this.pickerElement === rootElement) {
        this.pickerElement = undefined;
      }
    };
  };

  private readonly handleTemplateClick = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-template]');
    if (card?.dataset.template) {
      this.setTemplate(card.dataset.template);
    }
  };

  private renderPickerCards(): void {
    const rootElement = this.pickerElement;
    if (!rootElement) {
      return;
    }
    const document = this.parentElement.ownerDocument;
    rootElement.replaceChildren();
    rootElement.setAttribute('role', 'listbox');
    rootElement.setAttribute('aria-label', this.props.examplesTitle ?? 'Examples');
    for (const [name, template] of Object.entries(this.templates)) {
      const metadata = this.getTemplateMetadata(name, template);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'deckgl-playground-template-card';
      card.dataset.template = name;
      card.setAttribute('role', 'option');
      card.setAttribute('aria-selected', String(name === this.currentTemplate));
      if (metadata.screencap) {
        card.classList.add('has-screencap');
        card.style.backgroundImage = `linear-gradient(180deg, rgba(9,16,29,0.05), rgba(9,16,29,0.8)), url(${JSON.stringify(metadata.screencap)})`;
      }
      const title = document.createElement('strong');
      title.textContent = metadata.title ?? name;
      const description = document.createElement('span');
      description.textContent = metadata.description ?? '';
      card.append(title, description);
      rootElement.append(card);
    }
  }

  private readonly handleEditorResize = () => {
    this.sidebarContainer?.setProps({
      widthPx: Math.min(this.props.sidebarWidthPx ?? 440, this.parentElement.clientWidth * 0.8)
    });
    this.panelManager.onRedraw({
      viewports: [
        {
          id: 'root',
          x: 0,
          y: 0,
          width: this.parentElement.clientWidth,
          height: this.parentElement.clientHeight
        }
      ],
      layers: []
    });
  };

  /** Resolves card metadata without injecting it into the edited document. */
  private getTemplateMetadata(
    name: string,
    template: PlaygroundTemplate
  ): PlaygroundTemplateMetadata {
    return {...getTemplateMetadata(name, template), ...this.props.templateMetadata?.[name]};
  }

  /** Only the newest mounted update may notify observers or change busy state. */
  private isCurrentUpdate(context: PlaygroundUpdateContext): boolean {
    return !this.finalized && !context.signal.aborted && context.revision === this.updateRevision;
  }

  /** Publishes one current outcome and accessible preview loading state. */
  private updateStatus(status: PlaygroundStatus, context: PlaygroundUpdateContext): void {
    if (!this.isCurrentUpdate(context)) return;
    this.previewElement.setAttribute('aria-busy', String(status === 'loading'));
    this.props.onStatusChange?.(status, context);
  }

  /** Reports a current failure without clearing the persistent preview. */
  private reportUpdateError(error: unknown, context: PlaygroundUpdateContext): void {
    if (!this.isCurrentUpdate(context)) return;
    this.updateStatus('error', context);
    if (this.isCurrentUpdate(context)) {
      this.props.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Notifies acceptance only after the current renderer has finished its update. */
  private completeUpdate(value: unknown, text: string, context: PlaygroundUpdateContext): void {
    if (!this.isCurrentUpdate(context)) return;
    this.updateStatus('ready', context);
    if (this.isCurrentUpdate(context)) this.props.onChange?.(value, text);
  }

  private readonly handleTextChange = (text: string, templateSelected = false) => {
    if (this.finalized) return;
    const previousController = this.updateController;
    const controller = new AbortController();
    this.updateController = controller;
    const context: PlaygroundUpdateContext = {
      templateId: this.currentTemplate,
      templateMetadata: this.getTemplateMetadata(
        this.currentTemplate,
        this.templates[this.currentTemplate]
      ),
      revision: ++this.updateRevision,
      signal: controller.signal
    };
    // Install the new revision first: an abort listener can synchronously start another edit.
    previousController?.abort();
    if (!this.isCurrentUpdate(context)) return;
    let value: unknown;
    let updating: void | Promise<void>;
    try {
      if (templateSelected) this.props.onTemplateChange?.(context.templateId);
      if (!this.isCurrentUpdate(context)) return;
      value = this.props.parse ? this.props.parse(text) : JSON.parse(text);
      if (!this.isCurrentUpdate(context)) return;
      if (this.props.renderer) {
        updating = this.props.renderer.update(this.previewElement, value, text, context);
      } else {
        const cleanup = this.previewCleanup;
        this.previewCleanup = undefined;
        cleanup?.();
        this.previewElement.replaceChildren();
        this.previewCleanup = this.props.render?.(this.previewElement, value) || undefined;
      }
    } catch (error) {
      this.reportUpdateError(error, context);
      return;
    }
    if (updating && typeof updating.then === 'function') {
      // Attach both handlers even when update() synchronously superseded this revision.
      void Promise.resolve(updating).then(
        () => {
          try {
            this.completeUpdate(value, text, context);
          } catch (error) {
            this.reportUpdateError(error, context);
          }
        },
        error => this.reportUpdateError(error, context)
      );
      this.updateStatus('loading', context);
    } else {
      this.completeUpdate(value, text, context);
    }
  };
}

function ensurePlaygroundStyles(document: Document): void {
  if (document.getElementById('deckgl-playground-styles')) {
    return;
  }
  const style = document.createElement('style');
  style.id = 'deckgl-playground-styles';
  style.textContent = `
    .deckgl-playground { position: relative; width: 100%; height: 100%; overflow: hidden; }
    .deckgl-playground-panels { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
    .deckgl-playground-sidebar { --menu-background: #f8fafc; --menu-weak-background: #eef2f7; --menu-text: #172033; --menu-border: 1px solid #d8e0ea; --menu-shadow: -12px 0 36px rgba(15, 23, 42, 0.18); --button-background: #fff; --button-text: #172033; --button-icon-idle: #526174; --button-icon-hover: #172033; --button-inner-stroke: 1px solid #d8e0ea; --button-corner-radius: 10px; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .deckgl-playground-sidebar [data-panel-tabs] { padding: 8px 10px 0 !important; }
    .deckgl-playground-template-picker-panel { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; padding: 4px; }
    .deckgl-playground-template-card { display: flex; min-height: 88px; flex-direction: column; justify-content: flex-end; gap: 4px; padding: 10px; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff center / cover no-repeat; color: #172033; text-align: left; cursor: pointer; }
    .deckgl-playground-template-card:hover, .deckgl-playground-template-card[aria-selected="true"] { border-color: #2878d8; box-shadow: 0 0 0 2px rgba(40,120,216,0.2); }
    .deckgl-playground-template-card span { font-size: 11px; line-height: 1.3; opacity: 0.78; }
    .deckgl-playground-template-card.has-screencap { color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.9); }
    .deckgl-playground-preview { position: relative; width: 100%; height: 100%; }
  `;
  document.head.append(style);
}

function getTemplateMetadata(
  name: string,
  template: PlaygroundTemplate
): PlaygroundTemplateMetadata {
  if (typeof template === 'string') {
    try {
      template = JSON.parse(template);
    } catch {
      return {title: name};
    }
  }
  if (typeof template === 'object' && template) {
    const metadata = (template as TemplateWithMetadata).metadata;
    return {
      ...metadata,
      title: typeof template.name === 'string' ? template.name : (metadata?.title ?? name),
      description:
        typeof template.description === 'string' ? template.description : metadata?.description
    };
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
