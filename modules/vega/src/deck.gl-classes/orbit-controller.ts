/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import type {OrbitController} from '@deck.gl/core';
import {base} from '../base';

export interface OrbitControllerClassOptions {
  doubleClickHandler?: (
    e: Parameters<OrbitController['handleEvent']>[0],
    orbitController: OrbitController_Class
  ) => boolean;
}

export function createOrbitControllerClass(
  factoryOptions: OrbitControllerClassOptions
): typeof OrbitController_Class {
  // deck.gl compares controller.constructor with the configured controller class.
  // Returning a factory that constructs a different class resets camera transitions.
  class OrbitControllerInternal extends base.deck.OrbitController {
    public declare invertPan: boolean;
    constructor(props: ConstructorParameters<typeof OrbitController>[0]) {
      super(props);
      this.invertPan = true;
    }

    handleEvent(event: Parameters<OrbitController['handleEvent']>[0]) {
      if (event.type === 'doubletap' && factoryOptions.doubleClickHandler) {
        return factoryOptions.doubleClickHandler(event, this);
      }
      return super.handleEvent(event);
    }
  }

  return OrbitControllerInternal;
}

export declare class OrbitController_Class extends base.deck.OrbitController {}
