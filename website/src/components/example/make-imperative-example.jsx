import React, {useEffect, useRef} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {DeviceManagerController, DeviceTabsWidget} from '@deck.gl-community/widgets';

import {deferImperativeCleanup} from '../imperative-cleanup';
import makeExample from './make-example';
import {mountDeviceManagedExample} from './mount-device-managed-example';

const HOST_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%'
};

function ImperativeExampleHost({mount, mountLabel, deviceTabs, ...mountProps}) {
  const hostRef = useRef(null);
  const initialPropsRef = useRef(mountProps);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    let cleanup;
    let isDisposed = false;
    const animationFrame = window.requestAnimationFrame(() => {
      Promise.resolve()
        .then(() =>
          mountDeviceManagedExample(hostElement, mount, initialPropsRef.current, {
            deviceTabs,
            mountLabel
          })
        )
        .then((nextCleanup) => {
          if (typeof nextCleanup !== 'function') {
            return;
          }
          if (isDisposed || generation !== mountGeneration) {
            deferImperativeCleanup(nextCleanup);
            return;
          }
          cleanup = nextCleanup;
        })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error(`Failed to mount ${mountLabel}`, error);
        });
    };

    const animationFrame = window.requestAnimationFrame(() => {
      if (!deviceTabs) {
        mountExample();
        return;
      }

      manager = new DeviceManagerController();
      unsubscribe = manager.subscribe(({device}) => {
        if (!device || device === activeDevice || isDisposed) {
          return;
        }
        activeDevice = device;
        mountExample(device);
      });
      manager.initialize().catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to initialize ${mountLabel} graphics backend`, error);
        });
    });

    return () => {
      isDisposed = true;
      mountGeneration++;
      window.cancelAnimationFrame(animationFrame);
      unsubscribe?.();
      deferImperativeCleanup(cleanup);
      manager?.reset();
    };
  }, [mount, mountLabel, deviceTabs]);

  return <div ref={hostRef} style={HOST_STYLE} />;
}

export default function makeImperativeExample(
  {title, code, renderInfo = () => null, mount, parameters, mapStyle, data, deviceTabs},
  options
) {
  function ImperativeDemo(props) {
    return (
      <BrowserOnly>
        {() => (
          <ImperativeExampleHost
            mount={mount}
            mountLabel={title}
            deviceTabs={deviceTabs}
            {...props}
          />
        )}
      </BrowserOnly>
    );
  }

  ImperativeDemo.title = title;
  ImperativeDemo.code = code;
  ImperativeDemo.renderInfo = renderInfo;
  ImperativeDemo.parameters = parameters;
  ImperativeDemo.mapStyle = mapStyle;
  ImperativeDemo.data = data;

  return makeExample(ImperativeDemo, options);
}
