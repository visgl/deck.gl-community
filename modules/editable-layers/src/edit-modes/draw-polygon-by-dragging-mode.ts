// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import throttle from 'lodash.throttle';
import {ClickEvent, StartDraggingEvent, StopDraggingEvent, DraggingEvent, ModeProps} from './types';
import {Polygon} from 'geojson'
import {SimpleFeatureCollection} from '../utils/geojson-types';
import {getPickedEditHandle} from './utils';
import {DrawPolygonMode} from './draw-polygon-mode';

type DraggingHandler = (event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>) => void;

export class DrawPolygonByDraggingMode extends DrawPolygonMode {
  handleDraggingThrottled: DraggingHandler | null | undefined = null;

  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    // No-op
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    event.cancelPan();
    if (props.modeConfig && props.modeConfig.throttleMs) {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      this.handleDraggingThrottled = throttle(this.handleDraggingAux, props.modeConfig.throttleMs);
    } else {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      this.handleDraggingThrottled = this.handleDraggingAux;
    }
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    this.addClickSequence(event);
    const clickSequence = this.getClickSequence();
    // @ts-expect-error cancel() not typed
    if (this.handleDraggingThrottled && this.handleDraggingThrottled.cancel) {
      // @ts-expect-error cancel() not typed
      this.handleDraggingThrottled.cancel();
    }

    if (clickSequence.length > 2) {
      // Complete the polygon.
      const polygonToAdd: Polygon = {
        type: 'Polygon',
        coordinates: [[...clickSequence, clickSequence[0]]]
      };

      const editAction = this.getAddFeatureOrBooleanPolygonAction(polygonToAdd, props);
      if (editAction) {
        props.onEdit(editAction);
      }
    }
    this.resetClickSequence();
  }

  handleDraggingAux(event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const {picks} = event;
    const clickedEditHandle = getPickedEditHandle(picks);

    if (!clickedEditHandle) {
      // Don't add another point right next to an existing one.
      this.addClickSequence(event);
      props.onEdit({
        updatedData: props.data,
        editType: 'addTentativePosition',
        editContext: {
          position: event.mapCoords
        }
      });
    }
  }

  handleDragging(event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    if (this.handleDraggingThrottled) {
      this.handleDraggingThrottled(event, props);
    }
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<SimpleFeatureCollection>) {
    if (event.key === 'Enter') {
      const clickSequence = this.getClickSequence();
      if (clickSequence.length > 2) {
        const polygonToAdd: Polygon = {
          type: 'Polygon',
          coordinates: [[...clickSequence, clickSequence[0]]]
        };
        this.resetClickSequence();

        const editAction = this.getAddFeatureOrBooleanPolygonAction(polygonToAdd, props);
        if (editAction) {
          props.onEdit(editAction);
        }
      }
    } else if (event.key === 'Escape') {
      this.resetClickSequence();
      if (this.handleDraggingThrottled) {
        this.handleDraggingThrottled = null;
      }
      props.onEdit({
        // Because the new drawing feature is dropped, so the data will keep as the same.
        updatedData: props.data,
        editType: 'cancelFeature',
        editContext: {}
      });
    }
  }
}
