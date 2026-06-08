import {type SettingsSchema, type SettingsState} from '@deck.gl-community/trace-layers/react';

import {DEFAULT_VIS_SETTINGS, normalizeLineRoutingMode} from './vis-settings';

import type {VisSettings} from './vis-settings';
import type {TraceColorScheme} from '@deck.gl-community/trace-layers/trace';
import type {
  SettingDescriptor,
  SettingPersistenceTarget,
  SettingsSectionDescriptor
} from '@deck.gl-community/trace-layers/react';

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
const TIME_ZONE_OPTIONS = [
  {label: 'UTC', value: 'UTC'},
  {label: 'PT', value: 'America/Los_Angeles'},
  ...(LOCAL_TIME_ZONE === 'America/Los_Angeles' ? [] : [{label: 'Local', value: LOCAL_TIME_ZONE}])
] as const;
const TRACK_AGGREGATION_MODE_OPTIONS = [
  {label: 'Separate Threads', value: 'separate-threads'},
  {label: 'Combine Threads', value: 'combine-threads'}
] as const;
const PROCESS_OVERVIEW_AGGREGATION_OPTIONS = [
  {label: 'Icicle', value: 'icicle'},
  {label: 'Density', value: 'density'}
] as const;
const LAYOUT_DENSITY_OPTIONS = [
  {label: 'Comfortable', value: 'comfortable'},
  {label: 'Compact', value: 'compact'},
  {label: 'Compact - Spaced Processes', value: 'compact-spacious-processes'},
  {label: 'Compact - Inline Text', value: 'ultra-compact'},
  {label: 'Flamegraph', value: 'flamegraph'}
] as const;
const INTERACTION_MODE_OPTIONS = [
  {label: 'Swipe to Zoom', value: 'drag-to-zoom'},
  {label: 'Swipe to Pan (Perfetto)', value: 'drag-to-pan'}
] as const;
const MIN_SPAN_WIDTH_PIXEL_OPTIONS = [
  {label: '0 pixels', value: 0},
  {label: '1 pixel', value: 1},
  {label: '2 pixels', value: 2},
  {label: '4 pixels', value: 4}
] as const;
const VIS_SETTINGS_SLIDER_DEBOUNCE_MS = 100;

type VisSettingsPanelKey =
  | 'showSubmits'
  | 'showInstants'
  | 'showCounters'
  | 'showGlobalEvents'
  | 'transitions'
  | 'showPathsOnly'
  | 'sortThreads'
  | 'showEmptyProcesses'
  | 'criticalPathAnimationIntervalMs'
  | 'criticalPathTrailLength'
  | 'dependencyOpacity'
  | 'highlightFadeFactor'
  | 'extendedSelectionFadeOpacity'
  | 'traceOffsetMs'
  | 'traceScale'
  | 'minBlockTimeMs'
  | 'minSpanWidthPixels'
  | 'maxVisibleLanesPerThread'
  | 'localDependencyMode'
  | 'crossDependencyMode'
  | 'followCriticalPathAnimationMode'
  | 'lineRoutingMode'
  | 'processLayoutMode'
  | 'trackAggregationMode'
  | 'processOverviewAggregation'
  | 'startingProcessesMode'
  | 'layoutDensity'
  | 'threadDisplayMode'
  | 'timezone'
  | 'widgetTheme'
  | 'popupMode'
  | 'interactionMode'
  | 'selectHidesMinimap'
  | 'enableFastTextLayer'
  | 'traceColorSchemeId'
  | 'traceRunSummaryAggregationKey';

const BOOLEAN_VIS_SETTING_KEYS: VisSettingsPanelKey[] = [
  'showSubmits',
  'transitions',
  'showPathsOnly',
  'showGlobalEvents',
  'selectHidesMinimap',
  'enableFastTextLayer',
  'showEmptyProcesses'
];

const NUMBER_VIS_SETTING_KEYS: VisSettingsPanelKey[] = [
  'criticalPathAnimationIntervalMs',
  'criticalPathTrailLength',
  'dependencyOpacity',
  'highlightFadeFactor',
  'extendedSelectionFadeOpacity',
  'traceOffsetMs',
  'traceScale',
  'minBlockTimeMs',
  'minSpanWidthPixels',
  'maxVisibleLanesPerThread'
];

const STRING_VIS_SETTING_KEYS: VisSettingsPanelKey[] = [
  'localDependencyMode',
  'crossDependencyMode',
  'followCriticalPathAnimationMode',
  'lineRoutingMode',
  'processLayoutMode',
  'trackAggregationMode',
  'processOverviewAggregation',
  'startingProcessesMode',
  'layoutDensity',
  'threadDisplayMode',
  'timezone',
  'widgetTheme',
  'popupMode',
  'interactionMode',
  'traceColorSchemeId',
  'traceRunSummaryAggregationKey'
];

/**
 * Settings keys represented by the trace visualization settings panel.
 */
export const VIS_SETTINGS_PANEL_KEYS: VisSettingsPanelKey[] = [
  ...BOOLEAN_VIS_SETTING_KEYS,
  ...NUMBER_VIS_SETTING_KEYS,
  ...STRING_VIS_SETTING_KEYS
];
const HIDDEN_WIDGET_STATE_KEYS = ['showOverview'] as const satisfies ReadonlyArray<
  keyof VisSettings
>;

const BOOLEAN_KEY_SET = new Set<VisSettingsPanelKey>(BOOLEAN_VIS_SETTING_KEYS);
const NUMBER_KEY_SET = new Set<VisSettingsPanelKey>(NUMBER_VIS_SETTING_KEYS);
const STRING_KEY_SET = new Set<VisSettingsPanelKey>(STRING_VIS_SETTING_KEYS);

const STRING_OPTIONS_BY_KEY: Partial<Record<VisSettingsPanelKey, string[]>> = {
  localDependencyMode: ['all', 'none', 'warnings', 'submit'],
  crossDependencyMode: ['all', 'none'],
  followCriticalPathAnimationMode: ['none', 'animate', 'follow'],
  lineRoutingMode: ['straight', 'curve'],
  processLayoutMode: ['step1', 'sequential', 'interleaved'],
  trackAggregationMode: ['separate-threads', 'combine-threads'],
  processOverviewAggregation: PROCESS_OVERVIEW_AGGREGATION_OPTIONS.map(option => option.value),
  startingProcessesMode: ['all-expanded', 'group-collapsed', 'all-collapsed'],
  layoutDensity: [
    'comfortable',
    'compact',
    'compact-spacious-processes',
    'ultra-compact',
    'flamegraph'
  ],
  threadDisplayMode: ['active', 'all', 'minimal', 'selected'],
  timezone: TIME_ZONE_OPTIONS.map(option => option.value),
  widgetTheme: ['light', 'dark', 'auto'],
  popupMode: ['tab', 'popup'],
  interactionMode: INTERACTION_MODE_OPTIONS.map(option => option.value),
  traceColorSchemeId: [],
  traceRunSummaryAggregationKey: []
};

const NUMBER_LIMITS_BY_KEY: Partial<
  Record<VisSettingsPanelKey, {min: number; max: number; integer?: boolean}>
> = {
  criticalPathAnimationIntervalMs: {min: 30, max: 1000, integer: true},
  criticalPathTrailLength: {min: 1, max: 200, integer: true},
  dependencyOpacity: {min: 0, max: 1},
  highlightFadeFactor: {min: 0, max: 1},
  extendedSelectionFadeOpacity: {min: 0, max: 1},
  traceOffsetMs: {min: -500, max: 500},
  traceScale: {min: 0.1, max: 4},
  minBlockTimeMs: {min: 0, max: 1000, integer: true},
  minSpanWidthPixels: {min: 0, max: 4, integer: true},
  maxVisibleLanesPerThread: {min: 0, max: 250, integer: true}
};

/**
 * Copies settings descriptors and assigns one persistence target to all of them.
 */
function withPersist(
  settings: ReadonlyArray<SettingDescriptor>,
  persist: SettingPersistenceTarget
): SettingDescriptor[] {
  return settings.map(setting => ({
    ...setting,
    persist
  }));
}

function clampNumber(value: number, min: number, max: number, integer = false): number {
  const clamped = Math.max(min, Math.min(max, value));
  return integer ? Math.round(clamped) : clamped;
}

function coerceVisSettingsPanelValue(
  key: VisSettingsPanelKey,
  rawValue: unknown,
  stringOptionsByKey: Partial<Record<VisSettingsPanelKey, string[]>> = STRING_OPTIONS_BY_KEY
): VisSettings[VisSettingsPanelKey] | undefined {
  if (BOOLEAN_KEY_SET.has(key)) {
    return typeof rawValue === 'boolean'
      ? (rawValue as VisSettings[VisSettingsPanelKey])
      : undefined;
  }

  if (NUMBER_KEY_SET.has(key)) {
    const numericValue =
      typeof rawValue === 'number'
        ? rawValue
        : typeof rawValue === 'string'
          ? Number(rawValue)
          : Number.NaN;

    if (!Number.isFinite(numericValue)) {
      return undefined;
    }

    const limits = NUMBER_LIMITS_BY_KEY[key];
    if (!limits) {
      return undefined;
    }

    return clampNumber(
      numericValue,
      limits.min,
      limits.max,
      Boolean(limits.integer)
    ) as VisSettings[VisSettingsPanelKey];
  }

  if (STRING_KEY_SET.has(key) && typeof rawValue === 'string') {
    if (key === 'lineRoutingMode') {
      return normalizeLineRoutingMode(rawValue) as VisSettings[VisSettingsPanelKey] | undefined;
    }
    const options = stringOptionsByKey[key] ?? [];
    return options.includes(rawValue) ? (rawValue as VisSettings[VisSettingsPanelKey]) : undefined;
  }

  return undefined;
}

/**
 * Converts trace visualization settings into flat settings-panel state.
 */
export function toVisSettingsState(visSettings: VisSettings): SettingsState {
  const baseSettings = {...DEFAULT_VIS_SETTINGS, ...visSettings};
  const panelState: SettingsState = {};

  VIS_SETTINGS_PANEL_KEYS.forEach(key => {
    if (key === 'maxVisibleLanesPerThread') {
      (panelState as Record<string, unknown>)[key] = baseSettings.maxVisibleLanesUnlimited
        ? 0
        : (baseSettings.maxVisibleLanesPerThread ?? DEFAULT_VIS_SETTINGS.maxVisibleLanesPerThread);
      return;
    }

    (panelState as Record<string, unknown>)[key] = baseSettings[key] as string | number | boolean;
  });
  HIDDEN_WIDGET_STATE_KEYS.forEach(key => {
    (panelState as Record<string, unknown>)[key] = baseSettings[key];
  });

  return panelState;
}

/**
 * Coerces a settings-panel state patch into validated trace visualization setting updates.
 */
export function getVisSettingsUpdatesFromPanelState(
  currentSettings: VisSettings,
  nextPanelState: SettingsState,
  stringOptionsByKey?: Partial<Record<VisSettingsPanelKey, string[]>>
): Partial<VisSettings> {
  const updates: Partial<VisSettings> = {};

  const stringOptions = {
    ...STRING_OPTIONS_BY_KEY,
    ...stringOptionsByKey
  };

  VIS_SETTINGS_PANEL_KEYS.forEach(key => {
    const coercedValue = coerceVisSettingsPanelValue(key, nextPanelState[key], stringOptions);
    if (key === 'maxVisibleLanesPerThread' && typeof coercedValue === 'number') {
      const maxVisibleLanesUnlimited = coercedValue === 0;
      if (coercedValue !== currentSettings.maxVisibleLanesPerThread) {
        updates.maxVisibleLanesPerThread = coercedValue;
      }
      if (maxVisibleLanesUnlimited !== currentSettings.maxVisibleLanesUnlimited) {
        updates.maxVisibleLanesUnlimited = maxVisibleLanesUnlimited;
      }
      return;
    }

    if (coercedValue === undefined || coercedValue === currentSettings[key]) {
      return;
    }

    updates[key] = coercedValue as never;
  });
  if (typeof nextPanelState.showOverview === 'boolean') {
    const showOverview = nextPanelState.showOverview;
    if (showOverview !== currentSettings.showOverview) {
      updates.showOverview = showOverview;
    }
  }

  return updates;
}

/**
 * Builds the settings-panel schema for trace visualization and optional app-provided sections.
 */
export function getVisSettingsSchema(
  traceColorSchemes: ReadonlyArray<TraceColorScheme>,
  traceSettingsSections: ReadonlyArray<SettingsSectionDescriptor> = []
): SettingsSchema {
  const baseSchema = VIS_SETTINGS_PANEL_SCHEMA;
  const traceColorSchemeOptions = traceColorSchemes.map(scheme => ({
    label: scheme.name,
    value: scheme.id
  }));
  const options = traceColorSchemeOptions.filter(option => Boolean(option.value));
  const spansSection: SettingsSectionDescriptor = {
    id: 'spans',
    name: 'Spans',
    initiallyCollapsed: false,
    settings: withPersist(
      [
        {
          name: 'traceColorSchemeId',
          type: 'select',
          label: 'Span Colors',
          description: 'Choose how spans are colorered.',
          group: 'Span Rendering',
          options,
          defaultValue: DEFAULT_VIS_SETTINGS.traceColorSchemeId
        },
        {
          name: 'layoutDensity',
          type: 'select',
          label: 'Span Spacing',
          description:
            'Adjust vertical spacing of rows and labels. Trades off between span density and dependency line visibility.',
          group: 'Span Rendering',
          options: [...LAYOUT_DENSITY_OPTIONS],
          defaultValue: DEFAULT_VIS_SETTINGS.layoutDensity
        },
        {
          name: 'minSpanWidthPixels',
          type: 'select',
          label: 'Minimum Span Width',
          description: 'Choose the minimum rendered width for visible spans.',
          group: 'Span Rendering',
          options: [...MIN_SPAN_WIDTH_PIXEL_OPTIONS],
          defaultValue: DEFAULT_VIS_SETTINGS.minSpanWidthPixels
        },
        {
          name: 'minBlockTimeMs',
          type: 'number',
          label: 'Duration',
          description: 'Hide spans shorter than this threshold.',
          group: 'Span Filtering',
          min: NUMBER_LIMITS_BY_KEY.minBlockTimeMs?.min,
          max: NUMBER_LIMITS_BY_KEY.minBlockTimeMs?.max,
          step: 1,
          sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
          defaultValue: DEFAULT_VIS_SETTINGS.minBlockTimeMs
        },
        {
          name: 'highlightFadeFactor',
          type: 'number',
          label: 'Highlight Opacity',
          description: 'Opacity multiplier for non-highlighted spans.',
          group: 'Selection Emphasis',
          min: NUMBER_LIMITS_BY_KEY.highlightFadeFactor?.min,
          max: NUMBER_LIMITS_BY_KEY.highlightFadeFactor?.max,
          step: 0.01,
          sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
          defaultValue: DEFAULT_VIS_SETTINGS.highlightFadeFactor
        },
        {
          name: 'extendedSelectionFadeOpacity',
          type: 'number',
          label: 'Selection Opacity',
          description: 'Opacity multiplier used when extended selection fade is active.',
          group: 'Selection Emphasis',
          min: NUMBER_LIMITS_BY_KEY.extendedSelectionFadeOpacity?.min,
          max: NUMBER_LIMITS_BY_KEY.extendedSelectionFadeOpacity?.max,
          step: 0.01,
          sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
          defaultValue: DEFAULT_VIS_SETTINGS.extendedSelectionFadeOpacity
        }
      ],
      'url'
    )
  };

  const sectionById = new Map(baseSchema.sections.map(section => [section.id, section]));

  const reorderedSections = [
    sectionById.get('processes'),
    sectionById.get('dependencies'),
    sectionById.get('comparison'),
    sectionById.get('animation'),
    sectionById.get('application'),
    {
      id: 'experimental',
      name: 'Experimental',
      settings: [
        sectionById.get('experimentalTransitions')?.settings ?? [],
        sectionById.get('experimentalOverview')?.settings ?? [],
        sectionById.get('experimentalText')?.settings ?? []
      ].flat()
    }
  ];

  const filteredSections = reorderedSections.filter(
    (section): section is SettingsSectionDescriptor => Boolean(section)
  );
  const [baseSections, experimentalSection] = filteredSections.reduce<
    [SettingsSectionDescriptor[], SettingsSectionDescriptor | undefined]
  >(
    ([accSections, accExperimental], section) => {
      if (section.id === 'experimental') {
        return [accSections, section];
      }
      return [[...accSections, section], accExperimental];
    },
    [[], undefined]
  );
  const processSection = baseSections.find(section => section.id === 'processes');
  const remainingBaseSections = baseSections.filter(section => section.id !== 'processes');
  const commonSections = [
    ...(processSection ? [processSection] : []),
    spansSection,
    ...remainingBaseSections,
    ...(experimentalSection ? [experimentalSection] : [])
  ];
  const {standaloneSections, mergedCommonSections} = mergeSettingsSectionOverrides(
    commonSections,
    traceSettingsSections
  );

  return {
    ...baseSchema,
    sections: [...standaloneSections, ...mergedCommonSections]
  };
}

/** Merges trace-provided section overrides into matching common sections. */
function mergeSettingsSectionOverrides(
  commonSections: ReadonlyArray<SettingsSectionDescriptor>,
  traceSettingsSections: ReadonlyArray<SettingsSectionDescriptor>
): {
  standaloneSections: SettingsSectionDescriptor[];
  mergedCommonSections: SettingsSectionDescriptor[];
} {
  const commonSectionIds = new Set(
    commonSections.flatMap(section => (section.id ? [section.id] : []))
  );
  const overrideSectionsById = new Map<string, SettingsSectionDescriptor[]>();
  const standaloneSections: SettingsSectionDescriptor[] = [];

  traceSettingsSections.forEach(section => {
    if (!section.id || !commonSectionIds.has(section.id)) {
      standaloneSections.push(section);
      return;
    }

    const overrides = overrideSectionsById.get(section.id) ?? [];
    overrideSectionsById.set(section.id, [...overrides, section]);
  });

  return {
    standaloneSections,
    mergedCommonSections: commonSections.map(section =>
      mergeSettingsSectionOverride(
        section,
        section.id ? overrideSectionsById.get(section.id) : undefined
      )
    )
  };
}

/** Prepends override settings and lets override settings replace common definitions by name. */
function mergeSettingsSectionOverride(
  section: SettingsSectionDescriptor,
  overrideSections?: ReadonlyArray<SettingsSectionDescriptor>
): SettingsSectionDescriptor {
  if (!overrideSections?.length) {
    return section;
  }

  const overrideSettings = overrideSections.flatMap(overrideSection => overrideSection.settings);
  const overrideSettingNames = new Set(overrideSettings.map(setting => setting.name));
  return {
    ...section,
    settings: [
      ...overrideSettings,
      ...section.settings.filter(setting => !overrideSettingNames.has(setting.name))
    ]
  };
}

/**
 * Base settings-panel schema for trace visualization controls.
 */
export const VIS_SETTINGS_PANEL_SCHEMA: SettingsSchema = {
  title: 'Visualization settings',
  sections: [
    {
      id: 'dependencies',
      name: 'Dependencies',
      settings: withPersist(
        [
          {
            name: 'localDependencyMode',
            type: 'select',
            label: 'Local',
            description: 'Choose which local dependencies are rendered.',
            group: 'Visibility',
            options: [...(STRING_OPTIONS_BY_KEY.localDependencyMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.localDependencyMode
          },
          {
            name: 'crossDependencyMode',
            type: 'select',
            label: 'Cross Rank',
            description: 'Choose whether cross-rank dependencies are shown.',
            group: 'Visibility',
            options: [...(STRING_OPTIONS_BY_KEY.crossDependencyMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.crossDependencyMode
          },
          {
            name: 'lineRoutingMode',
            type: 'select',
            label: 'Shape',
            description: 'Use direct lines or curved arcs for dependencies.',
            group: 'Shape',
            options: [...(STRING_OPTIONS_BY_KEY.lineRoutingMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.lineRoutingMode
          },
          {
            name: 'dependencyOpacity',
            type: 'number',
            label: 'Opacity',
            description: 'Opacity applied to dependency lines.',
            group: 'Visibility',
            min: NUMBER_LIMITS_BY_KEY.dependencyOpacity?.min,
            max: NUMBER_LIMITS_BY_KEY.dependencyOpacity?.max,
            step: 0.01,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.dependencyOpacity
          }
        ],
        'url'
      )
    },
    {
      id: 'processes',
      name: 'Processes',
      initiallyCollapsed: false,
      settings: withPersist(
        [
          {
            name: 'trackAggregationMode',
            type: 'select',
            label: 'Span Compaction',
            description:
              'Whether spans are organized into threads or processes. Process view provides a more compact flamegraph but hides the process/thread structure.',
            group: 'Process Layout',
            options: [...TRACK_AGGREGATION_MODE_OPTIONS],
            defaultValue: DEFAULT_VIS_SETTINGS.trackAggregationMode
          },
          {
            name: 'processOverviewAggregation',
            type: 'select',
            label: 'Process Overviews',
            description:
              'Alternative renderings of summarized process activity in collapsed process rows and the minimap.',
            group: 'Process Layout',
            options: [...PROCESS_OVERVIEW_AGGREGATION_OPTIONS],
            defaultValue: DEFAULT_VIS_SETTINGS.processOverviewAggregation
          },
          {
            name: 'showEmptyProcesses',
            type: 'boolean',
            label: 'Show Empty Processes',
            description: 'Keep process rows visible when they have no remaining visible spans.',
            group: 'Process Layout',
            defaultValue: DEFAULT_VIS_SETTINGS.showEmptyProcesses
          },
          {
            name: 'maxVisibleLanesPerThread',
            type: 'number',
            label: 'Lane Limit',
            description: 'Maximum lanes rendered in processes. 0 means no limit.',
            group: 'Lane Limits',
            min: NUMBER_LIMITS_BY_KEY.maxVisibleLanesPerThread?.min,
            max: NUMBER_LIMITS_BY_KEY.maxVisibleLanesPerThread?.max,
            step: 1,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.maxVisibleLanesPerThread
          },
          {
            name: 'threadDisplayMode',
            type: 'select',
            label: 'Stream Filter',
            description: 'Filter how streams are chosen for rendering.',
            group: 'Stream Filtering',
            options: [...(STRING_OPTIONS_BY_KEY.threadDisplayMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.threadDisplayMode
          }
        ],
        'url'
      )
    },
    {
      id: 'comparison',
      name: 'Comparison',
      settings: withPersist(
        [
          {
            name: 'processLayoutMode',
            type: 'select',
            label: 'Rank layout',
            description: 'Control how multiple graphs are vertically arranged.',
            group: 'Alignment',
            options: [...(STRING_OPTIONS_BY_KEY.processLayoutMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.processLayoutMode
          },
          {
            name: 'traceOffsetMs',
            type: 'number',
            label: 'Trace Offset',
            description: 'Shift the secondary trace horizontally.',
            group: 'Alignment',
            min: NUMBER_LIMITS_BY_KEY.traceOffsetMs?.min,
            max: NUMBER_LIMITS_BY_KEY.traceOffsetMs?.max,
            step: 0.5,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.traceOffsetMs
          },
          {
            name: 'traceScale',
            type: 'number',
            label: 'Trace Scale',
            description: 'Scale factor applied to the secondary trace timeline.',
            group: 'Alignment',
            min: NUMBER_LIMITS_BY_KEY.traceScale?.min,
            max: NUMBER_LIMITS_BY_KEY.traceScale?.max,
            step: 0.01,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.traceScale
          }
        ],
        'url'
      )
    },
    {
      id: 'animation',
      name: 'Critical Paths',
      settings: withPersist(
        [
          {
            name: 'showPathsOnly',
            type: 'boolean',
            label: 'Highlight paths',
            description: 'Hide spans outside the active path selection.',
            group: 'Path Playback',
            defaultValue: DEFAULT_VIS_SETTINGS.showPathsOnly
          },
          {
            name: 'followCriticalPathAnimationMode',
            type: 'select',
            label: 'Animate Paths',
            description: 'Disable animation, animate, or animate and follow.',
            group: 'Path Playback',
            options: [...(STRING_OPTIONS_BY_KEY.followCriticalPathAnimationMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.followCriticalPathAnimationMode
          },
          {
            name: 'criticalPathAnimationIntervalMs',
            type: 'number',
            label: 'Animation Speed',
            description: 'Delay between animation steps in milliseconds.',
            group: 'Path Playback',
            min: NUMBER_LIMITS_BY_KEY.criticalPathAnimationIntervalMs?.min,
            max: NUMBER_LIMITS_BY_KEY.criticalPathAnimationIntervalMs?.max,
            step: 1,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.criticalPathAnimationIntervalMs
          },
          {
            name: 'criticalPathTrailLength',
            type: 'number',
            label: 'Trail Length',
            description: 'Number of previous spans chunk in the animated trail.',
            group: 'Path Playback',
            min: NUMBER_LIMITS_BY_KEY.criticalPathTrailLength?.min,
            max: NUMBER_LIMITS_BY_KEY.criticalPathTrailLength?.max,
            step: 1,
            sliderDebounceMs: VIS_SETTINGS_SLIDER_DEBOUNCE_MS,
            defaultValue: DEFAULT_VIS_SETTINGS.criticalPathTrailLength
          }
        ],
        'url'
      )
    },
    {
      id: 'application',
      name: 'Application',
      settings: withPersist(
        [
          {
            name: 'interactionMode',
            type: 'select',
            label: 'Interaction',
            description: 'Choose whether trackpad/mouse-wheel swipes zoom time or pan the trace.',
            group: 'Navigation',
            options: [...INTERACTION_MODE_OPTIONS],
            defaultValue: DEFAULT_VIS_SETTINGS.interactionMode
          },
          {
            name: 'timezone',
            type: 'select',
            label: 'Timezone',
            description: 'Choose which timezone is used for timeline timestamps.',
            group: 'Navigation',
            options: TIME_ZONE_OPTIONS,
            defaultValue: DEFAULT_VIS_SETTINGS.timezone
          },
          {
            name: 'widgetTheme',
            type: 'select',
            label: 'Widget Theme',
            description: 'Theme for deck widgets (auto follows the app theme).',
            group: 'Widget Behavior',
            options: [
              {label: 'Light', value: 'light'},
              {label: 'Dark', value: 'dark'},
              {label: 'Auto', value: 'auto'}
            ],
            defaultValue: DEFAULT_VIS_SETTINGS.widgetTheme
          },
          {
            name: 'popupMode',
            type: 'select',
            label: 'Open Links',
            description: 'Choose where deep links are opened.',
            group: 'Widget Behavior',
            options: [...(STRING_OPTIONS_BY_KEY.popupMode ?? [])],
            defaultValue: DEFAULT_VIS_SETTINGS.popupMode
          },
          {
            name: 'selectHidesMinimap',
            type: 'boolean',
            label: 'Select hides minimap',
            description: 'Hide the overview minimap while a span selection is active.',
            group: 'Widget Behavior',
            defaultValue: DEFAULT_VIS_SETTINGS.selectHidesMinimap
          }
        ],
        'local-storage'
      )
    },
    {
      id: 'experimentalTransitions',
      name: 'Experimental',
      settings: withPersist(
        [
          {
            name: 'transitions',
            type: 'boolean',
            label: 'Enable transitions',
            description: 'Enable deck.gl transition animations.',
            group: 'Experimental Features',
            defaultValue: DEFAULT_VIS_SETTINGS.transitions
          }
        ],
        'local-storage'
      )
    },
    {
      id: 'experimentalOverview',
      name: 'Experimental events',
      settings: withPersist(
        [
          {
            name: 'showGlobalEvents',
            type: 'boolean',
            label: 'Show Global Events',
            description: 'Render graph-global events in a dedicated top row and in the mini-map.',
            group: 'Experimental Features',
            defaultValue: DEFAULT_VIS_SETTINGS.showGlobalEvents
          }
        ],
        'local-storage'
      )
    },
    {
      id: 'experimentalText',
      name: 'Experimental text',
      settings: withPersist(
        [
          {
            name: 'enableFastTextLayer',
            type: 'boolean',
            label: 'Fast Text Layer',
            description: 'Render span labels with the experimental packed FastTextLayer.',
            group: 'Experimental Features',
            defaultValue: DEFAULT_VIS_SETTINGS.enableFastTextLayer
          }
        ],
        'local-storage'
      )
    }
  ]
};
