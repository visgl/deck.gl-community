/** @jsxImportSource preact */
import {h, render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PANEL_THEME_DARK, PANEL_THEME_LIGHT} from '../lib/panel-theme';

import {
  AccordeonWidgetContainer,
  AccordeonPanel,
  asPanelContainer,
  ColumnWidgetContainer,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  TabbedWidgetContainer,
  TabbedPanel,
  WidgetContainerRenderer
} from './widget-containers';

import type {WidgetAccordeonContainer, WidgetTabbedContainer} from './widget-containers';

function getPanelContent(root: ParentNode, panelId: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-panel-id="${panelId}"]`);
}

function createPanelContent(panelId: string) {
  return <div data-panel-id={panelId}>{panelId} content</div>;
}

function getThemeScopes(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-panel-theme-mode]')];
}

async function waitForCondition(
  predicate: () => boolean,
  message: string,
  attempts = 8
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
    await Promise.resolve();
  }

  throw new Error(message);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('widget containers', () => {
  it('toggles accordion panels with uncontrolled multi-expand behavior and emits panel ids', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const onExpandedPanelIdsChange = vi.fn();
    render(
      h(AccordeonWidgetContainer, {
        panels: [
          {id: 'first', title: 'First', content: createPanelContent('first')},
          {id: 'second', title: 'Second', content: createPanelContent('second')}
        ],
        allowMultipleExpanded: true,
        onExpandedPanelIdsChange
      }),
      root
    );

    const firstButton = root.querySelector<HTMLButtonElement>('section > button');
    expect(firstButton).toBeTruthy();
    expect(root.querySelector('[data-panel-id="first"]')).toBeFalsy();
    expect(root.querySelector('[data-panel-id="second"]')).toBeFalsy();

    firstButton.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await Promise.resolve();
    expect(onExpandedPanelIdsChange).toHaveBeenLastCalledWith(['first']);
    expect(root.querySelector('[data-panel-id="first"]')).toBeTruthy();

    firstButton.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await Promise.resolve();
    expect(onExpandedPanelIdsChange).toHaveBeenLastCalledWith([]);
    expect(root.querySelector('[data-panel-id="first"]')).toBeFalsy();
  });

  it('uses active tab selection for tabbed containers and supports switching tabs', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onActivePanelIdChange = vi.fn();

    render(
      h(TabbedWidgetContainer, {
        defaultActivePanelId: 'second',
        onActivePanelIdChange,
        panels: [
          {
            id: 'first',
            title: 'First',
            content: createPanelContent('first'),
            keepMounted: true
          },
          {
            id: 'second',
            title: 'Second',
            content: createPanelContent('second'),
            keepMounted: true
          }
        ]
      }),
      root
    );

    const firstTab = root.querySelectorAll<HTMLButtonElement>('button')[0];
    const secondTab = root.querySelectorAll<HTMLButtonElement>('button')[1];
    expect(firstTab).toBeTruthy();
    expect(secondTab).toBeTruthy();

    const firstPanel = getPanelContent(root, 'first');
    const secondPanel = getPanelContent(root, 'second');
    expect(firstPanel?.parentElement?.parentElement?.style.visibility).toBe('hidden');
    expect(secondPanel?.parentElement?.parentElement?.style.visibility).toBe('visible');

    firstTab.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await Promise.resolve();

    const firstPanelAfter = getPanelContent(root, 'first');
    const secondPanelAfter = getPanelContent(root, 'second');
    expect(firstPanelAfter?.parentElement?.parentElement?.style.visibility).toBe('visible');
    expect(secondPanelAfter?.parentElement?.parentElement?.style.visibility).toBe('hidden');
    expect(onActivePanelIdChange).toHaveBeenLastCalledWith('first');
  });

  it('renders tab and accordion containers through WidgetContainerRenderer', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const accordeonContainer: WidgetAccordeonContainer = {
      kind: 'accordeon',
      props: {
        panels: [{id: 'one', title: 'One', content: createPanelContent('one')}],
        defaultExpandedPanelIds: ['one']
      }
    };
    const tabbedContainer: WidgetTabbedContainer = {
      kind: 'tabs',
      props: {
        panels: [
          {id: 'alpha', title: 'Alpha', content: createPanelContent('alpha')},
          {id: 'beta', title: 'Beta', content: createPanelContent('beta'), disabled: true}
        ],
        defaultActivePanelId: 'alpha'
      }
    };

    render(h(WidgetContainerRenderer, {container: accordeonContainer}), root);
    expect(root.textContent).toContain('One');
    render(h(WidgetContainerRenderer, {container: tabbedContainer}), root);
    expect(root.textContent).toContain('Alpha');
  });

  it('renders child panels in order through a column container and hides empty titles', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(ColumnWidgetContainer, {
        panels: [
          {id: 'overview', title: '', content: createPanelContent('overview')},
          {id: 'actions', title: 'Actions', content: createPanelContent('actions')}
        ]
      }),
      root
    );

    expect(root.textContent).toContain('overview content');
    expect(root.textContent).toContain('Actions');
    expect(root.textContent).toContain('actions content');

    const headers = root.querySelectorAll('header');
    expect(headers).toHaveLength(1);
    expect(headers[0]?.textContent).toBe('Actions');
  });

  it('wraps tabbed panels from a panel record and preserves key order', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new TabbedPanel({
      id: 'shortcut-tabs',
      title: 'Keyboard Shortcuts',
      panels: {
        b: {id: 'b', title: 'B', content: <div>B content</div>},
        a: {id: 'a', title: 'A', content: <div>A content</div>}
      }
    });

    render(panel.content, root);

    const buttons = root.querySelectorAll('button');
    expect(buttons[0]?.textContent).toBe('B');
    expect(buttons[1]?.textContent).toBe('A');

    const tabList = root.querySelector<HTMLDivElement>('[data-widget-tabs]');
    expect(tabList?.style.flexWrap).toBe('wrap');
    expect(tabList?.style.overflowX).toBe('hidden');
  });

  it('wraps column panels from a panel record and preserves key order', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new ColumnPanel({
      id: 'column-panels',
      title: 'Column Panels',
      panels: {
        overview: {id: 'overview', title: '', content: <div>overview content</div>},
        actions: {id: 'actions', title: 'Actions', content: <div>actions content</div>}
      }
    });

    render(panel.content, root);

    const sections = root.querySelectorAll('section');
    expect(sections).toHaveLength(2);
    expect(sections[0]?.textContent).toContain('overview content');
    expect(sections[1]?.textContent).toContain('Actions');
    expect(sections[1]?.textContent).toContain('actions content');
  });

  it('supports horizontally scrollable tab rows when requested', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(TabbedWidgetContainer, {
        tabListLayout: 'scroll',
        panels: [
          {id: 'one', title: 'One', content: createPanelContent('one')},
          {id: 'two', title: 'Two', content: createPanelContent('two')},
          {id: 'three', title: 'Three', content: createPanelContent('three')}
        ]
      }),
      root
    );

    const tabList = root.querySelector<HTMLDivElement>('[data-widget-tabs]');
    expect(tabList?.style.flexWrap).toBe('nowrap');
    expect(tabList?.style.overflowX).toBe('auto');
  });

  it('renders a wrapper accordion panel from a panel record', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new AccordeonPanel({
      panels: {
        first: {id: 'first', title: 'First', content: <div>first content</div>},
        second: {id: 'second', title: 'Second', content: <div>second content</div>}
      }
    });

    render(panel.content, root);

    const firstButton = root.querySelector<HTMLButtonElement>('section > button');
    expect(firstButton).toBeTruthy();
    firstButton.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await Promise.resolve();

    expect(root.textContent).toContain('first content');
  });

  it('renders direct panel content via a single-panel container without accordion chrome', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panelContainer = asPanelContainer({
      id: 'direct',
      title: 'Direct',
      content: <div>direct content</div>
    });

    render(h(WidgetContainerRenderer, {container: panelContainer}), root);

    expect(root.textContent).toContain('direct content');
    expect(root.querySelector('section > button')).toBeNull();
    expect(root.querySelector('div > button')).toBeNull();
  });

  it('preserves inherited theme mode for direct panel content', async () => {
    const root = document.createElement('div');
    root.style.setProperty('--menu-background', PANEL_THEME_DARK['--menu-background'] ?? '');
    document.body.appendChild(root);

    const panelContainer = asPanelContainer({
      id: 'direct',
      title: 'Direct',
      content: <div>direct content</div>
    });

    render(h(WidgetContainerRenderer, {container: panelContainer}), root);
    await Promise.resolve();

    const scope = getThemeScopes(root)[0];
    expect(scope?.dataset.panelThemeMode).toBe('dark');
    expect(scope?.style.getPropertyValue('--menu-background')).toBe(
      PANEL_THEME_DARK['--menu-background']
    );
  });

  it('forces explicit light and dark theme overrides', async () => {
    const root = document.createElement('div');
    root.style.setProperty('--menu-background', PANEL_THEME_DARK['--menu-background'] ?? '');
    document.body.appendChild(root);

    const panelContainer = asPanelContainer(
      new ColumnPanel({
        id: 'forced-themes',
        title: 'Forced themes',
        panels: {
          light: {id: 'light', title: 'Light', theme: 'light', content: <div>light</div>},
          dark: {id: 'dark', title: 'Dark', theme: 'dark', content: <div>dark</div>}
        }
      })
    );

    render(h(WidgetContainerRenderer, {container: panelContainer}), root);
    await Promise.resolve();

    await waitForCondition(
      () => getThemeScopes(root)[2]?.dataset.panelThemeMode === 'dark',
      'Expected explicit dark theme scope to render.'
    );
    const scopes = getThemeScopes(root);
    expect(scopes[1]?.dataset.panelThemeMode).toBe('light');
    expect(scopes[1]?.style.getPropertyValue('--menu-background')).toBe(
      PANEL_THEME_LIGHT['--menu-background']
    );
    expect(scopes[2]?.dataset.panelThemeMode).toBe('dark');
    expect(scopes[2]?.style.getPropertyValue('--menu-background')).toBe(
      PANEL_THEME_DARK['--menu-background']
    );
  });

  it('inverts theme mode relative to the parent and supports nested invert', async () => {
    const root = document.createElement('div');
    root.style.setProperty('--menu-background', PANEL_THEME_DARK['--menu-background'] ?? '');
    document.body.appendChild(root);

    const panelContainer = asPanelContainer(
      new ColumnPanel({
        id: 'invert-root',
        title: 'Invert root',
        theme: 'invert',
        panels: {
          nested: new MarkdownPanel({
            id: 'nested',
            title: 'Nested',
            theme: 'invert',
            markdown: 'nested content'
          })
        }
      })
    );

    render(h(WidgetContainerRenderer, {container: panelContainer}), root);
    await Promise.resolve();

    await waitForCondition(
      () => getThemeScopes(root)[1]?.dataset.panelThemeMode === 'dark',
      'Expected nested inverted theme scope to render as dark.'
    );
    const scopes = getThemeScopes(root);
    expect(scopes[0]?.dataset.panelThemeMode).toBe('light');
    expect(scopes[1]?.dataset.panelThemeMode).toBe('dark');
  });

  it('renders imperative HTML through a custom widget panel and runs cleanup on unmount', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cleanup = vi.fn();
    const onRenderHTML = vi.fn((hostElement: HTMLElement) => {
      hostElement.textContent = 'custom content';
      return cleanup;
    });
    const panelContainer = asPanelContainer(
      new CustomPanel({
        id: 'custom',
        title: 'Custom',
        onRenderHTML
      })
    );

    render(h(WidgetContainerRenderer, {container: panelContainer}), root);
    await waitForCondition(
      () =>
        onRenderHTML.mock.calls.length > 0 &&
        (root.textContent?.includes('custom content') ?? false),
      'Expected custom widget panel content to render.',
      60
    );

    expect(root.textContent).toContain('custom content');
    expect(onRenderHTML).toHaveBeenCalledTimes(1);

    render(null, root);
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('renders a minimal safe markdown subset through a markdown widget panel', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const panel = new MarkdownPanel({
      id: 'markdown',
      title: 'Markdown',
      markdown: [
        '# Title',
        '',
        'Paragraph with **bold** text, `inline code`, and a [link](https://example.com).',
        '',
        '- First item',
        '- Second item',
        '',
        '```',
        'const value = 1;',
        '```'
      ].join('\n')
    });

    render(panel.content, root);

    expect(root.querySelector('h1')?.textContent).toBe('Title');
    expect(root.querySelector('strong')?.textContent).toBe('bold');
    expect(root.querySelector('p code')?.textContent).toBe('inline code');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(root.querySelectorAll('ul li')).toHaveLength(2);
    expect(root.querySelector('pre code')?.textContent).toContain('const value = 1;');
  });

  it('treats raw html-like input as text in markdown widget panels', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const panel = new MarkdownPanel({
      id: 'markdown-html',
      title: 'Markdown HTML',
      markdown: '<b>unsafe</b>'
    });

    render(panel.content, root);

    expect(root.querySelector('b')).toBeNull();
    expect(root.textContent).toContain('<b>unsafe</b>');
  });
});
