// biome-ignore lint/correctness/noUnusedImports: React is required by the classic JSX transform.
import * as React from 'react';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it} from 'vitest';

import {MarkdownPanel, TabbedPanel} from '@deck.gl-community/panels';

import {Panel} from './panel';

afterEach(() => {
  cleanup();
});

describe('Panel', () => {
  it('renders a single panel definition inside a React tree', () => {
    render(
      <Panel
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Rendered from React'
          })
        }
      />
    );

    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText('Rendered from React')).toBeTruthy();
  });

  it('renders a composite panel when provided', () => {
    render(
      <Panel
        panel={
          new TabbedPanel({
            id: 'tabs',
            title: 'Tabs',
            panels: [
              new MarkdownPanel({
                id: 'first',
                title: 'First',
                markdown: 'First tab'
              }),
              new MarkdownPanel({
                id: 'second',
                title: 'Second',
                markdown: 'Second tab'
              })
            ]
          })
        }
      />
    );

    expect(screen.getByText('First')).toBeTruthy();
    expect(screen.getByText('Second')).toBeTruthy();
    expect(screen.getByText('First tab')).toBeTruthy();
  });

  it('applies a dark theme host when requested', async () => {
    const {container} = render(
      <Panel
        themeMode="dark"
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Dark host'
          })
        }
      />
    );

    const host = container.querySelector<HTMLDivElement>('.deck-react-panel');
    expect(host?.style.getPropertyValue('--menu-background')).toContain('rgba');
    await waitFor(() => {
      expect(host?.querySelector('[data-panel-theme-mode="dark"]')).toBeTruthy();
    });
  });

  it('supports unframed rendering for embedded layouts', () => {
    const {container} = render(
      <Panel
        framed={false}
        panel={
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Unframed content'
          })
        }
      />
    );

    const host = container.querySelector<HTMLDivElement>('.deck-react-panel');
    expect(host?.style.border).toBe('');
    expect(screen.getByText('Unframed content')).toBeTruthy();
  });
});

it('applies custom presets and switches back to inherited host variables', async () => {
  const panel = new MarkdownPanel({id: 'summary', title: 'Summary', markdown: 'Theme content'});
  const {container, rerender} = render(
    <Panel
      panel={panel}
      theme={{base: 'sleek-dark', variables: {'--button-text': 'rgb(1, 200, 120)'}}}
    />
  );
  const scope = () => container.querySelector<HTMLElement>('[data-panel-theme-mode]')!;
  await waitFor(() => expect(scope().dataset.panelThemePreset).toBe('sleek-dark'));
  expect(getComputedStyle(scope()).getPropertyValue('--button-text')).toBe('rgb(1, 200, 120)');
  rerender(<Panel panel={panel} theme="sleek-light" />);
  await waitFor(() => expect(scope().dataset.panelThemePreset).toBe('sleek-light'));
  rerender(
    <Panel
      panel={panel}
      theme="inherit"
      style={{'--panel-preset': 'dark', '--button-text': 'rgb(200, 20, 10)'} as React.CSSProperties}
    />
  );
  await waitFor(() =>
    expect(getComputedStyle(scope()).getPropertyValue('--button-text')).toBe('rgb(200, 20, 10)')
  );
});
