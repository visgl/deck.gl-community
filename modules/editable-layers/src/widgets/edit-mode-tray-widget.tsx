// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import type {ComponentChild, JSX} from 'preact';
import {
  Widget,
  type WidgetProps,
  type WidgetPlacement,
  type Deck
} from '@deck.gl/core';
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

export type EditModeTrayWidgetMenuOption = {
  /** Unique identifier for the option within its menu. */
  id: string;
  /** Optional icon rendered before the label. */
  icon?: ComponentChild;
  /** Optional text label for the option. */
  label?: string;
  /** Optional tooltip text applied to the option button. */
  title?: string;
};

export type EditModeTrayWidgetMenu = {
  /** Identifier for the menu group. */
  id: string;
  /** Optional label rendered above the menu options. */
  label?: string;
  /** Collection of selectable options. */
  options: EditModeTrayWidgetMenuOption[];
  /** Identifier of the currently selected option. */
  selectedOptionId?: string | null;
};

export type EditModeTrayWidgetMenuSelectEvent = {
  menuId: string;
  optionId: string;
  menu: EditModeTrayWidgetMenu;
  option: EditModeTrayWidgetMenuOption;
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
  /** Optional configuration menus rendered beneath the mode list. */
  menus?: EditModeTrayWidgetMenu[];
  /** Callback fired when the user selects a menu option. */
  onSelectMenuOption?: (event: EditModeTrayWidgetMenuSelectEvent) => void;
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

const MENU_WRAPPER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: '100%'
};

const MENU_SECTION_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  width: '100%'
};

const MENU_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '9px',
  lineHeight: '10px',
  color: '#d1d5db',
  textAlign: 'center',
  letterSpacing: '0.04em',
  textTransform: 'uppercase'
};

const MENU_OPTIONS_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: '4px'
};

const MENU_OPTION_BUTTON_STYLE: JSX.CSSProperties = {
  appearance: 'none',
  background: 'rgba(20, 24, 27, 0.7)',
  border: '1px solid transparent',
  borderRadius: '999px',
  color: '#f5f5f5',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '10px',
  lineHeight: '12px',
  padding: '4px 8px',
  transition: 'background 0.15s ease, color 0.15s ease, border-color 0.15s ease'
};

const MENU_OPTION_BUTTON_ACTIVE_STYLE: JSX.CSSProperties = {
  background: '#1f2937',
  borderColor: 'rgba(59, 130, 246, 0.6)'
};

const MENU_OPTION_ICON_STYLE: JSX.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center'
};

const MENU_OPTION_LABEL_STYLE: JSX.CSSProperties = {
  display: 'inline-block'
};

export class EditModeTrayWidget extends Widget<EditModeTrayWidgetProps> {
  static override defaultProps = {
    id: 'edit-mode-tray',
    placement: 'top-left',
    layout: 'vertical',
    modes: [],
    menus: [],
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
  private rootElement: HTMLElement | null = null;
  private appliedCustomClassName: string | null = null;
  private menuSelections: Map<string, string | null> = new Map();

  constructor(props: EditModeTrayWidgetProps = {}) {
    super({...EditModeTrayWidget.defaultProps, ...props});
    this.placement = props.placement ?? EditModeTrayWidget.defaultProps.placement;
    this.layout = props.layout ?? EditModeTrayWidget.defaultProps.layout;
    const modes = props.modes ?? [];
    const menus = props.menus ?? [];
    this.selectedModeId = this.resolveSelectedModeId(modes, props);
    this.updateMenuSelections(menus);
  }

  override setProps(props: Partial<EditModeTrayWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.layout !== undefined) {
      this.layout = props.layout;
    }

    const modes = props.modes ?? this.props.modes ?? [];
    const menus = props.menus ?? this.props.menus ?? [];
    this.selectedModeId = this.resolveSelectedModeId(modes, props);
    this.updateMenuSelections(menus);

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
    this.rootElement = rootElement;
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
    const menus = this.props.menus ?? [];
    const selectedId = this.selectedModeId;
    const direction = this.layout === 'horizontal' ? 'row' : 'column';
    const hasMenus = menus.length > 0;

    const trayStyle: JSX.CSSProperties = {
      ...TRAY_BASE_STYLE,
      flexDirection: hasMenus ? 'column' : direction,
      alignItems: hasMenus ? 'stretch' : TRAY_BASE_STYLE.alignItems
    };

    const modeListStyle: JSX.CSSProperties = {
      display: 'flex',
      flexDirection: direction,
      gap: TRAY_BASE_STYLE.gap,
      alignItems: 'center',
      justifyContent: 'center'
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
        <div style={modeListStyle}>
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
        {hasMenus ? (
          <div style={MENU_WRAPPER_STYLE}>
            {menus.map((menu) => {
              const menuSelectedId = menu.selectedOptionId ?? this.menuSelections.get(menu.id) ?? null;
              return (
                <div key={menu.id} style={MENU_SECTION_STYLE}>
                  {menu.label ? <span style={MENU_LABEL_STYLE}>{menu.label}</span> : null}
                  <div style={MENU_OPTIONS_STYLE}>
                    {menu.options.map((option) => {
                      const optionId = option.id;
                      const active = optionId === menuSelectedId;
                      const title = option.title ?? option.label ?? '';
                      const optionStyle: JSX.CSSProperties = {
                        ...MENU_OPTION_BUTTON_STYLE,
                        ...(active ? MENU_OPTION_BUTTON_ACTIVE_STYLE : {})
                      };

                      return (
                        <button
                          key={optionId}
                          type="button"
                          title={title || undefined}
                          aria-pressed={active}
                          style={optionStyle}
                          onClick={(event) => {
                            stopEvent(event);
                            this.handleSelectMenuOption(menu, option);
                          }}
                        >
                          {option.icon ? <span style={MENU_OPTION_ICON_STYLE}>{option.icon}</span> : null}
                          {option.label ? <span style={MENU_OPTION_LABEL_STYLE}>{option.label}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
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

  private handleSelectMenuOption(menu: EditModeTrayWidgetMenu, option: EditModeTrayWidgetMenuOption) {
    this.menuSelections.set(menu.id, option.id);
    this.renderTray();

    this.props.onSelectMenuOption?.({
      menuId: menu.id,
      optionId: option.id,
      menu,
      option
    });
  }

  private updateMenuSelections(menus: EditModeTrayWidgetMenu[]): void {
    const previousSelections = this.menuSelections;
    const nextSelections = new Map<string, string | null>();

    for (const menu of menus) {
      const selected =
        menu.selectedOptionId ?? previousSelections.get(menu.id) ?? (menu.options[0]?.id ?? null);
      nextSelections.set(menu.id, selected ?? null);
    }

    this.menuSelections = nextSelections;
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
