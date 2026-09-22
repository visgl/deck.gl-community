import 'client-only';
import {createRoot, roots, unmountAtNode} from '../reconciler/index';
import type {ReconcilerRoot} from '../reconciler/index';
import {log} from '../shared/index';
import {hasSameConfigProperties} from '../shared/has-same-config-properties';
import {useEffectEvent} from '../shared/use-effect-event';
import type {DeckglProps, OnDeckglChange} from '../types/index';
import {FiberProvider, useContextBridge} from 'its-fine';
import type {ContextBridge} from 'its-fine';
import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';
import useIsomorphicLayoutEffect from 'use-isomorphic-layout-effect';

function getCanvasParent(value: string | HTMLCanvasElement): HTMLDivElement | undefined {
  if (value instanceof HTMLCanvasElement) {
    return value.parentElement as HTMLDivElement;
  }

  const el = document.querySelector(value);

  if (el instanceof HTMLElement) {
    return el.parentElement as HTMLDivElement;
  }

  return undefined;
}

function DeckGLComponent(props: DeckglProps) {
  const {children, debug, onDeckglChange, ...deckglProps} = props;
  const notifyDeckglChange = useEffectEvent<Parameters<OnDeckglChange>, void>(deckgl => {
    onDeckglChange?.(deckgl);
  });

  const Bridge: ContextBridge = useContextBridge();
  const wrapper = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const interleave = useRef<HTMLDivElement>(null);

  // NOTE: enable/disable logging based on debug prop
  useEffect(() => {
    // oxlint-disable-next-line no-unused-expressions
    debug ? log.enableLogging() : log.disableLogging();
  }, [debug]);

  // Object-rest creates a new config object each render. Preserve the committed
  // config while its values are unchanged so a lifecycle callback replacement is non-reactive.
  const configCache = useRef(deckglProps);
  const config = hasSameConfigProperties(configCache.current, deckglProps)
    ? configCache.current
    : deckglProps;

  useIsomorphicLayoutEffect(() => {
    configCache.current = config;
  });

  useIsomorphicLayoutEffect(() => {
    const actualCanvas = (config.canvas ||
      interleave.current ||
      canvas.current) as HTMLCanvasElement;

    // NOTE: if a canvas is defined through props, leverage that since we don't need to make a canvas ref below
    const actualParent =
      config.parent || (config.canvas ? getCanvasParent(config.canvas) : wrapper.current);

    if (actualCanvas) {
      const root: ReconcilerRoot = roots.get(actualCanvas) ?? createRoot(actualCanvas);
      // NOTE: spread canvas and parent refs here where they are guaranteed to be set
      // Only set canvas/parent if not explicitly provided in props
      root.configure({
        ...config,
        canvas: actualCanvas,
        parent: actualParent
      });
      notifyDeckglChange(root.store.getState().deckgl);
      root.render(<Bridge>{children}</Bridge>);
    }
  }, [children, config, Bridge]);

  useEffect(() => {
    const actualCanvas = (config.canvas ||
      interleave.current ||
      canvas.current) as HTMLCanvasElement;

    if (actualCanvas) {
      return () => {
        notifyDeckglChange(null);
        unmountAtNode(actualCanvas);
      };
    }
  }, [config.canvas]);

  // NOTE: interleaved prop is a hint that we are utilizing an external renderer such as Mapbox/Maplibre
  // so we want to avoid rendering another container / canvas element if that is true.
  if ('interleaved' in props) {
    return <div ref={interleave} id="deckgl-fiber-interleave" hidden />;
  }

  // Prevent creating an orphaned canvas/parent element. This assumes a user already has something in their JSX defined.
  if (props.canvas) {
    return null;
  }

  return (
    <div ref={wrapper} id="deckgl-fiber-wrapper">
      <canvas ref={canvas} id="deckgl-fiber-canvas" />
    </div>
  );
}

export function DeckGL(props: DeckglProps & {children: ReactNode}) {
  return (
    <FiberProvider>
      <DeckGLComponent {...props} />
    </FiberProvider>
  );
}
