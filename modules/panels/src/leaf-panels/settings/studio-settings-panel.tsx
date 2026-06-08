/** @jsxImportSource preact */

import {useEffect, useMemo, useRef, useState} from 'preact/hooks';

import {
  clamp,
  getDefaultValue,
  getSectionKey,
  normalizeOption,
  resolveSettingValue,
  setValueAtPath
} from '../../lib/settings/settings';
import {SelectComponent} from '../../preact/select-component';
import {Panel} from '../../panels/panel';

import type {
  SettingsChangeDescriptor,
  SettingsManagerOnChange
} from '../../lib/settings/settings-manager';
import type {
  SettingDescriptor,
  SettingsSchema,
  SettingsSectionDescriptor,
  SettingsState,
  SettingValue
} from '../../lib/settings/settings';
import type {ComponentChildren, JSX} from 'preact';

/** Studio settings tab id derived from the backing settings schema section key. */
export type StudioSettingsTabId = string;

/** Label/control column sizing used by Studio setting rows. */
export type StudioSettingsRowLayout = 'aligned' | 'fit-labels';

/** Visual dependency routing card variants supported by the settings panel. */
export type StudioDependencyShape = 'straight' | 'arc' | 'step';

/** Inline SVG icons available to the Studio settings panel. */
export type StudioSettingsIconName =
  | 'settings'
  | 'layout'
  | 'filter'
  | 'branch'
  | 'compare'
  | 'path'
  | 'chevron';

/** Props accepted by the Studio SVG icon renderer. */
export type StudioSettingsIconProps = {
  /** Icon glyph name. Unknown names fall back to the settings glyph. */
  name: StudioSettingsIconName;
  /** Square icon size in CSS pixels. */
  size?: number;
  /** Optional inline style merged into the SVG node. */
  style?: JSX.CSSProperties;
};

/** Props accepted by the schema-driven Studio settings panel. */
export type StudioSettingsPanelProps = {
  /** Settings schema that supplies available controls. */
  schema: SettingsSchema;
  /** Optional local-storage-backed application settings shown in a separate rail group. */
  applicationSchema?: SettingsSchema;
  /** Optional font family applied to the whole settings panel. */
  fontFamily?: string;
  /** Current settings snapshot read by each control. */
  settings: SettingsState;
  /** Existing settings manager callback invoked after each control change. */
  onSettingsChange?: SettingsManagerOnChange;
  /** Optional static preset label shown in the tab rail. */
  presetLabel?: string;
  /**
   * Setting row label/control sizing. `aligned` keeps stable columns, while `fit-labels`
   * lets each label use its content width so controls can claim more horizontal space.
   */
  settingRowLayout?: StudioSettingsRowLayout;
};

/** Creates a panel wrapper for the Studio settings panel. */
export function createStudioSettingsPanel(props: StudioSettingsPanelProps): Panel {
  return new StudioSettingsContentPanel({
    id: 'studio-settings-panel',
    title: 'Settings',
    content: <StudioSettingsPanel {...props} />
  });
}

class StudioSettingsContentPanel extends Panel {}

/** Renders a schema-driven settings panel styled with deck widget theme variables. */
export function StudioSettingsPanel({
  schema,
  applicationSchema,
  fontFamily,
  settings,
  onSettingsChange,
  presetLabel,
  settingRowLayout = 'aligned'
}: StudioSettingsPanelProps) {
  const [activeTabId, setActiveTabId] = useState<StudioSettingsTabId>('');
  const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(
    readPersistedNavigationCollapsed
  );
  const [localSettings, setLocalSettings] = useState(settings);
  const previousSettingsRef = useRef(settings);
  const model = useMemo(
    () => buildPanelModel(schema, applicationSchema),
    [applicationSchema, schema]
  );
  const activeTab = model.tabs.find(tab => tab.id === activeTabId) ?? model.tabs[0];
  const selectedTabId = activeTab?.id ?? '';
  const lineRoutingSetting = model.settingsByName.get(LINE_ROUTING_MODE_SETTING);

  useEffect(() => {
    if (previousSettingsRef.current === settings) {
      return;
    }
    previousSettingsRef.current = settings;
    setLocalSettings(settings);
  }, [settings]);

  /** Applies one setting value to local panel state and the existing manager callback. */
  function applySetting(setting: SettingDescriptor, value: SettingValue): void {
    const nextSettings = setValueAtPath(localSettings, setting.name, value);
    const previousValue = resolveSettingValue(setting, localSettings);
    const changedSetting: SettingsChangeDescriptor = {
      type: 'setting',
      name: setting.name,
      previousValue,
      nextValue: value,
      descriptor: setting
    };
    setLocalSettings(nextSettings);
    onSettingsChange?.(nextSettings, [changedSetting]);
  }

  function applyNavigationCollapsed(nextCollapsed: boolean): void {
    setIsNavigationCollapsed(nextCollapsed);
    writePersistedNavigationCollapsed(nextCollapsed);
  }

  function renderSettingsSection(tab: TabDefinition, compact: boolean): ComponentChildren {
    return (
      <div key={tab.id} style={STYLES.sectionStackItem}>
        <Section title={tab.title} eyebrow={tab.eyebrow}>
          {tab.settings.length > 0 ? (
            <SettingGroups
              tab={tab}
              settings={localSettings}
              compact={compact}
              settingRowLayout={settingRowLayout}
              onChange={(setting, value) => applySetting(setting, value)}
            />
          ) : (
            <div style={STYLES.emptyState}>No settings in this section.</div>
          )}
        </Section>
        {tab.hasLineRoutingSetting && lineRoutingSetting ? (
          <DependencyShapeSection
            setting={lineRoutingSetting}
            settings={localSettings}
            onChange={value => applySetting(lineRoutingSetting, value)}
          />
        ) : null}
      </div>
    );
  }

  const navigation = (
    <nav style={STYLES.rail} aria-label="Visualization settings sections">
      {model.tabGroups.map(group => (
        <div key={group.id} style={STYLES.railGroup}>
          {group.label ? <div style={STYLES.railGroupTitle}>{group.label}</div> : null}
          <div style={STYLES.tabList}>
            {group.tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={selectedTabId === tab.id}
                style={selectedTabId === tab.id ? STYLES.tabButtonActive : STYLES.tabButton}
                onClick={() => setActiveTabId(tab.id)}
              >
                <StudioSettingsIcon name={tab.icon} size={16} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {presetLabel ? (
        <div style={STYLES.preset}>
          <div style={STYLES.presetEyebrow}>Preset</div>
          <div style={STYLES.presetCard}>{presetLabel}</div>
        </div>
      ) : null}
    </nav>
  );

  return (
    <div
      style={{
        ...(isNavigationCollapsed ? STYLES.shellCollapsed : STYLES.shell),
        fontFamily: fontFamily ?? STYLES.shell.fontFamily
      }}
    >
      <header data-studio-settings-drag-handle="true" style={STYLES.header}>
        <div style={STYLES.headerTopRow}>
          <div style={STYLES.headerTitle}>
            <StudioSettingsIcon name="settings" size={21} />
            <h1 style={STYLES.heading}>Settings</h1>
          </div>
          <div style={STYLES.headerActions}>
            <button
              type="button"
              aria-label={
                isNavigationCollapsed ? 'Expand settings dialog' : 'Collapse settings dialog'
              }
              aria-pressed={isNavigationCollapsed}
              title={isNavigationCollapsed ? 'Expand settings dialog' : 'Collapse settings dialog'}
              style={
                isNavigationCollapsed
                  ? STYLES.navigationModeButtonActive
                  : STYLES.navigationModeButton
              }
              onClick={() => applyNavigationCollapsed(!isNavigationCollapsed)}
            >
              {isNavigationCollapsed ? 'Compact' : 'Expanded'}
            </button>
            <button
              type="button"
              aria-label="Close"
              data-modal-panel-container-close="true"
              style={STYLES.headerCloseButton}
            >
              ×
            </button>
          </div>
        </div>
      </header>
      <div style={isNavigationCollapsed ? STYLES.bodyCollapsed : STYLES.body}>
        {isNavigationCollapsed ? null : navigation}
        {isNavigationCollapsed ? (
          <main style={STYLES.mainCollapsed} aria-label="All settings sections">
            {model.tabs.map(tab => renderSettingsSection(tab, true))}
          </main>
        ) : (
          <main style={STYLES.main}>
            {activeTab ? (
              renderSettingsSection(activeTab, false)
            ) : (
              <Section title="Settings">
                <div style={STYLES.emptyState}>No settings in this section.</div>
              </Section>
            )}
          </main>
        )}
      </div>
    </div>
  );
}

/** Renders one local SVG icon used by the Studio settings panel. */
export function StudioSettingsIcon({name, size = 18, style}: StudioSettingsIconProps): JSX.Element {
  const normalizedName = STUDIO_ICON_NAMES.has(name) ? name : 'settings';
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{width: size, height: size, flex: '0 0 auto', ...style}}
    >
      {normalizedName === 'settings' ? (
        <g>
          <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.04.04a2 2 0 0 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.07a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.04.04a2 2 0 0 1-2.83-2.83l.04-.04A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.07A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88l-.04-.04a2 2 0 0 1 2.83-2.83l.04.04a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.07V3a2 2 0 0 1 4 0v.07a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.04-.04a2 2 0 0 1 2.83 2.83l-.04.04a1.7 1.7 0 0 0-.34 1.88 1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.07A1.7 1.7 0 0 0 19.4 15Z" />
        </g>
      ) : null}
      {normalizedName === 'layout' ? (
        <g>
          <rect x="3" y="4" width="7" height="7" rx="1.5" />
          <rect x="14" y="4" width="7" height="7" rx="1.5" />
          <rect x="3" y="15" width="18" height="5" rx="1.5" />
        </g>
      ) : null}
      {normalizedName === 'filter' ? (
        <g>
          <path d="M4 5h16" />
          <path d="M7 12h10" />
          <path d="M10 19h4" />
        </g>
      ) : null}
      {normalizedName === 'branch' ? (
        <g>
          <circle cx="6" cy="6" r="3" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="18" cy="18" r="3" />
          <path d="M9 6h4.5A4.5 4.5 0 0 1 18 10.5V15" />
        </g>
      ) : null}
      {normalizedName === 'compare' ? (
        <g>
          <path d="M7 4v16" />
          <path d="M17 4v16" />
          <path d="M3 8h8" />
          <path d="M13 16h8" />
        </g>
      ) : null}
      {normalizedName === 'path' ? (
        <g>
          <path d="M5 19C7 7 17 17 19 5" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="5" r="2" />
        </g>
      ) : null}
      {normalizedName === 'chevron' ? <path d="m6 9 6 6 6-6" /> : null}
    </svg>
  );
}

type TabDefinition = {
  /** Stable tab id derived from the backing section key. */
  id: StudioSettingsTabId;
  /** Label rendered in the left rail tab button. */
  label: string;
  /** Main heading shown for the active tab. */
  title: string;
  /** Optional short category label rendered above the tab heading. */
  eyebrow?: string;
  /** Icon rendered next to the tab label. */
  icon: StudioSettingsIconName;
  /** Setting descriptors rendered inside this tab. */
  settings: SettingDescriptor[];
  /** Whether this tab should render the visual dependency shape selector. */
  hasLineRoutingSetting: boolean;
};

type TabGroupDefinition = {
  /** Stable id for one rail grouping. */
  id: string;
  /** Optional heading rendered above grouped tabs. */
  label?: string;
  /** Tabs rendered inside this rail grouping. */
  tabs: TabDefinition[];
};

type PanelModel = {
  /** Flat tab list used for active-tab lookup. */
  tabs: TabDefinition[];
  /** Grouped tab list rendered in the left rail. */
  tabGroups: TabGroupDefinition[];
  /** Settings indexed by dot-path name for special-case schema controls. */
  settingsByName: Map<string, SettingDescriptor>;
};

/** Navigation layout used by the Studio settings panel. */
type DependencyShapeOption = {
  /** Visual shape key rendered by the SVG preview. */
  shape: StudioDependencyShape;
  /** Card title shown under the SVG preview. */
  title: string;
  /** Short card hint shown under the title. */
  subtitle: string;
  /** Backing schema value written to the settings state. */
  value: SettingValue;
};

type SettingGroup = {
  /** Heading shown above a related group of settings. */
  title: string;
  /** Settings rendered under this group heading. */
  settings: SettingDescriptor[];
};

const LINE_ROUTING_MODE_SETTING = 'lineRoutingMode';
const STUDIO_SETTINGS_NAVIGATION_COLLAPSED_STORAGE_KEY =
  'deck.gl-community:studio-settings:navigation-collapsed';
const STUDIO_ICON_NAMES = new Set<StudioSettingsIconName>([
  'settings',
  'layout',
  'filter',
  'branch',
  'compare',
  'path',
  'chevron'
]);

const DEPENDENCY_SHAPE_LABELS: Record<StudioDependencyShape, {title: string; subtitle: string}> = {
  straight: {title: 'Straight', subtitle: 'minimal'},
  arc: {title: 'Arc', subtitle: 'flow'},
  step: {title: 'Step', subtitle: 'orthogonal'}
};

/** Renders one section container. */
function Section({
  title,
  eyebrow,
  children
}: {
  title: string;
  eyebrow?: string;
  children: ComponentChildren;
}) {
  return (
    <section style={STYLES.section}>
      <div style={STYLES.sectionHeader}>
        {eyebrow ? <div style={STYLES.eyebrow}>{eyebrow}</div> : null}
        <h2 style={STYLES.sectionTitle}>{title}</h2>
      </div>
      <div style={STYLES.sectionBody}>{children}</div>
    </section>
  );
}

/** Renders visual setting groups inside one schema-backed Studio section. */
function SettingGroups({
  tab,
  settings,
  compact,
  settingRowLayout,
  onChange
}: {
  tab: TabDefinition | undefined;
  settings: SettingsState;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (setting: SettingDescriptor, value: SettingValue) => void;
}) {
  return (
    <>
      {getSettingGroups(tab).map(group => (
        <div key={group.title} style={STYLES.settingGroup}>
          <div style={STYLES.settingGroupTitle}>{group.title}</div>
          <div style={STYLES.settingGroupBody}>
            {group.settings.map(setting => (
              <SettingControl
                key={setting.name}
                setting={setting}
                settings={settings}
                compact={compact}
                settingRowLayout={settingRowLayout}
                onChange={value => onChange(setting, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

/** Builds display groups from schema-owned setting group metadata. */
function getSettingGroups(tab: TabDefinition | undefined): SettingGroup[] {
  if (!tab) {
    return [];
  }
  const groups: SettingGroup[] = [];
  const groupByTitle = new Map<string, SettingGroup>();
  tab.settings.forEach(setting => {
    const title = setting.group?.trim() || tab.title;
    let group = groupByTitle.get(title);
    if (!group) {
      group = {title, settings: []};
      groupByTitle.set(title, group);
      groups.push(group);
    }
    group.settings.push(setting);
  });
  return groups;
}

/** Renders a setting row based on one schema descriptor. */
function SettingControl({
  setting,
  settings,
  compact,
  settingRowLayout,
  onChange
}: {
  setting: SettingDescriptor;
  settings: SettingsState;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (value: SettingValue) => void;
}) {
  const value = resolveSettingValue(setting, settings);
  if (setting.type === 'select') {
    return (
      <SelectControl
        setting={setting}
        value={value}
        compact={compact}
        settingRowLayout={settingRowLayout}
        onChange={onChange}
      />
    );
  }
  if (setting.type === 'boolean') {
    return (
      <BooleanControl
        setting={setting}
        value={Boolean(value)}
        compact={compact}
        settingRowLayout={settingRowLayout}
        onChange={onChange}
      />
    );
  }
  if (setting.type === 'number') {
    return (
      <NumberControl
        setting={setting}
        value={Number(value)}
        compact={compact}
        settingRowLayout={settingRowLayout}
        onChange={onChange}
      />
    );
  }
  return (
    <StringControl
      setting={setting}
      value={String(value)}
      compact={compact}
      settingRowLayout={settingRowLayout}
      onChange={onChange}
    />
  );
}

/** Renders a select setting row. */
function SelectControl({
  setting,
  value,
  compact,
  settingRowLayout,
  onChange
}: {
  setting: SettingDescriptor;
  value: SettingValue;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (value: SettingValue) => void;
}) {
  const options = (setting.options ?? [getDefaultValue(setting)]).map(normalizeOption);
  return (
    <SettingRow setting={setting} compact={compact} settingRowLayout={settingRowLayout}>
      <SelectComponent
        id={`studio-settings-${setting.name.replace(/[^a-z0-9_-]+/gi, '-')}`}
        label={setting.label ?? setting.name}
        value={value}
        options={options}
        onValueChange={onChange}
      />
    </SettingRow>
  );
}

/** Renders a boolean setting row. */
function BooleanControl({
  setting,
  value,
  compact,
  settingRowLayout,
  onChange
}: {
  setting: SettingDescriptor;
  value: boolean;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (value: SettingValue) => void;
}) {
  return (
    <SettingRow setting={setting} compact={compact} settingRowLayout={settingRowLayout}>
      <button
        type="button"
        aria-pressed={value}
        style={value ? STYLES.switchButtonActive : STYLES.switchButton}
        onClick={() => onChange(!value)}
      >
        <span style={STYLES.switchText}>{value ? 'Enabled' : 'Disabled'}</span>
        <span style={value ? STYLES.switchTrackActive : STYLES.switchTrack}>
          <span style={value ? STYLES.switchKnobActive : STYLES.switchKnob} />
        </span>
      </button>
    </SettingRow>
  );
}

/** Renders a number setting row. */
function NumberControl({
  setting,
  value,
  compact,
  settingRowLayout,
  onChange
}: {
  setting: SettingDescriptor;
  value: number;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (value: SettingValue) => void;
}) {
  const min = Number.isFinite(setting.min) ? (setting.min as number) : 0;
  const max = Number.isFinite(setting.max) ? (setting.max as number) : Math.max(value, 100);
  const step = setting.step ?? 'any';
  const boundedValue = clamp(value, min, max);
  const sliderDebounceMs = getSliderDebounceMs(setting);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftValue, setDraftValue] = useState(boundedValue);

  useEffect(() => {
    setDraftValue(boundedValue);
  }, [boundedValue]);

  useEffect(
    () => () => {
      clearPendingSliderChange(debounceTimerRef);
    },
    []
  );

  function commitValue(nextValue: number): void {
    clearPendingSliderChange(debounceTimerRef);
    setDraftValue(nextValue);
    onChange(nextValue);
  }

  function scheduleSliderValue(nextValue: number): void {
    setDraftValue(nextValue);
    if (sliderDebounceMs <= 0) {
      onChange(nextValue);
      return;
    }

    clearPendingSliderChange(debounceTimerRef);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      onChange(nextValue);
    }, sliderDebounceMs);
  }

  return (
    <SettingRow setting={setting} compact={compact} settingRowLayout={settingRowLayout}>
      <div style={STYLES.numberGrid}>
        <input
          aria-label={`${setting.label ?? setting.name} slider`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={draftValue}
          style={STYLES.range}
          onInput={event => scheduleSliderValue(Number(event.currentTarget.value))}
        />
        <input
          aria-label={`${setting.label ?? setting.name} value`}
          type="number"
          min={min}
          max={max}
          step={step}
          value={draftValue}
          style={STYLES.numberInput}
          onInput={event => commitValue(Number(event.currentTarget.value))}
        />
      </div>
    </SettingRow>
  );
}

/** Returns the trailing debounce duration for range slider changes. */
function getSliderDebounceMs(setting: SettingDescriptor): number {
  if (!Number.isFinite(setting.sliderDebounceMs)) {
    return 0;
  }
  return Math.max(0, setting.sliderDebounceMs as number);
}

/** Clears any pending debounced range slider commit. */
function clearPendingSliderChange(timerRef: {current: ReturnType<typeof setTimeout> | null}): void {
  if (timerRef.current == null) {
    return;
  }
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

/** Renders a string fallback setting row. */
function StringControl({
  setting,
  value,
  compact,
  settingRowLayout,
  onChange
}: {
  setting: SettingDescriptor;
  value: string;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  onChange: (value: SettingValue) => void;
}) {
  return (
    <SettingRow setting={setting} compact={compact} settingRowLayout={settingRowLayout}>
      <input
        aria-label={setting.label ?? setting.name}
        type="text"
        value={value}
        style={STYLES.textInput}
        onInput={event => onChange(event.currentTarget.value)}
      />
    </SettingRow>
  );
}

/** Renders one pill-shaped setting row. */
function SettingRow({
  setting,
  compact,
  settingRowLayout,
  children
}: {
  setting: SettingDescriptor;
  compact: boolean;
  settingRowLayout: StudioSettingsRowLayout;
  children: ComponentChildren;
}) {
  return (
    <div
      data-studio-setting-row-layout={settingRowLayout}
      style={getSettingRowStyle(compact, settingRowLayout)}
    >
      <div style={STYLES.settingMeta}>
        <div style={STYLES.settingLabel}>{setting.label ?? humanizeSettingName(setting.name)}</div>
        {!compact && setting.description ? (
          <div style={STYLES.settingHint}>{setting.description}</div>
        ) : null}
      </div>
      <div style={STYLES.settingControl}>{children}</div>
    </div>
  );
}

/** Returns the setting row grid for the requested navigation and label layout. */
function getSettingRowStyle(
  compact: boolean,
  settingRowLayout: StudioSettingsRowLayout
): JSX.CSSProperties {
  if (settingRowLayout === 'fit-labels') {
    return compact ? STYLES.settingPillCollapsedFitLabels : STYLES.settingPillFitLabels;
  }
  return compact ? STYLES.settingPillCollapsed : STYLES.settingPill;
}

/** Renders the dependency shape card section for lineRoutingMode. */
function DependencyShapeSection({
  setting,
  settings,
  onChange
}: {
  setting: SettingDescriptor;
  settings: SettingsState;
  onChange: (value: SettingValue) => void;
}) {
  const value = resolveSettingValue(setting, settings);
  const selectedShape = shapeFromRoutingValue(value);
  const shapeOptions = getDependencyShapeOptions(setting);
  return (
    <section style={STYLES.shapeSection}>
      <div style={STYLES.shapeHeader}>
        <div>
          <h2 style={STYLES.shapeTitle}>Shape</h2>
          <p style={STYLES.shapeDescription}>Pick the dependency language visually.</p>
        </div>
        <StudioSettingsIcon name="branch" size={26} style={STYLES.shapeIcon} />
      </div>
      <div style={STYLES.shapeGrid}>
        {shapeOptions.map(option => (
          <DependencyShapeCard
            key={option.shape}
            option={option}
            selected={option.shape === selectedShape}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
    </section>
  );
}

/** Renders one SVG dependency routing preview card. */
function DependencyShapeCard({
  option,
  selected,
  onClick
}: {
  option: DependencyShapeOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      style={selected ? STYLES.shapeCardSelected : STYLES.shapeCard}
      onClick={onClick}
    >
      <DependencyShapePreview shape={option.shape} />
      <div style={STYLES.shapeCardFooter}>
        <div>
          <div style={STYLES.shapeCardTitle}>{option.title}</div>
          <div style={STYLES.shapeCardSubtitle}>{option.subtitle}</div>
        </div>
        <span style={selected ? STYLES.radioSelected : STYLES.radio}>
          <span style={selected ? STYLES.radioDotSelected : STYLES.radioDot} />
        </span>
      </div>
    </button>
  );
}

/** Renders an SVG preview for one dependency routing shape. */
function DependencyShapePreview({shape}: {shape: StudioDependencyShape}) {
  const path =
    shape === 'arc'
      ? 'M24 34C46 10 82 10 104 34'
      : shape === 'step'
        ? 'M24 34H58V18H104'
        : 'M24 34H104';
  return (
    <svg viewBox="0 0 128 56" fill="none" aria-hidden="true" style={STYLES.shapePreview}>
      <rect x="12" y="28" width="30" height="14" rx="4" style={STYLES.endpointPill} />
      <rect x="86" y="28" width="30" height="14" rx="4" style={STYLES.endpointPill} />
      <path d={path} style={STYLES.dependencyPath} />
      <circle cx="24" cy="34" r="4.5" style={STYLES.endpointDot} />
      <circle cx="104" cy="34" r="4.5" style={STYLES.endpointDot} />
    </svg>
  );
}

/** Builds tab settings and lookup maps from visualization and application schemas. */
function buildPanelModel(schema: SettingsSchema, applicationSchema?: SettingsSchema): PanelModel {
  const settingsByName = new Map<string, SettingDescriptor>();
  const visualizationTabs = buildTabsFromSchema(schema, 'visualization', settingsByName);
  const applicationTabs = applicationSchema
    ? buildTabsFromSchema(applicationSchema, 'application', settingsByName)
    : [];
  const tabs = [...visualizationTabs, ...applicationTabs];
  const tabGroups: TabGroupDefinition[] = [
    {id: 'visualization', label: 'Visualization', tabs: visualizationTabs},
    {
      id: 'application',
      label: 'Application',
      tabs: applicationTabs
    }
  ].filter(group => group.tabs.length > 0);

  if (tabs.length > 0) {
    return {
      tabs,
      tabGroups,
      settingsByName
    };
  }

  const fallbackTab = {
    id: 'settings',
    label: 'Settings',
    title: schema.title ?? 'Settings',
    icon: 'settings' as const,
    settings: [],
    hasLineRoutingSetting: false
  };

  return {
    tabs: [fallbackTab],
    tabGroups: [{id: 'visualization', tabs: [fallbackTab]}],
    settingsByName
  };
}

/** Builds tabs from one schema and records settings by name. */
function buildTabsFromSchema(
  schema: SettingsSchema,
  tabIdPrefix: string,
  settingsByName: Map<string, SettingDescriptor>
): TabDefinition[] {
  return schema.sections.flatMap((section, index) => {
    const settings = section.settings.filter(setting => {
      settingsByName.set(setting.name, setting);
      return setting.name !== LINE_ROUTING_MODE_SETTING;
    });
    const hasLineRoutingSetting = section.settings.some(
      setting => setting.name === LINE_ROUTING_MODE_SETTING
    );
    if (settings.length === 0 && !hasLineRoutingSetting) {
      return [];
    }
    return [
      {
        id: `${tabIdPrefix}:${getSectionKey(section, index)}`,
        label: getSectionLabel(section, index),
        title: getSectionLabel(section, index),
        eyebrow: section.description,
        icon: getSectionIcon(section),
        settings,
        hasLineRoutingSetting
      }
    ];
  });
}

/** Returns a display label for one schema section. */
function getSectionLabel(section: SettingsSectionDescriptor, index: number): string {
  const name = section.name.trim();
  return name || `Settings ${index + 1}`;
}

/** Selects an icon for one schema section without changing its grouping. */
function getSectionIcon(section: SettingsSectionDescriptor): StudioSettingsIconName {
  const searchable = `${section.id ?? ''} ${section.name}`.toLowerCase();
  if (searchable.includes('depend')) {
    return 'branch';
  }
  if (
    searchable.includes('item') ||
    searchable.includes('feature') ||
    searchable.includes('render') ||
    searchable.includes('filter') ||
    searchable.includes('layout') ||
    searchable.includes('color')
  ) {
    return 'layout';
  }
  if (searchable.includes('compare')) {
    return 'compare';
  }
  if (searchable.includes('path') || searchable.includes('animation')) {
    return 'path';
  }
  return 'settings';
}

/** Builds shape options from the lineRoutingMode setting descriptor. */
function getDependencyShapeOptions(setting: SettingDescriptor): DependencyShapeOption[] {
  const normalizedOptions = (setting.options ?? ['straight', 'curve']).map(normalizeOption);
  const optionsByShape = new Map<StudioDependencyShape, DependencyShapeOption>();
  normalizedOptions.forEach(option => {
    const shape = shapeFromRoutingValue(option.value);
    if (optionsByShape.has(shape)) {
      return;
    }
    const labels = DEPENDENCY_SHAPE_LABELS[shape];
    optionsByShape.set(shape, {
      shape,
      title: labels.title,
      subtitle: labels.subtitle,
      value: option.value
    });
  });
  return (['straight', 'arc', 'step'] as const).flatMap(shape => {
    const existing = optionsByShape.get(shape);
    return existing ? [existing] : [];
  });
}

/** Reads the persisted compact settings-panel mode. */
function readPersistedNavigationCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(STUDIO_SETTINGS_NAVIGATION_COLLAPSED_STORAGE_KEY) === 'true';
}

/** Stores the compact settings-panel mode for later openings. */
function writePersistedNavigationCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(
    STUDIO_SETTINGS_NAVIGATION_COLLAPSED_STORAGE_KEY,
    collapsed ? 'true' : 'false'
  );
}

/** Maps a lineRoutingMode value to the visual shape card id. */
function shapeFromRoutingValue(value: unknown): StudioDependencyShape {
  const valueText = String(value).toLowerCase();
  if (valueText === 'step' || valueText.includes('step')) {
    return 'step';
  }
  if (valueText === 'curve' || valueText === 'arc' || valueText.includes('arc')) {
    return 'arc';
  }
  return 'straight';
}

/** Converts a camel-case or dotted setting path into a readable label. */
function humanizeSettingName(name: string): string {
  const leafName = name.split('.').pop() ?? name;
  return leafName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, match => match.toUpperCase());
}

const STYLES = {
  shell: {
    width: 'min(calc(100vw - 56px), 720px)',
    height: 'min(calc(100vh - 56px), 680px)',
    maxHeight: 'min(calc(100vh - 56px), 680px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--menu-corner-radius, 22px)',
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.28))',
    background: 'var(--menu-background, #334155)',
    color: 'var(--menu-text, #e2e8f0)',
    boxShadow: 'var(--menu-shadow, 0 24px 60px rgba(0, 0, 0, 0.35))',
    fontFamily: 'var(--font-family, system-ui, sans-serif)'
  },
  shellCollapsed: {
    width: 'min(calc(100vw - 56px), 420px)',
    height: 'min(calc(100vh - 56px), 680px)',
    maxHeight: 'min(calc(100vh - 56px), 680px)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 'var(--menu-corner-radius, 22px)',
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.28))',
    background: 'var(--menu-background, #334155)',
    color: 'var(--menu-text, #e2e8f0)',
    boxShadow: 'var(--menu-shadow, 0 24px 60px rgba(0, 0, 0, 0.35))',
    fontFamily: 'var(--font-family, system-ui, sans-serif)'
  },
  header: {
    height: 58,
    minHeight: 58,
    maxHeight: 58,
    flex: '0 0 58px',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 18px',
    borderBottom: 'var(--menu-border, 1px solid rgba(15, 23, 42, 0.35))',
    background: 'var(--button-background, rgba(15, 23, 42, 0.16))',
    cursor: 'grab',
    userSelect: 'none'
  },
  headerTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    minWidth: 0
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    height: 24,
    minWidth: 0,
    color: 'var(--button-text, #dbeafe)'
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto'
  },
  heading: {
    margin: 0,
    fontSize: 14,
    fontWeight: 800,
    lineHeight: '18px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase'
  },
  navigationModeButton: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 74,
    height: 24,
    border: '1px solid var(--menu-border-color, rgba(148, 163, 184, 0.26))',
    borderRadius: 7,
    background: 'var(--menu-background, rgba(15, 23, 42, 0.12))',
    color: 'var(--menu-text, #e2e8f0)',
    boxShadow: 'none',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 650,
    lineHeight: 1,
    outline: 'none',
    padding: '0 10px',
    cursor: 'pointer'
  },
  navigationModeButtonActive: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 74,
    height: 24,
    border: '1px solid var(--menu-border-color, rgba(148, 163, 184, 0.3))',
    borderRadius: 7,
    background: 'var(--menu-item-hover, rgba(15, 23, 42, 0.2))',
    color: 'var(--menu-text, #f8fafc)',
    boxShadow: 'none',
    font: 'inherit',
    fontSize: 12,
    fontWeight: 650,
    lineHeight: 1,
    outline: 'none',
    padding: '0 10px',
    cursor: 'pointer'
  },
  headerCloseButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 30,
    border: 'none',
    borderRadius: 10,
    background: 'transparent',
    color: 'var(--button-text, #94a3b8)',
    font: 'inherit',
    fontSize: 23,
    lineHeight: 1,
    padding: 0,
    cursor: 'pointer'
  },
  body: {
    display: 'grid',
    gridTemplateColumns: '160px minmax(0, 1fr)',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden'
  },
  bodyCollapsed: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden'
  },
  rail: {
    borderRight: 'var(--menu-border, 1px solid rgba(15, 23, 42, 0.28))',
    padding: 12,
    overflowY: 'auto'
  },
  railGroup: {
    display: 'grid',
    gap: 6,
    marginBottom: 14
  },
  railGroupTitle: {
    padding: '0 8px',
    color: 'var(--button-text, #94a3b8)',
    fontSize: 10,
    fontWeight: 820,
    letterSpacing: '0.12em',
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  tabList: {
    display: 'grid',
    gap: 3,
    padding: 5,
    borderRadius: 16,
    background: 'var(--menu-item-hover, rgba(15, 23, 42, 0.22))'
  },
  tabButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 34,
    border: '1px solid transparent',
    borderRadius: 11,
    padding: '0 10px',
    background: 'transparent',
    color: 'var(--button-text, #94a3b8)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 700,
    textAlign: 'left',
    cursor: 'pointer'
  },
  tabButtonActive: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    minHeight: 34,
    border: 'var(--menu-border, 1px solid rgba(103, 232, 249, 0.45))',
    borderRadius: 11,
    padding: '0 10px',
    background: 'var(--button-background, rgba(103, 232, 249, 0.14))',
    color: 'var(--button-icon-hover, #cffafe)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 760,
    textAlign: 'left',
    cursor: 'pointer'
  },
  preset: {
    marginTop: 18,
    borderRadius: 20,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.18))',
    background: 'var(--menu-item-hover, rgba(15, 23, 42, 0.18))',
    padding: 14
  },
  presetEyebrow: {
    marginBottom: 10,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--button-text, #94a3b8)'
  },
  presetCard: {
    borderRadius: 14,
    border: 'var(--menu-border, 1px solid rgba(103, 232, 249, 0.28))',
    background: 'var(--button-background, rgba(103, 232, 249, 0.12))',
    color: 'var(--button-icon-hover, #cffafe)',
    padding: '12px 14px',
    fontSize: 14,
    fontWeight: 850
  },
  main: {
    display: 'grid',
    gap: 10,
    alignContent: 'start',
    minWidth: 0,
    minHeight: 0,
    padding: 16,
    overflowY: 'auto',
    overscrollBehavior: 'contain'
  },
  mainCollapsed: {
    display: 'grid',
    gap: 12,
    alignContent: 'start',
    minWidth: 0,
    minHeight: 0,
    padding: 16,
    overflowY: 'auto',
    overscrollBehavior: 'contain'
  },
  sectionStackItem: {
    display: 'grid',
    gap: 10,
    minWidth: 0
  },
  section: {
    borderRadius: 18,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.24))',
    background: 'var(--menu-item-hover, rgba(255, 255, 255, 0.035))',
    padding: 14
  },
  sectionHeader: {
    paddingBottom: 12,
    marginBottom: 10,
    borderBottom: 'var(--menu-border, 1px solid rgba(15, 23, 42, 0.34))'
  },
  eyebrow: {
    marginBottom: 6,
    color: 'var(--button-icon-hover, #99f6e4)',
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: '0.22em',
    textTransform: 'uppercase'
  },
  sectionTitle: {
    margin: 0,
    color: 'var(--menu-text, #f8fafc)',
    fontSize: 18,
    lineHeight: 1.1,
    fontWeight: 900
  },
  sectionBody: {
    display: 'grid',
    gap: 14
  },
  settingGroup: {
    display: 'grid',
    gap: 8
  },
  settingGroupTitle: {
    color: 'var(--button-icon-hover, #99f6e4)',
    fontSize: 10,
    fontWeight: 820,
    letterSpacing: '0.16em',
    textTransform: 'uppercase'
  },
  settingGroupBody: {
    display: 'grid',
    gap: 10
  },
  settingPill: {
    display: 'grid',
    gridTemplateColumns: 'minmax(170px, 220px) minmax(180px, 1fr)',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 14,
    background: 'var(--button-background, rgba(15, 23, 42, 0.32))',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)',
    padding: '10px 14px'
  },
  settingPillCollapsed: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: 14,
    background: 'var(--button-background, rgba(15, 23, 42, 0.32))',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)',
    padding: '10px 14px'
  },
  settingPillFitLabels: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(180px, 1fr)',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 14,
    background: 'var(--button-background, rgba(15, 23, 42, 0.32))',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)',
    padding: '10px 14px'
  },
  settingPillCollapsedFitLabels: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: 14,
    background: 'var(--button-background, rgba(15, 23, 42, 0.32))',
    boxShadow: 'inset 0 0 0 1px rgba(15, 23, 42, 0.08)',
    padding: '10px 14px'
  },
  settingMeta: {
    minWidth: 0
  },
  settingControl: {
    minWidth: 0
  },
  settingLabel: {
    color: 'var(--menu-text, #dbeafe)',
    fontSize: 13,
    fontWeight: 760
  },
  settingHint: {
    marginTop: 3,
    color: 'var(--button-text, #94a3b8)',
    fontSize: 11,
    lineHeight: 1.3,
    fontWeight: 620
  },
  numberGrid: {
    display: 'grid',
    width: '100%',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr) 70px',
    gap: 12,
    alignItems: 'center'
  },
  range: {
    width: '100%',
    minWidth: 0,
    accentColor: 'var(--button-icon-hover, #60a5fa)'
  },
  numberInput: {
    width: '100%',
    minWidth: 0,
    minHeight: 36,
    boxSizing: 'border-box',
    borderRadius: 13,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.24))',
    background: 'var(--menu-background, rgba(51, 65, 85, 0.78))',
    color: 'var(--menu-text, #f8fafc)',
    textAlign: 'center',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 760
  },
  textInput: {
    width: '100%',
    minHeight: 36,
    borderRadius: 13,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.24))',
    background: 'var(--menu-background, rgba(51, 65, 85, 0.78))',
    color: 'var(--menu-text, #f8fafc)',
    padding: '0 16px',
    font: 'inherit',
    fontSize: 13,
    fontWeight: 700
  },
  switchButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    minHeight: 36,
    border: 'none',
    background: 'transparent',
    color: 'var(--button-text, #94a3b8)',
    font: 'inherit',
    cursor: 'pointer'
  },
  switchButtonActive: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
    minHeight: 36,
    border: 'none',
    background: 'transparent',
    color: 'var(--button-icon-hover, #cffafe)',
    font: 'inherit',
    cursor: 'pointer'
  },
  switchText: {
    fontSize: 13,
    fontWeight: 700
  },
  switchTrack: {
    display: 'flex',
    alignItems: 'center',
    width: 44,
    height: 24,
    borderRadius: 999,
    background: 'var(--menu-item-hover, rgba(15, 23, 42, 0.48))',
    padding: 2
  },
  switchTrackActive: {
    display: 'flex',
    alignItems: 'center',
    width: 44,
    height: 24,
    borderRadius: 999,
    background: 'var(--button-icon-hover, #60a5fa)',
    padding: 2
  },
  switchKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    background: 'var(--button-text, #94a3b8)'
  },
  switchKnobActive: {
    width: 20,
    height: 20,
    borderRadius: 999,
    background: 'var(--menu-text, #ffffff)',
    transform: 'translateX(20px)'
  },
  emptyState: {
    color: 'var(--button-text, #94a3b8)',
    fontSize: 12
  },
  shapeSection: {
    borderRadius: 16,
    border: 'var(--menu-border, 1px solid rgba(103, 232, 249, 0.24))',
    background: 'var(--menu-item-hover, rgba(103, 232, 249, 0.045))',
    padding: 14
  },
  shapeHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    gap: 12,
    marginBottom: 12
  },
  shapeTitle: {
    margin: 0,
    color: 'var(--menu-text, #f8fafc)',
    fontSize: 14,
    fontWeight: 800
  },
  shapeDescription: {
    margin: '4px 0 0',
    color: 'var(--button-text, #94a3b8)',
    fontSize: 12,
    fontWeight: 620
  },
  shapeIcon: {
    color: 'var(--button-icon-hover, #99f6e4)'
  },
  shapeGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 8
  },
  shapeCard: {
    minHeight: 82,
    display: 'grid',
    alignContent: 'space-between',
    borderRadius: 12,
    border: 'var(--menu-border, 1px solid rgba(148, 163, 184, 0.18))',
    background: 'var(--button-background, rgba(15, 23, 42, 0.32))',
    color: 'var(--menu-text, #f8fafc)',
    padding: 9,
    textAlign: 'left',
    cursor: 'pointer'
  },
  shapeCardSelected: {
    minHeight: 82,
    display: 'grid',
    alignContent: 'space-between',
    borderRadius: 12,
    border: 'var(--menu-border, 1px solid rgba(103, 232, 249, 0.7))',
    background: 'var(--button-background, rgba(103, 232, 249, 0.14))',
    color: 'var(--menu-text, #f8fafc)',
    padding: 9,
    textAlign: 'left',
    cursor: 'pointer'
  },
  shapePreview: {
    width: '100%',
    height: 30
  },
  endpointPill: {
    fill: 'var(--menu-background, rgba(51, 65, 85, 0.88))'
  },
  dependencyPath: {
    stroke: 'var(--button-icon-hover, #67e8f9)',
    strokeWidth: 3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  },
  endpointDot: {
    fill: 'var(--button-icon-hover, #a5f3fc)'
  },
  shapeCardFooter: {
    display: 'flex',
    alignItems: 'end',
    justifyContent: 'space-between',
    gap: 10
  },
  shapeCardTitle: {
    color: 'var(--menu-text, #f8fafc)',
    fontSize: 11,
    fontWeight: 800
  },
  shapeCardSubtitle: {
    marginTop: 2,
    color: 'var(--button-text, #94a3b8)',
    fontSize: 10,
    fontWeight: 620
  },
  radio: {
    display: 'grid',
    placeItems: 'center',
    width: 14,
    height: 14,
    borderRadius: 999,
    border: 'var(--menu-border, 2px solid rgba(148, 163, 184, 0.65))'
  },
  radioSelected: {
    display: 'grid',
    placeItems: 'center',
    width: 14,
    height: 14,
    borderRadius: 999,
    border: 'var(--menu-border, 2px solid rgba(103, 232, 249, 0.9))',
    background: 'var(--button-background, rgba(103, 232, 249, 0.16))'
  },
  radioDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: 'transparent'
  },
  radioDotSelected: {
    width: 5,
    height: 5,
    borderRadius: 999,
    background: 'var(--button-icon-hover, #a5f3fc)'
  }
} satisfies Record<string, JSX.CSSProperties>;
