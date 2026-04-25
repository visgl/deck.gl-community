/** @jsxImportSource preact */
import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {ToastWidget} from './widget-panels/toast-widget';
import {ToolbarWidget} from './widget-panels/toolbar-widget';
import {WidgetHost} from './widget-host';
import {Widget} from './widget';

type TestWidgetProps = {
  id?: string;
  className?: string;
  style?: Partial<CSSStyleDeclaration>;
  _container?: string | HTMLDivElement | null;
  placement?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'fill';
  text: string;
};

class TestWidget extends Widget<TestWidgetProps> {
  static defaultProps = {
    ...Widget.defaultProps,
    id: 'test-widget',
    placement: 'top-left' as const,
    text: ''
  };

  className = 'deck-widget-test';
  placement = TestWidget.defaultProps.placement;

  constructor(props: Partial<TestWidgetProps> & Pick<TestWidgetProps, 'text'>) {
    super({...TestWidget.defaultProps, ...props});
    this.setProps(this.props);
  }

  override setProps(props: Partial<TestWidgetProps>): void {
    if (props.placement) {
      this.placement = props.placement;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    rootElement.className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');
    render(<div data-test-widget-text="">{this.props.text}</div>, rootElement);
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

function createHostRoot() {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = '960px';
  root.style.height = '640px';
  document.body.appendChild(root);
  return root;
}

describe('WidgetHost', () => {
  it('mounts standalone widgets without a Deck instance', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});

    host.setProps({
      widgets: [
        new TestWidget({
          id: 'summary',
          placement: 'top-left',
          text: 'Standalone host content'
        }),
        new ToolbarWidget({
          id: 'toolbar',
          items: [{kind: 'action', id: 'save', label: 'Save'}]
        }),
        new ToastWidget({
          id: 'toast'
        })
      ]
    });

    expect(root.classList.contains('deck-widget-container')).toBe(true);
    expect(root.querySelector('.deck-widget-test')?.textContent).toContain(
      'Standalone host content'
    );
    expect(root.querySelector('.deck-widget-toolbar')?.textContent).toContain('Save');
    expect(root.querySelector('.deck-widget-toast')).toBeTruthy();
    expect(root.querySelector('.top-left')).toBeTruthy();
    expect(root.querySelector('.top-right')).toBeTruthy();
    expect(root.querySelector('.bottom-right')).toBeTruthy();
  });

  it('reconciles widgets by id and updates an existing mounted instance', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});
    const initialWidget = new TestWidget({
      id: 'summary',
      text: 'First content'
    });

    host.setProps({widgets: [initialWidget]});

    const updatedWidget = new TestWidget({
      id: 'summary',
      text: 'Updated content'
    });

    host.setProps({widgets: [updatedWidget]});

    expect(host.getWidgets()[0]).toBe(initialWidget);
    expect(root.textContent).toContain('Updated content');
    expect(root.querySelectorAll('.deck-widget-test')).toHaveLength(1);
  });

  it('honors an explicit HTMLElement container override', () => {
    const root = createHostRoot();
    const explicitContainer = document.createElement('div');
    root.appendChild(explicitContainer);

    const host = new WidgetHost({parentElement: root});
    host.setProps({
      widgets: [
        new ToolbarWidget({
          id: 'toolbar',
          _container: explicitContainer,
          items: [{kind: 'action', id: 'custom', label: 'Explicit'}]
        })
      ]
    });

    expect(explicitContainer.querySelector('.deck-widget-toolbar')?.textContent).toContain(
      'Explicit'
    );
    expect(root.querySelector('.top-right .deck-widget-toolbar')).toBeNull();
  });

  it('finalizes widgets and removes internal placement containers', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});

    host.setProps({
      widgets: [new TestWidget({id: 'summary', text: 'Content', placement: 'bottom-left'})]
    });

    expect(root.querySelector('.bottom-left')).toBeTruthy();

    host.finalize();

    expect(root.classList.contains('deck-widget-container')).toBe(false);
    expect(root.querySelector('.deck-widget-test')).toBeNull();
    expect(root.querySelector('.bottom-left')).toBeNull();
  });

  it('supports interactive updates in standalone mode', async () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});
    const state = {
      accent: 'Ocean'
    };

    const summaryWidget = new TestWidget({
      id: 'summary',
      placement: 'top-left',
      text: `Accent: ${state.accent}`
    });

    const syncWidgets = () => {
      summaryWidget.setProps({text: `Accent: ${state.accent}`});
    };

    const toolbarWidget = new ToolbarWidget({
      id: 'toolbar',
      items: [
        {
          kind: 'action',
          id: 'accent',
          label: 'Accent',
          onClick: () => {
            state.accent = 'Sunset';
            syncWidgets();
          }
        },
        {
          kind: 'action',
          id: 'night',
          label: 'Night',
          onClick: () => {
            state.accent = 'Midnight';
            syncWidgets();
          }
        }
      ]
    });

    host.setProps({widgets: [summaryWidget, toolbarWidget]});

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
});
