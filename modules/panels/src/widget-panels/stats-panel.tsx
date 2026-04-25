/* eslint react/react-in-jsx-scope: 0 */
/** @jsxImportSource preact */
import {useMemo} from 'preact/hooks';

import {useEffectiveWidgetPanelThemeMode} from './widget-containers';

import type {WidgetPanel, WidgetPanelTheme} from './widget-containers';
import type {JSX} from 'preact';
import type {Stats} from '@probe.gl/stats';

/** Props for {@link StatsPanel}. */
export type StatsPanelProps = {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Probe.gl stats bag rendered by this panel. */
  stats: Stats;
  /** Optional stat names to render and their order. Defaults to all stats in insertion order. */
  statNames?: string[];
  /** Optional label mapping for displayed stat names. */
  labels?: Partial<Record<string, string>>;
  /** Optional class name applied to the outer panel content wrapper. */
  className?: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
};

/** Widget panel that renders a compact table of probe.gl stats. */
export class StatsPanel implements WidgetPanel {
  /** Stable panel id used by parent containers. */
  id: string;
  /** Visible heading text for the panel. */
  title: string;
  /** Optional theme override applied to this panel subtree. */
  theme?: WidgetPanelTheme;
  /** Rendered Preact content for this panel. */
  content: JSX.Element;

  /** Creates a stats panel for one probe.gl {@link Stats} bag. */
  constructor(props: StatsPanelProps) {
    this.id = props.id;
    this.title = props.title;
    this.theme = props.theme ?? 'inherit';
    this.content = <StatsPanelContent {...props} />;
  }
}

/** Renders the stats rows used by {@link StatsPanel}. */
function StatsPanelContent({stats, statNames, labels, className}: StatsPanelProps): JSX.Element {
  const themeMode = useEffectiveWidgetPanelThemeMode();
  const rows = useMemo(() => {
    const table = stats.getTable();
    const names = statNames ?? Object.keys(table);
    return names
      .filter((name) => table[name])
      .map((name) => ({
        name,
        label: labels?.[name] ?? name,
        value: table[name].count
      }));
  }, [labels, statNames, stats]);

  /** Theme-aware colors used by the stats table. */
  const colors =
    themeMode === 'dark'
      ? {
          text: '#f8fafc',
          muted: 'rgba(226, 232, 240, 0.78)',
          divider: 'rgba(148, 163, 184, 0.22)'
        }
      : {
          text: '#0f172a',
          muted: 'rgba(15, 23, 42, 0.72)',
          divider: 'rgba(15, 23, 42, 0.12)'
        };

  return (
    <div className={className} style={{display: 'grid', gap: '8px'}}>
      {rows.map((row, index) => (
        <div
          key={row.name}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '12px',
            alignItems: 'baseline',
            paddingTop: index === 0 ? '0' : '8px',
            borderTop: index === 0 ? 'none' : `1px solid ${colors.divider}`
          }}
        >
          <span
            style={{color: colors.muted, font: '600 12px/1.4 ui-sans-serif,system-ui,sans-serif'}}
          >
            {row.label}
          </span>
          <span
            style={{
              color: colors.text,
              font: '700 12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace'
            }}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}
