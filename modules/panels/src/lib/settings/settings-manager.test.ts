import {describe, expect, it, vi} from 'vitest';

import {getChangedSetting, SettingsManager} from './settings-manager';
import {getSettingDefinitions} from './settings';

import type {SettingDescriptor, SettingsSchema} from './settings';

describe('SettingsManager', () => {
  it('indexes schema settings for settings manager registration', () => {
    const interactionDescriptor: SettingDescriptor = {
      name: 'interaction.mode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };
    const schema: SettingsSchema = {
      sections: [
        {
          name: 'Interaction',
          settings: [interactionDescriptor]
        }
      ]
    };

    expect(getSettingDefinitions(schema)).toEqual(
      new Map([['interaction.mode', interactionDescriptor]])
    );
  });

  it('returns one named change descriptor from an emitted change list', () => {
    const opacityChange = {
      type: 'setting' as const,
      name: 'render.opacity',
      previousValue: 0.4,
      nextValue: 0.5
    };
    const visibilityChange = {
      type: 'setting' as const,
      name: 'render.visible',
      previousValue: true,
      nextValue: false
    };

    expect(getChangedSetting([opacityChange, visibilityChange], 'render.visible')).toBe(
      visibilityChange
    );
    expect(getChangedSetting([opacityChange], 'render.visible')).toBeUndefined();
    expect(getChangedSetting(undefined, 'render.visible')).toBeUndefined();
  });

  it('overlays stored local storage settings unless a descriptor opts out', () => {
    const manager = new SettingsManager();
    const storage = makeMemoryStorage({
      'panel-settings': JSON.stringify({
        interactionMode: 'drag-to-pan',
        layoutDensity: 'compact'
      })
    });
    const interactionDescriptor: SettingDescriptor = {
      name: 'interactionMode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };
    const layoutDescriptor: SettingDescriptor = {
      name: 'layoutDensity',
      type: 'select',
      persist: 'url',
      options: ['comfortable', 'compact']
    };

    manager.setLocalStoragePersistence({
      storageKey: 'panel-settings',
      getStorage: () => storage
    });

    expect(
      manager.getSettingsWithLocalStorage(
        {interactionMode: 'drag-to-zoom', layoutDensity: 'comfortable'},
        new Map([
          ['interactionMode', interactionDescriptor],
          ['layoutDensity', layoutDescriptor]
        ])
      )
    ).toEqual({
      interactionMode: 'drag-to-pan',
      layoutDensity: 'comfortable'
    });
  });

  it('normalizes invalid stored select values using descriptor options', () => {
    const manager = new SettingsManager();
    const storage = makeMemoryStorage({
      'panel-settings': JSON.stringify({
        interactionMode: 'removed-mode'
      })
    });
    const interactionDescriptor: SettingDescriptor = {
      name: 'interactionMode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };

    manager.setLocalStoragePersistence({
      storageKey: 'panel-settings',
      getStorage: () => storage
    });

    expect(
      manager.getSettingsWithLocalStorage(
        {interactionMode: 'drag-to-zoom'},
        new Map([['interactionMode', interactionDescriptor]])
      )
    ).toEqual({
      interactionMode: 'drag-to-zoom'
    });
  });

  it('persists settings to local storage by default', () => {
    const manager = new SettingsManager();
    const storage = makeMemoryStorage();
    const interactionDescriptor: SettingDescriptor = {
      name: 'interactionMode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };
    const layoutDescriptor: SettingDescriptor = {
      name: 'layoutDensity',
      type: 'select',
      options: ['comfortable', 'compact']
    };

    manager.setLocalStoragePersistence({
      storageKey: 'panel-settings',
      getStorage: () => storage
    });
    manager.setCurrentSettings({
      interactionMode: 'drag-to-zoom',
      layoutDensity: 'comfortable'
    });
    manager.setSettingDefinitions(
      new Map([
        ['interactionMode', interactionDescriptor],
        ['layoutDensity', layoutDescriptor]
      ])
    );

    manager.setSettings({
      interactionMode: 'drag-to-pan',
      layoutDensity: 'compact'
    });

    expect(storage.getItem('panel-settings')).toBe(
      '{"interactionMode":"drag-to-pan","layoutDensity":"compact"}'
    );
  });

  it('does not persist settings that explicitly opt out of local storage', () => {
    const manager = new SettingsManager();
    const storage = makeMemoryStorage();
    const interactionDescriptor: SettingDescriptor = {
      name: 'interactionMode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };
    const layoutDescriptor: SettingDescriptor = {
      name: 'layoutDensity',
      type: 'select',
      persist: 'url',
      options: ['comfortable', 'compact']
    };

    manager.setLocalStoragePersistence({
      storageKey: 'panel-settings',
      getStorage: () => storage
    });
    manager.setCurrentSettings({
      interactionMode: 'drag-to-zoom',
      layoutDensity: 'comfortable'
    });
    manager.setSettingDefinitions(
      new Map([
        ['interactionMode', interactionDescriptor],
        ['layoutDensity', layoutDescriptor]
      ])
    );

    manager.setSettings({
      interactionMode: 'drag-to-pan',
      layoutDensity: 'compact'
    });

    expect(storage.getItem('panel-settings')).toBe('{"interactionMode":"drag-to-pan"}');
  });

  it('keeps persisted settings when partial widget updates omit them', () => {
    const manager = new SettingsManager();
    const storage = makeMemoryStorage({
      'panel-settings': JSON.stringify({interactionMode: 'drag-to-pan'})
    });
    const interactionDescriptor: SettingDescriptor = {
      name: 'interactionMode',
      type: 'select',
      options: ['drag-to-zoom', 'drag-to-pan']
    };
    const overviewDescriptor: SettingDescriptor = {
      name: 'showOverview',
      type: 'boolean'
    };

    manager.setLocalStoragePersistence({
      storageKey: 'panel-settings',
      getStorage: () => storage
    });
    manager.setCurrentSettings({
      interactionMode: 'drag-to-pan',
      showOverview: false
    });
    manager.setSettingDefinitions(
      new Map([
        ['interactionMode', interactionDescriptor],
        ['showOverview', overviewDescriptor]
      ])
    );

    manager.setSettings({showOverview: true});

    expect(storage.getItem('panel-settings')).toBe(
      '{"interactionMode":"drag-to-pan","showOverview":true}'
    );
  });

  it('emits changes when a setting value changes', () => {
    const manager = new SettingsManager();
    const descriptor: SettingDescriptor = {
      name: 'colorSchemeId',
      type: 'select',
      label: 'Color scheme',
      options: ['a', 'b']
    };

    manager.setCurrentSettings({colorSchemeId: 'a'});
    manager.setSettingDefinitions(new Map([['colorSchemeId', descriptor]]));

    const onChange = vi.fn();
    manager.setOnSettingsChange(onChange);

    manager.setSettingValue('colorSchemeId', 'b');

    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextSettings, changedSettings] = onChange.mock.calls[0];
    expect(nextSettings).toMatchObject({colorSchemeId: 'b'});
    expect(changedSettings?.[0]).toMatchObject({
      type: 'setting',
      name: 'colorSchemeId',
      previousValue: 'a',
      nextValue: 'b',
      descriptor
    });
  });

  it('emits resolved descriptor values when a settings snapshot contains stale values', () => {
    const manager = new SettingsManager();
    const descriptor: SettingDescriptor = {
      name: 'colorSchemeId',
      type: 'select',
      label: 'Color scheme',
      options: ['a', 'b']
    };

    manager.setCurrentSettings({colorSchemeId: 'a'});
    manager.setSettingDefinitions(new Map([['colorSchemeId', descriptor]]));

    const onChange = vi.fn();
    manager.setOnSettingsChange(onChange);

    manager.setSettings({colorSchemeId: 'removed'});

    expect(onChange).not.toHaveBeenCalled();

    manager.setSettings({colorSchemeId: 'b'});

    expect(onChange).toHaveBeenCalledTimes(1);
    const [nextSettings, changedSettings] = onChange.mock.calls[0];
    expect(nextSettings).toMatchObject({colorSchemeId: 'b'});
    expect(changedSettings?.[0]).toMatchObject({
      type: 'setting',
      name: 'colorSchemeId',
      previousValue: 'a',
      nextValue: 'b',
      descriptor
    });
  });

  it('skips emitting when no values change', () => {
    const manager = new SettingsManager();
    const descriptor: SettingDescriptor = {
      name: 'layoutDensity',
      type: 'select',
      options: ['compact', 'comfortable']
    };

    manager.setCurrentSettings({layoutDensity: 'compact'});
    manager.setSettingDefinitions(new Map([['layoutDensity', descriptor]]));

    const onChange = vi.fn();
    manager.setOnSettingsChange(onChange);

    manager.setSettingValue('layoutDensity', 'compact');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('computes change descriptors on setSettings', () => {
    const manager = new SettingsManager();
    const descriptor: SettingDescriptor = {
      name: 'showOverview',
      type: 'boolean'
    };

    manager.setCurrentSettings({showOverview: false});
    manager.setSettingDefinitions(new Map([['showOverview', descriptor]]));

    const onChange = vi.fn();
    manager.setOnSettingsChange(onChange);

    manager.setSettings({showOverview: true});

    expect(onChange).toHaveBeenCalledTimes(1);
    const [, changedSettings] = onChange.mock.calls[0];
    expect(changedSettings?.[0]).toMatchObject({
      type: 'setting',
      name: 'showOverview',
      previousValue: false,
      nextValue: true,
      descriptor
    });
  });

  it('notifies every registered change listener', () => {
    const manager = new SettingsManager();
    const descriptor: SettingDescriptor = {
      name: 'colorSchemeId',
      type: 'select',
      options: ['a', 'b']
    };
    const firstListener = vi.fn();
    const secondListener = vi.fn();

    manager.setCurrentSettings({colorSchemeId: 'a'});
    manager.setSettingDefinitions(new Map([['colorSchemeId', descriptor]]));
    manager.setOnSettingsChange(firstListener);
    manager.setOnSettingsChange(secondListener);

    manager.setSettingValue('colorSchemeId', 'b');

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);
  });
});

function makeMemoryStorage(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    })
  } satisfies Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
