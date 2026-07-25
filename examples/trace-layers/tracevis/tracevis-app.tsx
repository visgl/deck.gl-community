import {MainView} from './components/tracevis-main-view';
import {initStore} from './tracevis-store';
import type {Deck, View} from '@deck.gl/core';

/** Glues up the standalone Tracevis demo shell. */
export const App = ({
  onDeckInitialized
}: {
  onDeckInitialized?: (deck: Deck<View | View[] | null>) => void;
} = {}) => {
  return (
    <AppInitializer>
      <MainView onDeckInitialized={onDeckInitialized} />
    </AppInitializer>
  );
};

// HOOKS

/** Props for the demo initialization boundary. */
type AppInitializerProps = {
  /** Demo app children rendered after store initialization. */
  children?: React.ReactNode;
};

/** Runs one-time demo store initialization before rendering children. */
function AppInitializer({children}: AppInitializerProps) {
  initStore();

  return children;
}
