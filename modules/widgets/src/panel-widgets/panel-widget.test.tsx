/** @jsxImportSource preact */
import {describe, expect, it, vi} from 'vitest';
import {
  BoxPanelContainer,
  FullScreenPanelContainer,
  ModalPanelContainer,
  PanelComponent,
  SidebarPanelContainer,
  ToastComponent,
  ToolbarComponent
} from '@deck.gl-community/panels';

import {
  BoxPanelWidget,
  FullScreenPanelWidget,
  ModalPanelWidget,
  PanelWidget,
  SidebarPanelWidget,
  ToastWidget,
  ToolbarWidget
} from './panel-widget';

import type {PanelComponentProps, PanelPlacement} from '@deck.gl-community/panels';

type TestComponentProps = PanelComponentProps & {
  text: string;
  placement?: PanelPlacement;
};

class TestComponent extends PanelComponent<TestComponentProps> {
  static defaultProps: Required<TestComponentProps> = {
    ...PanelComponent.defaultProps,
    id: 'test-component',
    text: '',
    placement: 'top-left'
  };

  className = 'deck-widget-test-component';
  placement: PanelPlacement = TestComponent.defaultProps.placement;
  onAddSpy = vi.fn();
  onRemoveSpy = vi.fn();
  onViewportChangeSpy = vi.fn();
  onRedrawSpy = vi.fn();
  onHoverSpy = vi.fn();
  onClickSpy = vi.fn();
  onDragSpy = vi.fn();
  onDragStartSpy = vi.fn();
  onDragEndSpy = vi.fn();

  constructor(props: Partial<TestComponentProps> & Pick<TestComponentProps, 'text'>) {
    super({...TestComponent.defaultProps, ...props});
    this.setProps(this.props);
  }

  override setProps(props: Partial<TestComponentProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onAdd(params: {deck: unknown; viewId: string | null}): void {
    this.onAddSpy(params);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.textContent = this.props.text;
  }

  override onRemove(): void {
    this.onRemoveSpy();
  }

  override onViewportChange(viewport: unknown): void {
    this.onViewportChangeSpy(viewport);
  }

  override onRedraw(params: {viewports: unknown[]; layers: unknown[]}): void {
    this.onRedrawSpy(params);
  }

  override onHover(info: unknown, event: unknown): void {
    this.onHoverSpy(info, event);
  }

  override onClick(info: unknown, event: unknown): void {
    this.onClickSpy(info, event);
  }

  override onDrag(info: unknown, event: unknown): void {
    this.onDragSpy(info, event);
  }

  override onDragStart(info: unknown, event: unknown): void {
    this.onDragStartSpy(info, event);
  }

  override onDragEnd(info: unknown, event: unknown): void {
    this.onDragEndSpy(info, event);
  }
}

class OtherTestComponent extends TestComponent {
  override className = 'deck-widget-other-test-component';
}

describe('PanelWidget', () => {
  it('forwards deck lifecycle, render, redraw, viewport, and pointer hooks', () => {
    const component = new TestComponent({text: 'Panel widget'});
    const widget = new PanelWidget({component});
    const deck = {};
    widget.widgetManager = {} as never;
    widget.deck = deck as never;

    const root = widget.onAdd({deck, viewId: 'main'});
    widget.rootElement = root;
    widget.onRenderHTML(root);
    widget.onViewportChange({id: 'main'});
    widget.onRedraw({viewports: [{id: 'main'}], layers: ['layer']});
    widget.onHover('hover-info', 'hover-event');
    widget.onClick('click-info', 'click-event');
    widget.onDrag('drag-info', 'drag-event');
    widget.onDragStart('drag-start-info', 'drag-start-event');
    widget.onDragEnd('drag-end-info', 'drag-end-event');
    widget.onRemove();

    expect(root.textContent).toBe('Panel widget');
    expect(component.onAddSpy).toHaveBeenCalledWith({deck, viewId: 'main'});
    expect(component.onViewportChangeSpy).toHaveBeenCalledWith({id: 'main'});
    expect(component.onRedrawSpy).toHaveBeenCalledWith({
      viewports: [{id: 'main'}],
      layers: ['layer']
    });
    expect(component.onHoverSpy).toHaveBeenCalledWith('hover-info', 'hover-event');
    expect(component.onClickSpy).toHaveBeenCalledWith('click-info', 'click-event');
    expect(component.onDragSpy).toHaveBeenCalledWith('drag-info', 'drag-event');
    expect(component.onDragStartSpy).toHaveBeenCalledWith('drag-start-info', 'drag-start-event');
    expect(component.onDragEndSpy).toHaveBeenCalledWith('drag-end-info', 'drag-end-event');
    expect(component.onRemoveSpy).toHaveBeenCalledOnce();
  });

  it('updates the mounted component for same-type same-id reconciliation', () => {
    const component = new TestComponent({id: 'summary', text: 'First'});
    const widget = new PanelWidget({component});
    const root = widget.onAdd({deck: {}, viewId: null});
    widget.rootElement = root;
    widget.onRenderHTML(root);

    widget.setProps({component: new TestComponent({id: 'summary', text: 'Second'})});

    expect(widget.component).toBe(component);
    expect(root.textContent).toBe('Second');
  });

  it('swaps delegates when the component type changes', () => {
    const component = new TestComponent({id: 'summary', text: 'First'});
    const widget = new PanelWidget({component});
    const deck = {};
    const root = widget.onAdd({deck, viewId: null});
    widget.rootElement = root;
    widget.onRenderHTML(root);
    const nextComponent = new OtherTestComponent({id: 'summary', text: 'Second'});

    widget.setProps({component: nextComponent});

    expect(component.onRemoveSpy).toHaveBeenCalledOnce();
    expect(nextComponent.onAddSpy).toHaveBeenCalledWith({deck, viewId: null});
    expect(widget.component).toBe(nextComponent);
    expect(root.textContent).toBe('Second');
  });

  it('constructs named adapters from panel-owned components', () => {
    expect(new BoxPanelWidget().component).toBeInstanceOf(BoxPanelContainer);
    expect(new ModalPanelWidget().component).toBeInstanceOf(ModalPanelContainer);
    expect(new SidebarPanelWidget().component).toBeInstanceOf(SidebarPanelContainer);
    expect(new FullScreenPanelWidget().component).toBeInstanceOf(FullScreenPanelContainer);
    expect(new ToolbarWidget().component).toBeInstanceOf(ToolbarComponent);
    expect(new ToastWidget().component).toBeInstanceOf(ToastComponent);
  });

  it('shows modal widget triggers by default and honors explicit trigger hiding', () => {
    const visibleWidget = new ModalPanelWidget({triggerLabel: 'Settings'});
    const visibleRoot = visibleWidget.onAdd({deck: {}, viewId: null});
    visibleWidget.rootElement = visibleRoot;
    visibleWidget.onRenderHTML(visibleRoot);

    const trigger = visibleRoot.querySelector('button[aria-label="Open Settings"]');
    expect(trigger).toBeTruthy();
    expect(trigger?.textContent).not.toContain('Settings');

    const hiddenWidget = new ModalPanelWidget({hideTrigger: true});
    const hiddenRoot = hiddenWidget.onAdd({deck: {}, viewId: null});
    hiddenWidget.rootElement = hiddenRoot;
    hiddenWidget.onRenderHTML(hiddenRoot);

    expect(hiddenRoot.querySelector('.deck-widget-icon-button')).toBeNull();

    visibleWidget.onRemove();
    hiddenWidget.onRemove();
  });
});
