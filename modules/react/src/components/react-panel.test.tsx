// biome-ignore lint/correctness/noUnusedImports: React is required by the classic JSX transform.
import * as React from 'react';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {userEvent} from 'vitest/browser';
import {MarkdownPanel, TabbedPanel} from '@deck.gl-community/panels';
import {Panel} from './panel';
import {ReactPanel, useReactPanel} from './react-panel';

afterEach(cleanup);
const LabelContext = React.createContext('Missing context');
function Counter() {
  const label = React.useContext(LabelContext);
  const [count, setCount] = React.useState(0);
  return (
    <button onClick={() => setCount(value => value + 1)}>
      {label}: {count}
    </button>
  );
}

it('preserves React context, state, and updates through a direct panel under StrictMode', async () => {
  function App({label}: {label: string}) {
    return (
      <React.StrictMode>
        <LabelContext.Provider value={label}>
          <ReactPanel
            title="Controls"
            theme={{base: 'sleek-dark', variables: {'--button-text': 'rgb(1, 200, 120)'}}}
          >
            <Counter />
          </ReactPanel>
        </LabelContext.Provider>
      </React.StrictMode>
    );
  }
  const view = render(<App label="First" />);
  const button = await screen.findByRole('button', {name: 'First: 0'});
  fireEvent.click(button);
  expect(screen.getByRole('button', {name: 'First: 1'})).toBe(button);
  view.rerender(<App label="Updated" />);
  await waitFor(() => expect(screen.getByRole('button', {name: 'Updated: 1'})).toBe(button));
  expect(getComputedStyle(button).getPropertyValue('--button-text')).toBe('rgb(1, 200, 120)');
  view.unmount();
  expect(document.querySelector('[data-panel-host]')).toBeNull();
});

it('composes React-owned children into ordinary panel tabs while preserving state', async () => {
  function App() {
    const {panel, portal} = useReactPanel({
      id: 'react',
      title: 'React controls',
      children: <Counter />
    });
    const tabs = React.useMemo(
      () =>
        new TabbedPanel({
          id: 'tabs',
          title: 'Tabs',
          panels: [
            panel,
            new MarkdownPanel({id: 'other', title: 'Other', markdown: 'Other content'})
          ]
        }),
      [panel]
    );
    return (
      <LabelContext.Provider value="From app">
        <Panel panel={tabs} />
        {portal}
      </LabelContext.Provider>
    );
  }
  render(<App />);
  fireEvent.click(await screen.findByRole('button', {name: 'From app: 0'}));
  expect(screen.getByRole('button', {name: 'From app: 1'})).toBeTruthy();
  await userEvent.click(screen.getByRole('button', {name: 'Other'}));
  await waitFor(() => expect(screen.queryByRole('button', {name: 'From app: 1'})).toBeNull());
  await userEvent.click(screen.getByRole('button', {name: 'React controls'}));
  expect(await screen.findByRole('button', {name: 'From app: 1'})).toBeTruthy();
});
