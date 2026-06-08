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
  /** Panel-owned component delegated by this deck.gl widget. */
  component: ComponentT;

  /** Placement anchor forwarded from the delegated component. */
  get placement(): WidgetPlacement {
    return this.component.placement;
  }

  /** Root CSS class forwarded from the delegated component. */
  get className(): string {
    return this.component.className;
  }

  /** Creates one deck.gl adapter around a panel-owned component. */
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

  /** Updates widget props and reconciles or swaps the delegated component. */
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

  /** Mounts the delegated component through deck.gl's widget lifecycle. */
  override onAdd(params: {deck: unknown; viewId: string | null}): HTMLDivElement {
    this.deck = params.deck as never;
    this.viewId ??= params.viewId;
    this.#syncComponentHost();
    return this.component._onAdd({
      deck: params.deck,
      viewId: this.viewId ?? null
    });
  }

  /** Renders the delegated component into deck.gl's widget root element. */
  override onRenderHTML(rootElement: HTMLElement): void {
    this.component.rootElement = rootElement as HTMLDivElement;
    this.component.onRenderHTML(rootElement);
  }

  /** Removes the delegated component from deck.gl's widget lifecycle. */
  override onRemove(): void {
    this.component.onRemove();
    this.component.rootElement = undefined;
    this.component.deck = undefined;
    this.component.panelManager = undefined;
  }

  /** Forwards viewport changes to the delegated component. */
  override onViewportChange(viewport: unknown): void {
    this.component.onViewportChange(viewport);
  }

  /** Forwards redraw notifications to the delegated component. */
  override onRedraw(params: {viewports: unknown[]; layers: unknown[]}): void {
    this.component.onRedraw(params);
  }

  /** Forwards hover events to the delegated component. */
  override onHover(info: unknown, event: unknown): void {
    this.component.onHover(info, event);
  }

  /** Forwards click events to the delegated component. */
  override onClick(info: unknown, event: unknown): void {
    this.component.onClick(info, event);
  }

  /** Forwards drag events to the delegated component. */
  override onDrag(info: unknown, event: unknown): void {
    this.component.onDrag(info, event);
  }

  /** Forwards drag-start events to the delegated component. */
  override onDragStart(info: unknown, event: unknown): void {
    this.component.onDragStart(info, event);
  }

  /** Forwards drag-end events to the delegated component. */
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
  /** Creates one deck.gl adapter around a new box panel container. */
  constructor(props: Partial<BoxPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(BoxPanelContainer, props));
  }

  /** Updates the constructed box panel container or swaps an explicit delegate. */
  override setProps(props: NamedPanelWidgetUpdateProps<BoxPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ModalPanelWidget}. */
export type ModalPanelWidgetProps = NamedPanelWidgetProps<ModalPanelContainerProps>;

/**
 * deck.gl adapter that constructs one {@link ModalPanelContainer}.
 *
 * Named modal widgets expose their icon trigger by default, matching the
 * legacy modal widget behavior unless callers own trigger visibility.
 */
export class ModalPanelWidget extends PanelWidget<ModalPanelContainer> {
  /** Creates one deck.gl adapter around a new modal panel container. */
  constructor(props: Partial<ModalPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ModalPanelContainer, getModalPanelWidgetProps(props)));
  }

  /** Updates the constructed modal panel container or swaps an explicit delegate. */
  override setProps(props: NamedPanelWidgetUpdateProps<ModalPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link SidebarPanelWidget}. */
export type SidebarPanelWidgetProps = NamedPanelWidgetProps<SidebarPanelContainerProps>;

/** deck.gl adapter that constructs one {@link SidebarPanelContainer}. */
export class SidebarPanelWidget extends PanelWidget<SidebarPanelContainer> {
  /** Creates one deck.gl adapter around a new sidebar panel container. */
  constructor(props: Partial<SidebarPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(SidebarPanelContainer, props));
  }

  /** Updates the constructed sidebar panel container or swaps an explicit delegate. */
  override setProps(props: NamedPanelWidgetUpdateProps<SidebarPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link FullScreenPanelWidget}. */
export type FullScreenPanelWidgetProps = NamedPanelWidgetProps<FullScreenPanelContainerProps>;

/** deck.gl adapter that constructs one {@link FullScreenPanelContainer}. */
export class FullScreenPanelWidget extends PanelWidget<FullScreenPanelContainer> {
  /** Creates one deck.gl adapter around a new full-screen panel container. */
  constructor(props: Partial<FullScreenPanelWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(FullScreenPanelContainer, props));
  }

  /** Updates the constructed full-screen panel container or swaps an explicit delegate. */
  override setProps(props: NamedPanelWidgetUpdateProps<FullScreenPanelContainer>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ToolbarWidget}. */
export type ToolbarWidgetProps = NamedPanelWidgetProps<ToolbarComponentProps>;

/** deck.gl adapter that constructs one {@link ToolbarComponent}. */
export class ToolbarWidget extends PanelWidget<ToolbarComponent> {
  /** Creates one deck.gl adapter around a new toolbar component. */
  constructor(props: Partial<ToolbarWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ToolbarComponent, props));
  }

  /** Updates the constructed toolbar component or swaps an explicit delegate. */
  override setProps(props: NamedPanelWidgetUpdateProps<ToolbarComponent>): void {
    updateNamedPanelWidget(this, props);
  }
}

/** Props for {@link ToastWidget}. */
export type ToastWidgetProps = NamedPanelWidgetProps<ToastComponentProps>;

/** deck.gl adapter that constructs one {@link ToastComponent}. */
export class ToastWidget extends PanelWidget<ToastComponent> {
  /** Creates one deck.gl adapter around a new toast component. */
  constructor(props: Partial<ToastWidgetProps> = {}) {
    super(createNamedPanelWidgetProps(ToastComponent, props));
  }

  /** Updates the constructed toast component or swaps an explicit delegate. */
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

/** Applies widget-level modal trigger defaults before constructing the panel container. */
function getModalPanelWidgetProps(
  props: Partial<ModalPanelWidgetProps>
): Partial<ModalPanelWidgetProps> {
  if (props.button !== undefined || props.hideTrigger !== undefined) {
    return props;
  }
  return {...props, button: true};
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
