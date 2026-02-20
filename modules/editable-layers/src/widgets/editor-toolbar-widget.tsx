// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import type {JSX} from 'preact';
import {Widget, type WidgetProps, type WidgetPlacement, type Deck} from '@deck.gl/core';

export type BooleanOperation = 'union' | 'difference' | 'intersection' | null;

export type EditorToolbarWidgetProps = WidgetProps & {
  /** Placement for the widget root element. */
  placement?: WidgetPlacement;
  /** Currently active boolean operation. */
  booleanOperation?: BooleanOperation;
  /** Number of features in the current dataset. */
  featureCount?: number;
  /** Callback fired when the user selects a boolean operation. */
  onSetBooleanOperation?: (op: BooleanOperation) => void;
  /** Callback fired when the user clicks the clear button. */
  onClear?: () => void;
  /** Callback fired when the user clicks the export button. */
  onExport?: () => void;
};

// --- Styles (match EditModeTrayWidget visual language) ---

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  pointerEvents: 'auto',
  userSelect: 'none',
  zIndex: '99'
};

const TRAY_STYLE: JSX.CSSProperties = {
  display: 'flex',
  gap: '4px',
  background: 'rgba(36, 40, 41, 0.88)',
  borderRadius: '999px',
  padding: '5px 8px',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
};

const BUTTON_STYLE: JSX.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  color: '#f0f0f0',
  height: '30px',
  padding: '0 8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '4px',
  borderRadius: '15px',
  cursor: 'pointer',
  fontSize: '11px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontWeight: '500',
  transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
  whiteSpace: 'nowrap'
};

const BUTTON_ACTIVE_STYLE: JSX.CSSProperties = {
  background: '#0071e3',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.35)'
};

const DIVIDER_STYLE: JSX.CSSProperties = {
  width: '1px',
  height: '20px',
  background: 'rgba(255, 255, 255, 0.2)',
  margin: '0 2px',
  flexShrink: '0'
};

const BADGE_STYLE: JSX.CSSProperties = {
  color: 'rgba(255, 255, 255, 0.6)',
  fontSize: '11px',
  padding: '0 6px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  whiteSpace: 'nowrap'
};

// --- SVG Icons (14x14) ---

function PencilIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10 1.5l2.5 2.5L4.5 12H2v-2.5z" />
    </svg>
  );
}

function SubtractIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
    >
      <rect x="1" y="1" width="8" height="8" rx="1.5" />
      <rect x="5" y="5" width="8" height="8" rx="1.5" fill="rgba(36,40,41,0.88)" />
    </svg>
  );
}

function UnionIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
    >
      <rect x="1" y="1" width="8" height="8" rx="1.5" />
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
    </svg>
  );
}

function IntersectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" strokeWidth="1.1">
      <rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" opacity="0.4" />
      <rect x="5" y="5" width="8" height="8" rx="1.5" stroke="currentColor" opacity="0.4" />
      <rect x="5" y="5" width="4" height="4" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4h9M5.5 4V2.5h3V4M3.5 4l.5 8h6l.5-8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2v7M4.5 6.5L7 9l2.5-2.5M2.5 11.5h9" />
    </svg>
  );
}

// --- Widget ---

const BOOLEAN_OPS: Array<{
  op: BooleanOperation;
  icon: () => JSX.Element;
  label: string;
  title: string;
}> = [
  {op: null, icon: PencilIcon, label: 'Edit', title: 'Draw new features'},
  {op: 'difference', icon: SubtractIcon, label: 'Sub', title: 'Subtract from selection'},
  {op: 'union', icon: UnionIcon, label: 'Union', title: 'Union with selection'},
  {op: 'intersection', icon: IntersectIcon, label: 'Sect', title: 'Intersect with selection'}
];

export class EditorToolbarWidget extends Widget<EditorToolbarWidgetProps> {
  static override defaultProps = {
    id: 'editor-toolbar',
    _container: null,
    placement: 'bottom-left',
    booleanOperation: null,
    featureCount: 0,
    style: {},
    className: ''
  } satisfies Required<WidgetProps> &
    Required<Pick<EditorToolbarWidgetProps, 'placement'>> &
    EditorToolbarWidgetProps;

  placement: WidgetPlacement = 'bottom-left';
  className = 'deck-widget-editor-toolbar';
  deck?: Deck | null = null;
  private appliedCustomClassName: string | null = null;

  constructor(props: EditorToolbarWidgetProps = {}) {
    super({...EditorToolbarWidget.defaultProps, ...props});
    this.placement = props.placement ?? EditorToolbarWidget.defaultProps.placement;
  }

  override setProps(props: Partial<EditorToolbarWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    super.setProps(props);
    this.renderToolbar();
  }

  override onAdd({deck}: {deck: Deck}): void {
    this.deck = deck;
  }

  override onRemove(): void {
    this.deck = null;
    const root = this.rootElement;
    if (root) {
      render(null, root);
    }
    this.rootElement = null;
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    const style = {...ROOT_STYLE, ...this.props.style};
    Object.assign(rootElement.style, style);
    if (this.appliedCustomClassName && this.appliedCustomClassName !== this.props.className) {
      rootElement.classList.remove(this.appliedCustomClassName);
      this.appliedCustomClassName = null;
    }
    if (this.props.className) {
      rootElement.classList.add(this.props.className);
      this.appliedCustomClassName = this.props.className;
    }
    rootElement.classList.add(this.className);
    this.renderToolbar();
  }

  private renderToolbar() {
    const root = this.rootElement;
    if (!root) {
      return;
    }

    const booleanOp = this.props.booleanOperation ?? null;
    const featureCount = this.props.featureCount ?? 0;

    const stopEvent = (event: Event) => {
      event.stopPropagation();
      if (typeof (event as any).stopImmediatePropagation === 'function') {
        (event as any).stopImmediatePropagation();
      }
    };

    const ui = (
      <div
        style={TRAY_STYLE}
        onPointerDown={stopEvent}
        onPointerMove={stopEvent}
        onPointerUp={stopEvent}
        onMouseDown={stopEvent}
        onMouseMove={stopEvent}
        onMouseUp={stopEvent}
        onTouchStart={stopEvent}
        onTouchMove={stopEvent}
        onTouchEnd={stopEvent}
      >
        {/* Boolean operation toggle buttons */}
        {BOOLEAN_OPS.map(({op, icon: Icon, label, title}) => {
          const active = booleanOp === op;
          return (
            <button
              key={label}
              type="button"
              title={title}
              aria-pressed={active}
              style={{...BUTTON_STYLE, ...(active ? BUTTON_ACTIVE_STYLE : {})}}
              onClick={(event) => {
                stopEvent(event);
                this.props.onSetBooleanOperation?.(op);
              }}
            >
              <Icon />
              <span>{label}</span>
            </button>
          );
        })}

        <div style={DIVIDER_STYLE} />

        {/* Clear button */}
        <button
          type="button"
          title="Clear all features"
          style={BUTTON_STYLE}
          onClick={(event) => {
            stopEvent(event);
            this.props.onClear?.();
          }}
        >
          <TrashIcon />
        </button>

        {/* Export button */}
        <button
          type="button"
          title="Download as GeoJSON"
          style={BUTTON_STYLE}
          onClick={(event) => {
            stopEvent(event);
            this.props.onExport?.();
          }}
        >
          <DownloadIcon />
        </button>

        <div style={DIVIDER_STYLE} />

        {/* Feature count badge */}
        <span style={BADGE_STYLE}>
          {featureCount} feature{featureCount !== 1 ? 's' : ''}
        </span>
      </div>
    );

    render(ui, root);
  }
}
