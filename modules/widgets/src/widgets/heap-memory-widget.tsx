/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';

import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

type HeapMemoryInfo = {
  jsHeapSizeLimit: number;
  totalJSHeapSize: number;
  usedJSHeapSize: number;
};

export type HeapMemoryWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  /** How frequently to poll the heap usage, in milliseconds. */
  pollIntervalMs?: number;
};

const DEFAULT_MEMORY_INFO: HeapMemoryInfo = {
  jsHeapSizeLimit: 0,
  totalJSHeapSize: 0,
  usedJSHeapSize: 0,
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

function formatGigabytesValue(bytes: number): string {
  if (!Number.isFinite(bytes)) {
    return '0.00';
  }
  const gigabytes = bytes / 1024 / 1024 / 1024;
  return gigabytes.toFixed(2);
}

type HeapMemoryWidgetViewProps = {
  pollIntervalMs: number;
};

function HeapMemoryWidgetView({ pollIntervalMs }: HeapMemoryWidgetViewProps) {
  const [memoryInfo, setMemoryInfo] = useState<HeapMemoryInfo>(DEFAULT_MEMORY_INFO);

  useEffect(() => {
    let isMounted = true;

    const updateMemory = () => {
      if (!isMounted || typeof window === 'undefined') {
        return;
      }
      const memory = (window.performance as Performance & { memory?: HeapMemoryInfo }).memory;
      if (!memory) {
        return;
      }

      setMemoryInfo({
        jsHeapSizeLimit: memory.jsHeapSizeLimit ?? 0,
        totalJSHeapSize: memory.totalJSHeapSize ?? 0,
        usedJSHeapSize: memory.usedJSHeapSize ?? 0,
      });
    };

    updateMemory();
    const interval = window.setInterval(updateMemory, Math.max(500, pollIntervalMs));
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [pollIntervalMs]);

  const { jsHeapSizeLimit, totalJSHeapSize, usedJSHeapSize } = memoryInfo;

  const { usedRatio, reservedRatio } = useMemo(() => {
    const limit = jsHeapSizeLimit || 0;
    if (!limit) {
      return { usedRatio: 0, reservedRatio: 0 } as const;
    }
    const used = clampRatio(usedJSHeapSize / limit);
    const total = clampRatio(totalJSHeapSize / limit);

    return {
      usedRatio: used,
      reservedRatio: Math.max(0, total - used),
    } as const;
  }, [jsHeapSizeLimit, totalJSHeapSize, usedJSHeapSize]);

  const gradient = useMemo(() => {
    const usedColor =
      usedRatio < 0.5
        ? 'rgba(107, 114, 128, 0.55)'
        : usedRatio < 0.8
          ? 'rgba(234, 179, 8, 0.6)'
          : 'rgba(239, 68, 68, 0.7)';
    const reservedColor = 'rgba(148, 163, 184, 0.35)';
    const remainingColor = 'rgba(226, 232, 240, 0.35)';

    const usedPercent = (usedRatio * 100).toFixed(2);
    const reservedEnd = ((usedRatio + reservedRatio) * 100).toFixed(2);

    return `linear-gradient(90deg, ${usedColor} 0%, ${usedColor} ${usedPercent}%, ${reservedColor} ${usedPercent}%, ${reservedColor} ${reservedEnd}%, ${remainingColor} ${reservedEnd}%, ${remainingColor} 100%)`;
  }, [reservedRatio, usedRatio]);

  const hasMemoryInfo = jsHeapSizeLimit > 0;
  const valueText = hasMemoryInfo ? formatGigabytesValue(usedJSHeapSize) : 'N/A';
  const title = hasMemoryInfo ? `Heap Size: ${valueText}GB` : 'Heap Size unavailable';

  const buttonStyle: JSX.CSSProperties = {
    position: 'relative',
    padding: 0,
    borderRadius: 'var(--button-corner-radius)',
    backgroundImage: gradient,
    backgroundColor: 'var(--button-background)',
    color: 'var(--deck-widget-text-color, #111827)',
    border: '1px solid var(--button-stroke)',
    boxShadow: 'var(--button-shadow)',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: '0px',
    fontSize: '10px',
    fontWeight: 700,
    userSelect: 'none',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '100% 100%',
    width: '100%',
    height: '100%',
  };

  return (
    <div className="deck-widget-button">
      <button
        className="deck-widget-icon-button deck-widget-heap-memory"
        type="button"
        title={title}
        aria-label="Heap size"
        style={buttonStyle}
      >
        <span
          style={{
            lineHeight: 1.05,
            fontSize: '10px',
            textShadow: '0 1px 1px rgba(255, 255, 255, 0.35)',
          }}
        >
          {valueText}
        </span>
        <span
          style={{
            lineHeight: 1,
            fontSize: '9px',
            textShadow: '0 1px 1px rgba(255, 255, 255, 0.35)',
          }}
        >
          GB
        </span>
      </button>
    </div>
  );
}

export class HeapMemoryWidget extends Widget<HeapMemoryWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'heap-memory',
    placement: 'top-right',
    pollIntervalMs: 2000,
  } satisfies Required<WidgetProps> &
    Required<Pick<HeapMemoryWidgetProps, 'placement' | 'pollIntervalMs'>> &
    HeapMemoryWidgetProps;

  placement: WidgetPlacement = HeapMemoryWidget.defaultProps.placement;
  className = 'deck-widget-heap-memory';

  #pollIntervalMs = HeapMemoryWidget.defaultProps.pollIntervalMs;
  #rootElement: HTMLElement | null = null;

  constructor(props: HeapMemoryWidgetProps = {}) {
    super({ ...HeapMemoryWidget.defaultProps, ...props });
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.pollIntervalMs !== undefined) {
      this.#pollIntervalMs = props.pollIntervalMs;
    }
  }

  override setProps(props: Partial<HeapMemoryWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.pollIntervalMs !== undefined) {
      this.#pollIntervalMs = props.pollIntervalMs;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;
    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');

    rootElement.className = className;

    render(<HeapMemoryWidgetView pollIntervalMs={this.#pollIntervalMs} />, rootElement);
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }
}
