import React, {useEffect, useRef} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import makeExample from './make-example';

const HOST_STYLE = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%'
};

function ImperativeExampleHost({mount, mountLabel, ...mountProps}) {
  const hostRef = useRef(null);
  const initialPropsRef = useRef(mountProps);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    let cleanup;
    let isDisposed = false;

    Promise.resolve(mount(hostElement, initialPropsRef.current))
      .then((nextCleanup) => {
        if (typeof nextCleanup !== 'function') {
          return;
        }
        if (isDisposed) {
          nextCleanup();
          return;
        }
        cleanup = nextCleanup;
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.error(`Failed to mount ${mountLabel}`, error);
      });

    return () => {
      isDisposed = true;
      cleanup?.();
    };
  }, [mount, mountLabel]);

  return <div ref={hostRef} style={HOST_STYLE} />;
}

export default function makeImperativeExample(
  {title, code, renderInfo = () => null, mount, parameters, mapStyle, data},
  options,
) {
  function ImperativeDemo(props) {
    return (
      <BrowserOnly>
        {() => <ImperativeExampleHost mount={mount} mountLabel={title} {...props} />}
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
