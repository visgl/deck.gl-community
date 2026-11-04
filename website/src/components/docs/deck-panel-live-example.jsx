import React, {useEffect, useRef} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {mountDeckPanelExample} from '../../../../examples/widgets/deck-panel/app';
import {deferImperativeCleanup} from '../imperative-cleanup';

const STYLE = {height: 600, width: '100%', position: 'relative', borderRadius: 10,
  overflow: 'hidden', marginBottom: '2rem'};

function DeckPanelExampleHost() {
  const host = useRef(null);
  useEffect(() => {
    const cleanup = mountDeckPanelExample(host.current);
    return () => deferImperativeCleanup(cleanup);
  }, []);
  return <div ref={host} style={STYLE} />;
}

export default function DeckPanelLiveExample() {
  return <BrowserOnly fallback={<div style={STYLE} />}>{() => <DeckPanelExampleHost />}</BrowserOnly>;
}
