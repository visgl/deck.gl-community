/** @jsxImportSource preact */
import {h, render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {PANEL_THEME_DARK, PANEL_THEME_LIGHT} from '../lib/panel-theme';

import {
  AccordeonPanelContainer,
  AccordeonPanel,
  asPanelContainer,
  ColumnPanelContainer,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  SplitterPanel,
  TabbedPanelContainer,
  TabbedPanel,
  PanelContentRenderer
} from './panel-containers';

import type {PanelAccordeonContentContainer, PanelTabbedContentContainer} from './panel-containers';

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

async function waitForAnimationFrame(): Promise<void> {
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve());
  });
  await Promise.resolve();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('panel content containers', () => {
  it('toggles accordion panels with uncontrolled multi-expand behavior and emits panel ids', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const onExpandedPanelIdsChange = vi.fn();
    render(
      h(AccordeonPanelContainer, {
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
      h(TabbedPanelContainer, {
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

  it('renders tab and accordion containers through PanelContentRenderer', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const accordeonContainer: PanelAccordeonContentContainer = {
      kind: 'accordeon',
      props: {
        panels: [{id: 'one', title: 'One', content: createPanelContent('one')}],
        defaultExpandedPanelIds: ['one']
      }
    };
    const tabbedContainer: PanelTabbedContentContainer = {
      kind: 'tabs',
      props: {
        panels: [
          {id: 'alpha', title: 'Alpha', content: createPanelContent('alpha')},
          {id: 'beta', title: 'Beta', content: createPanelContent('beta'), disabled: true}
        ],
        defaultActivePanelId: 'alpha'
      }
    };

    render(h(PanelContentRenderer, {container: accordeonContainer}), root);
    expect(root.textContent).toContain('One');
    render(h(PanelContentRenderer, {container: tabbedContainer}), root);
    expect(root.textContent).toContain('Alpha');
  });

  it('renders child panels in order through a column container and hides empty titles', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(ColumnPanelContainer, {
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

    const tabList = root.querySelector<HTMLDivElement>('[data-panel-tabs]');
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

  it('wraps split panels with the first panel in the first pane and remaining panels in order', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const panel = new SplitterPanel({
      id: 'splitter-panels',
      title: 'Splitter Panels',
      panels: {
        first: {id: 'first', title: 'First', content: createPanelContent('first')},
        second: {id: 'second', title: 'Second', content: createPanelContent('second')},
        third: {id: 'third', title: 'Third', content: createPanelContent('third')}
      }
    });

    render(panel.content, root);

    const handle = root.querySelector<HTMLElement>('[data-panel-splitter]');
    expect(handle).toBeTruthy();
    expect(handle?.getAttribute('aria-orientation')).toBe('vertical');

    const firstContent = getPanelContent(root, 'first');
    const secondContent = getPanelContent(root, 'second');
    const thirdContent = getPanelContent(root, 'third');
    expect(firstContent?.compareDocumentPosition(secondContent!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(secondContent?.compareDocumentPosition(thirdContent!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('supports horizontal and vertical splitter layouts', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const horizontalPanel = new SplitterPanel({
      orientation: 'horizontal',
      initialSplit: 0.25,
      panels: {
        first: {id: 'first', title: 'First', content: createPanelContent('first')},
        second: {id: 'second', title: 'Second', content: createPanelContent('second')}
      }
    });

    render(horizontalPanel.content, root);
    expect(root.firstElementChild instanceof HTMLElement && root.firstElementChild.style.flexDirection).toBe(
      'row'
    );
    expect(root.querySelector<HTMLElement>('[data-panel-splitter]')?.style.cursor).toBe(
      'col-resize'
    );

    const verticalPanel = new SplitterPanel({
      orientation: 'vertical',
      initialSplit: 0.25,
      panels: {
        first: {id: 'first', title: 'First', content: createPanelContent('first')},
        second: {id: 'second', title: 'Second', content: createPanelContent('second')}
      }
    });

    render(verticalPanel.content, root);
    expect(root.firstElementChild instanceof HTMLElement && root.firstElementChild.style.flexDirection).toBe(
      'column'
    );
    expect(root.querySelector<HTMLElement>('[data-panel-splitter]')?.style.cursor).toBe(
      'row-resize'
    );
  });

  it('clamps splitter drag changes and emits drag lifecycle callbacks', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onChange = vi.fn();
    const onDragStart = vi.fn();
    const onDragEnd = vi.fn();
    const panel = new SplitterPanel({
      initialSplit: 2,
      minSplit: 0.2,
      maxSplit: 0.8,
      onChange,
      onDragStart,
      onDragEnd,
      panels: {
        first: {id: 'first', title: 'First', content: createPanelContent('first')},
        second: {id: 'second', title: 'Second', content: createPanelContent('second')}
      }
    });

    render(panel.content, root);
    const container = root.firstElementChild as HTMLElement;
    container.getBoundingClientRect = () =>
      ({left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100} as DOMRect);

    const handle = root.querySelector<HTMLElement>('[data-panel-splitter]');
    expect(handle?.getAttribute('aria-valuenow')).toBe('80');
    handle?.dispatchEvent(new Event('pointerdown', {bubbles: true}));
    await waitForAnimationFrame();
    document.dispatchEvent(new MouseEvent('pointermove', {clientX: 10, clientY: 50, bubbles: true}));
    document.dispatchEvent(new Event('pointerup', {bubbles: true}));
    await Promise.resolve();

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    expect(onDragEnd).toHaveBeenCalledTimes(1);
  });

  it('does not drag when the splitter is not editable', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const onChange = vi.fn();
    const panel = new SplitterPanel({
      editable: false,
      onChange,
      panels: {
        first: {id: 'first', title: 'First', content: createPanelContent('first')},
        second: {id: 'second', title: 'Second', content: createPanelContent('second')}
      }
    });

    render(panel.content, root);
    root.querySelector<HTMLElement>('[data-panel-splitter]')?.dispatchEvent(
      new Event('pointerdown', {bubbles: true})
    );
    document.dispatchEvent(new MouseEvent('pointermove', {clientX: 10, bubbles: true}));
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders one splitter panel without a handle and renders empty input as empty content', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const singlePanel = new SplitterPanel({
      panels: {
        only: {id: 'only', title: 'Only', content: createPanelContent('only')}
      }
    });
    render(singlePanel.content, root);
    expect(root.querySelector('[data-panel-id="only"]')).toBeTruthy();
    expect(root.querySelector('[data-panel-splitter]')).toBeNull();

    const emptyPanel = new SplitterPanel({panels: {}});
    render(emptyPanel.content, root);
    expect(root.textContent).toBe('');
    expect(root.querySelector('[data-panel-splitter]')).toBeNull();
  });

  it('supports horizontally scrollable tab rows when requested', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    render(
      h(TabbedPanelContainer, {
        tabListLayout: 'scroll',
        panels: [
          {id: 'one', title: 'One', content: createPanelContent('one')},
          {id: 'two', title: 'Two', content: createPanelContent('two')},
          {id: 'three', title: 'Three', content: createPanelContent('three')}
        ]
      }),
      root
    );

    const tabList = root.querySelector<HTMLDivElement>('[data-panel-tabs]');
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

    render(h(PanelContentRenderer, {container: panelContainer}), root);

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

    render(h(PanelContentRenderer, {container: panelContainer}), root);
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

    render(h(PanelContentRenderer, {container: panelContainer}), root);
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

    render(h(PanelContentRenderer, {container: panelContainer}), root);
    await Promise.resolve();

    await waitForCondition(
      () => getThemeScopes(root)[1]?.dataset.panelThemeMode === 'dark',
      'Expected nested inverted theme scope to render as dark.'
    );
    const scopes = getThemeScopes(root);
    expect(scopes[0]?.dataset.panelThemeMode).toBe('light');
    expect(scopes[1]?.dataset.panelThemeMode).toBe('dark');
  });

  it('renders imperative HTML through a custom panel and runs cleanup on unmount', async () => {
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

    render(h(PanelContentRenderer, {container: panelContainer}), root);
    await waitForCondition(
      () =>
        onRenderHTML.mock.calls.length > 0 &&
        (root.textContent?.includes('custom content') ?? false),
      'Expected custom panel content to render.',
      60
    );

    expect(root.textContent).toContain('custom content');
    expect(onRenderHTML).toHaveBeenCalledTimes(1);

    render(null, root);
    await Promise.resolve();

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('renders a minimal safe markdown subset through a markdown panel', () => {
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

  it('treats raw html-like input as text in markdown panels', () => {
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
