import {
  AccordionPanel,
  MarkdownPanel,
  SplitterPanel,
  TextEditorPanel,
  ColumnPanel,
  Panel,
  type PanelProps,
  createStudioSettingsPanel
} from '@deck.gl-community/panels';
// @ts-expect-error Removed misspelled public export.
import type {AccordeonPanel} from '@deck.gl-community/panels';
void (null as AccordeonPanel | null);

const summary = new MarkdownPanel({id: 'summary', title: 'Summary', markdown: 'Ready'});
summary.setProps({markdown: 'Updated'});
// @ts-expect-error Public specialized props reject misspelled fields.
summary.setProps({markdwon: 'Typo'});
const accordion = new AccordionPanel({panels: [summary], defaultExpandedPanelIds: ['summary']});
accordion.setProps({
  expandedPanelIds: [],
  onExpandedPanelIdsChange: ids => {
    const selected: readonly string[] = ids;
    void selected;
  }
});
const split = new SplitterPanel({
  panels: [summary],
  split: 0.4,
  onSplitChange: value => {
    const ratio: number = value;
    void ratio;
  }
});
split.setProps({split: 0.5, defaultSplit: 0.6});
// @ts-expect-error Removed callback alias.
split.setProps({onChange: (_value: number) => {}});
// @ts-expect-error Removed initialization alias.
new SplitterPanel({panels: [summary], initialSplit: 0.4});
new TextEditorPanel({id: 'source', title: 'Source'}).setProps({value: 'text', readOnly: true});
new ColumnPanel({panels: [summary]}).setProps({panels: [accordion]});
createStudioSettingsPanel({schema: {sections: []}, settings: {}}).setProps({
  settings: {visible: true}
});
class SelectionPanel extends Panel<PanelProps & {selection: number}> {
  override renderContent() {
    return String(this.props.selection);
  }
}
new SelectionPanel({selection: 1}).setProps({selection: 2});

// Identity defaults are part of every concrete panel's public constructor contract.
new MarkdownPanel({title: 'Summary', markdown: 'No explicit id'});
new TextEditorPanel({title: 'Source'});

// @ts-expect-error Removed docked-only sidebar class.
import type {SidePanelContainer} from '@deck.gl-community/panels';
void (null as SidePanelContainer | null);
import {SidebarPanelContainer} from '@deck.gl-community/panels';
const sidebar = new SidebarPanelContainer({pinned: true, pinnable: true, hidable: true});
sidebar.setProps({
  open: false,
  onOpenChange: open => {
    const visible: boolean = open;
    void visible;
  }
});
// @ts-expect-error Visibility has one public state, open; hidden is removed.
sidebar.setProps({hidden: true});
