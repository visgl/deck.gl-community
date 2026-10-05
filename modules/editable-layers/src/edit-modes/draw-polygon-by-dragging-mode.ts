// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import throttle from 'lodash.throttle';
import {ClickEvent, StartDraggingEvent, StopDraggingEvent, DraggingEvent, ModeProps} from './types';
import {Polygon, SimpleFeatureCollection} from '../utils/geojson-types';
import {getPickedEditHandle} from './utils';
import {DrawPolygonMode} from './draw-polygon-mode';

type DraggingHandler = ((
  event: DraggingEvent,
  props: ModeProps<SimpleFeatureCollection>
) => void) & {
  cancel?: () => void;
};

function isPrimaryButton(event: StartDraggingEvent): boolean {
  const {button, buttons, which} = event.sourceEvent || {};
  return (
    (button === undefined || button === 0 || button === -1) &&
    (buttons === undefined || buttons === 0 || buttons === 1) &&
    (which === undefined || which === 0 || which === 1)
  );
}

export class DrawPolygonByDraggingMode extends DrawPolygonMode {
  handleDraggingThrottled: DraggingHandler | null | undefined = null;
  isDrawingWithPrimaryButton = false;

  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    // No-op
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    this.handleDraggingThrottled?.cancel?.();
    this.isDrawingWithPrimaryButton = isPrimaryButton(event);
    if (!this.isDrawingWithPrimaryButton) {
      this.handleDraggingThrottled = null;
      return;
    }

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
    if (!this.isDrawingWithPrimaryButton) {
      return;
    }

    this.addClickSequence(event);
    const clickSequence = this.getClickSequence();
    this.handleDraggingThrottled?.cancel?.();

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
    this.isDrawingWithPrimaryButton = false;
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
    if (this.isDrawingWithPrimaryButton && this.handleDraggingThrottled) {
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
      this.isDrawingWithPrimaryButton = false;
      this.handleDraggingThrottled?.cancel?.();
      this.handleDraggingThrottled = null;
      props.onEdit({
        // Because the new drawing feature is dropped, so the data will keep as the same.
        updatedData: props.data,
        editType: 'cancelFeature',
        editContext: {}
      });
    }
  }
}
