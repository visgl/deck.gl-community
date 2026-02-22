/** @jsxImportSource preact */
import { Widget } from '@deck.gl/core';
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { IconButton, makeTextIcon } from '../preact-components/icon-button';

import type { WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

export type SettingsWidgetValue = boolean | number | string;

export type SettingsWidgetSettingType = 'boolean' | 'number' | 'string' | 'select';

export type SettingsWidgetOption =
  | SettingsWidgetValue
  | {
      label: string;
      value: SettingsWidgetValue;
    };

export type SettingsWidgetSettingDescriptor = {
  /** Path in the settings object (dot notation supported). */
  name: string;
  /** Human-friendly label shown in the control list. Defaults to `name`. */
  label?: string;
  description?: string;
  type: SettingsWidgetSettingType;
  min?: number;
  max?: number;
  step?: number;
  options?: SettingsWidgetOption[];
  defaultValue?: SettingsWidgetValue;
};

export type SettingsWidgetSectionDescriptor = {
  /** Optional stable id for preserving collapse state across re-renders. */
  id?: string;
  name: string;
  description?: string;
  /** Whether this section starts collapsed when first seen. Defaults to true. */
  initiallyCollapsed?: boolean;
  settings: SettingsWidgetSettingDescriptor[];
};

export type SettingsWidgetSchema = {
  title?: string;
  sections: SettingsWidgetSectionDescriptor[];
};

export type SettingsWidgetState = Record<string, unknown>;

export type SettingsWidgetProps = WidgetProps & {
  placement?: WidgetPlacement;
  label?: string;
  schema?: SettingsWidgetSchema;
  settings?: SettingsWidgetState;
  onSettingsChange?: (settings: SettingsWidgetState) => void;
};

const PANE_STYLE: JSX.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  width: '380px',
  maxHeight: 'min(460px, calc(100vh - 60px))',
  borderRadius: '8px',
  border: '1px solid rgba(71, 85, 105, 0.55)',
  background: 'rgba(15, 23, 42, 0.94)',
  color: 'rgba(241, 245, 249, 0.98)',
  boxShadow: '0 12px 32px rgba(2, 6, 23, 0.55)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  pointerEvents: 'auto',
  zIndex: 20,
};

const HEADER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid rgba(100, 116, 139, 0.45)',
  padding: '10px 12px',
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
  background: 'rgba(30, 41, 59, 0.75)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: '12px',
};

const SECTION_CONTENT_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gap: '8px',
  padding: '8px 12px 12px',
};

const SETTING_ROW_STYLE: JSX.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) minmax(200px, 1.4fr)',
  alignItems: 'center',
  gap: '8px',
};

const SETTING_LABEL_STYLE: JSX.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: 'rgba(226, 232, 240, 0.98)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const SETTING_CONTROL_STYLE: JSX.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
};

const INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(100, 116, 139, 0.8)',
  borderRadius: '4px',
  backgroundColor: 'rgba(15, 23, 42, 0.7)',
  color: 'inherit',
  fontSize: '12px',
  padding: '4px 6px',
  boxSizing: 'border-box',
};

const RANGE_INPUT_STYLE: JSX.CSSProperties = {
  width: '100%',
  minWidth: '120px',
  margin: 0,
};

const NUMBER_INPUT_STYLE: JSX.CSSProperties = {
  ...INPUT_STYLE,
  width: '84px',
  flexShrink: 0,
};

const CHECKBOX_STYLE: JSX.CSSProperties = {
  width: '14px',
  height: '14px',
  margin: 0,
};

const SETTINGS_BUTTON_ICON = makeTextIcon('⚙', 24, 36);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePath(path: string): string[] {
  return path
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getValueAtPath(settings: SettingsWidgetState, path: string): unknown {
  const segments = parsePath(path);
  if (!segments.length) {
    return undefined;
  }

  let current: unknown = settings;
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setValueAtPath(
  settings: SettingsWidgetState,
  path: string,
  value: SettingsWidgetValue,
): SettingsWidgetState {
  const segments = parsePath(path);
  if (!segments.length) {
    return settings;
  }

  const nextSettings: SettingsWidgetState = { ...settings };
  let writeCursor: Record<string, unknown> = nextSettings;
  let readCursor: Record<string, unknown> = settings;

  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;

    if (isLeaf) {
      writeCursor[segment] = value;
      return;
    }

    const existingChild = readCursor[segment];
    const nextChild = isRecord(existingChild) ? { ...existingChild } : {};
    writeCursor[segment] = nextChild;

    writeCursor = nextChild;
    readCursor = isRecord(existingChild) ? existingChild : {};
  });

  return nextSettings;
}

function clamp(value: number, min?: number, max?: number): number {
  let clamped = value;
  if (Number.isFinite(min)) {
    clamped = Math.max(min as number, clamped);
  }
  if (Number.isFinite(max)) {
    clamped = Math.min(max as number, clamped);
  }
  return clamped;
}

function getSectionKey(section: SettingsWidgetSectionDescriptor, index: number): string {
  return section.id ?? section.name ?? `section-${index}`;
}

function getInitialCollapsedState(section: SettingsWidgetSectionDescriptor): boolean {
  return section.initiallyCollapsed ?? true;
}

function buildInitialCollapsedState(
  sections: SettingsWidgetSectionDescriptor[],
): Record<string, boolean> {
  return sections.reduce<Record<string, boolean>>((result, section, index) => {
    result[getSectionKey(section, index)] = getInitialCollapsedState(section);
    return result;
  }, {});
}

function normalizeOption(option: SettingsWidgetOption): {
  label: string;
  value: SettingsWidgetValue;
} {
  if (isRecord(option) && 'label' in option && 'value' in option) {
    return {
      label: String(option.label),
      value: option.value as SettingsWidgetValue,
    };
  }

  return {
    label: String(option),
    value: option as SettingsWidgetValue,
  };
}

function getDefaultValue(setting: SettingsWidgetSettingDescriptor): SettingsWidgetValue {
  if (setting.defaultValue !== undefined) {
    return setting.defaultValue;
  }

  if (setting.type === 'boolean') {
    return false;
  }

  if (setting.type === 'number') {
    return Number.isFinite(setting.min) ? (setting.min as number) : 0;
  }

  if (setting.type === 'select') {
    if (setting.options?.length) {
      return normalizeOption(setting.options[0]).value;
    }
    return '';
  }

  return '';
}

function resolveSettingValue(
  setting: SettingsWidgetSettingDescriptor,
  settings: SettingsWidgetState,
): SettingsWidgetValue {
  const currentValue = getValueAtPath(settings, setting.name);

  if (setting.type === 'boolean') {
    return typeof currentValue === 'boolean' ? currentValue : (getDefaultValue(setting) as boolean);
  }

  if (setting.type === 'number') {
    const numericValue =
      typeof currentValue === 'number'
        ? currentValue
        : Number.isFinite(Number(currentValue))
          ? Number(currentValue)
          : (getDefaultValue(setting) as number);
    return clamp(numericValue, setting.min, setting.max);
  }

  if (setting.type === 'select') {
    const normalizedOptions = (setting.options ?? []).map(normalizeOption);
    const defaultValue = getDefaultValue(setting);
    const candidateValue =
      typeof currentValue === 'string' ||
      typeof currentValue === 'number' ||
      typeof currentValue === 'boolean'
        ? currentValue
        : defaultValue;

    if (!normalizedOptions.length) {
      return String(candidateValue);
    }

    const match = normalizedOptions.find((option) => option.value === candidateValue);
    return match ? match.value : normalizedOptions[0].value;
  }

  if (typeof currentValue === 'string') {
    return currentValue;
  }

  const defaultValue = getDefaultValue(setting);
  return typeof defaultValue === 'string' ? defaultValue : String(defaultValue);
}

function mergeCollapsedState(
  previous: Record<string, boolean>,
  sections: SettingsWidgetSectionDescriptor[],
): Record<string, boolean> {
  const nextState: Record<string, boolean> = {};

  sections.forEach((section, index) => {
    const key = getSectionKey(section, index);
    nextState[key] = previous[key] ?? getInitialCollapsedState(section);
  });

  return nextState;
}

function stopPropagation(event: Event) {
  event.stopPropagation();
}

type SettingsControlProps = {
  setting: SettingsWidgetSettingDescriptor;
  value: SettingsWidgetValue;
  onValueChange: (nextValue: SettingsWidgetValue) => void;
};

function SettingsControl({ setting, value, onValueChange }: SettingsControlProps) {
  const label = setting.label ?? setting.name;
  const tooltip = setting.description?.trim();
  const inputId = `settings-widget-input-${setting.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  const handleBooleanChange: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    onValueChange((event.currentTarget as HTMLInputElement).checked);
  };

  const handleNumberChange = (nextValue: number) => {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    onValueChange(clamp(nextValue, setting.min, setting.max));
  };

  const handleTextChange: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    onValueChange((event.currentTarget as HTMLInputElement).value);
  };

  const handleSelectChange: JSX.GenericEventHandler<HTMLSelectElement> = (event) => {
    const selectedRaw = (event.currentTarget as HTMLSelectElement).value;
    const selectedValue = (setting.options ?? []).map(normalizeOption).find((option) => {
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
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, width: '100%' }}
      >
        <input
          id={inputId}
          type="range"
          min={String(setting.min)}
          max={String(setting.max)}
          step={String(setting.step ?? 1)}
          value={String(numericValue)}
          onInput={(event) =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          onChange={(event) =>
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
          onInput={(event) =>
            handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
          }
          onChange={(event) =>
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
        onInput={(event) =>
          handleNumberChange(Number((event.currentTarget as HTMLInputElement).value))
        }
        onChange={(event) =>
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
  } else {
    control = (
      <input
        id={inputId}
        type="text"
        value={String(value)}
        onInput={handleTextChange}
        onChange={handleTextChange}
        aria-label={label}
        style={INPUT_STYLE}
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
  schema: SettingsWidgetSchema;
  settings: SettingsWidgetState;
  onSettingsChange?: (settings: SettingsWidgetState) => void;
};

const DEFAULT_SETTINGS_WIDGET_SCHEMA: SettingsWidgetSchema = { sections: [] };
const DEFAULT_SETTINGS_WIDGET_STATE: SettingsWidgetState = {};

function SettingsWidgetView({
  label,
  schema,
  settings,
  onSettingsChange,
}: SettingsWidgetViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPaneOpen, setIsPaneOpen] = useState(false);
  const [localSettings, setLocalSettings] = useState<SettingsWidgetState>(settings);
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>(() =>
    buildInitialCollapsedState(schema.sections),
  );

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    setCollapsedState((previous) => mergeCollapsedState(previous, schema.sections));
  }, [schema.sections]);

  useEffect(() => {
    if (!isPaneOpen || typeof document === 'undefined') {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!containerRef.current || !event.target) {
        return;
      }
      if (!containerRef.current.contains(event.target as Node)) {
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
        section,
      })),
    [schema.sections],
  );

  const updateSetting = (path: string, nextValue: SettingsWidgetValue) => {
    setLocalSettings((previous) => {
      const nextSettings = setValueAtPath(previous, path, nextValue);
      onSettingsChange?.(nextSettings);
      return nextSettings;
    });
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', pointerEvents: 'auto' }}>
      <IconButton
        icon={SETTINGS_BUTTON_ICON}
        title={label}
        className={isPaneOpen ? 'deck-widget-button-active' : ''}
        onClick={() => setIsPaneOpen((previous) => !previous)}
      />

      {isPaneOpen && (
        <div
          role="dialog"
          aria-label={schema.title ?? label}
          style={PANE_STYLE}
          onPointerDown={(event) => stopPropagation(event as unknown as Event)}
          onMouseDown={(event) => stopPropagation(event as unknown as Event)}
          onWheel={(event) => stopPropagation(event as unknown as Event)}
          onClick={(event) => stopPropagation(event as unknown as Event)}
        >
          <div style={HEADER_STYLE}>
            <div style={{ fontSize: '13px', fontWeight: 700 }}>{schema.title ?? label}</div>
            <button
              type="button"
              onClick={() => setIsPaneOpen(false)}
              style={{
                border: 0,
                borderRadius: '4px',
                padding: '2px 6px',
                background: 'rgba(51, 65, 85, 0.8)',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: '14px',
                lineHeight: 1,
              }}
              title="Close settings"
              aria-label="Close settings"
            >
              ×
            </button>
          </div>

          <div style={{ overflowY: 'auto', paddingBottom: '8px' }}>
            {sectionEntries.map(({ key, section }) => {
              const isCollapsed = collapsedState[key] ?? false;
              return (
                <div key={key} style={{ borderBottom: '1px solid rgba(51, 65, 85, 0.7)' }}>
                  <button
                    type="button"
                    style={SECTION_TOGGLE_STYLE}
                    onClick={() =>
                      setCollapsedState((previous) => ({
                        ...previous,
                        [key]: !isCollapsed,
                      }))
                    }
                    aria-expanded={!isCollapsed}
                  >
                    <span style={{ display: 'grid', gap: '2px', textAlign: 'left' }}>
                      <span style={{ fontWeight: 700, fontSize: '12px' }}>{section.name}</span>
                      {section.description && (
                        <span style={{ fontSize: '11px', color: 'rgba(148, 163, 184, 1)' }}>
                          {section.description}
                        </span>
                      )}
                    </span>
                    <span aria-hidden>{isCollapsed ? '▸' : '▾'}</span>
                  </button>

                  {!isCollapsed && (
                    <div style={SECTION_CONTENT_STYLE}>
                      {section.settings.map((setting) => (
                        <SettingsControl
                          key={setting.name}
                          setting={setting}
                          value={resolveSettingValue(setting, localSettings)}
                          onValueChange={(nextValue) => updateSetting(setting.name, nextValue)}
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
    onSettingsChange: undefined,
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
    super({ ...SettingsWidget.defaultProps, ...props });

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
      rootElement,
    );
  }

  override onRemove(): void {
    if (this.#rootElement) {
      render(null, this.#rootElement);
    }
  }
}
