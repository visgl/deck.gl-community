import React, {useEffect, useRef} from 'react';
import {FullScreenComponent} from '@deck.gl-community/panels';

/** Shared fullscreen chrome for gallery pages and inline documentation examples. */
export default function FullscreenExample({children, style, className, label = 'Interactive example'}) {
  const host = useRef(null);
  const controls = useRef(null);
  useEffect(() => {
    // A gallery page may itself contain inline examples; show one button for the outer host.
    if (host.current.parentElement?.closest('[data-fullscreen-example]')) return undefined;
    const fullscreen = new FullScreenComponent({
      target: host.current,
      style: {
        right: 'max(12px, env(safe-area-inset-right))',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        zIndex: '1000'
      }
    });
    fullscreen.onRenderHTML(controls.current);
    return () => fullscreen.onRemove();
  }, []);
  return (
    <div ref={host} data-fullscreen-example="" aria-label={label} className={className}
      style={{position: 'relative', background: 'var(--ifm-background-color, #0b1220)', ...style}}>
      {children}
      <div ref={controls} />
    </div>
  );
}
