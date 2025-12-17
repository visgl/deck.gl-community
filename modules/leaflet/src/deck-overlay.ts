// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as L from 'leaflet';
import type {Deck, DeckProps} from '@deck.gl/core';
import {createDeckInstance, updateDeckView} from './deck-utils';
import type {ViewOrViews} from './deck-utils';

export class DeckOverlay extends L.Layer {
  props: DeckProps<ViewOrViews>;
  _container: HTMLDivElement | undefined = undefined;
  _deck: Deck<ViewOrViews> | undefined = undefined;
  _animate: boolean | undefined = undefined;

  constructor(props: DeckProps<ViewOrViews>) {
    super();

    this.props = props;
  }

  onAdd(): this {
    const pane = this.getPane();
    if (!pane) {
      return this;
    }

    this._container = L.DomUtil.create('div');
    this._container.className = 'leaflet-layer';
    if (this.#getZoomAnimated()) {
      L.DomUtil.addClass(this._container, 'leaflet-zoom-animated');
    }

    pane.appendChild(this._container);
    this._deck = createDeckInstance(this._map, this._container, this._deck, this.props);
    this.#update();

    return this;
  }

  onRemove(_map: L.Map): this {
    if (!this._container || !this._deck) {
      return this;
    }

    L.DomUtil.remove(this._container);
    this._container = undefined;

    this._deck.finalize();
    this._deck = undefined;

    return this;
  }

  getEvents(): {[name: string]: L.LeafletEventHandlerFn} {
    return {
      viewreset: this.#reset.bind(this),
      movestart: this.#onMoveStart.bind(this),
      moveend: this.#onMoveEnd.bind(this),
      zoomstart: this.#onZoomStart.bind(this),
      zoom: this.#onZoom.bind(this),
      zoomend: this.#onZoomEnd.bind(this),
      ...(this.#getZoomAnimated()
        ? {zoomanim: this.#onAnimZoom.bind(this) as L.LeafletEventHandlerFn}
        : {})
    };
  }

  setProps(props: DeckProps): void {
    Object.assign(this.props, props);

    if (this._deck) {
      this._deck.setProps(props);
    }
  }

  pickObject(opts: Parameters<Deck['pickObject']>[0]): ReturnType<Deck['pickObject']> {
    if (!this._deck) {
      return null;
    }

    return this._deck.pickObject(opts);
  }

  pickMultipleObjects(
    opts: Parameters<Deck['pickMultipleObjects']>[0]
  ): ReturnType<Deck['pickMultipleObjects']> {
    if (!this._deck) {
      return [];
    }

    return this._deck.pickMultipleObjects(opts);
  }

  pickObjects(opts: Parameters<Deck['pickObjects']>[0]): ReturnType<Deck['pickObjects']> {
    if (!this._deck) {
      return [];
    }

    return this._deck.pickObjects(opts);
  }

  #getMap(): L.Map & {_animatingZoom: boolean; _getMapPanePos: () => L.Point} {
    return (this as any)._map;
  }

  #getZoomAnimated(): boolean {
    return (this as any)._zoomAnimated;
  }

  #update(): void {
    if (!this._container || !this._deck) {
      return;
    }
    if (this.#getMap()._animatingZoom) {
      return;
    }

    const size = this.#getMap().getSize();
    this._container.style.width = `${size.x}px`;
    this._container.style.height = `${size.y}px`;

    // invert map position
    const offset = this.#getMap()._getMapPanePos().multiplyBy(-1);
    L.DomUtil.setPosition(this._container, offset);

    updateDeckView(this._deck, this._map);
  }

  #pauseAnimation(): void {
    if (!this._deck) {
      return;
    }

    if (this._deck.props._animate) {
      this._animate = this._deck.props._animate;
      this._deck.setProps({_animate: false});
    }
  }

  #unpauseAnimation(): void {
    if (!this._deck) {
      return;
    }

    if (this._animate) {
      this._deck.setProps({_animate: this._animate});
      this._animate = undefined;
    }
  }

  #reset(): void {
    this.#updateTransform(this.#getMap().getCenter(), this.#getMap().getZoom());
    this.#update();
  }

  #onMoveStart(): void {
    this.#pauseAnimation();
  }

  #onMoveEnd(): void {
    this.#update();
    this.#unpauseAnimation();
  }

  #onZoomStart(): void {
    this.#pauseAnimation();
  }

  #onAnimZoom(event: L.ZoomAnimEvent): void {
    this.#updateTransform(event.center, event.zoom);
  }

  #onZoom(): void {
    this.#updateTransform(this.#getMap().getCenter(), this.#getMap().getZoom());
  }

  #onZoomEnd(): void {
    this.#unpauseAnimation();
  }

  /**
   * see https://stackoverflow.com/a/67107000/1823988
   * see L.Renderer._updateTransform https://github.com/Leaflet/Leaflet/blob/master/src/layer/vector/Renderer.js#L90-L105
   */
  #updateTransform(center: L.LatLng, zoom: number): void {
    if (!this._container) {
      return;
    }

    const scale = this.#getMap().getZoomScale(zoom, this.#getMap().getZoom());
    const position = L.DomUtil.getPosition(this._container);
    const viewHalf = this.#getMap().getSize().multiplyBy(0.5);
    const currentCenterPoint = this.#getMap().project(this.#getMap().getCenter(), zoom);
    const destCenterPoint = this.#getMap().project(center, zoom);
    const centerOffset = destCenterPoint.subtract(currentCenterPoint);
    const topLeftOffset = viewHalf
      .multiplyBy(-scale)
      .add(position)
      .add(viewHalf)
      .subtract(centerOffset);

    if (L.Browser.any3d) {
      L.DomUtil.setTransform(this._container, topLeftOffset, scale);
    } else {
      L.DomUtil.setPosition(this._container, topLeftOffset);
    }
  }
}
