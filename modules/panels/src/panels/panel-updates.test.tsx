/** @jsxImportSource preact */
import {render} from 'preact';
import {useState} from 'preact/hooks';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {Stats} from '@probe.gl/stats';
import {Panel, type PanelProps} from './panel';
import {mountPanel} from './mount-panel';
import {PanelManager} from './panel-manager';
import {BoxPanelContainer} from '../panel-mounts/box-panel-container';
import {ColumnPanel} from '../composite-panels/column-panel';
import {TabbedPanel} from '../composite-panels/tabbed-panel';
import {AccordionPanel} from '../composite-panels/accordion-panel';
import {SplitterPanel} from '../composite-panels/splitter-panel';
import {MarkdownPanel} from '../leaf-panels/markdown/markdown-panel';
import {MetricsPanel} from '../leaf-panels/metrics/metrics-panel';
import {BinaryDataPanel} from '../leaf-panels/binary-data/binary-data-panel';
import {DocumentationLinksPanel} from '../leaf-panels/documentation-links-panel';
import {KeyboardShortcutsPanel} from '../leaf-panels/keyboard-shortcuts/keyboard-shortcuts-panel';
import {URLParametersPanel} from '../leaf-panels/url-parameters/url-parameters-panel';
import {SourcePickerPanel} from '../leaf-panels/source-picker/source-picker-panel';
import {StatsPanel} from '../leaf-panels/stats/stats-panel';
import {ArrowSchemaPanel} from '../leaf-panels/arrow/arrow-schema-panel';
import {ArrowTablePanel} from '../leaf-panels/arrow/arrow-table-panel';
import {ArrowBatchesPanel} from '../leaf-panels/arrow/arrow-batches-panel';
import {SettingsPanel} from '../leaf-panels/settings/settings-panel';
import {createStudioSettingsPanel} from '../leaf-panels/settings/studio-settings-panel';
import {CommandDocumentationPanel} from '../leaf-panels/commands/command-documentation-panel';
import {CommandManager} from '../lib/commands/command-manager';
import {CustomPanel} from '../leaf-panels/custom-panel';

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach(dispose => dispose());
  document.body.innerHTML = '';
});
const metadata = {id: 'data', title: 'Data'};
const schema = (label: string) => ({
  title: label,
  sections: [
    {id: 'main', name: 'Main', settings: [{name: 'value', label, type: 'boolean' as const}]}
  ]
});
function createHost() {
  const root = document.createElement('div');
  document.body.append(root);
  return root;
}
function embed(panel: Panel) {
  const root = createHost();
  const mounted = mountPanel(panel, root);
  cleanup.push(mounted.finalize);
  return root;
}
async function settle() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await new Promise(resolve => setTimeout(resolve, 0));
}
function commandManager(label: string) {
  const manager = new CommandManager();
  manager.registerCommand({id: label, label, do() {}});
  return manager;
}

/** Each case changes actual displayed domain data through the public typed setter. */
const cases: Array<{
  name: string;
  create: () => {panel: Panel; update: () => void; expected: string};
}> = [
  {
    name: 'MarkdownPanel',
    create() {
      const panel = new MarkdownPanel({...metadata, markdown: 'Alpha'});
      return {panel, update: () => panel.setProps({markdown: 'Beta'}), expected: 'Beta'};
    }
  },
  {
    name: 'MetricsPanel',
    create() {
      const panel = new MetricsPanel({...metadata, metrics: {value: 'Alpha'}});
      return {panel, update: () => panel.setProps({metrics: {value: 'Beta'}}), expected: 'Beta'};
    }
  },
  {
    name: 'BinaryDataPanel',
    create() {
      const panel = new BinaryDataPanel({...metadata, data: new TextEncoder().encode('Alpha')});
      return {
        panel,
        update: () => panel.setProps({data: new TextEncoder().encode('Beta')}),
        expected: '42'
      };
    }
  },
  {
    name: 'DocumentationLinksPanel',
    create() {
      const panel = new DocumentationLinksPanel({links: []});
      return {
        panel,
        update: () => panel.setProps({links: [{id: 'help', title: 'Beta', href: '/help'}]}),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'KeyboardShortcutsPanel',
    create() {
      const panel = new KeyboardShortcutsPanel();
      return {
        panel,
        update: () =>
          panel.setProps({keyboardShortcuts: [{key: 'b', name: 'Beta', description: 'Beta'}]}),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'URLParametersPanel',
    create() {
      const panel = new URLParametersPanel();
      return {
        panel,
        update: () =>
          panel.setProps({
            urlParameters: [
              {name: 'beta', description: 'Beta', serialize: () => undefined, deserialize() {}}
            ]
          }),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'StatsPanel',
    create() {
      const stats = new Stats({id: 'stats'});
      stats.get('first').incrementCount();
      const panel = new StatsPanel({...metadata, stats});
      return {panel, update: () => panel.setProps({labels: {first: 'Beta'}}), expected: 'Beta'};
    }
  },
  {
    name: 'ArrowSchemaPanel',
    create() {
      const panel = new ArrowSchemaPanel({...metadata});
      return {
        panel,
        update: () => panel.setProps({schema: {fields: [{name: 'Beta', type: 'Utf8'}]}}),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'ArrowTablePanel',
    create() {
      const panel = new ArrowTablePanel({...metadata});
      return {
        panel,
        update: () =>
          panel.setProps({
            table: {
              numRows: 1,
              schema: {fields: [{name: 'Beta', type: 'Utf8'}]},
              getChild: () => ({get: () => 'Beta'})
            }
          }),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'ArrowBatchesPanel',
    create() {
      const panel = new ArrowBatchesPanel({...metadata});
      return {
        panel,
        update: () =>
          panel.setProps({table: {numRows: 7, schema: {fields: []}, batches: [{numRows: 7}]}}),
        expected: '7 rows total'
      };
    }
  },
  {
    name: 'SettingsPanel',
    create() {
      const panel = new SettingsPanel({schema: schema('Alpha'), settings: {value: false}});
      return {panel, update: () => panel.setProps({schema: schema('Beta')}), expected: 'Beta'};
    }
  },
  {
    name: 'SettingsPanel section bridge',
    create() {
      const panel = SettingsPanel.createSectionPanels({
        schema: schema('Alpha'),
        settings: {value: false}
      })[0];
      return {
        panel,
        update: () => panel.setProps({section: schema('Beta').sections[0]}),
        expected: 'Beta'
      };
    }
  },
  {
    name: 'StudioSettingsPanel bridge',
    create() {
      const panel = createStudioSettingsPanel({schema: schema('Alpha'), settings: {value: false}});
      return {panel, update: () => panel.setProps({schema: schema('Beta')}), expected: 'Beta'};
    }
  },
  {
    name: 'CommandDocumentationPanel',
    create() {
      const panel = new CommandDocumentationPanel({manager: commandManager('Alpha')});
      return {
        panel,
        update: () => panel.setProps({manager: commandManager('Beta')}),
        expected: 'Beta'
      };
    }
  }
];

describe('rendering from public panel props', () => {
  it('uses stable per-class default ids and accepts explicit identities', () => {
    const markdown = new MarkdownPanel({title: 'Summary', markdown: 'Ready'});
    const metrics = new MetricsPanel({title: 'Metrics', metrics: {count: 1}});
    const table = new ArrowTablePanel({title: 'Table'});
    const source = new SourcePickerPanel({title: 'Source', onLoadUrl() {}});
    expect([markdown.id, metrics.id, table.id, source.id]).toEqual([
      'markdown-panel',
      'metrics-panel',
      'arrow-table-panel',
      'source-picker-panel'
    ]);
    expect(new MarkdownPanel({title: 'Other', markdown: 'Ready'}).id).toBe(markdown.id);
    expect(new MarkdownPanel({id: 'second-summary', title: 'Other', markdown: 'Ready'}).id).toBe(
      'second-summary'
    );
    expect(new DocumentationLinksPanel().id).toBe('documentation-links');
  });

  for (const item of cases)
    it(`updates ${item.name} inside a nested composition`, async () => {
      const {panel, update, expected} = item.create();
      const root = embed(new ColumnPanel({panels: [panel]}));
      update();
      await settle();
      expect(root.textContent).toContain(expected);
    });

  it('keeps default-id source picker labels scoped to their own input across hosts', () => {
    const a = embed(new SourcePickerPanel({title: 'First', onLoadUrl() {}}));
    const b = embed(new SourcePickerPanel({title: 'Second', onLoadUrl() {}}));
    const firstInput = a.querySelector<HTMLInputElement>('input[type="url"]')!;
    const secondInput = b.querySelector<HTMLInputElement>('input[type="url"]')!;
    expect(firstInput.id).not.toBe(secondInput.id);
    expect(a.querySelector<HTMLLabelElement>('label')?.control).toBe(firstInput);
    expect(b.querySelector<HTMLLabelElement>('label')?.control).toBe(secondInput);
  });

  it('applies and restores optional defaults consistently in constructors and setters', async () => {
    const panel = new DocumentationLinksPanel({links: undefined});
    const root = embed(panel);
    panel.setProps({links: [{id: 'help', title: 'Beta', href: '/help'}]});
    await settle();
    expect(root.textContent).toContain('Beta');
    panel.setProps({links: undefined});
    await settle();
    expect(root.textContent).not.toContain('Beta');
    const settings = new SettingsPanel({schema: undefined});
    expect(settings.title).toBe('Settings');
    const settingsRoot = embed(settings);
    settings.setProps({
      schema: {...schema('Beta'), sections: [{...schema('Beta').sections[0], name: 'Beta'}]}
    });
    await settle();
    expect(settingsRoot.textContent).toContain('Beta');
    settings.setProps({schema: undefined});
    await settle();
    expect(settingsRoot.textContent).not.toContain('Beta');
  });

  it('reconciles specialized constructor props while retaining the mounted shell', async () => {
    const root = createHost();
    const first = new MarkdownPanel({...metadata, markdown: 'Alpha'});
    const manager = new PanelManager({parentElement: root, components: [first]});
    cleanup.push(() => manager.finalize());
    const element = first.rootElement;
    manager.setProps({components: [new MarkdownPanel({...metadata, markdown: 'Beta'})]});
    await settle();
    expect(manager.getComponents()[0]).toBe(first);
    expect(first.rootElement).toBe(element);
    expect(root.textContent).toContain('Beta');
    first.setProps({markdown: 'Gamma'});
    await settle();
    expect(root.textContent).toContain('Gamma');
  });

  it('refreshes a container title from child props and releases its subscription on removal', async () => {
    const panel = new MarkdownPanel({...metadata, markdown: 'Alpha'});
    const shell = new BoxPanelContainer({id: 'shell', panel, collapsible: true, pinnable: true});
    const root = createHost();
    const manager = new PanelManager({parentElement: root, components: [shell]});
    cleanup.push(() => manager.finalize());
    panel.setProps({title: 'Beta', markdown: 'Updated body'});
    await settle();
    expect(root.querySelector('[aria-label="Collapse Beta"]')).toBeTruthy();
    expect(root.textContent).toContain('Updated body');
    const unsubscribe = vi.fn(),
      subscribe = vi.spyOn(panel, 'subscribe').mockReturnValue(unsubscribe);
    shell.setProps({panel});
    expect(subscribe).toHaveBeenCalled();
    manager.setProps({components: []});
    expect(unsubscribe).toHaveBeenCalled();
    panel.setProps({title: 'Removed'});
    await settle();
    expect(root.textContent).not.toContain('Removed');
  });

  it('updates nested headers, themes, children and local tab state without remounting controls', async () => {
    const source = new SourcePickerPanel({...metadata, defaultUrl: 'initial', onLoadUrl() {}});
    const summary = new MarkdownPanel({id: 'summary', title: 'Summary', markdown: 'Alpha'});
    const tabs = new TabbedPanel({panels: [summary, source], defaultActivePanelId: 'summary'});
    const root = embed(tabs);
    root.querySelectorAll<HTMLButtonElement>('[data-panel-tabs] button')[1].click();
    await settle();
    const input = root.querySelector<HTMLInputElement>('input[type="url"]')!;
    input.value = 'local edit';
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await settle();
    source.setProps({title: 'Updated source', defaultUrl: 'ignored', theme: 'sleek-dark'});
    tabs.setProps({
      title: 'New heading',
      panels: [summary, source],
      defaultActivePanelId: 'summary'
    });
    await settle();
    expect(root.querySelector('input[type="url"]')).toBe(input);
    expect(input.value).toBe('local edit');
    expect(root.querySelector('[data-panel-active="true"]')?.textContent).toBe('Updated source');
    expect(
      input.closest('[data-panel-theme-preset]')?.getAttribute('data-panel-theme-preset')
    ).toBe('sleek-dark');
    const next = new MarkdownPanel({id: 'next', title: 'Next', markdown: 'New child'});
    tabs.setProps({panels: [next, source]});
    await settle();
    next.setProps({title: 'Changed child', markdown: 'Fresh child'});
    await settle();
    expect(root.textContent).toContain('Changed child');
    expect(root.textContent).toContain('Fresh child');
  });

  it('applies controlled tab selection and current callbacks through the public class', async () => {
    const first = vi.fn(),
      next = vi.fn();
    const panels = ['a', 'b'].map(id => new MarkdownPanel({id, title: id, markdown: id}));
    const tabs = new TabbedPanel({
      panels,
      activePanelId: 'a',
      defaultActivePanelId: 'b',
      onActivePanelIdChange: first
    });
    const root = embed(tabs);
    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-panel-tabs] button');
    buttons[1].click();
    await settle();
    expect(first).toHaveBeenCalledWith('b');
    expect(root.querySelector('[data-panel-active="true"]')?.textContent).toBe('a');
    tabs.setProps({activePanelId: 'b', onActivePanelIdChange: next});
    await settle();
    expect(root.querySelector('[data-panel-active="true"]')?.textContent).toBe('b');
    buttons[0].click();
    await settle();
    expect(next).toHaveBeenCalledWith('a');
    expect(root.querySelector('[data-panel-active="true"]')?.textContent).toBe('b');
  });

  it('keeps accordion defaults local and accepts controlled expansion updates', async () => {
    const a = new MarkdownPanel({...metadata, markdown: 'Alpha'}),
      b = new MarkdownPanel({id: 'b', title: 'B', markdown: 'Beta'});
    const panel = new AccordionPanel({
      panels: [a, b],
      defaultExpandedPanelIds: ['data'],
      allowMultipleExpanded: false
    });
    const root = embed(panel);
    root
      .querySelectorAll('section > button')[1]
      .dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    await settle();
    panel.setProps({defaultExpandedPanelIds: ['data'], title: 'Updated'});
    await settle();
    expect(root.textContent).toContain('Beta');
    expect(root.textContent).not.toContain('Alpha');
    panel.setProps({expandedPanelIds: ['data']});
    await settle();
    expect(root.textContent).toContain('Alpha');
    expect(root.textContent).not.toContain('Beta');
  });

  it('cleans custom renderers only when their callback changes or the surface unmounts', async () => {
    const dispose = vi.fn();
    const first = vi.fn((root: HTMLElement) => {
      root.textContent = 'Alpha';
      return dispose;
    });
    const panel = new CustomPanel({...metadata, onRenderHTML: first});
    const root = embed(panel);
    panel.setProps({title: 'Renamed'});
    await settle();
    expect(first).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    panel.setProps({
      onRenderHTML: host => {
        host.textContent = 'Beta';
        return dispose;
      }
    });
    await settle();
    expect(root.textContent).toContain('Beta');
    expect(dispose).toHaveBeenCalledOnce();
    cleanup.pop()?.();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('supports typed custom panel props and preserves Preact component state', async () => {
    function Counter({label}: {label: string}) {
      const [count, setCount] = useState(0);
      return (
        <button onClick={() => setCount(count + 1)}>
          {label}:{count}
        </button>
      );
    }
    class CounterPanel extends Panel<PanelProps & {label: string}> {
      override renderContent() {
        return <Counter label={this.props.label} />;
      }
    }
    const panel = new CounterPanel({label: 'Alpha'});
    const root = embed(panel);
    root.querySelector('button')?.click();
    await settle();
    panel.setProps({label: 'Beta'});
    await settle();
    expect(root.textContent).toBe('Beta:1');
  });
});

describe('SplitterPanel public controlled and default props', () => {
  function createSplitter(props: Partial<ConstructorParameters<typeof SplitterPanel>[0]> = {}) {
    const panel = new SplitterPanel({
      panels: [
        new MarkdownPanel({...metadata, markdown: 'Alpha'}),
        new MarkdownPanel({id: 'b', title: 'B', markdown: 'Beta'})
      ],
      ...props
    });
    const root = createHost();
    render(panel.content, root);
    cleanup.push(() => render(null, root));
    const surface = root.firstElementChild as HTMLElement;
    surface.getBoundingClientRect = () => ({left: 0, top: 0, width: 100, height: 100}) as DOMRect;
    const handle = root.querySelector<HTMLElement>('[data-panel-splitter]')!;
    return {
      panel,
      root,
      handle,
      move: (x: number) =>
        document.dispatchEvent(new MouseEvent('pointermove', {clientX: x, bubbles: true}))
    };
  }
  it('lets controlled split win, emits requests, and uses current callbacks during an active drag', async () => {
    const order: string[] = [],
      first = vi.fn(() => order.push('first')),
      next = vi.fn(() => order.push('next'));
    const {panel, handle, move} = createSplitter({
      split: 0.3,
      defaultSplit: 0.8,
      minSplit: 0.2,
      maxSplit: 0.7,
      onDragStart: () => order.push('start'),
      onDragEnd: () => order.push('end'),
      onSplitChange: first
    });
    expect(handle.getAttribute('aria-valuenow')).toBe('30');
    handle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    move(90);
    await settle();
    expect(first).toHaveBeenLastCalledWith(0.7);
    expect(handle.getAttribute('aria-valuenow')).toBe('30');
    panel.setProps({split: 0.6, onSplitChange: next});
    await settle();
    expect(handle.getAttribute('aria-valuenow')).toBe('60');
    expect(next).not.toHaveBeenCalled();
    move(10);
    await settle();
    document.dispatchEvent(new PointerEvent('pointerup'));
    move(50);
    await settle();
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(0.2);
    expect(order).toEqual(['start', 'first', 'next', 'end']);
    expect(handle.getAttribute('aria-valuenow')).toBe('60');
  });
  it('reads defaults only on mount and clamps later bounds without emitting change callbacks', async () => {
    const onSplitChange = vi.fn();
    const {panel, handle, move} = createSplitter({defaultSplit: 0.4, onSplitChange});
    handle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    move(65);
    document.dispatchEvent(new PointerEvent('pointerup'));
    await settle();
    expect(handle.getAttribute('aria-valuenow')).toBe('65');
    panel.setProps({defaultSplit: 0.1});
    await settle();
    expect(handle.getAttribute('aria-valuenow')).toBe('65');
    panel.setProps({maxSplit: 0.5});
    await settle();
    expect(handle.getAttribute('aria-valuenow')).toBe('50');
    expect(onSplitChange).toHaveBeenCalledOnce();
  });
  it('removes document drag listeners when unmounted', async () => {
    const onSplitChange = vi.fn();
    const {handle, move} = createSplitter({onSplitChange});
    handle.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}));
    cleanup.pop()?.();
    move(90);
    await settle();
    expect(onSplitChange).not.toHaveBeenCalled();
  });
});
