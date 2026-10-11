import {useEffect, useRef, useState} from 'react';

export function App() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let finalize: (() => void) | undefined;
    import('../../../../modules/vega/demo/example')
      .then(({createExample}) => {
        if (!disposed) finalize = createExample(host.current).finalize;
      })
      .catch(reason => setError(String(reason)));
    return () => {
      disposed = true;
      finalize?.();
    };
  }, []);
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <div ref={host} style={{minHeight: 468}} />
    </div>
  );
}
