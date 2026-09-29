import type {DeckProps, Layer, View} from '@deck.gl/core';
import {Deck} from '@deck.gl/core';
import {createStore, noop, log} from '../shared/index';
import type {ReactNode} from 'react';
import reactReconciler from 'react-reconciler';
import type {HostConfig} from 'react-reconciler';
import {ConcurrentRoot} from 'react-reconciler/constants.js';

import * as config from './config';
import type {
  ChildSet,
  Container,
  DeckglConfiguration,
  HostContext,
  Instance,
  Props,
  ReconcilerRoot,
  RootElement,
  RootOptions
} from './types';

/**
 * React reconciler instance configured for deck.gl rendering
 *
 * Internal reconciler used by createRoot/unmountAtNode. Generally not used directly
 * by consumers - use the higher-level createRoot API instead.
 *
 * **Type Assertion Note:**
 * The `as unknown as HostConfig` assertion is necessary because @types/react-reconciler@0.33.0
 * has an incorrect type definition for `waitForCommitToBeReady`:
 *
 * - **@types definition (INCORRECT):** `waitForCommitToBeReady(): ...`
 *   - Takes 0 parameters
 *
 * - **Actual react-reconciler implementation (CORRECT):** `waitForCommitToBeReady(state, timeoutOffset): ...`
 *   - Takes 2 parameters: SuspendedState and timeout number
 *   - See: ReactFiberWorkLoop.js line `const schedulePendingCommit = waitForCommitToBeReady(suspendedState, timeoutOffset);`
 *
 * Our implementation follows the actual react-reconciler@0.33.0 source code.
 * The assertion only affects this renderer creation - the config module itself
 * remains fully typed and will catch other errors.
 *
 * **Related Issue:** https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/70858
 *
 * @example
 * ```typescript
 * // Advanced usage: direct container access
 * import { renderer } from '@deck.gl-community/react-fiber/reconciler';
 *
 * const container = renderer.createContainer(
 *   hostContext,
 *   ConcurrentRoot,
 *   // ... other params
 * );
 * renderer.updateContainer(element, container, null, callback);
 * ```
 */
export const renderer: ReturnType<typeof reactReconciler> = reactReconciler(
  config as unknown as HostConfig<
    string,
    Props,
    Container,
    Instance | undefined,
    void,
    unknown,
    unknown,
    never,
    Layer | View,
    HostContext,
    ChildSet,
    number,
    -1,
    null
  >
);

/**
 * Active reconciler roots registry
 *
 * Maps RootElement containers to their ReconcilerRoot instances. Used internally
 * to ensure root idempotency and proper cleanup.
 *
 * @example
 * ```typescript
 * // Advanced usage: check if root exists for container
 * import { roots } from '@deck.gl-community/react-fiber/reconciler';
 *
 * if (roots.has(containerElement)) {
 *   const existingRoot = roots.get(containerElement);
 *   // Work with existing root
 * }
 * ```
 */
export const roots = new Map<RootElement, ReconcilerRoot>();

function reportError(error: unknown): void {
  console.error(error);
}

/**
 * Unmounts and cleans up a reconciler root
 *
 * Performs complete cleanup including:
 * - Unmounting React tree from the container
 * - Finalizing deck.gl instance (releases WebGL resources)
 * - Clearing internal state
 * - Removing root from registry
 *
 * Safe to call multiple times or on non-existent nodes (no-op if not found).
 *
 * Cleanup (state clearing and root removal) always completes even if finalize
 * throws, but the error is re-thrown to allow proper error handling by callers.
 *
 * @param node - Root element container to unmount
 * @throws {Error} When deck.gl finalize() fails (e.g., WebGL context errors)
 *
 * @example
 * ```typescript
 * const root = createRoot(container);
 * root.render(<MyApp />);
 *
 * // Later: cleanup with error handling
 * try {
 *   unmountAtNode(container);
 * } catch (error) {
 *   console.error('WebGL cleanup failed:', error);
 *   // Root is still removed from registry despite error
 * }
 * ```
 */
export function unmountAtNode(node: RootElement) {
  const root = roots.get(node);

  log
    .withMetadata({
      node,
      root
    })
    .debug('renderer.unmountAtNode');

  if (root?.container) {
    renderer.updateContainer(null, root.container, null, noop);

    const state = root.store.getState();
    const deckgl = state.deckgl;

    // Ensure cleanup completes even if finalize throws
    try {
      deckgl?.finalize();
    } finally {
      // Always clear state and remove from registry, even on error
      state.setDeckgl(null);
      roots.delete(node);
    }
  }
}

/**
 * Creates a reconciler root for deck.gl rendering
 *
 * Returns a ReconcilerRoot with methods to configure deck.gl and render React
 * elements. Calling createRoot multiple times with the same node returns the
 * existing root (idempotent).
 *
 * The returned root provides:
 * - `configure(props)` - Initialize deck.gl instance with props
 * - `render(children)` - Render React elements into deck.gl
 * - `container` - Internal reconciler container
 * - `store` - Shared state store
 *
 * @param node - Root element to attach the reconciler to
 * @returns ReconcilerRoot instance with configure/render methods
 *
 * @example
 * ```typescript
 * import { createRoot } from '@deck.gl-community/react-fiber/reconciler';
 * import { ScatterplotLayer } from '@deck.gl/layers';
 *
 * const root = createRoot(container);
 *
 * // Configure deck.gl
 * root.configure({
 *   views: [new MapView()],
 *   initialViewState: { longitude: 0, latitude: 0, zoom: 1 }
 * });
 *
 * // Render layers
 * root.render(
 *   <layer layer={new ScatterplotLayer({ id: 'points', data })} />
 * );
 * ```
 */
export function createRoot(node: RootElement, options: RootOptions = {}): ReconcilerRoot {
  log
    .withMetadata({
      node
    })
    .debug('renderer.createRoot');

  const createExternalOverlay = options.createExternalOverlay;
  const isExternalOverlay = Boolean(createExternalOverlay);

  // A registry key has one immutable rendering capability. Reusing it with a
  // different provider could otherwise retain the wrong external control.
  const existingRoot = roots.get(node);
  if (existingRoot) {
    if (
      existingRoot.isExternalOverlay !== isExternalOverlay ||
      existingRoot.createExternalOverlay !== createExternalOverlay
    ) {
      throw new Error('Cannot reuse a DeckGL root with a different overlay capability.');
    }
    return existingRoot;
  }

  // Create new root
  const store = createStore(isExternalOverlay);

  /**
   * Create a new React reconciler container with the following configuration:
   * - tag: ConcurrentRoot for concurrent mode rendering
   * - hydration callbacks: null (no SSR hydration)
   * - isStrictMode: false
   * - concurrentUpdatesByDefaultOverride: null
   * - identifierPrefix: empty string
   * - onUncaughtError: reportError handler
   * - onCaughtError: reportError handler
   * - onRecoverableError: reportError handler
   * - transitionCallbacks: null
   *
   * @see https://github.com/facebook/react/blob/main/packages/react-noop-renderer/src/createReactNoop.js#L1159
   */
  const container = renderer.createContainer(
    {store},
    ConcurrentRoot,
    null,
    false,
    null,
    '',
    reportError,
    reportError,
    reportError,
    () => null
  );

  let configured = false;
  let initialInterleaved: boolean | undefined;

  function configure(props: DeckglConfiguration) {
    if (!isExternalOverlay && 'interleaved' in props) {
      throw new Error(
        'The default DeckGL root does not support interleaved rendering. ' +
          'Import /mapbox or /maplibre, or create a custom overlay root with createDeckGL.'
      );
    }

    const interleaved = props.interleaved ?? false;

    if (configured && isExternalOverlay && initialInterleaved !== interleaved) {
      throw new Error(
        'The interleaved mode is fixed when an overlay root is created. ' +
          'Remount DeckGL with a different React key to change it.'
      );
    }

    // NOTE: we want to support a "mix-mode" of sorts where a user can pass an explicit `layers` prop alongside
    // traditional usage of creating layers as JSX children.
    store.setState({_passedLayers: props.layers ?? []});

    if (configured) {
      const deckgl = store.getState().deckgl;
      if (deckgl) {
        deckgl.setProps(props as never);
      }
      return;
    }

    log.withMetadata(props).debug('renderer.configure');

    const state = store.getState();
    const deckgl = createExternalOverlay
      ? createExternalOverlay(props)
      : new Deck(props as DeckProps);

    initialInterleaved = interleaved;
    state.setDeckgl(deckgl);

    configured = true;
  }

  function render(children: ReactNode) {
    log
      .withMetadata({
        children
      })
      .debug('renderer.render');

    renderer.updateContainer(children, container, null, noop);
  }

  const root: ReconcilerRoot = {
    configure,
    container,
    createExternalOverlay,
    isExternalOverlay,
    render,
    store
  };
  roots.set(node, root);

  return root;
}
