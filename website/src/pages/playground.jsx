import React, {useEffect, useRef, useState} from 'react';
import Head from '@docusaurus/Head';
import {deferImperativeCleanup} from '../components/imperative-cleanup';

export default function PlaygroundPage() {
  const hostRef = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let disposed = false;
    let cleanup;

    import('../../../examples/playground/standalone')
      .then(({mountStandalonePlayground}) => {
        if (disposed || !hostRef.current) return;
        const nextCleanup = mountStandalonePlayground(hostRef.current);
        if (disposed) {
          deferImperativeCleanup(nextCleanup);
          return;
        }
        cleanup = nextCleanup;
        setStatus('ready');
      })
      .catch(() => {
        if (!disposed) setStatus('error');
      });

    return () => {
      disposed = true;
      deferImperativeCleanup(cleanup);
    };
  }, []);

  return (
    <>
      <Head>
        <title>Playground | deck.gl-community</title>
        <meta
          name="description"
          content="Edit deck.gl JSON, preview layers, and work with page-local sources through browser tools."
        />
      </Head>
      <main
        aria-label="deck.gl Playground"
        style={{position: 'fixed', inset: 0, overflow: 'hidden'}}
      >
        <div ref={hostRef} style={{width: '100%', height: '100%'}} />
        {status !== 'ready' && (
          <div
            role={status === 'error' ? 'alert' : 'status'}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              padding: 24
            }}
          >
            {status === 'error'
              ? 'The playground could not be loaded. Reload this page to try again.'
              : 'Loading playground…'}
          </div>
        )}
      </main>
    </>
  );
}
