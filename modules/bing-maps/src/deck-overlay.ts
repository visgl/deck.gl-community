// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createContainer, createDeckInstance, destroyDeckInstance, getViewState} from './utils';

const HIDE_ALL_LAYERS = () => false;

export default function getDeckOverlay({CustomOverlay, Events, MapTypeId}) {
  class DeckOverlay extends CustomOverlay {
    constructor(props = {}) {
      super();
      this.props = props;
    }

    setProps(props) {
      Object.assign(this.props, props);
      if (this.deck) {
        this.deck.setProps(props);
      }
    }

    pickObject(params) {
      return this.deck && this.deck.pickObject(params);
    }

    pickMultipleObjects(params) {
      return this.deck && this.deck.pickMultipleObjects(params);
    }

    pickObjects(params) {
      return this.deck && this.deck.pickObjects(params);
    }

    finalize() {
      destroyDeckInstance(this.deck, Events);
    }

    // Set up DOM elements, and use setHtmlElement to bind it with the overlay.
    onAdd() {
      this.container = createContainer(this.props.style);
      // Add the container to the overlay
      this.setHtmlElement(this.container);
    }

    // Perform custom operations after adding the overlay to the map.
    onLoad() {
      const map = this.getMap();
      this.deck = createDeckInstance(map, this, this.props, Events);
    }

    // Remove all event handlers from the map.
    onRemove() {
      destroyDeckInstance(this.deck, Events);
      this.deck = null;
    }

    redraw() {
      const map = this.getMap();
      const {deck} = this;
      const mapType = map.getMapTypeId();
      const canSyncWithMap = mapType !== MapTypeId.streetside && mapType !== MapTypeId.birdseye;
      deck.setProps({
        ...getViewState(map),
        layerFilter: canSyncWithMap ? this.props.layerFilter : HIDE_ALL_LAYERS
      });
      // deck.redraw();
    }
  }

  return DeckOverlay;
}
