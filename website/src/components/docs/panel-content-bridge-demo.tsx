import React, {createContext, useContext, useMemo, useState} from 'react';
import {Panel, useReactPanel} from '@deck.gl-community/react';
import {MarkdownPanel, TabbedPanel} from '@deck.gl-community/panels';

const LabelContext = createContext('Scene');
function SceneCounter() {
  const label = useContext(LabelContext);
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(value => value + 1)}>{label}: {count}</button>;
}

/** Demonstrates React context and state inside a Preact-backed panel composition. */
export default function PanelContentBridgeDemo() {
  const [label, setLabel] = useState('Scene');
  const [dark, setDark] = useState(false);
  const {panel, portal} = useReactPanel({id: 'react-controls', title: 'React controls', keepMounted: true, children: <SceneCounter />});
  const tabs = useMemo(() => new TabbedPanel({id: 'bridge-tabs', title: 'Content bridge', panels: [panel,
    new MarkdownPanel({id: 'notes', title: 'Notes', markdown: 'The counter is React-owned. Its context comes from outside the panel, and its state survives tab and theme changes.'})]}), [panel]);
  return <LabelContext.Provider value={label}>
    <div style={{display: 'grid', gap: 12}}>
      <label>Context label <input value={label} onChange={event => setLabel(event.target.value)} /></label>
      <label><input type="checkbox" checked={dark} onChange={event => setDark(event.target.checked)} /> Dark theme</label>
      <Panel panel={tabs} theme={{base: dark ? 'sleek-dark' : 'sleek-light', variables: {'--panel-accent-color': '#16856b'}}} />
      {portal}
    </div>
  </LabelContext.Provider>;
}
