/** @jsxImportSource preact */
import {Panel} from '../../panels/panel';
import type {PanelTheme} from '../../panels/panel';

/** Scalar telemetry value displayed by a metrics panel. */
export type MetricValue = string | number | boolean | null | undefined;

/** Configuration for a plain-data metrics panel. */
export type MetricsPanelProps = {
  /** Stable panel identifier. */
  id: string;
  /** Visible panel title. */
  title: string;
  /** Metric values keyed by their stable names. */
  metrics: Readonly<Record<string, MetricValue>>;
  /** Ordered subset of metrics. Defaults to object insertion order. */
  metricNames?: ReadonlyArray<string>;
  /** Optional labels keyed by metric name. */
  labels?: Readonly<Record<string, string>>;
  /** Optional host formatter for units, ratios, durations, and missing values. */
  formatValue?: (value: MetricValue, name: string) => string;
  /** Optional panel theme override. */
  theme?: PanelTheme;
};

/** Renders scalar telemetry without requiring a probe.gl Stats instance. */
export class MetricsPanel extends Panel {
  /** Creates a metrics panel from a host-owned snapshot. */
  constructor(props: MetricsPanelProps) {
    super({
      id: props.id,
      title: props.title,
      theme: props.theme,
      content: <MetricsContent {...props} />
    });
  }
}

/** Renders an accessible list of metric labels and formatted values. */
function MetricsContent({metrics, metricNames, labels, formatValue}: MetricsPanelProps) {
  const names = (metricNames ?? Object.keys(metrics)).filter(name => Object.hasOwn(metrics, name));
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: '8px 12px',
        margin: 0,
        color: 'var(--menu-text, inherit)'
      }}
    >
      {names.map(name => (
        <div key={name} style={{display: 'contents'}}>
          <dt>{labels?.[name] ?? name}</dt>
          <dd style={{margin: 0, textAlign: 'right', fontVariantNumeric: 'tabular-nums'}}>
            {formatValue ? formatValue(metrics[name], name) : String(metrics[name] ?? '—')}
          </dd>
        </div>
      ))}
    </dl>
  );
}
