import React, {useEffect, useRef} from 'react';
// eslint-disable-next-line import/no-unresolved
import BrowserOnly from '@docusaurus/BrowserOnly';

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

function PanelLiveExampleHost({highlight, height}) {
  const hostRef = useRef(null);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      return undefined;
    }

    let cleanup;
    let isDisposed = false;
    const animationFrame = window.requestAnimationFrame(async () => {
      const {mountPanelDocsExample} = await import(
        '../../../../examples/widgets/panel-docs/app'
      );
      cleanup = mountPanelDocsExample(hostElement, {highlight});
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

export default function PanelLiveExample({highlight = 'widget-panels', size = 'narrow', height}) {
  const resolvedHeight = height ?? SIZE_TO_HEIGHT[size] ?? SIZE_TO_HEIGHT.narrow;

  return (
    <BrowserOnly fallback={<div style={{...WRAPPER_STYLE, height: resolvedHeight}} />}>
      {() => <PanelLiveExampleHost highlight={highlight} height={resolvedHeight} />}
    </BrowserOnly>
  );
}
