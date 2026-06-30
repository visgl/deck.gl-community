import type {SpanRef, TraceLayout, TraceVisSettings} from '../../trace/index';

/** Options for applying dependency visibility without framebuffer blending. */
export type DependencyVisibilityOptions = {
  /** Minimum visible color contribution after dependency opacity is applied. */
  minimumVisibility?: number;
};

export const TRACE_SPAN_POSITION_TRANSITION = {
  duration: 800,
  easing: (t: number) => t * t * (3 - 2 * t)
};

/**
 * Returns the effective opacity multiplier for non-selected dependency overlays.
 */
export function getDependencyOpacityMultiplier(settings: TraceVisSettings): number {
  const dependencyOpacity = Number.isFinite(settings.dependencyOpacity)
    ? settings.dependencyOpacity
    : 1;
  return clampUnitInterval(
    dependencyOpacity * (settings.showPathsOnly ? DEPENDENCY_NOT_IN_PATH_OPACITY_MULTIPLIER : 1)
  );
}

/**
 * Applies dependency opacity to a line color without requiring framebuffer blending.
 *
 * Dependency layers intentionally run with `blend: false` for pan/zoom performance. To preserve
 * the old translucent appearance over the mostly white trace background, opacity is approximated
 * by compositing the dependency color into RGB and writing an opaque alpha channel.
 */
export function applyDependencyLineOpacity(
  color: readonly [number, number, number, number],
  opacityMultiplier: number,
  options?: DependencyVisibilityOptions
): [number, number, number, number] {
  return applyOpaqueDependencyVisibility(
    color,
    getDependencyVisibility(opacityMultiplier, options)
  );
}

/**
 * Applies dependency marker visibility without requiring framebuffer blending.
 */
export function applyDependencyMarkerOpacity(
  color: readonly [number, number, number, number],
  opacityMultiplier: number,
  options?: DependencyVisibilityOptions
): [number, number, number, number] {
  return applyOpaqueDependencyVisibility(
    color,
    getDependencyVisibility(opacityMultiplier, options)
  );
}

export function makeGeometryUpdateTriggers(
  settings: TraceVisSettings,
  traceLayout: Readonly<TraceLayout>,
  updateTrigger?: unknown,
  geometryTrigger: unknown = traceLayout
) {
  return [
    settings.showPathsOnly,
    settings.minSpanTimeMs,
    settings.selectedThreadNames,
    settings.threadDisplayMode,
    settings.lineRoutingMode,
    geometryTrigger,
    updateTrigger
  ];
}

export function makeColorUpdateTriggers(
  settings: TraceVisSettings,
  highlightedSpanRefs?: ReadonlySet<SpanRef>
) {
  return [
    settings.showPathsOnly,
    settings.minSpanTimeMs,
    settings.highlightFadeFactor,
    settings.extendedSelectionFadeOpacity,
    settings.useExtendedSelectionFadeOpacity,
    settings.dependencyOpacity,
    highlightedSpanRefs
  ];
}

const DEPENDENCY_NOT_IN_PATH_OPACITY_MULTIPLIER = 0.2;
const TRACE_BACKGROUND_COLOR = [255, 255, 255] as const;

/** Returns the effective no-blend color contribution for one dependency. */
function getDependencyVisibility(
  opacityMultiplier: number,
  options: DependencyVisibilityOptions | undefined
): number {
  const opacity = clampUnitInterval(opacityMultiplier);
  return Math.max(Math.sqrt(opacity), clampUnitInterval(options?.minimumVisibility ?? 0));
}

/** Applies visibility by compositing a dependency color over the trace background into opaque RGB. */
function applyOpaqueDependencyVisibility(
  color: readonly [number, number, number, number],
  visibility: number
): [number, number, number, number] {
  const alphaVisibility = (color[3] / 255) * clampUnitInterval(visibility);
  return [
    compositeChannelOverTraceBackground(color[0], TRACE_BACKGROUND_COLOR[0], alphaVisibility),
    compositeChannelOverTraceBackground(color[1], TRACE_BACKGROUND_COLOR[1], alphaVisibility),
    compositeChannelOverTraceBackground(color[2], TRACE_BACKGROUND_COLOR[2], alphaVisibility),
    255
  ];
}

/** Composites one foreground color channel over one background color channel. */
function compositeChannelOverTraceBackground(
  foregroundChannel: number,
  backgroundChannel: number,
  alpha: number
): number {
  return Math.round(foregroundChannel * alpha + backgroundChannel * (1 - alpha));
}

/** Clamps a numeric value to [0, 1], defaulting non-finite values to 1. */
function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}
