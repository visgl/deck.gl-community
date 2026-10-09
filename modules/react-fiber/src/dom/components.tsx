import 'client-only';
import {assert} from '@deck.gl/core';
import {createRoot, unmountAtNode} from '../reconciler/index';
import type {
  DeckglConfiguration,
  ReconcilerRoot,
  RootElement,
  RootOptions
} from '../reconciler/types';
import {log} from '../shared/index';
import type {DeckglRenderer} from '../shared/store';
import {hasSameConfigProperties} from '../shared/has-same-config-properties';
import {useEffectEvent} from '../shared/use-effect-event';
import type {DeckGLRootProps, DeckglInstance, DeckglProps, OnDeckglChange} from '../types/index';
import {FiberProvider, useContextBridge} from 'its-fine';
import type {ContextBridge} from 'its-fine';
import {useEffect, useRef} from 'react';
import type {ReactNode, RefObject} from 'react';
import useIsomorphicLayoutEffect from 'use-isomorphic-layout-effect';

type CanvasSource = string | HTMLCanvasElement;

interface ResolvedCanvas {
  source: CanvasSource;
  element: HTMLCanvasElement;
}

function findCanvasById(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  // Like Deck, a string `canvas` is an element id that must name a mounted <canvas>.
  assert(element instanceof HTMLCanvasElement);
  return element;
}

// Call only from effects. The resolved element is cached per source so the root
// is configured and unmounted with the same registry key.
function getCanvasRoot(
  source: CanvasSource | null | undefined,
  ownCanvas: RefObject<HTMLCanvasElement | null>,
  resolvedCanvas: RefObject<ResolvedCanvas | null>
): HTMLCanvasElement | null {
  if (!source) {
    return ownCanvas.current;
  }
  if (resolvedCanvas.current?.source === source) {
    return resolvedCanvas.current.element;
  }

  const element = typeof source === 'string' ? findCanvasById(source) : source;
  resolvedCanvas.current = {source, element};
  return element;
}

/** Configuration for an externally owned deck.gl overlay root. */
export interface CreateDeckGLOptions<Props, Instance extends DeckglRenderer> {
  /** Creates the one external-overlay instance bound to the returned component. */
  createExternalOverlay: (props: Props) => Instance;
}

type ComponentProps<Props, Instance extends DeckglRenderer> = DeckGLRootProps<Instance, Props> & {
  debug?: boolean;
};

function createDeckGLComponent<Props, Instance extends DeckglRenderer>(
  options?: CreateDeckGLOptions<Props, Instance>
) {
  const overlayFactory = options?.createExternalOverlay;
  const isExternalOverlay = Boolean(overlayFactory);

  // Call only from effects: roots must server-render without touching `document`.
  // Factory scope keeps this non-reactive; the element is a stable registry key held in a ref.
  function getDetachedRoot(
    detachedRoot: RefObject<HTMLDivElement | null>,
    rootOptions: RefObject<RootOptions | undefined>
  ): HTMLDivElement {
    if (!detachedRoot.current) {
      detachedRoot.current = document.createElement('div');
      rootOptions.current = {
        createExternalOverlay: config => overlayFactory?.(config as Props) as DeckglRenderer
      };
    }
    return detachedRoot.current;
  }

  function DeckGLComponent(props: ComponentProps<Props, Instance>) {
    if (!isExternalOverlay && 'interleaved' in props) {
      throw new Error(
        'The default DeckGL root does not support interleaved rendering. ' +
          'Import /mapbox or /maplibre, or create a custom overlay root with createDeckGL.'
      );
    }

    const {children, debug, onDeckglChange, ...deckglProps} = props;
    const notifyDeckglChange = useEffectEvent<Parameters<OnDeckglChange<Instance>>, void>(
      deckgl => {
        onDeckglChange?.(deckgl);
      }
    );

    const Bridge: ContextBridge = useContextBridge();
    const wrapper = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const detachedRoot = useRef<HTMLDivElement | null>(null);
    const rootOptions = useRef<RootOptions | undefined>(undefined);
    const resolvedCanvas = useRef<ResolvedCanvas | null>(null);

    // NOTE: enable/disable logging based on debug prop
    useEffect(() => {
      // oxlint-disable-next-line no-unused-expressions
      debug ? log.enableLogging() : log.disableLogging();
    }, [debug]);

    // Object-rest creates a new config object each render. Preserve the committed
    // config while its values are unchanged so a lifecycle callback replacement is non-reactive.
    const configCache = useRef(deckglProps as DeckglConfiguration);
    const configCandidate = deckglProps as DeckglConfiguration;
    const config = hasSameConfigProperties(configCache.current, configCandidate)
      ? configCache.current
      : configCandidate;

    useIsomorphicLayoutEffect(() => {
      configCache.current = config;
    });

    useIsomorphicLayoutEffect(() => {
      let rootElement: RootElement;
      let rootConfig: DeckglConfiguration = config;
      if (isExternalOverlay) {
        rootElement = getDetachedRoot(detachedRoot, rootOptions);
      } else {
        const canvasElement = getCanvasRoot(config.canvas, canvas, resolvedCanvas);
        if (!canvasElement) {
          return;
        }
        rootElement = canvasElement;
        rootConfig = {
          ...config,
          canvas: canvasElement,
          parent:
            config.parent ||
            (config.canvas ? (canvasElement.parentElement as HTMLDivElement) : wrapper.current)
        };
      }

      const root: ReconcilerRoot = rootOptions.current
        ? createRoot(rootElement, rootOptions.current)
        : createRoot(rootElement);

      root.configure(rootConfig);
      notifyDeckglChange(root.store.getState().deckgl as Instance | null);
      root.render(<Bridge>{children}</Bridge>);
    }, [children, config, Bridge]);

    useEffect(() => {
      const rootElement = isExternalOverlay
        ? getDetachedRoot(detachedRoot, rootOptions)
        : getCanvasRoot(config.canvas, canvas, resolvedCanvas);

      if (rootElement) {
        return () => {
          notifyDeckglChange(null);
          unmountAtNode(rootElement);
        };
      }
    }, [config.canvas]);

    if (isExternalOverlay || config.canvas) {
      return null;
    }

    return (
      <div ref={wrapper} id="deckgl-fiber-wrapper">
        <canvas ref={canvas} id="deckgl-fiber-canvas" />
      </div>
    );
  }

  return function DeckGL(props: ComponentProps<Props, Instance> & {children: ReactNode}) {
    return (
      <FiberProvider>
        <DeckGLComponent {...props} />
      </FiberProvider>
    );
  };
}

const PlainDeckGLComponent = createDeckGLComponent<DeckglProps, DeckglInstance>();

/** Creates a native React Fiber component bound to a compatible external overlay factory. */
export function createDeckGL<Props, Instance extends DeckglRenderer>(
  options: CreateDeckGLOptions<Props, Instance>
) {
  return createDeckGLComponent(options);
}

/** The standalone Deck root exported from the package root and `/dom`. */
export function DeckGL(props: DeckglProps & {children: ReactNode}) {
  return <PlainDeckGLComponent {...props} />;
}
