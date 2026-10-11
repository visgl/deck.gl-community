/* !
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 */

import {OrbitController} from '@deck.gl/core';
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
  function wrapper(initialProps: any) {
    class OrbitControllerInternal extends base.deck.OrbitController {
      public declare invertPan: boolean;
      public declare dragRotate: boolean;

      constructor(props: any) {
        super(props);
        this.invertPan = true;
      }

      handleEvent(event: Parameters<OrbitController['handleEvent']>[0]) {
        if (event.type === 'doubletap') {
          if (factoryOptions && factoryOptions.doubleClickHandler) {
            return factoryOptions.doubleClickHandler(event, this);
          }
        }
        return super.handleEvent(event);
      }
    }

    const instance = new OrbitControllerInternal(initialProps) as OrbitController;

    return instance;
  }

  return wrapper as any;
}

export declare class OrbitController_Class extends base.deck.OrbitController {}
