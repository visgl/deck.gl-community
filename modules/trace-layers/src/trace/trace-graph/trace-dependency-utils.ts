import type {
  TraceCrossProcessDependency,
  TraceDependency,
  TraceSameProcessDependency
} from './trace-types';

type TraceDependencyProcess = {
  /** Optional legacy same-process dependency objects for ingestion/export compatibility. */
  sameProcessDependencies?: readonly TraceSameProcessDependency[];
};

// DEPENDENCIES

/** Builds a dependency lookup keyed by each dependency's start and end span ids. */
export function buildSpanDependencyMap(
  processes: Readonly<TraceDependencyProcess[]>,
  crossProcessDependencies: Readonly<TraceCrossProcessDependency[]>
): Record<string, TraceDependency[]> {
  const map: Record<string, TraceDependency[]> = {};
  const appendDependency = (spanId: string, dependency: TraceDependency) => {
    const dependencies = map[spanId] ?? [];
    dependencies.push(dependency);
    map[spanId] = dependencies;
  };

  processes.forEach(process => {
    (process.sameProcessDependencies ?? []).forEach(dependency => {
      appendDependency(dependency.startSpanId, dependency);
      if (dependency.endSpanId !== dependency.startSpanId) {
        appendDependency(dependency.endSpanId, dependency);
      }
    });
  });
  crossProcessDependencies.forEach(dependency => {
    appendDependency(dependency.startSpanId, dependency);
    if (dependency.endSpanId !== dependency.startSpanId) {
      appendDependency(dependency.endSpanId, dependency);
    }
  });

  return map;
}

/** Returns the wait duration attached to a local or cross-process dependency. */
export function getDependencyDurationMs(dep: Readonly<TraceDependency>): number {
  let durationMs = 0;
  if (dep.type === 'trace-same-process-dependency') {
    durationMs = dep.waitTimeMs;
  } else if (dep.type === 'trace-cross-process-dependency') {
    durationMs = dep.waitTimeMs;
  }
  return durationMs;
}
