import type {PanelDockSide} from './panel-container-state';

/** Internal DOM layout; never changes the application's outer parent styles. */
export class PanelLayout {
  readonly root: HTMLDivElement;
  readonly center: HTMLDivElement;
  readonly edges: Record<PanelDockSide, HTMLDivElement>;
  private readonly marker: Comment;
  private readonly originalStyles: Map<string, {value: string; priority: string}>;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly parent: HTMLElement,
    private readonly content: HTMLElement,
    onResize: () => void
  ) {
    const document = parent.ownerDocument;
    this.marker = document.createComment('panel-content');
    content.before(this.marker);
    this.root = document.createElement('div');
    this.root.className = 'deck-panel-layout';
    this.center = document.createElement('div');
    this.center.className = 'deck-panel-layout-center';
    this.edges = {} as Record<PanelDockSide, HTMLDivElement>;
    for (const side of ['top', 'left', 'right', 'bottom'] as const) {
      const edge = document.createElement('div');
      edge.className = 'deck-panel-layout-edge';
      edge.dataset.side = side;
      this.edges[side] = edge;
      this.root.append(edge);
    }
    this.root.append(this.center);
    this.marker.after(this.root);
    this.center.append(content);
    this.originalStyles = new Map();
    for (const [key, value] of Object.entries({
      position: 'absolute',
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px',
      width: '100%',
      height: '100%',
      'min-width': '0px',
      'min-height': '0px',
      'margin-top': '0px',
      'margin-right': '0px',
      'margin-bottom': '0px',
      'margin-left': '0px',
      'box-sizing': 'border-box'
    })) {
      this.originalStyles.set(key, {
        value: content.style.getPropertyValue(key),
        priority: content.style.getPropertyPriority(key)
      });
      content.style.setProperty(key, value);
    }
    this.observer = new ResizeObserver(onResize);
    this.observer.observe(this.root);
    this.observer.observe(this.center);
  }

  /** Clamp edge thicknesses without imposing a canvas size or changing outer layout. */
  updateLimits(): void {
    const {width, height} = this.root.getBoundingClientRect();
    for (const side of ['top', 'left', 'right', 'bottom'] as const) {
      const horizontal = side === 'left' || side === 'right';
      for (const child of this.edges[side].children) {
        const style = (child as HTMLElement).style;
        style.maxWidth = horizontal ? `${width * 0.45}px` : '';
        style.maxHeight = horizontal ? '' : `${height * 0.45}px`;
      }
    }
  }

  finalize(): void {
    this.observer.disconnect();
    if (this.marker.parentNode) this.marker.before(this.content);
    else this.parent.append(this.content);
    for (const [key, {value, priority}] of this.originalStyles) {
      if (value) this.content.style.setProperty(key, value, priority);
      else this.content.style.removeProperty(key);
    }
    this.root.remove();
    this.marker.remove();
  }
}
