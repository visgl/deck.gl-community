import {create} from 'zustand';
import {
  buildTraceRanksFromChromeTrace,
  DEFAULT_TRACE_COLOR_SCHEME,
  maybeChromeTraceFile,
  parseChromeTrace
} from '@deck.gl-community/trace-layers/trace';
import {log, safeJsonParse} from '@deck.gl-community/trace-layers/react';

import {getTracevisExampleTrace} from './examples/tracevis-examples';
import {DEFAULT_VIS_SETTINGS, normalizeLineRoutingMode} from './lib/vis-settings';

import type {VisSettings} from './lib/vis-settings';
import type {
  ChromeTrace,
  ChromeTraceFileSchema,
  SpanRef,
  TraceColorScheme,
  TraceCrossProcessDependency,
  TraceProcess,
  TraceSpanLayoutMode,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '@deck.gl-community/trace-layers/trace';

/** Controls how extended selection affects non-selected spans and dependency overlays. */
export type ExtendedSelectionMode = 'none' | 'fade' | 'highlight' | 'both';

/** One breadcrumb entry in the standalone demo span navigation history. */
export type TraceBreadcrumbEntry = {
  /** Canonical span ref for the breadcrumb entry. */
  spanRef: SpanRef;
  /** Display name shown for the breadcrumb entry. */
  spanName?: string | null;
  /** Keyword labels copied from the selected span for badge styling. */
  spanKeywords?: string[] | null;
  /** Background color used by the breadcrumb badge. */
  blockColor?: string | null;
  /** Foreground text color used by the breadcrumb badge. */
  blockTextColor?: string | null;
};

/** Identifies which Tracevis trace slot owns a loaded trace. */
export type TraceSource = 'example' | 'uploaded' | 'primary' | 'secondary';

/** Identifies one trace payload independent of its parsed data. */
export type TraceIdentifier = {
  /** Stable trace id or uploaded file id. */
  traceId: string;
  /** Trace slot owning this trace. */
  source: TraceSource;
  /** Optional run id associated with the trace. */
  runId?: string | null;
};

/** Input used when loading or parsing one trace. */
export type TraceLoadParams = TraceIdentifier & {
  /** Raw Chrome trace bytes when loading from an uploaded file. */
  arrayBuffer?: ArrayBuffer;
  /** Already-parsed trace payload when bypassing file parsing. */
  traceJson?: unknown;
};

/** Parsed Tracevis trace payload stored in the demo cache. */
export type TracevisTraceData = TraceIdentifier & {
  /** Cache key derived from trace id, source, and run id. */
  key: string;
  /** Normalized nullable run id. */
  runId: string | null;
  /** Parsed Chrome trace payload. */
  trace: ChromeTrace | null;
  /** Normalized trace processes built from the payload. */
  ranks: Readonly<TraceProcess[]>;
  /** Cross-process dependencies built from the payload. */
  crossDependencies: Readonly<TraceCrossProcessDependency[]>;
  /** Whether spans use generated lanes or authored vertical geometry. */
  spanLayout?: TraceSpanLayoutMode;
};

/** Metadata for one uploaded trace in the demo catalog. */
export type UploadedTraceMetadata = {
  /** Stable trace id derived from the uploaded filename. */
  traceId: string;
  /** Optional run id when one can be inferred by callers. */
  runId: string | null;
  /** Trace format label shown in the catalog. */
  type: string;
  /** Short display name for the trace. */
  name: string;
};

/** Extended selection data used by deck trace highlighting. */
export type ExtendedSelection = {
  /** Visible selected span refs chunk for extended-selection highlighting. */
  spanRefs: SpanRef[];
  /** Visible selected local dependency refs chunk for extended-selection overlays. */
  visibleLocalDependencyRefs: VisibleLocalDependencyRef[];
  /** Visible selected cross dependency refs chunk for extended-selection overlays. */
  visibleCrossDependencyRefs: VisibleCrossDependencyRef[];
};

/** Demo-only Tracevis state used by the standalone app. */
export type TracevisDemoState = {
  /** Any error during file load or parse. */
  errorMap: Record<string, Error>;
  /** Whether a trace load is currently running. */
  isLoading: boolean;
  /** Whether any trace data has been accepted by the store. */
  dataLoaded: boolean;
  /** Active visualization settings. */
  visSettings: VisSettings;
  /** Available color schemes for the demo. */
  traceColorSchemes: TraceColorScheme[];
  /** Current selected color scheme with fallback behavior. */
  selectedTraceColorScheme: TraceColorScheme;
  /** Uploaded trace bytes keyed by trace id. */
  uploadedTraces: Record<string, ArrayBuffer>;
  /** Metadata for uploaded trace files. */
  uploadedTraceMetadatas: UploadedTraceMetadata[];
  /** Parsed trace data keyed by trace identifier. */
  traceDataMap: Record<string, TracevisTraceData>;
  /** Map of selected built-in example traces. */
  exampleTraceSelectionMap: Record<string, boolean>;
  /** Map of selected uploaded traces. */
  uploadedTraceSelectionMap: Record<string, boolean>;
  /** Time range selected in the trace viewer. */
  timeRange: {startTimeMs: number; endTimeMs: number} | null;
  /** Canonical runtime span refs to highlight. */
  highlightedSpanRefs: SpanRef[];
  /** Extended selection data for alternative highlight flows. */
  extendedSelection: ExtendedSelection;
  /** Mode controlling how extended selection is rendered. */
  extendedSelectionMode: ExtendedSelectionMode;
  /** Initial selection state resolved by the demo. */
  defaultSelectionState: {
    /** The demo evaluates defaults immediately. */
    evaluated: boolean;
    /** Canonical default selected span refs resolved from the current graph when available. */
    selectedSpanRefs?: SpanRef[];
    /** Expanded process ids applied before user interaction. */
    expandedProcessIds?: string[];
  };
  /** Canonical runtime selected span refs. */
  selectedSpanRefs: SpanRef[];
  /** Expanded process ids. */
  expandedProcessIds: string[];
  /** Ordered history of spans the user has navigated through. */
  breadcrumb: TraceBreadcrumbEntry[];
  /** Index of the currently active breadcrumb entry, or -1 when unset. */
  breadcrumbIndex: number;
  /** Records or clears an error for a named trace operation. */
  setError: (name: string, error: unknown | null | undefined) => void;
  /** Get the currently selected color scheme with fallback behavior. */
  getSelectedTraceColorScheme: () => TraceColorScheme;
  /** Merge multiple visualization settings at once. */
  setVisSettings: (settings: Partial<VisSettings>) => void;
  /** Update one visualization setting. */
  setVisSetting: <K extends keyof VisSettings>(setting: K, value: VisSettings[K]) => void;
  /** Update the selected color scheme id. */
  setTraceColorSchemeId: (schemeId: string) => void;
  /** Update dependency opacity. */
  setVisDependencyOpacity: (value: number) => void;
  /** Update the minimum block duration filter. */
  setVisMinBlockTimeMs: (value: number) => void;
  /** Update dependency line routing. */
  setVisLineRoutingMode: (value: 'straight' | 'curve') => void;
  /** Update stream display mode. */
  setVisStreamDisplayMode: (value: 'active' | 'all' | 'selected' | 'minimal') => void;
  /** Update selected stream names. */
  setVisSelectedStreamNames: (selectedThreadNames: string[]) => void;
  /** Update popup mode. */
  setVisPopupMode: (value: 'popup' | 'tab') => void;
  /** Upload and parse local trace files. */
  uploadTraceFiles: (files: File[]) => Promise<void>;
  /** Retrieve parsed trace data when available. */
  getTraceData: (params: TraceIdentifier) => TracevisTraceData | null;
  /** Parse and store a trace. */
  parseTrace: (params: TraceLoadParams) => Promise<TracevisTraceData | null>;
  /** Load, parse, and store a trace. */
  loadTrace: (params: TraceLoadParams) => Promise<TracevisTraceData | null>;
  /** Update built-in example trace selection state. */
  setExampleTraceSelectionMap: (selectionMap: Record<string, boolean>) => void;
  /** Update uploaded trace selection state. */
  setUploadedTraceSelectionMap: (selectionMap: Record<string, boolean>) => void;
  /** Update selected time range. */
  setSelectedTimeRange: (timeRange: {startTimeMs: number; endTimeMs: number} | null) => void;
  /** Sets highlighted runtime span refs. */
  setHighlightedSpanRefs: (highlightedSpanRefs: SpanRef[]) => void;
  /** Sets extended selection data. */
  setExtendedSelection: (selection: ExtendedSelection) => void;
  /** Updates extended selection rendering mode. */
  setExtendedSelectionMode: (mode: ExtendedSelectionMode) => void;
  /** Updates canonical selected span refs. */
  setSelectedSpanRefs: (selectedSpanRefs: SpanRef[]) => void;
  /** Updates expanded process ids. */
  setExpandedProcessIds: (processIds: string[]) => void;
  /** Append a span to the breadcrumb history. */
  pushBreadcrumb: (entry: TraceBreadcrumbEntry) => void;
  /** Navigate to an item in the breadcrumb history. */
  goToBreadcrumb: (index: number) => void;
  /** Clear breadcrumb history. */
  clearBreadcrumb: () => void;
  /** Primary selection/navigation entrypoint from runtime interactions. */
  navigateToSpanRef: (spanRef: SpanRef) => void;
};

/** Root demo app state. */
export type AppState = {
  /** Standalone Tracevis demo state. */
  tracevis: TracevisDemoState;
};

const MAX_BREADCRUMB_ENTRIES = 20;
const traceLoadPromises = new Map<string, Promise<TracevisTraceData | null>>();
const textDecoder = new TextDecoder();

/** Builds the stable cache key used for parsed trace data and load de-duplication. */
const makeTraceKey = (params: TraceIdentifier) =>
  `${params.source}:${params.runId ?? ''}:${params.traceId}`;

/** Removes common Chrome trace payload extensions from upload display ids. */
const normalizeTraceId = (filename: string): string => filename.replace(/\.(json|jsonl|pb)$/i, '');

/** Standalone Tracevis demo store. */
export const useRoomStore = create<AppState>()((set, get) => ({
  tracevis: {
    errorMap: {},
    isLoading: false,
    dataLoaded: false,
    visSettings: DEFAULT_VIS_SETTINGS,
    traceColorSchemes: [],
    selectedTraceColorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    uploadedTraces: {},
    uploadedTraceMetadatas: [],
    traceDataMap: {},
    exampleTraceSelectionMap: {},
    uploadedTraceSelectionMap: {},
    timeRange: null,
    highlightedSpanRefs: [],
    extendedSelection: normalizeExtendedSelection(undefined),
    extendedSelectionMode: 'fade',
    defaultSelectionState: {evaluated: true, selectedSpanRefs: [], expandedProcessIds: []},
    selectedSpanRefs: [],
    expandedProcessIds: [],
    breadcrumb: [],
    breadcrumbIndex: -1,

    setError(name, error) {
      const errorMap = {...get().tracevis.errorMap};
      if (error) {
        errorMap[name] = error instanceof Error ? error : new Error(String(error));
      } else {
        delete errorMap[name];
      }
      set(state => ({tracevis: {...state.tracevis, errorMap}}));
    },

    getSelectedTraceColorScheme() {
      const {traceColorSchemes, visSettings} = get().tracevis;
      return resolveTraceColorScheme(traceColorSchemes, visSettings.traceColorSchemeId);
    },

    setVisSettings(settings) {
      set(state => ({
        tracevis: {
          ...state.tracevis,
          ...buildSettingsPatch(state.tracevis, settings)
        }
      }));
    },

    setVisSetting(setting, value) {
      get().tracevis.setVisSettings({[setting]: value} as Partial<VisSettings>);
    },

    setTraceColorSchemeId(schemeId) {
      get().tracevis.setVisSettings({traceColorSchemeId: schemeId});
    },

    setVisDependencyOpacity(value) {
      get().tracevis.setVisSettings({dependencyOpacity: value});
    },

    setVisMinBlockTimeMs(value) {
      get().tracevis.setVisSettings({minBlockTimeMs: value});
    },

    setVisLineRoutingMode(value) {
      get().tracevis.setVisSettings({lineRoutingMode: value});
    },

    setVisStreamDisplayMode(value) {
      get().tracevis.setVisSettings({threadDisplayMode: value});
    },

    setVisSelectedStreamNames(selectedThreadNames) {
      get().tracevis.setVisSettings({selectedThreadNames});
    },

    setVisPopupMode(value) {
      get().tracevis.setVisSettings({popupMode: value});
    },

    async uploadTraceFiles(files) {
      set(state => ({tracevis: {...state.tracevis, isLoading: true}}));

      for (const file of files) {
        if (!/\.json$/i.test(file.name)) {
          get().tracevis.setError(
            file.name,
            new Error('Only Chrome trace JSON files are supported.')
          );
          continue;
        }

        try {
          const arrayBuffer = await file.arrayBuffer();
          const traceJson = safeJsonParse<ChromeTraceFileSchema>(textDecoder.decode(arrayBuffer));
          if (!traceJson || !maybeChromeTraceFile(traceJson)) {
            throw new Error('Unrecognized trace file format.');
          }

          const traceId = normalizeTraceId(file.name);
          const metadata: UploadedTraceMetadata = {
            traceId,
            runId: null,
            type: 'chrome_trace',
            name: traceId
          };

          set(state => ({
            tracevis: buildUploadedTracePatch(state.tracevis, traceId, arrayBuffer, metadata)
          }));

          await get().tracevis.parseTrace({
            traceId,
            source: 'uploaded',
            runId: null,
            arrayBuffer,
            traceJson
          });
        } catch (error) {
          log.probe(0, 'tracevis-demo uploadTraceFiles failed', {file, error})();
          get().tracevis.setError(file.name, error);
        }
      }

      set(state => ({
        tracevis: {
          ...state.tracevis,
          isLoading: false,
          dataLoaded: true
        }
      }));
    },

    getTraceData(params) {
      return get().tracevis.traceDataMap[makeTraceKey(params)] ?? null;
    },

    async parseTrace(params) {
      const key = makeTraceKey(params);
      const existing = get().tracevis.traceDataMap[key];
      if (existing) {
        return existing;
      }

      try {
        const example =
          params.source === 'example' ? getTracevisExampleTrace(params.traceId) : null;
        if (example?.ranks) {
          const traceData: TracevisTraceData = {
            key,
            traceId: params.traceId,
            source: params.source,
            runId: params.runId ?? null,
            trace: null,
            ranks: example.ranks,
            crossDependencies: example.crossDependencies ?? [],
            spanLayout: example.spanLayout
          };

          set(state => ({
            tracevis: {
              ...state.tracevis,
              traceDataMap: {
                ...state.tracevis.traceDataMap,
                [key]: traceData
              },
              dataLoaded: true
            }
          }));

          return traceData;
        }

        let traceJson = params.traceJson as ChromeTraceFileSchema | null | undefined;
        let arrayBuffer = params.arrayBuffer;
        if (!traceJson) {
          if (example?.traceJson) {
            traceJson = example.traceJson;
          }
          if (!arrayBuffer && params.source === 'uploaded') {
            arrayBuffer = get().tracevis.uploadedTraces[params.traceId];
          }
          if (arrayBuffer) {
            traceJson = safeJsonParse<ChromeTraceFileSchema>(textDecoder.decode(arrayBuffer));
          }
        }
        if (!traceJson || !maybeChromeTraceFile(traceJson)) {
          throw new Error('Unrecognized trace file format.');
        }

        const trace = parseChromeTrace(traceJson, {log});
        const {ranks, crossDependencies} = buildTraceRanksFromChromeTrace(trace, {log});
        const traceData: TracevisTraceData = {
          key,
          traceId: params.traceId,
          source: params.source,
          runId: params.runId ?? null,
          trace,
          ranks,
          crossDependencies,
          spanLayout: params.source === 'example' ? example?.spanLayout : undefined
        };

        set(state => ({
          tracevis: {
            ...state.tracevis,
            traceDataMap: {
              ...state.tracevis.traceDataMap,
              [key]: traceData
            },
            dataLoaded: true
          }
        }));

        return traceData;
      } catch (error) {
        log.probe(0, 'tracevis-demo parseTrace failed', {params, error})();
        get().tracevis.setError(params.traceId, error);
        return null;
      }
    },

    async loadTrace(params) {
      const key = makeTraceKey(params);
      const cached = get().tracevis.traceDataMap[key];
      if (cached) {
        return cached;
      }

      const inFlight = traceLoadPromises.get(key);
      if (inFlight) {
        return inFlight;
      }

      const promise = get().tracevis.parseTrace({
        ...params,
        arrayBuffer:
          params.arrayBuffer ??
          (params.source === 'uploaded' ? get().tracevis.uploadedTraces[params.traceId] : undefined)
      });
      traceLoadPromises.set(key, promise);
      try {
        return await promise;
      } finally {
        traceLoadPromises.delete(key);
      }
    },

    setExampleTraceSelectionMap(exampleTraceSelectionMap) {
      set(state => ({
        tracevis: {
          ...state.tracevis,
          exampleTraceSelectionMap
        }
      }));
    },

    setUploadedTraceSelectionMap(uploadedTraceSelectionMap) {
      set(state => ({
        tracevis: {
          ...state.tracevis,
          uploadedTraceSelectionMap
        }
      }));
    },

    setSelectedTimeRange(timeRange) {
      set(state => ({tracevis: {...state.tracevis, timeRange}}));
    },

    setHighlightedSpanRefs(highlightedSpanRefs) {
      set(state => ({
        tracevis: {
          ...state.tracevis,
          highlightedSpanRefs: dedupeScalarArray(highlightedSpanRefs)
        }
      }));
    },

    setExtendedSelection(selection) {
      const nextSelection = normalizeExtendedSelection(selection);
      set(state => {
        if (areExtendedSelectionsEqual(state.tracevis.extendedSelection, nextSelection)) {
          return state;
        }
        return {
          tracevis: {
            ...state.tracevis,
            extendedSelection: nextSelection
          }
        };
      });
    },

    setExtendedSelectionMode(extendedSelectionMode) {
      set(state => ({tracevis: {...state.tracevis, extendedSelectionMode}}));
    },

    setSelectedSpanRefs(selectedSpanRefs) {
      const dedupedSelectedSpanRefs = dedupeScalarArray(selectedSpanRefs);
      set(state => {
        if (areScalarArraysEqual(state.tracevis.selectedSpanRefs, dedupedSelectedSpanRefs)) {
          return state;
        }
        return {
          tracevis: {
            ...state.tracevis,
            selectedSpanRefs: dedupedSelectedSpanRefs
          }
        };
      });
    },

    setExpandedProcessIds(processIds) {
      const dedupedProcessIds = dedupeScalarArray(processIds);
      set(state => {
        if (areScalarArraysEqual(state.tracevis.expandedProcessIds, dedupedProcessIds)) {
          return state;
        }
        return {
          tracevis: {
            ...state.tracevis,
            expandedProcessIds: dedupedProcessIds
          }
        };
      });
    },

    pushBreadcrumb(entry) {
      if (entry.spanRef == null) {
        return;
      }

      const normalizedEntry = normalizeBreadcrumbEntry(entry);
      set(state => {
        const existingIndex = state.tracevis.breadcrumb.findIndex(
          crumb => crumb.spanRef === normalizedEntry.spanRef
        );
        let breadcrumb = state.tracevis.breadcrumb;
        let breadcrumbIndex = state.tracevis.breadcrumbIndex;

        if (existingIndex >= 0) {
          breadcrumb = breadcrumb.map((crumb, index) =>
            index === existingIndex ? mergeBreadcrumbEntry(crumb, normalizedEntry) : crumb
          );
          breadcrumbIndex = existingIndex;
        } else {
          breadcrumb =
            breadcrumbIndex >= 0 && breadcrumbIndex < breadcrumb.length - 1
              ? breadcrumb.slice(0, breadcrumbIndex + 1)
              : [...breadcrumb];
          breadcrumb.push(normalizedEntry);
          if (breadcrumb.length > MAX_BREADCRUMB_ENTRIES) {
            breadcrumb = breadcrumb.slice(breadcrumb.length - MAX_BREADCRUMB_ENTRIES);
          }
          breadcrumbIndex = breadcrumb.length - 1;
        }

        return {
          tracevis: {
            ...state.tracevis,
            breadcrumb,
            breadcrumbIndex
          }
        };
      });
    },

    goToBreadcrumb(index) {
      const target = get().tracevis.breadcrumb[index];
      if (!target) {
        return;
      }
      set(state => ({
        tracevis: {
          ...state.tracevis,
          selectedSpanRefs: [target.spanRef],
          breadcrumbIndex: index
        }
      }));
    },

    clearBreadcrumb() {
      set(state => ({
        tracevis: {
          ...state.tracevis,
          breadcrumb: [],
          breadcrumbIndex: -1
        }
      }));
    },

    navigateToSpanRef(spanRef) {
      get().tracevis.setSelectedSpanRefs([spanRef]);
    }
  }
}));

/** Initializes the standalone demo store. Reserved for future one-time setup. */
export function initStore() {}

/** Zustand store alias chunk for demo shell compatibility. */
export const roomStore = useRoomStore;
/** Zustand store alias chunk for app code that expects a named store export. */
export const store = roomStore;
/** Hook alias used by demo panels. */
export const useAppStore = useRoomStore;

function resolveTraceColorScheme(
  availableSchemes: ReadonlyArray<TraceColorScheme>,
  selectedSchemeId: string
): TraceColorScheme {
  return (
    availableSchemes.find(scheme => scheme.id === selectedSchemeId) ?? DEFAULT_TRACE_COLOR_SCHEME
  );
}

/** Resolves a selected color scheme id to one that exists in the current scheme list. */
function resolveTraceColorSchemeId(
  availableSchemes: ReadonlyArray<TraceColorScheme>,
  selectedSchemeId: string
): string {
  return availableSchemes.some(scheme => scheme.id === selectedSchemeId)
    ? selectedSchemeId
    : (availableSchemes[0]?.id ?? DEFAULT_VIS_SETTINGS.traceColorSchemeId);
}

/** Applies visualization setting updates while normalizing dependent fallback values. */
function buildSettingsPatch(
  state: TracevisDemoState,
  patch: Partial<VisSettings>
): Pick<TracevisDemoState, 'visSettings' | 'selectedTraceColorScheme'> {
  const nextVisSettings: VisSettings = {
    ...state.visSettings,
    ...patch,
    lineRoutingMode:
      normalizeLineRoutingMode(patch.lineRoutingMode ?? state.visSettings.lineRoutingMode) ??
      DEFAULT_VIS_SETTINGS.lineRoutingMode,
    traceColorSchemeId: resolveTraceColorSchemeId(
      state.traceColorSchemes,
      patch.traceColorSchemeId ?? state.visSettings.traceColorSchemeId
    )
  };
  return {
    visSettings: nextVisSettings,
    selectedTraceColorScheme: resolveTraceColorScheme(
      state.traceColorSchemes,
      nextVisSettings.traceColorSchemeId
    )
  };
}

/**
 * Adds uploaded trace bytes and metadata, selecting the trace automatically when it is the first
 * accepted upload in the demo catalog.
 */
function buildUploadedTracePatch(
  state: TracevisDemoState,
  traceId: string,
  arrayBuffer: ArrayBuffer,
  metadata: UploadedTraceMetadata
): TracevisDemoState {
  const isFirstUploadedTrace = state.uploadedTraceMetadatas.length === 0;
  return {
    ...state,
    uploadedTraces: {
      ...state.uploadedTraces,
      [traceId]: arrayBuffer
    },
    uploadedTraceMetadatas: [
      ...state.uploadedTraceMetadatas.filter(item => item.traceId !== traceId),
      metadata
    ],
    uploadedTraceSelectionMap: isFirstUploadedTrace
      ? {
          ...state.uploadedTraceSelectionMap,
          [traceId]: true
        }
      : state.uploadedTraceSelectionMap
  };
}

/** Normalizes possibly partial extended-selection data into a complete selection object. */
function normalizeExtendedSelection(
  extendedSelection: Partial<ExtendedSelection> | null | undefined
): ExtendedSelection {
  return {
    spanRefs: Array.isArray(extendedSelection?.spanRefs) ? [...extendedSelection.spanRefs] : [],
    visibleLocalDependencyRefs: Array.isArray(extendedSelection?.visibleLocalDependencyRefs)
      ? [...extendedSelection.visibleLocalDependencyRefs]
      : [],
    visibleCrossDependencyRefs: Array.isArray(extendedSelection?.visibleCrossDependencyRefs)
      ? [...extendedSelection.visibleCrossDependencyRefs]
      : []
  };
}

/** Compares two extended-selection payloads without allocating new sets. */
function areExtendedSelectionsEqual(left: ExtendedSelection, right: ExtendedSelection): boolean {
  return (
    areScalarArraysEqual(left.spanRefs, right.spanRefs) &&
    areScalarArraysEqual(left.visibleLocalDependencyRefs, right.visibleLocalDependencyRefs) &&
    areScalarArraysEqual(left.visibleCrossDependencyRefs, right.visibleCrossDependencyRefs)
  );
}

/** Compares ordered scalar arrays used by selection and expansion state. */
function areScalarArraysEqual<T extends string | number>(
  left: readonly T[],
  right: readonly T[]
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Removes duplicate scalar ids while preserving first-seen order. */
function dedupeScalarArray<T extends string | number>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

/** Fills optional breadcrumb display fields with explicit nulls for stable store state. */
function normalizeBreadcrumbEntry(entry: TraceBreadcrumbEntry): TraceBreadcrumbEntry {
  return {
    spanRef: entry.spanRef,
    spanName: entry.spanName ?? null,
    spanKeywords: entry.spanKeywords ?? null,
    blockColor: entry.blockColor ?? null,
    blockTextColor: entry.blockTextColor ?? null
  };
}

/** Merges fresher breadcrumb metadata into an existing breadcrumb entry. */
function mergeBreadcrumbEntry(
  current: TraceBreadcrumbEntry,
  next: TraceBreadcrumbEntry
): TraceBreadcrumbEntry {
  return {
    ...current,
    spanName: current.spanName ?? next.spanName ?? null,
    spanKeywords: current.spanKeywords ?? next.spanKeywords ?? null,
    blockColor: current.blockColor ?? next.blockColor ?? null,
    blockTextColor: current.blockTextColor ?? next.blockTextColor ?? null
  };
}
