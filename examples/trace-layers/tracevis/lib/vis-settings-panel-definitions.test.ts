import {describe, expect, it} from 'vitest';
import {DEFAULT_TRACE_COLOR_SCHEME} from '@deck.gl-community/trace-layers/trace';

import {DEFAULT_VIS_SETTINGS} from './vis-settings';
import {
  getVisSettingsSchema,
  getVisSettingsUpdatesFromPanelState,
  toVisSettingsState
} from './vis-settings-panel-definitions';

describe('vis settings panel definitions', () => {
  it('projects the canonical dependency settings and hidden overview state', () => {
    expect(toVisSettingsState(DEFAULT_VIS_SETTINGS)).toMatchObject({
      sameProcessDependencyMode: DEFAULT_VIS_SETTINGS.sameProcessDependencyMode,
      crossProcessDependencyMode: DEFAULT_VIS_SETTINGS.crossProcessDependencyMode,
      showOverview: DEFAULT_VIS_SETTINGS.showOverview
    });
  });

  it('read-migrates legacy dependency setting keys at widget ingress', () => {
    expect(
      getVisSettingsUpdatesFromPanelState(DEFAULT_VIS_SETTINGS, {
        localDependencyMode: 'all',
        crossDependencyMode: 'all'
      })
    ).toEqual({
      sameProcessDependencyMode: 'all',
      crossProcessDependencyMode: 'all'
    });
  });

  it('keeps dependency labels canonical and leaves overview out of the panel schema', () => {
    const schema = getVisSettingsSchema([DEFAULT_TRACE_COLOR_SCHEME]);
    const settings = schema.sections.flatMap(section => section.settings);

    expect(settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'sameProcessDependencyMode',
          label: 'Same Process'
        }),
        expect.objectContaining({
          name: 'crossProcessDependencyMode',
          label: 'Cross Process'
        })
      ])
    );
    expect(settings.some(setting => setting.name === 'showOverview')).toBe(false);
  });
});
