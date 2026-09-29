import 'client-only';
import {createRoot, unmountAtNode} from '../reconciler/index';
import type {DeckglConfiguration, ReconcilerRoot, RootOptions} from '../reconciler/types';
import {log} from '../shared/index';
import type {DeckglRenderer} from '../shared/store';
import {hasSameConfigProperties} from '../shared/has-same-config-properties';
import {useEffectEvent} from '../shared/use-effect-event';
import type {DeckGLRootProps, DeckglInstance, DeckglProps, OnDeckglChange} from '../types/index';
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

    if (isExternalOverlay && !detachedRoot.current) {
      detachedRoot.current = document.createElement('div');
      rootOptions.current = {
        createExternalOverlay: config => overlayFactory?.(config as Props) as DeckglRenderer
      };
    }

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
      const rootElement = isExternalOverlay
        ? detachedRoot.current
        : ((config.canvas || canvas.current) as HTMLCanvasElement);

      if (!rootElement) {
        return;
      }

      const root: ReconcilerRoot = rootOptions.current
        ? createRoot(rootElement, rootOptions.current)
        : createRoot(rootElement);
      const rootConfig = isExternalOverlay
        ? config
        : {
            ...config,
            canvas: rootElement,
            parent:
              config.parent ||
              (config.canvas
                ? getCanvasParent(config.canvas as string | HTMLCanvasElement)
                : wrapper.current)
          };

      root.configure(rootConfig);
      notifyDeckglChange(root.store.getState().deckgl as Instance | null);
      root.render(<Bridge>{children}</Bridge>);
    }, [children, config, Bridge]);

    useEffect(() => {
      const rootElement = isExternalOverlay
        ? detachedRoot.current
        : ((config.canvas || canvas.current) as HTMLCanvasElement);

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
