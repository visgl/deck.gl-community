import {buildJSONTrace} from '../ingestion/json-trace';

import type {JSONTrace} from '../ingestion/json-trace';
import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {StarlingV2RunSummary} from './run-summary-v2';

function createProcess(params: {
  processId: string;
  rankNum: number;
  name: string;
  threadName: string;
  blockName: string;
  startTimeMs: number;
  endTimeMs: number;
  userData?: Record<string, unknown>;
}): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: params.threadName,
    threadId: `${params.processId}:thread` as TraceThreadId,
    processId: params.processId
  };
  const block: TraceSpan = {
    type: 'trace-span',
    spanId: `${params.processId}:block` as TraceSpanId,
    threadId: thread.threadId,
    processName: params.processId,
    name: params.blockName,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs: params.startTimeMs,
        endTimeMs: params.endTimeMs,
        durationMs: params.endTimeMs - params.startTimeMs,
        durationMsAsString: `${params.endTimeMs - params.startTimeMs}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };

  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.name,
    rankNum: params.rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [block],
    spanMap: {[block.spanId]: block},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: [],
    userData: params.userData
  };
}

export function buildJSONTraceFromRunSummary(_summary: StarlingV2RunSummary): JSONTrace {
  const headProcess = createProcess({
    processId: 'head',
    rankNum: 0,
    name: 'Head',
    threadName: 'head-thread',
    blockName: 'head-parent',
    startTimeMs: 0,
    endTimeMs: 1_000,
    userData: {role: 'head'}
  });
  const logicalProcess = createProcess({
    processId: 'logical-1',
    rankNum: 1,
    name: 'Proc A',
    threadName: 'Thread A',
    blockName: 'logical-child',
    startTimeMs: 2_000,
    endTimeMs: 3_000
  });
  const dependency: TraceCrossProcessDependency = {
    type: 'trace-cross-process-dependency',
    dependencyId: 'head-to-logical' as TraceDependencyId,
    endpointId: 'head-to-logical:endpoint' as TraceCrossProcessEndpointId,
    startRankNum: headProcess.rankNum,
    endRankNum: logicalProcess.rankNum,
    startSpanId: headProcess.spans[0]!.spanId,
    endSpanId: logicalProcess.spans[0]!.spanId,
    waitMode: 'end-to-start',
    bidirectional: false,
    topology: 'head-to-logical',
    waitTimeMs: 1_000,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set()
  };

  return buildJSONTrace([headProcess, logicalProcess], [dependency], {
    name: 'head-to-logical-stub'
  });
}
