// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import type {ComponentChild, JSX} from 'preact';
import {Widget, type WidgetProps, type WidgetPlacement, type Deck} from '@deck.gl/core';
import type {
  GeoJsonEditModeConstructor,
  GeoJsonEditModeType
} from '../edit-modes/geojson-edit-mode';

export type EditModeTrayWidgetModeOption = {
  /**
   * Optional identifier for the mode button.
   * If not provided, one will be inferred from the supplied mode.
   */
  id?: string;
  /** Edit mode constructor or instance that the button should activate. */
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  /**
   * The icon or element rendered inside the button.
   * A simple string can also be supplied for text labels.
   */
  icon?: ComponentChild;
  /** Optional text label rendered below the icon when provided. */
  label?: string;
  /** Optional tooltip text applied to the button element. */
  title?: string;
};

export type EditModeTrayWidgetSelectEvent = {
  id: string;
  mode: GeoJsonEditModeConstructor | GeoJsonEditModeType;
  option: EditModeTrayWidgetModeOption;
};

export type EditModeTrayWidgetProps = WidgetProps & {
  /** Placement for the widget root element. */
  placement?: WidgetPlacement;
  /** Layout direction for mode buttons. */
  layout?: 'vertical' | 'horizontal';
  /** Collection of modes rendered in the tray. */
  modes?: EditModeTrayWidgetModeOption[];
  /** Identifier of the currently active mode. */
  selectedModeId?: string | null;
  /** Currently active mode instance/constructor. */
  activeMode?: GeoJsonEditModeConstructor | GeoJsonEditModeType | null;
  /** Callback fired when the user selects a mode. */
  onSelectMode?: (event: EditModeTrayWidgetSelectEvent) => void;
};

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  display: 'flex',
  pointerEvents: 'auto',
  userSelect: 'none',
  zIndex: '99'
};

const TRAY_BASE_STYLE: JSX.CSSProperties = {
  display: 'flex',
  gap: '6px',
  background: 'rgba(36, 40, 41, 0.88)',
  borderRadius: '999px',
  padding: '6px',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
};

const BUTTON_BASE_STYLE: JSX.CSSProperties = {
  appearance: 'none',
  background: 'transparent',
  border: 'none',
  color: '#f0f0f0',
  width: '34px',
  height: '34px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  cursor: 'pointer',
  padding: '0',
  transition: 'background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease'
};

const BUTTON_ACTIVE_STYLE: JSX.CSSProperties = {
  background: '#0071e3',
  color: '#ffffff',
  boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.35)'
};

const BUTTON_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '10px',
  marginTop: '2px',
  lineHeight: '12px'
};

export class EditModeTrayWidget extends Widget<EditModeTrayWidgetProps> {
  static override defaultProps = {
    id: 'edit-mode-tray',
    _container: null,
    placement: 'top-left',
    layout: 'vertical',
    modes: [],
    style: {},
    className: ''
  } satisfies Required<WidgetProps> &
    Required<Pick<EditModeTrayWidgetProps, 'placement' | 'layout'>> &
    EditModeTrayWidgetProps;

  placement: WidgetPlacement = 'top-left';
  className = 'deck-widget-edit-mode-tray';
  layout: 'vertical' | 'horizontal' = 'vertical';
  selectedModeId: string | null = null;
  deck?: Deck | null = null;
  private appliedCustomClassName: string | null = null;

  constructor(props: EditModeTrayWidgetProps = {}) {
    super({...EditModeTrayWidget.defaultProps, ...props});
    this.placement = props.placement ?? EditModeTrayWidget.defaultProps.placement;
    this.layout = props.layout ?? EditModeTrayWidget.defaultProps.layout;
    this.selectedModeId = this.resolveSelectedModeId(props.modes ?? [], props);
  }

  override setProps(props: Partial<EditModeTrayWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.layout !== undefined) {
      this.layout = props.layout;
    }

    const modes = props.modes ?? this.props.modes ?? [];
    this.selectedModeId = this.resolveSelectedModeId(modes, props);

    super.setProps(props);
    this.renderTray();
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

    this.renderTray();
  }

  private renderTray() {
    const root = this.rootElement;
    if (!root) {
      return;
    }

    const modes = this.props.modes ?? [];
    const selectedId = this.selectedModeId;
    const direction = this.layout === 'horizontal' ? 'row' : 'column';

    const trayStyle: JSX.CSSProperties = {
      ...TRAY_BASE_STYLE,
      flexDirection: direction
    };

    const stopEvent = (event: Event) => {
      event.stopPropagation();
      if (typeof (event as any).stopImmediatePropagation === 'function') {
        (event as any).stopImmediatePropagation();
      }
    };

    const ui = (
      <div
        style={trayStyle}
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
        {modes.map((option, index) => {
          const id = this.getModeId(option, index);
          const active = id === selectedId;
          const label = option.label ?? '';
          const title = option.title ?? label;

          const buttonStyle: JSX.CSSProperties = {
            ...BUTTON_BASE_STYLE,
            ...(active ? BUTTON_ACTIVE_STYLE : {})
          };

          return (
            <button
              key={id}
              type="button"
              title={title || undefined}
              aria-pressed={active}
              style={buttonStyle}
              onClick={(event) => {
                stopEvent(event);
                this.handleSelect(option, id);
              }}
            >
              {option.icon}
              {label ? <span style={BUTTON_LABEL_STYLE}>{label}</span> : null}
            </button>
          );
        })}
      </div>
    );

    render(ui, root);
  }

  private handleSelect(option: EditModeTrayWidgetModeOption, id: string) {
    if (this.selectedModeId !== id) {
      this.selectedModeId = id;
      this.renderTray();
    }

    this.props.onSelectMode?.({
      id,
      mode: option.mode,
      option
    });
  }

  private resolveSelectedModeId(
    modes: EditModeTrayWidgetModeOption[],
    props: Partial<EditModeTrayWidgetProps>
  ): string | null {
    if (props.selectedModeId !== undefined) {
      return props.selectedModeId;
    }

    const activeMode = props.activeMode ?? this.props?.activeMode ?? null;
    if (activeMode) {
      const match = this.findOptionByMode(modes, activeMode);
      if (match) {
        return this.getModeId(match.option, match.index);
      }
    }

    if (this.selectedModeId) {
      const existing = this.findOptionById(modes, this.selectedModeId);
      if (existing) {
        return this.selectedModeId;
      }
    }

    const first = modes[0];
    return first ? this.getModeId(first, 0) : null;
  }

  private findOptionByMode(
    modes: EditModeTrayWidgetModeOption[],
    activeMode: GeoJsonEditModeConstructor | GeoJsonEditModeType
  ): {option: EditModeTrayWidgetModeOption; index: number} | null {
    for (let index = 0; index < modes.length; index++) {
      const option = modes[index];
      if (option.mode === activeMode) {
        return {option, index};
      }
      if (this.isSameMode(option.mode, activeMode)) {
        return {option, index};
      }
    }
    return null;
  }

  private findOptionById(
    modes: EditModeTrayWidgetModeOption[],
    id: string
  ): {option: EditModeTrayWidgetModeOption; index: number} | null {
    for (let index = 0; index < modes.length; index++) {
      if (this.getModeId(modes[index], index) === id) {
        return {option: modes[index], index};
      }
    }
    return null;
  }

  private getModeId(option: EditModeTrayWidgetModeOption, index: number): string {
    if (option.id) {
      return option.id;
    }

    const mode = option.mode as any;
    if (mode) {
      if (typeof mode === 'function' && mode.name) {
        return mode.name;
      }
      if (mode && mode.constructor && mode.constructor.name) {
        return mode.constructor.name;
      }
    }

    return `mode-${index}`;
  }

  private isSameMode(
    modeA: GeoJsonEditModeConstructor | GeoJsonEditModeType,
    modeB: GeoJsonEditModeConstructor | GeoJsonEditModeType
  ): boolean {
    if (modeA === modeB) {
      return true;
    }
    const constructorA = (modeA as GeoJsonEditModeType)?.constructor;
    const constructorB = (modeB as GeoJsonEditModeType)?.constructor;
    return Boolean(constructorA && constructorB && constructorA === constructorB);
  }
}
