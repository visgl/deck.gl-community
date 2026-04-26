/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {PanelManager} from './panel-manager';
import {PanelContainer} from './panel-container';
import {PANEL_THEME_DARK, PANEL_THEME_LIGHT, applyPanelTheme} from './lib/panel-theme';
import {ToastPanelContainer} from './panels/toast-panel-container';
import {ToolbarPanelContainer} from './panels/toolbar-panel-container';
import {
  MarkdownPanel,
  PanelContentRenderer,
  asPanelContainer
} from './panels/panel-containers';

type TestPanelContainerProps = {
  id?: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  _container?: string | HTMLDivElement | null;
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';
  text: string;
};

class TestPanelContainer extends PanelContainer<TestPanelContainerProps> {
  static defaultProps = {
    ...PanelContainer.defaultProps,
    id: 'test-panel-container',
    placement: 'top-left' as const,
    text: ''
  };

  className = 'deck-panel-test';
  placement: TestPanelContainerProps['placement'] = TestPanelContainer.defaultProps.placement;

  constructor(props: Partial<TestPanelContainerProps> & Pick<TestPanelContainerProps, 'text'>) {
    super({...TestPanelContainer.defaultProps, ...props});
    this.setProps(this.props);
  }

  override setProps(props: Partial<TestPanelContainerProps>): void {
    if (props.placement) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.className = ['deck-panel', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    render(<div data-test-panel-container-text="">{this.props.text}</div>, rootElement);
  }
}

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style[data-deck-gl-community-panels-styles]').forEach(element => {
    element.remove();
  });
});

function createHostRoot() {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = '960px';
  root.style.height = '640px';
  document.body.appendChild(root);
  return root;
}

describe('PanelManager', () => {
  it('mounts standalone panel containers without a Deck instance', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});

    host.setProps({
      components: [
        new TestPanelContainer({
          id: 'summary',
          placement: 'top-left',
          text: 'Standalone host content'
        }),
        new ToolbarPanelContainer({
          id: 'toolbar',
          items: [{kind: 'action', id: 'save', label: 'Save'}]
        }),
        new ToastPanelContainer({
          id: 'toast'
        })
      ]
    });

    expect(root.classList.contains('deck-panel-container')).toBe(true);
    expect(root.querySelector('.deck-panel-test')?.textContent).toContain(
      'Standalone host content'
    );
    expect(root.querySelector('.deck-panel-toolbar')?.textContent).toContain('Save');
    expect(root.querySelector('.deck-panel-toast')).toBeTruthy();
    expect(root.querySelector('.top-left')).toBeTruthy();
    expect(root.querySelector('.top-right')).toBeTruthy();
    expect(root.querySelector('.bottom-right')).toBeTruthy();
  });

  it('injects the base panel stylesheet when deck panel styles are not present', () => {
    const root = createHostRoot();

    expect(document.querySelector('[data-deck-gl-community-panels-styles]')).toBeNull();

    const host = new PanelManager({parentElement: root});

    const styleElement = document.querySelector<HTMLStyleElement>(
      'style[data-deck-gl-community-panels-styles]'
    );
    expect(styleElement).toBeTruthy();
    expect(styleElement?.textContent).toContain('.deck-panel');
    expect(styleElement?.textContent).toContain('.deck-panel-button');

    host.finalize();
  });

  it('does not inject duplicate base stylesheets', () => {
    const root = createHostRoot();

    const firstHost = new PanelManager({parentElement: root});
    const secondHost = new PanelManager({parentElement: createHostRoot()});

    expect(document.querySelectorAll('style[data-deck-gl-community-panels-styles]')).toHaveLength(
      1
    );

    firstHost.finalize();
    secondHost.finalize();
  });

  it('reconciles panel containers by id and updates an existing mounted instance', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});
    const initialPanelContainer = new TestPanelContainer({
      id: 'summary',
      text: 'First content'
    });

    host.setProps({components: [initialPanelContainer]});

    const updatedPanelContainer = new TestPanelContainer({
      id: 'summary',
      text: 'Updated content'
    });

    host.setProps({components: [updatedPanelContainer]});

    expect(host.getComponents()[0]).toBe(initialPanelContainer);
    expect(root.textContent).toContain('Updated content');
    expect(root.querySelectorAll('.deck-panel-test')).toHaveLength(1);
  });

  it('honors an explicit HTMLElement container override', () => {
    const root = createHostRoot();
    const explicitContainer = document.createElement('div');
    root.appendChild(explicitContainer);

    const host = new PanelManager({parentElement: root});
    host.setProps({
      components: [
        new ToolbarPanelContainer({
          id: 'toolbar',
          _container: explicitContainer,
          items: [{kind: 'action', id: 'custom', label: 'Explicit'}]
        })
      ]
    });

    expect(explicitContainer.querySelector('.deck-panel-toolbar')?.textContent).toContain(
      'Explicit'
    );
    expect(root.querySelector('.top-right .deck-panel-toolbar')).toBeNull();
  });

  it('finalizes panel containers and removes internal placement containers', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});

    host.setProps({
      components: [new TestPanelContainer({id: 'summary', text: 'Content', placement: 'bottom-left'})]
    });

    expect(root.querySelector('.bottom-left')).toBeTruthy();

    host.finalize();

    expect(root.classList.contains('deck-panel-container')).toBe(false);
    expect(root.querySelector('.deck-panel-test')).toBeNull();
    expect(root.querySelector('.bottom-left')).toBeNull();
  });

  it('supports interactive updates in standalone mode', async () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});
    const state = {
      accent: 'Ocean'
    };

    const summaryPanelContainer = new TestPanelContainer({
      id: 'summary',
      placement: 'top-left',
      text: `Accent: ${state.accent}`
    });

    const syncPanelContainers = () => {
      summaryPanelContainer.setProps({text: `Accent: ${state.accent}`});
    };

    const toolbarPanelContainer = new ToolbarPanelContainer({
      id: 'toolbar',
      items: [
        {
          kind: 'action',
          id: 'accent',
          label: 'Accent',
          onClick: () => {
            state.accent = 'Sunset';
            syncPanelContainers();
          }
        },
        {
          kind: 'action',
          id: 'night',
          label: 'Night',
          onClick: () => {
            state.accent = 'Midnight';
            syncPanelContainers();
          }
        }
      ]
    });

    host.setProps({components: [summaryPanelContainer, toolbarPanelContainer]});

    const actionButtons = root.querySelectorAll<HTMLButtonElement>(
      '.deck-panel-toolbar [data-toolbar-item-kind="action"]'
    );

    actionButtons[0].click();
    await Promise.resolve();
    expect(root.textContent).toContain('Accent: Sunset');

    actionButtons[1].click();
    await Promise.resolve();
    expect(root.textContent).toContain('Accent: Midnight');
  });

  it('updates inherited panel theme mode when the host theme changes', async () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});
    const containerPanelContainer = new TestPanelContainer({
      id: 'theme-panel',
      text: ''
    });

    const panelRoot = document.createElement('div');
    root.appendChild(panelRoot);
    applyPanelTheme(root, PANEL_THEME_LIGHT);

    render(
      <PanelContentRenderer
        container={asPanelContainer(
          new MarkdownPanel({
            id: 'summary',
            title: 'Summary',
            markdown: 'Theme inheritance'
          })
        )}
      />,
      panelRoot
    );

    host.setProps({components: [containerPanelContainer]});
    await Promise.resolve();

    const themeScope = panelRoot.querySelector<HTMLElement>('[data-panel-theme-mode]');
    expect(themeScope?.dataset.panelThemeMode).toBe('light');

    applyPanelTheme(root, PANEL_THEME_DARK);
    await Promise.resolve();
    await Promise.resolve();

    expect(themeScope?.dataset.panelThemeMode).toBe('dark');
  });
});
