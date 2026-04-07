import React, {useEffect, useRef} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

import {mountWidgetPanelsDocsExample} from '../../../../examples/widgets/widget-panels/app';

const WRAPPER_STYLE = {
  position: 'relative',
  width: '100%',
  height: 350,
  minHeight: 350,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--ifm-color-emphasis-300)',
  marginBottom: '2rem'
};

const SIZE_TO_HEIGHT = {
  narrow: 350,
  tall: 560
};

function WidgetPanelsLiveExampleHost({highlight, height}) {
  const hostRef = useRef(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    let cleanup;
    let isDisposed = false;
    const animationFrame = window.requestAnimationFrame(() => {
      cleanup = mountWidgetPanelsDocsExample(hostElement, {highlight});
      if (isDisposed) {
        cleanup();
      }
    });

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(animationFrame);
      cleanup?.();
    };
  }, [highlight]);

  return <div ref={hostRef} style={{...WRAPPER_STYLE, height}} />;
}

export default function WidgetPanelsLiveExample({
  highlight = 'widget-panels',
  size = 'narrow',
  height
}) {
  const resolvedHeight = height ?? SIZE_TO_HEIGHT[size] ?? SIZE_TO_HEIGHT.narrow;

  return (
    <BrowserOnly fallback={<div style={{...WRAPPER_STYLE, height: resolvedHeight}} />}>
      {() => <WidgetPanelsLiveExampleHost highlight={highlight} height={resolvedHeight} />}
    </BrowserOnly>
  );
}
