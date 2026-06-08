// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Widget} from '@deck.gl/core';
import {
  BoxPanelContainer,
  FullScreenPanelContainer,
  ModalPanelContainer,
  PanelComponent,
  SidebarPanelContainer,
  ToastComponent,
  ToolbarComponent
} from '@deck.gl-community/panels';

import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {
  BoxPanelContainerProps,
  FullScreenPanelContainerProps,
  ModalPanelContainerProps,
  PanelComponentProps,
  SidebarPanelContainerProps,
  ToastComponentProps,
  ToolbarComponentProps
} from '@deck.gl-community/panels';

type PanelComponentPropsOf<ComponentT extends PanelComponent> =
  ComponentT extends PanelComponent<infer PropsT> ? PropsT : PanelComponentProps;

/** Props accepted by the generic deck.gl adapter for one panel-owned component. */
export type PanelWidgetProps<ComponentT extends PanelComponent = PanelComponent> = WidgetProps & {
  /** Panel-owned component delegated by this deck.gl widget. */
  component: ComponentT;
  /** Optional deck view id used for event forwarding and placement. */
  viewId?: string | null;
};

/**
 * deck.gl widget adapter for one panel-owned component.
 *
 * The component owns its DOM and behavior; this class only forwards deck.gl's
 * widget lifecycle and interaction hooks.
 */
export class PanelWidget<ComponentT extends PanelComponent = PanelComponent> extends Widget<
  PanelWidgetProps<ComponentT>
> {
  component: ComponentT;

  get placement(): WidgetPlacement {
    return this.component.placement;
  }

  get className(): string {
    return this.component.className;
  }

  constructor(props: PanelWidgetProps<ComponentT>) {
    const {component, viewId = component.viewId ?? null, ...widgetProps} = props;
    super({
      ...component.props,
      ...widgetProps,
      component,
      id: component.id,
      viewId
    } as PanelWidgetProps<ComponentT>);
    this.component = component;
    this.viewId = viewId;
    this.#syncComponentHost();
  }

  override setProps(props: Partial<PanelWidgetProps<ComponentT>>): void {
    const nextComponent = props.component;
    if (nextComponent && nextComponent !== this.component) {
      if (
        nextComponent.id === this.component.id &&
        nextComponent.constructor === this.component.constructor
      ) {
        this.component.setProps(nextComponent.props);
      } else {
        this.#swapComponent(nextComponent);
      }
    }
    if (props.viewId !== undefined) {
      this.viewId = props.viewId;
    }
    this.#syncComponentHost();
    super.setProps({
      ...props,
      component: this.component,
      id: this.component.id
    } as Partial<PanelWidgetProps<ComponentT>>);
  }

  override onAdd(params: {deck: unknown; viewId: string | null}): HTMLDivElement {
    this.deck = params.deck as never;
    this.viewId ??= params.viewId;
    this.#syncComponentHost();
    return this.component._onAdd({
      deck: params.deck,
      viewId: this.viewId ?? null
    });
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.component.rootElement = rootElement as HTMLDivElement;
    this.component.onRenderHTML(rootElement);
  }

  override onRemove(): void {
    this.component.onRemove();
    this.component.rootElement = undefined;
    this.component.deck = undefined;
    this.component.panelManager = undefined;
  }

  override onViewportChange(viewport: unknown): void {
    this.component.onViewportChange(viewport);
  }

  override onRedraw(params: {viewports: unknown[]; layers: unknown[]}): void {
    this.component.onRedraw(params);
  }

  override onHover(info: unknown, event: unknown): void {
    this.component.onHover(info, event);
  }

  override onClick(info: unknown, event: unknown): void {
    this.component.onClick(info, event);
  }

  override onDrag(info: unknown, event: unknown): void {
    this.component.onDrag(info, event);
  }

  override onDragStart(info: unknown, event: unknown): void {
    this.component.onDragStart(info, event);
  }

  override onDragEnd(info: unknown, event: unknown): void {
    this.component.onDragEnd(info, event);
  }

  #syncComponentHost(): void {
    this.component.panelManager = this.widgetManager;
    this.component.deck = this.deck;
    this.component.viewId = this.viewId ?? null;
  }

  #swapComponent(nextComponent: ComponentT): void {
    const rootElement = this.rootElement;
    this.component.onRemove();
    this.component.rootElement = undefined;
    this.component.deck = undefined;
    this.component.panelManager = undefined;
    this.component = nextComponent;
    this.#syncComponentHost();
    if (rootElement) {
      this.component.rootElement = rootElement;
      this.component.onAdd({deck: this.deck, viewId: this.viewId ?? null});
      this.component.onRenderHTML(rootElement);
    }
  }
}

type NamedPanelWidgetProps<PropsT extends PanelComponentProps> = PropsT & {
  viewId?: string | null;
};

type NamedPanelWidgetUpdateProps<ComponentT extends PanelComponent> =
  | Partial<NamedPanelWidgetProps<PanelComponentPropsOf<ComponentT>>>
  | Partial<PanelWidgetProps<ComponentT>>;

/** Props for {@link BoxPanelWidget}. */
export type BoxPanelWidgetProps = NamedPanelWidgetProps<BoxPanelContainerProps>;

/** deck.gl adapter that constructs one {@link BoxPanelContainer}. */
export class BoxPanelWidget extends PanelWidget<BoxPanelContainer> {
  constructor(props: Partial<BoxPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(BoxPanelContainer, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<BoxPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ModalPanelWidget}. */
export type ModalPanelWidgetProps = NamedPanelWidgetProps<ModalPanelContainerProps>;

/** deck.gl adapter that constructs one {@link ModalPanelContainer}. */
export class ModalPanelWidget extends PanelWidget<ModalPanelContainer> {
  constructor(props: Partial<ModalPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ModalPanelContainer, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<ModalPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link SidebarPanelWidget}. */
export type SidebarPanelWidgetProps = NamedPanelWidgetProps<SidebarPanelContainerProps>;

/** deck.gl adapter that constructs one {@link SidebarPanelContainer}. */
export class SidebarPanelWidget extends PanelWidget<SidebarPanelContainer> {
  constructor(props: Partial<SidebarPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(SidebarPanelContainer, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<SidebarPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link FullScreenPanelWidget}. */
export type FullScreenPanelWidgetProps = NamedPanelWidgetProps<FullScreenPanelContainerProps>;

/** deck.gl adapter that constructs one {@link FullScreenPanelContainer}. */
export class FullScreenPanelWidget extends PanelWidget<FullScreenPanelContainer> {
  constructor(props: Partial<FullScreenPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(FullScreenPanelContainer, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<FullScreenPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ToolbarWidget}. */
export type ToolbarWidgetProps = NamedPanelWidgetProps<ToolbarComponentProps>;

/** deck.gl adapter that constructs one {@link ToolbarComponent}. */
export class ToolbarWidget extends PanelWidget<ToolbarComponent> {
  constructor(props: Partial<ToolbarWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ToolbarComponent, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<ToolbarComponent>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ToastWidget}. */
export type ToastWidgetProps = NamedPanelWidgetProps<ToastComponentProps>;

/** deck.gl adapter that constructs one {@link ToastComponent}. */
export class ToastWidget extends PanelWidget<ToastComponent> {
  constructor(props: Partial<ToastWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ToastComponent, props));
  }

  override setProps(props: NamedPanelWidgetUpdateProps<ToastComponent>): void {
    updateNamedPanelWidget(this, props);
  }
}

function createNamedPanelWidgetProps<
  PropsT extends PanelComponentProps,
  ComponentT extends PanelComponent<PropsT>
>(
  Component: new (props: Partial<PropsT>) => ComponentT,
  props: Partial<NamedPanelWidgetProps<PropsT>>
): PanelWidgetProps<ComponentT> {
  const {viewId, ...componentProps} = props;
  return {
    component: new Component(componentProps as Partial<PropsT>),
    viewId
  };
}

function updateNamedPanelWidget<ComponentT extends PanelComponent>(
  widget: PanelWidget<ComponentT>,
  props: NamedPanelWidgetUpdateProps<ComponentT>
): void {
  if ('component' in props && props.component) {
    PanelWidget.prototype.setProps.call(widget, props);
    return;
  }
  const {viewId, ...componentProps} = props;
  widget.component.setProps(componentProps as Partial<PanelComponentPropsOf<ComponentT>>);
  PanelWidget.prototype.setProps.call(widget, {
    component: widget.component,
    ...(viewId !== undefined ? {viewId} : {})
  });
}
