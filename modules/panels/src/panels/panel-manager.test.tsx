/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {PanelManager} from './panel-manager';
import {PanelComponent} from './panel-component';
import {BoxPanelContainer} from '../panel-mounts/box-panel-container';
import {PANEL_THEME_DARK, PANEL_THEME_LIGHT, applyPanelTheme} from '../lib/panel-theme';
import {ToastComponent} from '../components/toast-component';
import {ToolbarComponent} from '../components/toolbar-component';
import {MarkdownPanel} from '../leaf-panels/markdown/markdown-panel';
import {PanelThemeScope} from './panel-theme-scope';
import {Panel} from './panel';

type TestPanelComponentProps = {
  id?: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  _container?: string | HTMLElement | null;
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';
  text: string;
};

class TestPanelComponent extends PanelComponent<TestPanelComponentProps> {
  static defaultProps = {
    ...PanelComponent.defaultProps,
    id: 'test-panel-component',
    placement: 'top-left' as const,
    text: ''
  };

  className = 'deck-widget-test';
  placement: TestPanelComponentProps['placement'] = TestPanelComponent.defaultProps.placement;

  constructor(props: Partial<TestPanelComponentProps> & Pick<TestPanelComponentProps, 'text'>) {
    super({...TestPanelComponent.defaultProps, ...props});
    this.setProps(this.props);
  }

  override setProps(props: Partial<TestPanelComponentProps>): void {
    if (props.placement) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    render(<div data-test-panel-container-text="">{this.props.text}</div>, rootElement);
  }
}

class TestPanel extends Panel {}

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
  it('mounts standalone panel components without a Deck instance', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});

    host.setProps({
      components: [
        new TestPanelComponent({
          id: 'summary',
          placement: 'top-left',
          text: 'Standalone host content'
        }),
        new TestPanel({
          id: 'direct',
          title: 'Direct',
          content: <div>Direct panel content</div>
        }),
        new BoxPanelContainer({
          id: 'box',
          panel: new MarkdownPanel({
            id: 'box-panel',
            title: 'Box',
            markdown: 'Box panel content'
          })
        }),
        new ToolbarComponent({
          id: 'toolbar',
          items: [{kind: 'action', id: 'save', label: 'Save'}]
        }),
        new ToastComponent({
          id: 'toast'
        })
      ]
    });

    expect(root.classList.contains('deck-widget-container')).toBe(true);
    expect(root.querySelector('.deck-widget-test')?.textContent).toContain(
      'Standalone host content'
    );
    expect(root.querySelector('.deck-widget-panel')?.textContent).toContain('Direct panel content');
    expect(root.querySelector('.deck-widget-box')?.textContent).toContain('Box panel content');
    expect(root.querySelector('.deck-widget-toolbar')?.textContent).toContain('Save');
    expect(root.querySelector('.deck-widget-toast')).toBeTruthy();
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
    expect(styleElement?.textContent).toContain('.deck-widget');
    expect(styleElement?.textContent).toContain('.deck-widget-button');

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

  it('reconciles panel components by id and updates an existing mounted instance', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});
    const initialPanelComponent = new TestPanelComponent({
      id: 'summary',
      text: 'First content'
    });

    host.setProps({components: [initialPanelComponent]});

    const updatedPanelComponent = new TestPanelComponent({
      id: 'summary',
      text: 'Updated content'
    });

    host.setProps({components: [updatedPanelComponent]});

    expect(host.getComponents()[0]).toBe(initialPanelComponent);
    expect(root.textContent).toContain('Updated content');
    expect(root.querySelectorAll('.deck-widget-test')).toHaveLength(1);
  });

  it('honors an explicit HTMLElement container override', () => {
    const root = createHostRoot();
    const explicitContainer = document.createElement('div');
    root.appendChild(explicitContainer);

    const host = new PanelManager({parentElement: root});
    const toolbar = new ToolbarComponent({
      id: 'toolbar',
      _container: explicitContainer,
      items: [{kind: 'action', id: 'custom', label: 'Explicit'}]
    });

    expect(toolbar._container).toBe(explicitContainer);

    host.setProps({
      components: [toolbar]
    });

    expect(explicitContainer.querySelector('.deck-widget-toolbar')?.textContent).toContain(
      'Explicit'
    );
    expect(root.querySelector('.top-right .deck-widget-toolbar')).toBeNull();
  });

  it('finalizes panel components and removes internal placement containers', () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});

    host.setProps({
      components: [
        new TestPanelComponent({id: 'summary', text: 'Content', placement: 'bottom-left'})
      ]
    });

    expect(root.querySelector('.bottom-left')).toBeTruthy();

    host.finalize();

    expect(root.classList.contains('deck-widget-container')).toBe(false);
    expect(root.querySelector('.deck-widget-test')).toBeNull();
    expect(root.querySelector('.bottom-left')).toBeNull();
  });

  it('supports interactive updates in standalone mode', async () => {
    const root = createHostRoot();
    const host = new PanelManager({parentElement: root});
    const state = {
      accent: 'Ocean'
    };

    const summaryPanelComponent = new TestPanelComponent({
      id: 'summary',
      placement: 'top-left',
      text: `Accent: ${state.accent}`
    });

    const syncPanelComponents = () => {
      summaryPanelComponent.setProps({text: `Accent: ${state.accent}`});
    };

    const toolbarComponent = new ToolbarComponent({
      id: 'toolbar',
      items: [
        {
          kind: 'action',
          id: 'accent',
          label: 'Accent',
          onClick: () => {
            state.accent = 'Sunset';
            syncPanelComponents();
          }
        },
        {
          kind: 'action',
          id: 'night',
          label: 'Night',
          onClick: () => {
            state.accent = 'Midnight';
            syncPanelComponents();
          }
        }
      ]
    });

    host.setProps({components: [summaryPanelComponent, toolbarComponent]});

    const actionButtons = root.querySelectorAll<HTMLButtonElement>(
      '.deck-widget-toolbar [data-toolbar-item-kind="action"]'
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
    const containerPanelComponent = new TestPanelComponent({
      id: 'theme-panel',
      text: ''
    });

    const panelRoot = document.createElement('div');
    root.appendChild(panelRoot);
    applyPanelTheme(root, PANEL_THEME_LIGHT);

    const panel = new MarkdownPanel({
      id: 'summary',
      title: 'Summary',
      markdown: 'Theme inheritance'
    });
    render(<PanelThemeScope panel={panel}>{panel.content}</PanelThemeScope>, panelRoot);

    host.setProps({components: [containerPanelComponent]});
    await Promise.resolve();

    const themeScope = panelRoot.querySelector<HTMLElement>('[data-panel-theme-mode]');
    expect(themeScope?.dataset.panelThemeMode).toBe('light');

    applyPanelTheme(root, PANEL_THEME_DARK);
    await Promise.resolve();
    await Promise.resolve();

    expect(themeScope?.dataset.panelThemeMode).toBe('dark');
  });
});
