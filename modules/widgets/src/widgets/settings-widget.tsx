/** @jsxImportSource preact */
import {Widget} from '@deck.gl/core';
import {render} from 'preact';
import {useEffect, useMemo, useRef, useState} from 'preact/hooks';

import {
  buildInitialCollapsedState,
  clamp,
  getSectionKey,
  mergeCollapsedState,
  normalizeOption,
  resolveSettingValue,
  setValueAtPath
} from '@deck.gl-community/panels';
import {IconButton, makeTextIcon} from '@deck.gl-community/panels';

import type {
  SettingDescriptor,
  SettingsSchema,
  SettingsState,
  SettingValue
} from '@deck.gl-community/panels';
import type {SettingsChangeDescriptor} from '@deck.gl-community/panels';
import type {WidgetPlacement, WidgetProps} from '@deck.gl/core';
import type {JSX} from 'preact';

export type SettingsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  schema?: SettingsSchema;
  settings?: SettingsState;
  onSettingsChange?: (
    settings: SettingsState,
    changedSettings?: SettingsChangeDescriptor[]
  ) => void;
};

const PANE_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + var(--menu-gap, 4px))',
  left: 0,
  width: '380px',
  maxHeight: 'min(460px, calc(100vh - 60px))',
  borderRadius: 'var(--button-corner-radius, 8px)',
  border: 'var(--menu-border, 1px solid rgba(128, 128, 128, 0.3))',
  background: 'var(--menu-background, #fff)',
  backdropFilter: 'var(--menu-backdrop-filter, unset)',
  color: 'var(--menu-text, rgb(24, 24, 26))',
  boxShadow: 'var(--menu-shadow, 0px 0px 8px 0px rgba(0, 0, 0, 0.25))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  pointerEvents: 'auto',
  zIndex: 20
};

const HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid var(--menu-item-hover, rgba(128, 128, 128, 0.22))',
  padding: '10px 12px'
};

const SECTION_TOGGLE_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: 0,
  margin: 0,
  padding: '8px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '12px'
};

const SECTION_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '8px 12px 12px 18px'
};

const SETTING_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) minmax(200px, 1.4fr)',
  alignItems: 'center',
  gap: '8px'
};

const SETTING_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--button-text, currentColor)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
};

const SETTING_CONTROL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center'
};

const INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  backdropFilter: 'var(--button-backdrop-filter, unset)',
  color: 'var(--button-text, currentColor)',
  fontSize: '12px',
  padding: '4px 6px',
  boxSizing: 'border-box'
};

const STRING_CONTROL_STYLE: JSX.CSSProperties = {
  ...INPUT_STYLE,
  flex: 1
};

const STRING_APPLY_BUTTON_STYLE: JSX.CSSProperties = {
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  color: 'var(--button-text, currentColor)',
  fontSize: '11px',
  padding: '4px 8px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
};

const RANGE_INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: '120px',
  margin: 0
};

const NUMBER_INPUT_STYLE: JSX.CSSProperties = {
  ...INPUT_STYLE,
  width: '84px',
  flexShrink: 0,
  height: '28px',
  lineHeight: '16px',
  padding: '2px 6px'
};

const CHECKBOX_STYLE: JSX.CSSProperties = {
  width: '14px',
  height: '14px',
  margin: 0,
  accentColor: 'var(--button-icon-hover, currentColor)'
};

const MULTI_SELECT_LIST_STYLE: JSX.CSSProperties = {
  width: '100%',
  maxHeight: '120px',
  overflow: 'auto',
  display: 'grid',
  gap: '4px',
  border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
  borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
  backgroundColor: 'var(--button-background, #fff)',
  padding: '4px',
  boxSizing: 'border-box'
};

const MULTI_SELECT_OPTION_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  color: 'var(--button-text, currentColor)',
  fontSize: '12px'
};

const MULTI_SELECT_OPTION_LABEL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
};

const MULTI_SELECT_EMPTY_STYLE: JSX.CSSProperties = {
  color: 'var(--button-text, currentColor)',
  fontSize: '12px',
  opacity: 0.68,
  padding: '2px'
};

const SETTINGS_BUTTON_ICON = makeTextIcon('⚙', 24, 36);

function stopPropagation(event: Event) {
  event.stopPropagation();
}

function stopPropagationForInput(event: Event) {
  event.stopPropagation();
  if (
    typeof (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation ===
    'function'
  ) {
    (event as {stopImmediatePropagation?: () => void}).stopImmediatePropagation?.();
  }
}

type SettingsControlProps = {
  setting: SettingDescriptor;
  value: SettingValue;
  onValueChange: (nextValue: SettingValue) => void;
};

type StringSettingControlProps = {
  inputId: string;
  label: string;
  value: string;
  onApply: (nextValue: string) => void;
};

function StringSettingControl({inputId, label, value, onApply}: StringSettingControlProps) {
  const [pendingValue, setPendingValue] = useState(value);
  const [recentValues, setRecentValues] = useState<string[]>(() => (value ? [value] : []));

  const isDirty = pendingValue !== value;

  useEffect(() => {
    setPendingValue(value);
  }, [value]);

  useEffect(() => {
    if (!value) {
      return;
    }
    setRecentValues(previous =>
      previous.includes(value) ? previous : [value, ...previous].slice(0, 8)
    );
  }, [value]);

  const handlePendingTextChange: JSX.GenericEventHandler<HTMLInputElement> = event => {
    setPendingValue((event.currentTarget as HTMLInputElement).value);
  };

  const applyPendingText = () => {
    if (pendingValue === value) {
      return;
    }
    onApply(pendingValue);
    setRecentValues(previous =>
      [pendingValue, ...previous.filter(entry => entry !== pendingValue)].slice(0, 8)
    );
  };

  const handleTextCommit = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      applyPendingText();
    }
    stopPropagationForInput(event);
  };

  return (
    <div style={SETTING_CONTROL_STYLE}>
      <input
        id={inputId}
        type="text"
        value={pendingValue}
        onInput={handlePendingTextChange}
        list={`${inputId}-recent-values`}
        onKeyDown={handleTextCommit}
        onKeyUp={stopPropagationForInput}
        onPointerDown={stopPropagationForInput}
        aria-label={label}
        style={STRING_CONTROL_STYLE}
      />
      {recentValues.length > 0 && (
        <datalist id={`${inputId}-recent-values`}>
          {recentValues.map(recentValue => (
            <option key={`${inputId}-${recentValue}`} value={recentValue} />
          ))}
        </datalist>
      )}
      <button
        type="button"
        disabled={!isDirty}
        style={{
          ...STRING_APPLY_BUTTON_STYLE,
          opacity: isDirty ? 1 : 0.55,
          cursor: isDirty ? 'pointer' : 'default',
          marginLeft: '6px'
        }}
        onClick={applyPendingText}
        onPointerDown={stopPropagationForInput}
        onKeyDown={stopPropagationForInput}
        onKeyUp={stopPropagationForInput}
      >
        {isDirty ? '✓' : '✅'}
      </button>
    </div>
  );
}

function SettingsControl({setting, value, onValueChange}: SettingsControlProps) {
  const label = setting.label ?? setting.name;
  const tooltip = setting.description?.trim();
  const inputId = `settings-widget-input-${setting.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const handleBooleanChange: JSX.GenericEventHandler<HTMLInputElement> = event => {
    onValueChange((event.currentTarget as HTMLInputElement).checked);
  };

  const handleNumberChange = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    onValueChange(clamp(nextValue, setting.min, setting.max));
  };

  const handleSelectChange: JSX.GenericEventHandler<HTMLSelectElement> = event => {
    const selectedRaw = (event.currentTarget as HTMLSelectElement).value;
    const selectedValue = (setting.options ?? []).map(normalizeOption).find(option => {
      return String(option.value) === selectedRaw;
    });
    onValueChange(selectedValue ? selectedValue.value : selectedRaw);
  };

  let control: JSX.Element;

  if (setting.type === 'boolean') {
    control = (
      <input
        id={inputId}
        type="checkbox"
        checked={Boolean(value)}
        onInput={handleBooleanChange}
        onChange={handleBooleanChange}
        aria-label={label}
        style={CHECKBOX_STYLE}
      />
    );
  } else if (setting.type === 'number') {
    const numericValue = Number(value);
    const showRange = Number.isFinite(setting.min) && Number.isFinite(setting.max);

    control = showRange ? (
      <div style={{display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%'}}>
        <input
          id={inputId}
          type="range"
          min={String(setting.min)}
          max={String(setting.max)}
          step={String(setting.step ?? 1)}
          value={String(numericValue)}
          onInput={event =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          onChange={event =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          aria-label={label}
          style={RANGE_INPUT_STYLE}
        />
        <input
          type="number"
          min={Number.isFinite(setting.min) ? String(setting.min) : undefined}
          max={Number.isFinite(setting.max) ? String(setting.max) : undefined}
          step={String(setting.step ?? 1)}
          value={String(numericValue)}
          onInput={event =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          onChange={event =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          aria-label={`${label} numeric value`}
          style={NUMBER_INPUT_STYLE}
        />
      </div>
    ) : (
      <input
        id={inputId}
        type="number"
        step={String(setting.step ?? 1)}
        value={String(numericValue)}
        onInput={event =>
          handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
        }
        onChange={event =>
          handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
        }
        aria-label={label}
        style={INPUT_STYLE}
      />
    );
  } else if (setting.type === 'select') {
    const normalizedOptions = (setting.options ?? []).map(normalizeOption);

    control = (
      <select
        id={inputId}
        value={String(value)}
        onInput={handleSelectChange}
        onChange={handleSelectChange}
        onPointerDown={stopPropagationForInput}
        onKeyDown={stopPropagationForInput}
        onKeyUp={stopPropagationForInput}
        aria-label={label}
        style={INPUT_STYLE}
      >
        {normalizedOptions.map((option, index) => (
          <option
            key={`${setting.name}-${index}-${String(option.value)}`}
            value={String(option.value)}
          >
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (setting.type === 'multi-select') {
    const selectedValues = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [];
    const selectedValueSet = new Set(selectedValues);
    const optionValues = new Set<string>();
    const normalizedOptions = [
      ...(setting.options ?? []).map(option => {
        const normalized = normalizeOption(option);
        const optionValue = String(normalized.value);
        optionValues.add(optionValue);
        return {
          label: normalized.label,
          value: optionValue
        };
      }),
      ...selectedValues
        .filter(selectedValue => !optionValues.has(selectedValue))
        .map(selectedValue => ({
          label: selectedValue,
          value: selectedValue
        }))
    ];

    control = (
      <div style={MULTI_SELECT_LIST_STYLE}>
        {normalizedOptions.map(option => {
          const checked = selectedValueSet.has(option.value);
          return (
            <label
              key={`${setting.name}-${option.value}`}
              style={MULTI_SELECT_OPTION_STYLE}
              title={option.label}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={event => {
                  const nextChecked = (event.currentTarget as HTMLInputElement).checked;
                  onValueChange(
                    nextChecked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter(selectedValue => selectedValue !== option.value)
                  );
                }}
                onPointerDown={stopPropagationForInput}
                onKeyDown={stopPropagationForInput}
                onKeyUp={stopPropagationForInput}
                aria-label={option.label}
                style={CHECKBOX_STYLE}
              />
              <span style={MULTI_SELECT_OPTION_LABEL_STYLE}>{option.label}</span>
            </label>
          );
        })}
        {normalizedOptions.length === 0 ? (
          <div style={MULTI_SELECT_EMPTY_STYLE}>No options</div>
        ) : null}
      </div>
    );
  } else {
    control = (
      <StringSettingControl
        inputId={inputId}
        label={label}
        value={String(value)}
        onApply={onValueChange}
      />
    );
  }

  return (
    <div data-setting-row-for={setting.name} style={SETTING_ROW_STYLE} title={tooltip}>
      <label htmlFor={inputId} style={SETTING_LABEL_STYLE}>
        {label}
      </label>
      <div style={SETTING_CONTROL_STYLE}>{control}</div>
    </div>
  );
}

type SettingsWidgetViewProps = {
  label: string;
  schema: SettingsSchema;
  settings: SettingsState;
  onSettingsChange?: (
    settings: SettingsState,
    changedSettings?: SettingsChangeDescriptor[]
  ) => void;
};

const DEFAULT_SETTINGS_WIDGET_SCHEMA: SettingsSchema = {sections: []};
const DEFAULT_SETTINGS_WIDGET_STATE: SettingsState = {};

function SettingsWidgetView({label, schema, settings, onSettingsChange}: SettingsWidgetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<SettingsState>(settings);
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(() =>
    buildInitialCollapsedState(schema.sections)
  );

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setCollapsedState(previous => mergeCollapsedState(previous, schema.sections));
  }, [schema.sections]);

  useEffect(() => {
    if (!isPaneOpen || typeof document === 'undefined') {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      const target = event.target;

      if (!container || !target) {
        return;
      }

      if (container.contains(target as Node)) {
        return;
      }

      const activeElement = document.activeElement;
      const activeElementInPanel =
        activeElement instanceof Element ? container.contains(activeElement) : false;
      const targetIsSelectOption =
        target instanceof Element && target.tagName.toUpperCase() === 'OPTION';

      if (activeElementInPanel && targetIsSelectOption) {
        return;
      }

      if (!container.contains(target as Node)) {
        setIsPaneOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
    };
  }, [isPaneOpen]);

  const sectionEntries = useMemo(
    () =>
      schema.sections.map((section, index) => ({
        key: getSectionKey(section, index),
        section
      })),
    [schema.sections]
  );

  const updateSetting = (path: string, nextValue: SettingValue) => {
    setLocalSettings(previous => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div
      ref={containerRef}
      style={{position: 'relative', pointerEvents: 'auto'}}
      onPointerDown={event => stopPropagation(event as unknown as Event)}
      onMouseDown={event => stopPropagation(event as unknown as Event)}
      onPointerMove={event => stopPropagation(event as unknown as Event)}
      onMouseMove={event => stopPropagation(event as unknown as Event)}
      onWheel={event => stopPropagation(event as unknown as Event)}
    >
      <IconButton
        icon={SETTINGS_BUTTON_ICON}
        title={label}
        className={isPaneOpen ? 'deck-widget-button-active' : ''}
        onClick={() => setIsPaneOpen(previous => !previous)}
      />

      {isPaneOpen && (
        <div
          role="dialog"
          aria-label={schema.title ?? label}
          style={PANE_STYLE}
          onPointerMove={event => stopPropagation(event as unknown as Event)}
          onMouseMove={event => stopPropagation(event as unknown as Event)}
          onPointerDown={event => stopPropagation(event as unknown as Event)}
          onMouseDown={event => stopPropagation(event as unknown as Event)}
          onWheel={event => stopPropagation(event as unknown as Event)}
          onClick={event => stopPropagation(event as unknown as Event)}
        >
          <div style={HEADER_STYLE}>
            <div style={{fontSize: '13px', fontWeight: 700}}>{schema.title ?? label}</div>
            <button
              type="button"
              onClick={() => setIsPaneOpen(false)}
              style={{
                border: 'var(--button-inner-stroke, 1px solid rgba(128, 128, 128, 0.35))',
                borderRadius: 'calc(var(--button-corner-radius, 8px) - 2px)',
                padding: '2px 6px',
                background: 'var(--button-background, transparent)',
                color: 'var(--button-icon-idle, currentColor)',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: 1
              }}
              title="Close settings"
              aria-label="Close settings"
            >
              ×
            </button>
          </div>

          <div style={{overflowY: 'auto', paddingBottom: '8px'}}>
            {sectionEntries.map(({key, section}) => {
              const isCollapsed = collapsedState[key] ?? false;
              return (
                <div
                  key={key}
                  style={{
                    borderBottom: '1px solid var(--menu-item-hover, rgba(128, 128, 128, 0.22))'
                  }}
                >
                  <button
                    type="button"
                    style={SECTION_TOGGLE_STYLE}
                    onClick={() =>
                      setCollapsedState(previous => ({
                        ...previous,
                        [key]: !isCollapsed
                      }))
                    }
                    aria-expanded={!isCollapsed}
                  >
                    <span style={{display: 'grid', gap: '2px', textAlign: 'left'}}>
                      <span style={{fontWeight: 700, fontSize: '12px'}}>{section.name}</span>
                      {section.description && (
                        <span
                          style={{
                            fontSize: '11px',
                            color: 'var(--button-icon-idle, currentColor)'
                          }}
                        >
                          {section.description}
                        </span>
                      )}
                    </span>
                    <span aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                  </button>

                  {!isCollapsed && (
                    <div style={SECTION_CONTENT_STYLE}>
                      {section.settings.map(setting => (
                        <SettingsControl
                          key={setting.name}
                          setting={setting}
                          value={resolveSettingValue(setting, localSettings)}
                          onValueChange={nextValue => updateSetting(setting.name, nextValue)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export class SettingsWidget extends Widget<SettingsWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'settings',
    placement: 'top-left',
    label: 'Settings',
    schema: DEFAULT_SETTINGS_WIDGET_SCHEMA,
    settings: DEFAULT_SETTINGS_WIDGET_STATE,
    onSettingsChange: undefined
  } satisfies Required<WidgetProps> &
    Required<Pick<SettingsWidgetProps, 'placement' | 'label' | 'schema' | 'settings'>> &
    SettingsWidgetProps;

  className = 'deck-widget-settings';
  placement: WidgetPlacement = SettingsWidget.defaultProps.placement;

  #label = SettingsWidget.defaultProps.label;
  #schema = SettingsWidget.defaultProps.schema;
  #settings = SettingsWidget.defaultProps.settings;
  #onSettingsChange: SettingsWidgetProps['onSettingsChange'] =
    SettingsWidget.defaultProps.onSettingsChange;
  #rootElement: HTMLElement | null = null;

  constructor(props: SettingsWidgetProps = {}) {
    super({...SettingsWidget.defaultProps, ...props});

    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.label !== undefined) {
      this.#label = props.label;
    }
    if (props.schema !== undefined) {
      this.#schema = props.schema;
    }
    if (props.settings !== undefined) {
      this.#settings = props.settings;
    }
    if (props.onSettingsChange !== undefined) {
      this.#onSettingsChange = props.onSettingsChange;
    }
  }

  override setProps(props: Partial<SettingsWidgetProps>): void {
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.label !== undefined) {
      this.#label = props.label;
    }
    if (props.schema !== undefined) {
      this.#schema = props.schema;
    }
    if (props.settings !== undefined) {
      this.#settings = props.settings;
    }
    if (props.onSettingsChange !== undefined) {
      this.#onSettingsChange = props.onSettingsChange;
    }
    super.setProps(props);
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    this.#rootElement = rootElement;

    const className = ['deck-widget', this.className, this.props.className]
      .filter(Boolean)
      .join(' ');

    rootElement.className = className;

    render(
      <SettingsWidgetView
        label={this.#label}
        schema={this.#schema}
        settings={this.#settings}
        onSettingsChange={this.#onSettingsChange}
      />,
      rootElement
    );
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }
}
