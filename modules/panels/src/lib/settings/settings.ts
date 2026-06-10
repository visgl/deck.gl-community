/** Scalar value supported by single-value settings controls. */
export type SettingScalarValue = boolean | number | string;

/** Persistable value supported by settings controls. */
export type SettingValue = SettingScalarValue | readonly string[];

/** Built-in control kinds supported by settings panels. */
export type SettingType = 'boolean' | 'number' | 'string' | 'select' | 'multi-select';

/** Persistence bucket used by settings managers and URL integrations. */
export type SettingPersistenceTarget = 'local-storage' | 'url' | 'none';

/** One selectable setting option, either as a raw value or label/value pair. */
export type SettingOption<Value extends SettingScalarValue = SettingScalarValue> =
  | Value
  | {
      /** Human-friendly label shown in the select control. */
      label: string;
      /** Primitive setting value written when the option is selected. */
      value: Value;
      /** Optional supporting copy shown below the option label in an open select menu. */
      description?: string;
    };

/** Backwards-compatible alias for selectable setting options. */
export type SettingsOption<Value extends SettingScalarValue = SettingScalarValue> =
  SettingOption<Value>;

/** Describes one schema-driven setting control. */
export type SettingDescriptor<
  Name extends string = string,
  Value extends SettingValue = SettingValue
> = {
  /** Path in the settings object (dot notation supported). */
  name: Name;
  /** Human-friendly label shown in the control list. Defaults to `name`. */
  label?: string;
  /** Optional visual group label used by richer settings panels. */
  group?: string;
  /** Persistence target used by settings managers and URL/shareable-link integrations. */
  persist?: SettingPersistenceTarget;
  description?: string;
  type: SettingType;
  min?: number;
  max?: number;
  step?: number;
  /** Optional trailing debounce, in milliseconds, for numeric range-slider input events. */
  sliderDebounceMs?: number;
  options?: readonly SettingOption[];
  defaultValue?: Value;
};

/** Describes one section of a settings schema. */
export type SettingsSectionDescriptor = {
  /** Optional stable id for preserving collapse state across re-renders. */
  id?: string;
  name: string;
  description?: string;
  /** Whether this section starts collapsed when first seen. Defaults to true. */
  initiallyCollapsed?: boolean;
  settings: SettingDescriptor[];
};

/** Full schema rendered by settings panels and consumed by settings managers. */
export type SettingsSchema = {
  title?: string;
  sections: SettingsSectionDescriptor[];
};

/** Setting descriptor lookup keyed by setting path. */
export type SettingDescriptorByName = Map<string, SettingDescriptor>;

/** Runtime settings snapshot keyed by setting path or nested object keys. */
export type SettingsState = Record<string, unknown>;

/** Settings schema split by each supported persistence target. */
export type PartitionedSettingsSchema = Record<SettingPersistenceTarget, SettingsSchema>;

/** Returns the value at `path` in a nested settings object without throwing. */
export function getValueAtPath(settings: SettingsState, path: string): unknown {
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

/** Clamps a numeric setting value within optional bounds. */
export function clamp(value: number, min?: number, max?: number): number {
  let clamped = value;
  if (Number.isFinite(min)) {
    clamped = Math.max(min, clamped);
  }
  if (Number.isFinite(max)) {
    clamped = Math.min(max, clamped);
  }
  return clamped;
}

/** Returns a copy of `settings` with a primitive value written at `path`. */
export function setValueAtPath(
  settings: SettingsState,
  path: string,
  value: SettingValue
): SettingsState {
  const segments = parsePath(path);
  if (!segments.length) {
    return settings;
  }

  const nextSettings: SettingsState = {...settings};
  let writeCursor: Record<string, unknown> = nextSettings;
  let readCursor: Record<string, unknown> = settings;

  segments.forEach((segment, index) => {
    const isLeaf = index === segments.length - 1;

    if (isLeaf) {
      writeCursor[segment] = value;
      return;
    }

    const existingChild = readCursor[segment];
    const nextChild = isRecord(existingChild) ? {...existingChild} : {};
    writeCursor[segment] = nextChild;

    writeCursor = nextChild;
    readCursor = isRecord(existingChild) ? existingChild : {};
  });

  return nextSettings;
}

/** Returns the stable key used to preserve state for one settings section. */
export function getSectionKey(section: SettingsSectionDescriptor, index: number): string {
  const id = section.id?.trim();
  if (id) {
    return id;
  }

  const name = section.name?.trim();
  if (name) {
    return name;
  }

  return `section-${index}`;
}

/** Returns whether a section should start collapsed, defaulting to `true`. */
export function getInitialCollapsedState(section: SettingsSectionDescriptor): boolean {
  return section.initiallyCollapsed ?? true;
}

/** Indexes a settings schema by setting path for settings-manager registration. */
export function getSettingDefinitions(schema: SettingsSchema): SettingDescriptorByName {
  const settingDefinitions: SettingDescriptorByName = new Map();

  for (const section of schema.sections) {
    for (const setting of section.settings) {
      settingDefinitions.set(setting.name, setting);
    }
  }

  return settingDefinitions;
}

/** Builds initial collapsed state keyed by settings section id, name, or index. */
export function buildInitialCollapsedState(
  sections: SettingsSectionDescriptor[]
): Record<string, boolean> {
  return sections.reduce<Record<string, boolean>>((result, section, index) => {
    result[getSectionKey(section, index)] = getInitialCollapsedState(section);
    return result;
  }, {});
}

/** Normalizes a setting option into a label/value pair. */
export function normalizeOption(option: SettingsOption): {
  label: string;
  value: SettingScalarValue;
  description?: string;
} {
  if (isRecord(option) && 'label' in option && 'value' in option) {
    return {
      label: String(option.label),
      value: option.value as SettingScalarValue,
      description: typeof option.description === 'string' ? option.description : undefined
    };
  }

  return {
    label: String(option),
    value: option as SettingScalarValue
  };
}

/** Returns the canonical persistence target for a setting descriptor. */
export function getSettingPersistenceTarget(
  setting: SettingDescriptor | undefined
): SettingPersistenceTarget {
  if (!setting) {
    return 'local-storage';
  }

  if (setting.persist) {
    return setting.persist;
  }

  return 'local-storage';
}

/** Returns a schema filtered to settings that match one persistence target. */
export function filterSettingsSchemaByPersistence(
  schema: SettingsSchema,
  persist: SettingPersistenceTarget
): SettingsSchema {
  return {
    ...schema,
    sections: schema.sections.flatMap(section => {
      const settings = section.settings.filter(
        setting => getSettingPersistenceTarget(setting) === persist
      );
      return settings.length > 0
        ? [
            {
              ...section,
              settings
            }
          ]
        : [];
    })
  };
}

/** Partitions one schema into per-persistence filtered schema copies. */
export function partitionSettingsSchemaByPersistence(
  schema: SettingsSchema
): PartitionedSettingsSchema {
  return {
    'local-storage': filterSettingsSchemaByPersistence(schema, 'local-storage'),
    url: filterSettingsSchemaByPersistence(schema, 'url'),
    none: filterSettingsSchemaByPersistence(schema, 'none')
  };
}

/** Returns a typed default value for a setting when explicit value is missing. */
export function getDefaultValue(setting: SettingDescriptor): SettingValue {
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

  if (setting.type === 'multi-select') {
    return [];
  }

  return '';
}

/** Resolves the effective setting value from a settings snapshot and descriptor defaults. */
// eslint-disable-next-line complexity
export function resolveSettingValue(
  setting: SettingDescriptor,
  settings: SettingsState
): SettingValue {
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

    const match = normalizedOptions.find(option => option.value === candidateValue);
    return match ? match.value : normalizedOptions[0].value;
  }

  if (setting.type === 'multi-select') {
    if (Array.isArray(currentValue)) {
      return currentValue.filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      );
    }
    const defaultValue = getDefaultValue(setting);
    return Array.isArray(defaultValue) ? defaultValue : [];
  }

  if (typeof currentValue === 'string') {
    return currentValue;
  }

  const defaultValue = getDefaultValue(setting);
  return typeof defaultValue === 'string' ? defaultValue : String(defaultValue);
}

/** Merges previous collapsed state with current section defaults. */
export function mergeCollapsedState(
  previous: Record<string, boolean>,
  sections: SettingsSectionDescriptor[]
): Record<string, boolean> {
  const nextState: Record<string, boolean> = {};

  sections.forEach((section, index) => {
    const key = getSectionKey(section, index);
    nextState[key] = previous[key] ?? getInitialCollapsedState(section);
  });

  return nextState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePath(path: string): string[] {
  return path
    .split('.')
    .map(segment => segment.trim())
    .filter(Boolean);
}
