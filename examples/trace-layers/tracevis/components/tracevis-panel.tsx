import {FC, useCallback, useMemo} from 'react';
import {ListTreeIcon} from 'lucide-react';
import {Accordion, AccordionSection} from '@deck.gl-community/trace-layers/react';

import {useAppStore} from '../tracevis-store';
import {
  CompactSelect,
  DismissibleBanner,
  MultiSelect,
  SlidingThumbSwitch,
  WithInfo
} from './infovis-primitives';

// For the navbar
export {Settings2Icon as TracevisPanelIcon, FileQuestion} from 'lucide-react';

/** Renders the standalone demo trace catalog panel. */
export const TracevisPanel: FC = () => {
  return (
    <div className="h-full min-w-0 overflow-y-auto p-3">
      <DismissibleBanner
        text="Trace layers docs"
        href="https://github.com/visgl/deck.gl-community/tree/master/docs/modules/trace-layers"
      />

      <Accordion type="multiple" defaultValue={['chrome-traces']}>
        <AccordionSection
          sectionId="chrome-traces"
          title="Traces"
          tooltip="List of traces for this run. Select to visualize."
          icon={<ListTreeIcon className="h-4 w-4" />}
        >
          <ChromeTraceSection />
        </AccordionSection>
      </Accordion>
    </div>
  );
};

function ChromeTraceSection() {
  const uploadedTraceMetadatas = useAppStore(state => state.tracevis.uploadedTraceMetadatas);
  const uploadedTraceSelectionMap = useAppStore(state => state.tracevis.uploadedTraceSelectionMap);
  const setUploadedTraceSelectionMap = useAppStore(
    state => state.tracevis.setUploadedTraceSelectionMap
  );
  const uploadTraceFiles = useAppStore(state => state.tracevis.uploadTraceFiles);
  const selectedTraceIds = uploadedTraceMetadatas
    .map(metadata => metadata.traceId)
    .filter(traceId => uploadedTraceSelectionMap[traceId]);

  return (
    <div className="space-y-2">
      {uploadedTraceMetadatas.length > 0 && (
        <div>
          <div className="center text-blue-500 mt-4">User-uploaded traces.</div>
          <div className="max-h-[150px] overflow-y-auto text-sm text-muted-foreground">
            {uploadedTraceMetadatas.map(metadata => (
              <label
                key={metadata.traceId}
                className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-2 py-1"
              >
                <input
                  type="checkbox"
                  checked={Boolean(uploadedTraceSelectionMap[metadata.traceId])}
                  onChange={event =>
                    setUploadedTraceSelectionMap({
                      ...uploadedTraceSelectionMap,
                      [metadata.traceId]: event.currentTarget.checked
                    })
                  }
                />
                <span className="min-w-0 truncate">
                  {metadata.name} <span className="opacity-70">({metadata.type})</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {selectedTraceIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Selected: {selectedTraceIds.slice(0, 2).join(' vs. ')}
        </div>
      )}
      <div className="my-4" />
      <div>
        <label className="flex h-[100px] min-h-[100px] w-full min-w-[300px] cursor-pointer flex-col items-center justify-center rounded border border-dashed bg-muted/50 px-2 p-1">
          <input
            className="sr-only"
            type="file"
            accept=".json"
            multiple
            onChange={event => {
              const files = Array.from(event.currentTarget.files ?? []);
              if (files.length > 0) {
                void uploadTraceFiles(files);
              }
              event.currentTarget.value = '';
            }}
          />
          <div className="text-xs text-muted-foreground"> Add Chrome traces to visualize </div>
        </label>
        {/*
          errorMessage && (
          <>
            <h2 className="font-bold text-xl text-red-300">{errorMessage}</h2>
            <pre className="text-xs text-foreground-muted">{errorDetails?.slice(0, 200)}</pre>
            <div className="text-xs text-foreground-muted">
              Please make sure you are uploading valid trace file formats.
            </div>
          </>
        )
      */}
      </div>
    </div>
  );
}

/** Renders the legacy inline visualization settings panel for the standalone demo. */
export function VisualizationSettings() {
  const visSettings = useAppStore(state => state.tracevis.visSettings);
  const setVisSetting = useAppStore(state => state.tracevis.setVisSetting);

  const setShowPathsOnly = useCallback(
    (checked: boolean) => setVisSetting('showPathsOnly', checked),
    [setVisSetting]
  );
  const setFollowCriticalPathAnimationMode = useCallback(
    (mode: 'none' | 'animate' | 'follow') => setVisSetting('followCriticalPathAnimationMode', mode),
    [setVisSetting]
  );

  const setLocalDependencyMode = useCallback(
    (mode: 'all' | 'none' | 'warnings' | 'submit') => setVisSetting('localDependencyMode', mode),
    [setVisSetting]
  );
  // const setShowSubmits = useCallback(
  //   (checked: boolean) => setVisSetting('showSubmits', checked),
  //   [setVisSetting],
  // );
  const setCrossDependencyMode = useCallback(
    (mode: 'all' | 'none') => setVisSetting('crossDependencyMode', mode),
    [setVisSetting]
  );
  const setShowInstants = useCallback(
    (checked: boolean) => setVisSetting('showInstants', checked),
    [setVisSetting]
  );
  const setShowCounters = useCallback(
    (checked: boolean) => setVisSetting('showCounters', checked),
    [setVisSetting]
  );
  const setLayoutDensity = useCallback(
    (
      density:
        | 'comfortable'
        | 'compact'
        | 'compact-spacious-processes'
        | 'ultra-compact'
        | 'flamegraph'
    ) => setVisSetting('layoutDensity', density),
    [setVisSetting]
  );
  const setHighlightFadeFactor = useCallback(
    (value: number) => setVisSetting('highlightFadeFactor', value),
    [setVisSetting]
  );
  const setVisDependencyOpacity = useAppStore(state => state.tracevis.setVisDependencyOpacity);
  const setVisLineRoutingMode = useAppStore(state => state.tracevis.setVisLineRoutingMode);

  const setVisMinBlockTimeMs = useAppStore(state => state.tracevis.setVisMinBlockTimeMs);
  const setVisStreamDisplayMode = useAppStore(state => state.tracevis.setVisStreamDisplayMode);
  const setVisSelectedStreamNames = useAppStore(state => state.tracevis.setVisSelectedStreamNames);
  const setVisRankLayoutMode = useCallback(
    (mode: 'step1' | 'sequential' | 'interleaved') => setVisSetting('processLayoutMode', mode),
    [setVisSetting]
  );
  const setTraceOffsetMs = useCallback(
    (value: number) => setVisSetting('traceOffsetMs', value),
    [setVisSetting]
  );
  const setTraceScale = useCallback(
    (value: number) => setVisSetting('traceScale', value),
    [setVisSetting]
  );

  const setVisPopupMode = useAppStore(state => state.tracevis.setVisPopupMode);
  const traceColorSchemes = useAppStore(state => state.tracevis.traceColorSchemes);
  const traceColorSchemeId = useAppStore(state => state.tracevis.visSettings.traceColorSchemeId);
  const setTraceColorSchemeId = useAppStore(state => state.tracevis.setTraceColorSchemeId);
  const traceColorSchemeOptions = useMemo(
    () =>
      traceColorSchemes.map(scheme => ({
        name: scheme.name,
        value: scheme.id
      })),
    [traceColorSchemes]
  );
  const hasMultipleTraceColorSchemes = traceColorSchemes.length > 1;
  const selectedTraceColorSchemeId = useMemo(() => {
    if (traceColorSchemes.some(scheme => scheme.id === traceColorSchemeId)) {
      return traceColorSchemeId;
    }
    return traceColorSchemes[0]?.id ?? 'default';
  }, [traceColorSchemes, traceColorSchemeId]);

  const traceOffsetMs = visSettings.traceOffsetMs ?? 0;
  const traceScale = visSettings.traceScale ?? 1;

  const streamNames = useMemo(() => [], []);
  const streamSelectOptions = useMemo(
    () => streamNames.map(name => ({label: name, value: name})),
    [streamNames]
  );

  const streamTooltip = useMemo(
    () => `\
Changes which streams are visible:
*all* - shows all streams in graph that have spans
*minimal* - hides less important streams
*selected* - lets user select which streams to show`,
    []
  );

  return (
    <div className="ml-2 px-2">
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-5 gap-y-2 items-center">
        <div className="text-foreground"> Filters </div>
        <hr className="col-span-3 border-t border-muted" />

        {hasMultipleTraceColorSchemes && (
          <>
            <label htmlFor="trace-color-scheme" className="text-sm text-muted-foreground">
              Color Scheme
            </label>

            <CompactSelect
              value={selectedTraceColorSchemeId}
              placeholder="Select a scheme"
              onValueChange={setTraceColorSchemeId}
              small
              items={traceColorSchemeOptions}
            />

            <span />
            <WithInfo tooltip="Select which scheme determines block and stream colors in the timeline." />
          </>
        )}

        {/* STREAM FILTER */}

        <label htmlFor="stream-display-mode" className="text-sm text-muted-foreground">
          Streams
        </label>

        <CompactSelect
          value={visSettings.threadDisplayMode}
          placeholder="Select a mode"
          onValueChange={setVisStreamDisplayMode}
          small
          items={[
            // { name: 'All', value: 'all' },
            {name: 'All', value: 'active'},
            {name: 'Minimal', value: 'minimal'},
            {name: 'Selected', value: 'selected'}
          ]}
        />

        <span />
        <WithInfo tooltip={streamTooltip} />

        {visSettings.threadDisplayMode === 'selected' && (
          <MultiSelect
            className="col-span-4"
            placeholder="Select Streams to Display"
            options={streamSelectOptions}
            value={visSettings.selectedThreadNames}
            onValueChange={setVisSelectedStreamNames}
          />
        )}

        <label htmlFor="demo-rank-layout-mode" className="text-sm text-muted-foreground">
          Layout
        </label>
        <CompactSelect
          value={visSettings.processLayoutMode}
          placeholder="Select a layout"
          onValueChange={setVisRankLayoutMode}
          small
          items={[
            {name: 'Step 1 only', value: 'step1'},
            {name: 'Sequential', value: 'sequential'},
            {name: 'Interleaved', value: 'interleaved'}
          ]}
        />
        <span />
        <WithInfo tooltip="Control how ranks from multiple traces are arranged vertically." />

        <div className="text-foreground"> Trace Alignment </div>
        <hr className="col-span-3 border-t border-muted" />

        <label
          htmlFor="demo-trace-offset-slider"
          className="text-sm font-medium text-muted-foreground"
        >
          Trace Offset
        </label>
        <NativeSlider
          id="demo-trace-offset-slider"
          value={[traceOffsetMs]}
          min={-10}
          max={10}
          step={0.5}
          onValueChange={([value]) => setTraceOffsetMs(value)}
          className="flex-1"
        />
        <span>{traceOffsetMs.toFixed(1)}ms</span>
        <WithInfo tooltip="Shift the secondary trace left or right relative to the primary trace." />

        <label
          htmlFor="demo-trace-scale-slider"
          className="text-sm font-medium text-muted-foreground"
        >
          Trace Scale
        </label>
        <NativeSlider
          id="demo-trace-scale-slider"
          value={[traceScale]}
          min={0.5}
          max={2}
          step={0.1}
          onValueChange={([value]) => setTraceScale(value)}
          className="flex-1"
        />
        <span>{traceScale.toFixed(2)}×</span>
        <WithInfo tooltip="Stretch or compress the secondary trace along the time axis." />

        {/* CRITICAL PATH SETTINGS */}

        <div className="col-span-4 pt-2 text-sm font-semibold text-foreground">Critical paths</div>
        <hr className="col-span-4 border-t border-muted" />

        <label htmlFor="show-paths-only" className="text-sm text-muted-foreground">
          Highlight Paths
        </label>

        <SlidingThumbSwitch
          id="show-paths-only"
          checked={visSettings.showPathsOnly}
          onCheckedChange={setShowPathsOnly}
        />

        <span />

        <WithInfo tooltip="Fade non-path spans and dependencies while keeping critical paths emphasized." />

        <label className="text-sm text-muted-foreground">Animate Paths</label>

        <CompactSelect
          value={visSettings.followCriticalPathAnimationMode ?? 'none'}
          placeholder="Choose animation mode"
          onValueChange={(value: 'none' | 'animate' | 'follow') =>
            setFollowCriticalPathAnimationMode(value)
          }
          small
          items={[
            {name: 'No', value: 'none'},
            {name: 'Animate', value: 'animate'},
            {name: 'Follow', value: 'follow'}
          ]}
        />

        <span />

        <WithInfo tooltip="Animate critical paths (Animate) or animate and recenter on the current block (Follow)." />

        <label
          htmlFor="demo-critical-path-animation-interval"
          className="text-sm text-muted-foreground"
        >
          Animation Speed
        </label>

        <div className="col-span-2 flex items-center gap-2">
          <input
            id="demo-critical-path-animation-interval"
            type="range"
            min={30}
            max={300}
            step={10}
            value={visSettings.criticalPathAnimationIntervalMs ?? 75}
            onChange={event =>
              setVisSetting('criticalPathAnimationIntervalMs', Number(event.target.value))
            }
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground min-w-[48px] text-right">
            {visSettings.criticalPathAnimationIntervalMs ?? 75} ms
          </span>
        </div>

        <WithInfo tooltip="Adjust how quickly the critical path animation advances (lower is faster)." />

        <label htmlFor="demo-critical-path-trail-length" className="text-sm text-muted-foreground">
          Trail Length
        </label>

        <div className="col-span-2 flex items-center gap-2">
          <input
            id="demo-critical-path-trail-length"
            type="range"
            min={1}
            max={10}
            step={1}
            value={visSettings.criticalPathTrailLength ?? 1}
            onChange={event => setVisSetting('criticalPathTrailLength', Number(event.target.value))}
            className="flex-1"
          />
          <span className="min-w-[48px] text-right text-xs text-muted-foreground">
            {visSettings.criticalPathTrailLength ?? 1} spans
          </span>
        </div>

        <WithInfo tooltip="Choose how many spans stay highlighted behind the animation head." />

        <div className="col-span-4 pt-2 text-sm font-semibold text-foreground">Filters</div>
        <hr className="col-span-4 border-t border-muted" />

        <label htmlFor="show-instants" className="text-sm text-muted-foreground">
          Instants
        </label>

        <SlidingThumbSwitch
          id="show-instants"
          checked={visSettings.showInstants}
          onCheckedChange={setShowInstants}
        />

        <span />
        <WithInfo tooltip="Show instant trace events as glyphs on each stream." />

        <label htmlFor="show-counters" className="text-sm text-muted-foreground">
          Counters
        </label>

        <SlidingThumbSwitch
          id="show-counters"
          checked={visSettings.showCounters}
          onCheckedChange={setShowCounters}
        />

        <span />
        <WithInfo tooltip="Overlay counter samples as sparklines and pickable points." />

        {/* BLOCK SLIDER */}

        <label htmlFor="block-length-slider" className="text-sm font-medium text-muted-foreground">
          Duration
        </label>
        <NativeSlider
          id="block-length-slider"
          value={[visSettings.minBlockTimeMs]}
          min={0}
          max={1000}
          step={10}
          onValueChange={([value]) => setVisMinBlockTimeMs(value)}
          className="flex-1"
        />
        <span>{visSettings.minBlockTimeMs}ms</span>
        <WithInfo tooltip="Hide spans with durations shorter than the specified value." />

        <label
          htmlFor="highlight-fade-slider"
          className="text-sm font-medium text-muted-foreground"
        >
          Highlight
        </label>
        <NativeSlider
          id="highlight-fade-slider"
          value={[visSettings.highlightFadeFactor]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([value]) => setHighlightFadeFactor(value)}
          className="flex-1"
        />
        <span>{Math.round(visSettings.highlightFadeFactor * 100)}%</span>
        <WithInfo tooltip="Opacity applied to spans that are not currently highlighted." />

        <div className="text-foreground"> Dependencies </div>
        <hr className="col-span-3 border-t border-muted" />

        <label htmlFor="local-dependency-mode" className="text-sm text-muted-foreground">
          Local
        </label>

        <CompactSelect<'all' | 'none' | 'warnings' | 'submit'>
          value={visSettings.localDependencyMode}
          onValueChange={setLocalDependencyMode}
          small
          placeholder="Select how dependencies are shown"
          items={[
            {name: 'All', value: 'all'},
            {name: 'None', value: 'none'},
            {name: 'Warnings', value: 'warnings'},
            {name: 'SUBMIT', value: 'submit'}
          ]}
        />
        <span />
        <WithInfo tooltip="Show local (intra-rank) dependency lines. Warnings shows suspicious SUBMIT waits and SUBMIT shows all SUBMIT dependencies." />

        {/*
        <label htmlFor="show-dependencies" className="text-sm text-muted-foreground">
          Show Submits
        </label>

        <SlidingThumbSwitch
          id="show-dependencies"
          checked={visSettings.showSubmits}
          onCheckedChange={setShowSubmits}
        />
        <span />
        <WithInfo tooltip="Show SUBMIT dependency lines." />
        */}

        <label htmlFor="cross-dependency-mode" className="text-sm text-muted-foreground">
          Cross Rank
        </label>

        <CompactSelect<'all' | 'none'>
          value={visSettings.crossDependencyMode}
          onValueChange={setCrossDependencyMode}
          small
          placeholder="Select how cross dependencies are shown"
          items={[
            {name: 'All', value: 'all'},
            {name: 'None', value: 'none'}
          ]}
        />

        <span />
        <WithInfo tooltip="Show cross rank dependency lines. ⚠️ Memory Intensive">
          <span>⚠️</span>
        </WithInfo>

        {/* DEPENDENCY OPACITY SLIDER */}

        <label htmlFor="path-fade-slider" className="text-sm font-medium text-muted-foreground">
          Line Opacity
        </label>
        <NativeSlider
          id="path-fade-slider"
          value={[visSettings.dependencyOpacity]}
          min={0}
          max={0.4}
          step={0.01}
          onValueChange={([value]) => setVisDependencyOpacity(value)}
          className="flex-1"
        />
        <span>{Math.round(visSettings.dependencyOpacity * 100)}%</span>
        <WithInfo tooltip="Adjust the opacity of dependency lines. Lower values make them more transparent." />

        {/* ROUTING */}

        <div className="text-muted-foreground">Line Routing</div>
        <CompactSelect
          value={visSettings.lineRoutingMode}
          placeholder="Select a mode"
          onValueChange={setVisLineRoutingMode}
          small
          items={[
            {name: 'Diagonal', value: 'straight'},
            {name: 'Curved', value: 'curve'}
          ]}
        />
        <span />
        <WithInfo tooltip="Line routing attempts to avoid intersections, but can make it harder to see dependencies. " />

        <div className="text-foreground"> Application </div>
        <hr className="col-span-3 border-t border-muted" />

        <label htmlFor="layout-density" className="text-sm text-muted-foreground">
          Density
        </label>

        <CompactSelect
          value={visSettings.layoutDensity ?? 'comfortable'}
          placeholder="Select a density"
          onValueChange={setLayoutDensity}
          small
          items={[
            {name: 'Comfortable', value: 'comfortable'},
            {name: 'Compact', value: 'compact'},
            {name: 'Compact, spaced processes', value: 'compact-spacious-processes'},
            {name: 'Ultra-compact', value: 'ultra-compact'},
            {name: 'Flamegraph', value: 'flamegraph'}
          ]}
        />

        <span />
        <WithInfo tooltip="Adjust vertical spacing and label sizing to fit more streams on screen." />

        <div className="text-muted-foreground">Open Deep Links in</div>
        <CompactSelect
          value={visSettings.popupMode}
          placeholder="Select a mode"
          onValueChange={setVisPopupMode}
          small
          items={[
            {name: 'Tab', value: 'tab'},
            {name: 'Popups', value: 'popup'}
          ]}
        />
        <span />
        <WithInfo tooltip="Whether deep links are opened in popup windows or new browser tabs (e.g. when opening NDB UI on a node in the rank table)." />
      </div>
    </div>
  );
}

/** Props for the native range input adapter used by the legacy settings panel. */
type NativeSliderProps = {
  /** DOM id for the range input. */
  id: string;
  /** Single-value slider tuple matching the previous slider API. */
  value: readonly number[];
  /** Minimum slider value. */
  min: number;
  /** Maximum slider value. */
  max: number;
  /** Slider step size. */
  step: number;
  /** Optional CSS class name for the range input. */
  className?: string;
  /** Called with the updated single-value tuple. */
  onValueChange: (value: [number]) => void;
};

/** Adapts a native range input to the small tuple-based API used by the settings panel. */
function NativeSlider(props: NativeSliderProps) {
  return (
    <input
      id={props.id}
      type="range"
      value={props.value[0]}
      min={props.min}
      max={props.max}
      step={props.step}
      className={props.className}
      onChange={event => props.onValueChange([Number(event.currentTarget.value)])}
    />
  );
}
