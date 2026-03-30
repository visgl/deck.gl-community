import type {
  SettingsWidgetOption,
  SettingsWidgetSchema,
  SettingsWidgetSectionDescriptor,
  SettingsWidgetSettingDescriptor,
  SettingsWidgetState,
  SettingsWidgetValue
} from '../../widgets/settings-widget';

export type SettingValue = SettingsWidgetValue;
export type SettingDescriptor = SettingsWidgetSettingDescriptor;
export type SettingsSectionDescriptor = SettingsWidgetSectionDescriptor;
export type SettingsSchema = SettingsWidgetSchema;
export type SettingsState = SettingsWidgetState;

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

export function getSectionKey(section: SettingsSectionDescriptor, index: number): string {
  return section.id ?? section.name ?? `section-${index}`;
}

export function buildInitialCollapsedState(
  sections: SettingsSectionDescriptor[]
): Record<string, boolean> {
  return sections.reduce<Record<string, boolean>>((result, section, index) => {
    result[getSectionKey(section, index)] = getInitialCollapsedState(section);
    return result;
  }, {});
}

export function normalizeOption(option: SettingsWidgetOption): {
  label: string;
  value: SettingValue;
} {
  if (isRecord(option) && 'label' in option && 'value' in option) {
    return {
      label: String(option.label),
      value: option.value
    };
  }

  return {
    label: String(option),
    value: option
  };
}

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

    const match = normalizedOptions.find((option) => option.value === candidateValue);
    return match ? match.value : normalizedOptions[0].value;
  }

  if (typeof currentValue === 'string') {
    return currentValue;
  }

  const defaultValue = getDefaultValue(setting);
  return typeof defaultValue === 'string' ? defaultValue : String(defaultValue);
}

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
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getValueAtPath(settings: SettingsState, path: string): unknown {
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

function getInitialCollapsedState(section: SettingsSectionDescriptor): boolean {
  return section.initiallyCollapsed ?? true;
}

function getDefaultValue(setting: SettingDescriptor): SettingValue {
  if (setting.defaultValue !== undefined) {
    return setting.defaultValue;
  }

  if (setting.type === 'boolean') {
    return false;
  }

  if (setting.type === 'number') {
    return Number.isFinite(setting.min) ? setting.min : 0;
  }

  if (setting.type === 'select') {
    if (setting.options?.length) {
      return normalizeOption(setting.options[0]).value;
    }
    return '';
  }

  return '';
}
