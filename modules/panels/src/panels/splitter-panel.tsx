/** @jsxImportSource preact */
import {useCallback, useEffect, useRef, useState} from 'preact/hooks';

import {ColumnPanelContainer} from './column-panel';
import {PanelThemeScope} from './panel-theme-scope';

import type {JSX} from 'preact';
import type {Panel, PanelTheme} from './panel-types';

export type SplitterPanelOrientation = 'horizontal' | 'vertical';

export type SplitterPanelProps = {
  panels: ReadonlyArray<Panel>;
  id?: string;
  title?: string;
  theme?: PanelTheme;
  orientation?: SplitterPanelOrientation;
  initialSplit?: number;
  editable?: boolean;
  minSplit?: number;
  maxSplit?: number;
  onChange?: (split: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

type SplitterPanelContentProps = {
  panels: ReadonlyArray<Panel>;
  orientation: SplitterPanelOrientation;
  initialSplit: number;
  editable: boolean;
  minSplit: number;
  maxSplit: number;
  onChange?: (split: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
};

export class SplitterPanel implements Panel {
  id: string;
  title: string;
  content: JSX.Element;
  theme?: PanelTheme;

  constructor({
    panels,
    id = 'splitter-panels',
    title = 'Panels',
    theme = 'inherit',
    orientation = 'horizontal',
    initialSplit = 0.5,
    editable = true,
    minSplit = 0.05,
    maxSplit = 0.95,
    onChange,
    onDragStart,
    onDragEnd
  }: SplitterPanelProps) {
    this.id = id;
    this.title = title;
    this.theme = theme;
    this.content = (
      <SplitterPanelContent
        panels={panels}
        orientation={orientation}
        initialSplit={initialSplit}
        editable={editable}
        minSplit={minSplit}
        maxSplit={maxSplit}
        onChange={onChange}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    );
  }
}

function SplitterPanelContent({
  panels,
  orientation,
  initialSplit,
  editable,
  minSplit,
  maxSplit,
  onChange,
  onDragStart,
  onDragEnd
}: SplitterPanelContentProps) {
  const firstPanel = panels[0];
  const remainingPanels = panels.slice(1);
  const resolvedMinSplit = normalizeSplitBoundary(minSplit, 0);
  const resolvedMaxSplit = Math.max(resolvedMinSplit, normalizeSplitBoundary(maxSplit, 1));
  const [split, setSplit] = useState(() =>
    clampSplit(initialSplit, resolvedMinSplit, resolvedMaxSplit)
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setSplit(clampSplit(initialSplit, resolvedMinSplit, resolvedMaxSplit));
  }, [initialSplit, resolvedMinSplit, resolvedMaxSplit]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  const updateSplitFromEvent = useCallback(
    (event: PointerEvent | MouseEvent) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const size = orientation === 'horizontal' ? rect.width : rect.height;
      if (size <= 0) {
        return;
      }

      const offset =
        orientation === 'horizontal' ? event.clientX - rect.left : event.clientY - rect.top;
      const nextSplit = clampSplit(offset / size, resolvedMinSplit, resolvedMaxSplit);
      setSplit(nextSplit);
      onChange?.(nextSplit);
    },
    [onChange, orientation, resolvedMinSplit, resolvedMaxSplit]
  );

  if (!firstPanel) {
    return <div style={SPLITTER_CONTAINER_STYLE(orientation)} />;
  }

  if (remainingPanels.length === 0) {
    return (
      <div style={SPLITTER_CONTAINER_STYLE(orientation)}>
        <div style={SPLITTER_PANE_STYLE(1, orientation)}>
          <PanelThemeScope panel={firstPanel}>{firstPanel.content}</PanelThemeScope>
        </div>
      </div>
    );
  }

  const handlePointerDown = (event: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!editable) {
      return;
    }
    event.preventDefault();
    dragCleanupRef.current?.();
    const ownerDocument = event.currentTarget.ownerDocument;
    const handlePointerMove = (moveEvent: PointerEvent | MouseEvent) => {
      updateSplitFromEvent(moveEvent);
    };
    const handlePointerEnd = () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      onDragEnd?.();
    };

    ownerDocument.addEventListener('pointermove', handlePointerMove);
    ownerDocument.addEventListener('pointerup', handlePointerEnd);
    ownerDocument.addEventListener('pointercancel', handlePointerEnd);
    dragCleanupRef.current = () => {
      ownerDocument.removeEventListener('pointermove', handlePointerMove);
      ownerDocument.removeEventListener('pointerup', handlePointerEnd);
      ownerDocument.removeEventListener('pointercancel', handlePointerEnd);
    };
    onDragStart?.();
  };

  return (
    <div ref={containerRef} style={SPLITTER_CONTAINER_STYLE(orientation)}>
      <div style={SPLITTER_PANE_STYLE(split, orientation)}>
        <PanelThemeScope panel={firstPanel}>{firstPanel.content}</PanelThemeScope>
      </div>
      <div
        data-panel-splitter=""
        role="separator"
        aria-orientation={orientation === 'horizontal' ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(resolvedMinSplit * 100)}
        aria-valuemax={Math.round(resolvedMaxSplit * 100)}
        aria-valuenow={Math.round(split * 100)}
        style={SPLITTER_HANDLE_STYLE(orientation, editable)}
        onPointerDown={handlePointerDown}
      >
        <span aria-hidden="true" style={SPLITTER_GRIP_STYLE(orientation, editable)} />
      </div>
      <div style={SPLITTER_PANE_STYLE(1 - split, orientation)}>
        <ColumnPanelContainer panels={remainingPanels} />
      </div>
    </div>
  );
}

const SPLITTER_HANDLE_SIZE_PX = 8;

function SPLITTER_CONTAINER_STYLE(orientation: SplitterPanelOrientation): JSX.CSSProperties {
  return {
    display: 'flex',
    flexDirection: orientation === 'horizontal' ? 'row' : 'column',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    color: 'var(--menu-text, rgb(24, 24, 26))'
  };
}

function SPLITTER_PANE_STYLE(
  split: number,
  orientation: SplitterPanelOrientation
): JSX.CSSProperties {
  const basis = `${split * 100}%`;
  return {
    flex: `0 0 ${basis}`,
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    padding: '0 8px',
    boxSizing: 'border-box'
  };
}

function SPLITTER_HANDLE_STYLE(
  orientation: SplitterPanelOrientation,
  editable: boolean
): JSX.CSSProperties {
  return {
    flex: `0 0 ${SPLITTER_HANDLE_SIZE_PX}px`,
    alignSelf: 'stretch',
    cursor: editable ? (orientation === 'horizontal' ? 'col-resize' : 'row-resize') : 'default',
    position: 'relative',
    background:
      'linear-gradient(var(--menu-border, rgba(148, 163, 184, 0.35)), var(--menu-border, rgba(148, 163, 184, 0.35))) center / 1px 100% no-repeat',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: editable ? 1 : 0.55,
    touchAction: 'none'
  };
}

function SPLITTER_GRIP_STYLE(
  orientation: SplitterPanelOrientation,
  editable: boolean
): JSX.CSSProperties {
  const isHorizontal = orientation === 'horizontal';
  const gripColor = 'var(--menu-border, rgba(148, 163, 184, 0.55))';
  return {
    display: editable ? 'block' : 'none',
    width: isHorizontal ? '8px' : '30px',
    height: isHorizontal ? '30px' : '8px',
    background: isHorizontal
      ? `linear-gradient(${gripColor}, ${gripColor}) left center / 1px 18px no-repeat,
        linear-gradient(${gripColor}, ${gripColor}) right center / 1px 18px no-repeat`
      : `linear-gradient(${gripColor}, ${gripColor}) center top / 18px 1px no-repeat,
        linear-gradient(${gripColor}, ${gripColor}) center bottom / 18px 1px no-repeat`,
    opacity: 0.75,
    pointerEvents: 'none'
  };
}

function normalizeSplitBoundary(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : fallback;
}

function clampSplit(value: number, minSplit: number, maxSplit: number): number {
  const normalizedValue = normalizeSplitBoundary(value, 0.5);
  return Math.min(Math.max(normalizedValue, minSplit), maxSplit);
}
