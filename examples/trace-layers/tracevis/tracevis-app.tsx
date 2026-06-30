import {MainView} from './components/tracevis-main-view';
import {initStore} from './tracevis-store';

/** Glues up the standalone Tracevis demo shell. */
export const App = () => {
  return (
    <AppInitializer>
      <MainView />
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
