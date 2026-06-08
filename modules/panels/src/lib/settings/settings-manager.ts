import {
  getSettingPersistenceTarget,
  getValueAtPath,
  resolveSettingValue,
  setValueAtPath
} from './settings';

import type {
  SettingDescriptor,
  SettingDescriptorByName,
  SettingsState,
  SettingValue
} from './settings';

/**
 * Describes one tracked setting value transition emitted by a settings manager update.
 */
export type SettingsChangeDescriptor<Name extends string = string, Value = unknown> = {
  /** Runtime discriminator for settings change event variants. */
  type: 'setting';
  /** Dot-path name of the setting that changed. */
  name: Name;
  /** Value before the change was applied. */
  previousValue: Value | undefined;
  /** Value after the change was applied. */
  nextValue: Value;
  /** Descriptor registered for the setting when available. */
  descriptor?: SettingDescriptor<Name>;
};

/**
 * Listener invoked after the manager applies one settings update.
 */
export type SettingsManagerOnChange<
  Change extends SettingsChangeDescriptor = SettingsChangeDescriptor
> = (
  /** Full settings snapshot after the update. */
  settings: SettingsState,
  /** Tracked setting transitions included in this update. */
  changedSettings?: Change[]
) => void;

export type SettingsManagerLocalStorageConfig = {
  /** Browser local storage key that stores settings unless the descriptor explicitly opts out. */
  storageKey: string;
  /** Optional storage provider used by tests or non-browser integrations. */
  getStorage?: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null | undefined;
};

/** Returns the emitted change descriptor for one setting path when present. */
export function getChangedSetting<
  Change extends SettingsChangeDescriptor = SettingsChangeDescriptor
>(changedSettings: readonly Change[] | undefined, name: string): Change | undefined {
  return changedSettings?.find(changedSetting => changedSetting.name === name);
}

/**
 * Coordinates settings snapshots, change emission, and descriptor-aware local persistence.
 */
export class SettingsManager<Change extends SettingsChangeDescriptor = SettingsChangeDescriptor> {
  #currentSettings: SettingsState = {};
  #localStorageConfig?: SettingsManagerLocalStorageConfig;
  #onSettingsChangeHandlers = new Set<SettingsManagerOnChange<Change>>();
  #settingDefinitions: SettingDescriptorByName = new Map<string, SettingDescriptor>();

  /**
   * Configures the storage location used for descriptor-level local storage persistence.
   */
  setLocalStoragePersistence(config: SettingsManagerLocalStorageConfig | undefined): void {
    this.#localStorageConfig = config;
  }

  /**
   * Returns `settings` with stored values overlaid for descriptors persisted to local storage.
   */
  getSettingsWithLocalStorage(
    settings: SettingsState,
    definitionsByName: SettingDescriptorByName = this.#settingDefinitions
  ): SettingsState {
    const localStorageSettings = this.getLocalStorageSettings(definitionsByName);
    let nextSettings = settings;

    for (const [name, value] of Object.entries(localStorageSettings)) {
      nextSettings = setValueAtPath(nextSettings, name, value);
    }

    return nextSettings;
  }

  /**
   * Returns local storage values for descriptors persisted to local storage.
   */
  getLocalStorageSettings(
    definitionsByName: SettingDescriptorByName = this.#settingDefinitions
  ): Record<string, SettingValue> {
    const storedValues = this.#readLocalStorageSettings();
    const settings: Record<string, SettingValue> = {};

    for (const [name, descriptor] of definitionsByName) {
      const value = storedValues[name];
      if (shouldPersistSetting(descriptor) && isSettingValue(value)) {
        const storedSetting = setValueAtPath({}, name, value);
        settings[name] = resolveSettingValue(descriptor, storedSetting);
      }
    }

    return settings;
  }

  /**
   * Replaces the current in-memory settings snapshot without emitting change events.
   */
  setCurrentSettings(settings: SettingsState): void {
    this.#currentSettings = this.#resolveKnownSettings(settings);
  }

  /**
   * Registers one change listener and returns an unsubscribe function.
   */
  setOnSettingsChange(handler: SettingsManagerOnChange<Change> | undefined): () => void {
    if (!handler) {
      return () => {
        return;
      };
    }

    this.#onSettingsChangeHandlers.add(handler);

    return () => {
      this.#onSettingsChangeHandlers.delete(handler);
    };
  }

  /**
   * Replaces the descriptor registry used for change tracking and persistence policy lookup.
   */
  setSettingDefinitions(definitionsByName: SettingDescriptorByName): void {
    this.#settingDefinitions = new Map(definitionsByName);
  }

  /**
   * Emits one settings change event and persists descriptor-backed values when needed.
   */
  emitSettingsChange(nextSettings: SettingsState, changedSettings?: Change[]): void {
    const resolvedNextSettings = this.#resolveKnownSettings(nextSettings);
    const resolvedChangedSettings =
      changedSettings ?? this.#computeChangedSettings(resolvedNextSettings);

    if (resolvedChangedSettings.length === 0) {
      this.#currentSettings = resolvedNextSettings;
      return;
    }

    this.#currentSettings = resolvedNextSettings;
    this.#writeLocalStorageSettings(resolvedChangedSettings, resolvedNextSettings);
    this.#onSettingsChangeHandlers.forEach(handler =>
      handler(resolvedNextSettings, resolvedChangedSettings)
    );
  }

  /**
   * Applies one individual setting value change by dot-path.
   */
  setSettingValue(name: string, nextValue: unknown): void {
    const descriptor = this.#settingDefinitions.get(name);
    const candidateSettings = setValueAtPath(
      this.#currentSettings,
      name,
      isSettingValue(nextValue) ? nextValue : ''
    );
    const resolvedNextValue = descriptor
      ? resolveSettingValue(descriptor, candidateSettings)
      : nextValue;
    const previousValue = getValueAtPath(this.#currentSettings, name);
    if (Object.is(previousValue, resolvedNextValue)) {
      return;
    }

    const nextSettings = setValueAtPath(
      this.#currentSettings,
      name,
      resolvedNextValue as SettingValue
    );
    const changedSettings: Change[] = [
      {
        type: 'setting',
        name,
        previousValue,
        nextValue: resolvedNextValue,
        descriptor
      } as Change
    ];

    this.emitSettingsChange(nextSettings, changedSettings);
  }

  /**
   * Applies one full settings snapshot and emits tracked changes.
   */
  setSettings(nextSettings: SettingsState): void {
    this.emitSettingsChange(nextSettings);
  }

  #computeChangedSettings(nextSettings: SettingsState): Change[] {
    const changedSettings: Change[] = [];

    for (const [name, descriptor] of this.#settingDefinitions) {
      const previousValue = getValueAtPath(this.#currentSettings, name);
      const nextValue = getValueAtPath(nextSettings, name);

      if (!Object.is(previousValue, nextValue)) {
        changedSettings.push({
          type: 'setting',
          name,
          previousValue,
          nextValue,
          descriptor
        } as Change);
      }
    }

    return changedSettings;
  }

  #resolveKnownSettings(settings: SettingsState): SettingsState {
    let resolvedSettings = settings;

    for (const [name, descriptor] of this.#settingDefinitions) {
      if (getValueAtPath(settings, name) === undefined) {
        continue;
      }
      resolvedSettings = setValueAtPath(
        resolvedSettings,
        name,
        resolveSettingValue(descriptor, resolvedSettings)
      );
    }

    return resolvedSettings;
  }

  #getStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null {
    if (this.#localStorageConfig?.getStorage) {
      return this.#localStorageConfig.getStorage() ?? null;
    }

    if (typeof window === 'undefined') {
      return null;
    }

    return window.localStorage;
  }

  #readLocalStorageSettings(): Record<string, unknown> {
    const storageKey = this.#localStorageConfig?.storageKey;
    const storage = this.#getStorage();
    if (!storageKey || !storage) {
      return {};
    }

    try {
      const raw = storage.getItem(storageKey);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  #writeLocalStorageSettings(
    changedSettings: SettingsChangeDescriptor[],
    nextSettings: SettingsState
  ): void {
    const storageKey = this.#localStorageConfig?.storageKey;
    const storage = this.#getStorage();
    if (!storageKey || !storage) {
      return;
    }

    const storedSettings = this.#readLocalStorageSettings();
    let changedPersistedSettings = false;

    for (const change of changedSettings) {
      if (!shouldPersistSetting(change.descriptor)) {
        continue;
      }

      const nextValue = getValueAtPath(nextSettings, change.name);
      if (isSettingValue(nextValue)) {
        changedPersistedSettings = true;
        storedSettings[change.name] = nextValue;
      }
    }

    if (!changedPersistedSettings) {
      return;
    }

    try {
      if (Object.keys(storedSettings).length === 0) {
        storage.removeItem(storageKey);
        return;
      }
      storage.setItem(storageKey, JSON.stringify(storedSettings));
    } catch {
      // Ignore storage quota and privacy-mode failures.
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

function shouldPersistSetting(descriptor: SettingDescriptor | undefined): boolean {
  return getSettingPersistenceTarget(descriptor) === 'local-storage';
}

export const settingsManager = new SettingsManager();
