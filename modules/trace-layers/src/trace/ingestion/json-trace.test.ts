import {describe, expect, it} from 'vitest';

import {
  buildCollapsedActivityByProcessId,
  buildCollapsedActivityByProcessRows,
  buildJSONTrace,
  EMPTY_JSON_TRACE,
  getProcessFromSpan,
  getThreadFromSpan,
  getTraceSpanMap,
  getTraceStreamMap,
  materializeJSONTrace,
  mergeJSONTraces
} from './json-trace';

import type {
  TraceCounter,
  TraceCounterId,
  TraceDependencyId,
  TraceInstant,
  TraceInstantId,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../trace-graph/trace-types';
import type {JSONTrace} from './json-trace';

const makeBlock = (spanId: string, startTimeMs: number, endTimeMs: number): TraceSpan => ({
  type: 'trace-span',
  spanId: spanId as TraceSpanId,
  threadId: 'stream:test' as TraceThreadId,
  processName: 'rank',
  name: `span:${spanId}`,
  keywords: [],
  primaryTimingKey: 'test',
  timings: {
    test: {
      status: 'finished',
      startTimeMs,
      endTimeMs,
      durationMs: Math.max(0, endTimeMs - startTimeMs),
      durationMsAsString: `${Math.max(0, endTimeMs - startTimeMs)}ms`
    }
  },
  localDependencyIds: [],
  localDependencies: [],
  crossProcessEndpointId: null,
  crossProcessDependencyEndpoints: []
});

function mkGraph(params: {
  processIds: string[];
  spans: TraceSpan[];
  threads: TraceThread[];
  min: number;
  max: number;
  name?: string;
}): JSONTrace {
  const processes: TraceProcess[] = params.processIds.map(
    (processId, index) =>
      ({
        processId,
        name: processId,
        spans: index === 0 ? params.spans : [],
        threads: index === 0 ? params.threads : [],
        instants: [],
        counters: [],
        localDependencies: [],
        remoteDependencies: []
      }) as unknown as TraceProcess
  );

  return buildJSONTrace(processes, [], {
    name: params.name ?? 'Trace Graph',
    events: EMPTY_JSON_TRACE.events,
    timeExtents: {minTimeMs: params.min, maxTimeMs: params.max}
  });
}

describe('trace-graph', () => {
  describe('getTraceSpanMap', () => {
    it('should create a span map from processes', () => {
      const processes: TraceProcess[] = [
        {
          processId: 'rank1',
          name: 'rank1',
          spans: [makeBlock('block1', 0, 10), makeBlock('block2', 10, 20)],
          threads: [],
          localDependencies: []
        } as unknown as TraceProcess,
        {
          processId: 'rank2',
          name: 'rank2',
          spans: [makeBlock('block3', 20, 30)],
          threads: [],
          localDependencies: []
        } as unknown as TraceProcess
      ];

      const spanMap = getTraceSpanMap(processes);

      expect(Object.keys(spanMap)).toEqual(['block1', 'block2', 'block3']);
      expect(spanMap.block1.spanId).toBe('block1');
      expect(spanMap.block2.spanId).toBe('block2');
      expect(spanMap.block3.spanId).toBe('block3');
    });
  });

  describe('getTraceStreamMap', () => {
    it('should create a stream map from processes', () => {
      const processes: TraceProcess[] = [
        {
          processId: 'rank1',
          name: 'rank1',
          spans: [],
          threads: [
            {threadId: 'stream1', name: 'Stream 1'} as TraceThread,
            {threadId: 'stream2', name: 'Stream 2'} as TraceThread
          ],
          localDependencies: []
        } as unknown as TraceProcess,
        {
          processId: 'rank2',
          name: 'rank2',
          spans: [],
          threads: [{threadId: 'stream3', name: 'Stream 3'} as TraceThread],
          localDependencies: []
        } as unknown as TraceProcess
      ];

      const threadMap = getTraceStreamMap(processes);

      expect(threadMap).toEqual({
        stream1: {threadId: 'stream1', name: 'Stream 1'},
        stream2: {threadId: 'stream2', name: 'Stream 2'},
        stream3: {threadId: 'stream3', name: 'Stream 3'}
      });
    });
  });

  describe('getThreadFromSpan', () => {
    const thread = {threadId: 'stream1' as TraceThreadId, name: 'Stream 1'};
    const span = {
      ...makeBlock('block1', 0, 10),
      threadId: thread.threadId as TraceThreadId
    } as TraceSpan;

    it('should return the thread for a valid span', () => {
      const processes: TraceProcess[] = [
        {
          processId: 'rank1',
          name: 'rank1',
          spans: [span],
          threads: [thread as TraceThread],
          localDependencies: []
        } as unknown as TraceProcess
      ];
      const graph = mkGraph({
        processIds: ['rank1'],
        spans: [span],
        threads: [thread as TraceThread],
        min: 0,
        max: 10
      });
      const traceGraph = buildJSONTrace(processes, [], {
        name: graph.name,
        events: graph.events,
        timeExtents: graph.timeExtents
      });

      expect(getThreadFromSpan(traceGraph, span.spanId)).toEqual(thread);
    });

    it('should return null for a missing span', () => {
      const graph = mkGraph({
        processIds: ['rank1'],
        spans: [span],
        threads: [thread as TraceThread],
        min: 0,
        max: 10
      });
      expect(getThreadFromSpan(graph, 'missing-span' as TraceSpanId)).toBeNull();
    });
  });

  describe('getProcessFromSpan', () => {
    const threadId = 'stream1' as TraceThreadId;
    const thread = {threadId, name: 'Stream 1'} as TraceThread;
    const process = {
      processId: 'rank1',
      name: 'rank1',
      rankNum: 0,
      stepNum: 0,
      threads: [thread],
      localDependencies: []
    } as unknown as TraceProcess;
    const span = {
      ...makeBlock('block1', 0, 10),
      threadId,
      processName: process.name
    } as TraceSpan;

    it('should return the process for a valid span', () => {
      const graphProcess = {
        ...process,
        spans: [span],
        instants: [],
        counters: [],
        remoteDependencies: []
      } as unknown as TraceProcess;
      const graph = buildJSONTrace([graphProcess], [], {
        name: 'Trace Graph',
        timeExtents: {minTimeMs: 0, maxTimeMs: 10}
      });

      expect(getProcessFromSpan(graph, span.spanId)).toMatchObject(process);
    });

    it('should return null for a span with missing process mapping', () => {
      const graph = buildJSONTrace([], [], {
        name: 'Trace Graph',
        timeExtents: {minTimeMs: 0, maxTimeMs: 10}
      });

      expect(getProcessFromSpan(graph, span.spanId)).toBeNull();
    });
  });

  describe('buildJSONTrace', () => {
    it('preserves manual span layout metadata and defaults omitted traces to auto', () => {
      const span = {
        ...makeBlock('manual-span', 0, 1),
        layoutTopY: 1.25,
        layoutHeight: 0.75
      } satisfies TraceSpan;
      const thread = {
        type: 'trace-thread',
        name: 'manual-thread',
        threadId: span.threadId,
        processId: 'manual-process'
      } satisfies TraceThread;
      const process = {
        type: 'trace-process',
        processId: 'manual-process',
        name: 'manual-process',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [span],
        spanMap: {[span.spanId]: span},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const manualTrace = buildJSONTrace([process], [], {
        name: 'manual-json-contract',
        spanLayout: 'manual'
      });
      const autoTrace = buildJSONTrace([process], [], {name: 'auto-json-contract'});

      expect(manualTrace.spanLayout).toBe('manual');
      expect(materializeJSONTrace(manualTrace)).toMatchObject({
        spanLayout: 'manual',
        spanMap: {
          [span.spanId]: {
            layoutTopY: 1.25,
            layoutHeight: 0.75
          }
        }
      });
      expect(materializeJSONTrace(autoTrace).spanLayout).toBe('auto');
    });

    it('serializes the public JSON trace without runtime maps or Set values', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'json-stream' as TraceThreadId,
        name: 'JSON stream',
        processId: 'json-rank'
      } as TraceThread;
      const span = {
        ...makeBlock('json-span', 1, 2),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const dependency = {
        type: 'trace-local-dependency',
        dependencyId: 'json-dependency' as TraceDependencyId,
        startSpanId: span.spanId,
        endSpanId: span.spanId,
        keywords: new Set(['SUBMIT']),
        waitMode: 'end-to-start',
        bidirectional: false,
        waitTimeMs: 0
      } satisfies TraceProcess['localDependencies'][number];
      const process = {
        type: 'trace-process',
        processId: 'json-rank',
        name: 'json-rank',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [
          {
            ...span,
            localDependencyIds: [dependency.dependencyId],
            localDependencies: [dependency]
          }
        ],
        spanMap: {[span.spanId]: span},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [dependency],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {name: 'json-contract'});
      const roundTripped = JSON.parse(JSON.stringify(graph)) as JSONTrace;

      expect('threadMap' in roundTripped.processes[0]!).toBe(false);
      expect('spanMap' in roundTripped.processes[0]!).toBe(false);
      expect('localDependencies' in roundTripped.processes[0]!.spans[0]!).toBe(false);
      expect(roundTripped.processes[0]!.localDependencies[0]!.keywords).toEqual(['SUBMIT']);
      expect(materializeJSONTrace(roundTripped).spanDependencyMap[span.spanId]).toHaveLength(1);
    });

    it('uses the extremal envelope across all span timings for graph-wide time bounds', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'timing-stream' as TraceThreadId,
        name: 'Timing stream',
        processId: 'rank-timing'
      } as TraceThread;
      const span = {
        ...makeBlock('multi-timing', 10, 20),
        threadId: thread.threadId,
        primaryTimingKey: 'latest',
        timings: {
          latest: {
            status: 'finished',
            startTimeMs: 10,
            endTimeMs: 20,
            durationMs: 10,
            durationMsAsString: '10ms'
          },
          earliest: {
            status: 'finished',
            startTimeMs: 5,
            endTimeMs: 30,
            durationMs: 25,
            durationMsAsString: '25ms'
          }
        }
      } satisfies TraceSpan;
      const process = {
        type: 'trace-process',
        processId: 'rank-timing',
        name: 'rank-timing',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [span],
        spanMap: {[span.spanId]: span},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {name: 'timing-envelope'});
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(5);
      expect(materializedGraph.maxTimeMs).toBe(30);
    });

    it('includes instants and counters in graph-wide time bounds', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'events-stream' as TraceThreadId,
        name: 'Events stream',
        processId: 'rank-events'
      } as TraceThread;
      const span = {
        ...makeBlock('event-span', 10, 20),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const instant = {
        type: 'trace-instant',
        instantId: 'instant-1' as TraceInstantId,
        threadId: thread.threadId,
        name: 'instant',
        atTimeMs: 2,
        scope: 't'
      } satisfies TraceInstant;
      const counter = {
        type: 'trace-counter',
        counterId: 'counter-1' as TraceCounterId,
        threadId: thread.threadId,
        name: 'counter',
        atTimeMs: 40,
        totalValue: 1,
        series: {total: 1}
      } satisfies TraceCounter;
      const process = {
        type: 'trace-process',
        processId: 'rank-events',
        name: 'rank-events',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [span],
        spanMap: {[span.spanId]: span},
        instants: [instant],
        instantMap: {[instant.instantId]: instant},
        threadInstantMap: {[thread.threadId]: [instant]},
        counters: [counter],
        counterMap: {[counter.counterId]: counter},
        threadCounterMap: {[thread.threadId]: [counter]},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {name: 'events-envelope'});
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(2);
      expect(materializedGraph.maxTimeMs).toBe(40);
    });

    it('uses provided canonical time extents when metadata supplies them', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'metadata-stream' as TraceThreadId,
        name: 'Metadata stream',
        processId: 'rank-metadata'
      } as TraceThread;
      const span = {
        ...makeBlock('metadata-span', 10, 20),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const process = {
        type: 'trace-process',
        processId: 'rank-metadata',
        name: 'rank-metadata',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [span],
        spanMap: {[span.spanId]: span},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {
        name: 'metadata-extents',
        timeExtents: {
          minTimeMs: 1,
          maxTimeMs: 100
        }
      });
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(1);
      expect(materializedGraph.maxTimeMs).toBe(100);
    });

    it('extends unfinished spans only to the finite graph max time', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'unfinished-stream' as TraceThreadId,
        name: 'Unfinished stream',
        processId: 'rank-unfinished'
      } as TraceThread;
      const unfinishedBlock = {
        ...makeBlock('unfinished-span', 10, 10),
        threadId: thread.threadId,
        timings: {
          test: {
            status: 'not-finished',
            startTimeMs: 10,
            endTimeMs: 10,
            durationMs: 0,
            durationMsAsString: '0ms'
          }
        }
      } satisfies TraceSpan;
      const finishedBlock = {
        ...makeBlock('finished-span', 20, 40),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const process = {
        type: 'trace-process',
        processId: 'rank-unfinished',
        name: 'rank-unfinished',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans: [unfinishedBlock, finishedBlock],
        spanMap: {
          [unfinishedBlock.spanId]: unfinishedBlock,
          [finishedBlock.spanId]: finishedBlock
        },
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {name: 'unfinished-envelope'});
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(10);
      expect(materializedGraph.maxTimeMs).toBe(40);
    });

    it('keeps not-started and zero-start spans out of computed time extents', () => {
      const thread = {
        type: 'trace-thread',
        threadId: 'placeholder-stream' as TraceThreadId,
        name: 'Placeholder stream',
        processId: 'rank-placeholder'
      } as TraceThread;
      const notStartedBlock = {
        ...makeBlock('not-started-span', 0, 0),
        threadId: thread.threadId,
        timings: {
          test: {
            status: 'not-started',
            startTimeMs: 0,
            endTimeMs: 0,
            durationMs: 0,
            durationMsAsString: 'not started'
          }
        }
      } satisfies TraceSpan;
      const zeroStartBlock = {
        ...makeBlock('zero-start-span', 0, 100),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const unfinishedBlock = {
        ...makeBlock('unfinished-span', 25, 0),
        threadId: thread.threadId,
        timings: {
          test: {
            status: 'not-finished',
            startTimeMs: 25,
            endTimeMs: 0,
            durationMs: 0,
            durationMsAsString: 'incomplete'
          }
        }
      } satisfies TraceSpan;
      const finishedBlock = {
        ...makeBlock('finished-span', 40, 50),
        threadId: thread.threadId
      } satisfies TraceSpan;
      const spans = [notStartedBlock, zeroStartBlock, unfinishedBlock, finishedBlock];
      const process = {
        type: 'trace-process',
        processId: 'rank-placeholder',
        name: 'rank-placeholder',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        spans,
        spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } satisfies TraceProcess;

      const graph = buildJSONTrace([process], [], {name: 'placeholder-envelope'});
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(25);
      expect(materializedGraph.maxTimeMs).toBe(50);
      expect(materializedGraph.spanMap[notStartedBlock.spanId]).toBeDefined();
      expect(materializedGraph.spanMap[zeroStartBlock.spanId]).toBeDefined();
    });

    it('falls back to zero time bounds for an empty trace graph', () => {
      const graph = buildJSONTrace([], [], {name: 'empty'});
      const materializedGraph = materializeJSONTrace(graph);

      expect(materializedGraph.minTimeMs).toBe(0);
      expect(materializedGraph.maxTimeMs).toBe(0);
    });
  });

  describe('mergeJSONTraces', () => {
    it('should merge multiple JSONTrace objects into one', () => {
      const graph1 = mkGraph({
        processIds: ['rank1'],
        spans: [makeBlock('block1', 0, 10)],
        threads: [{threadId: 'stream1', name: 'Stream 1'} as TraceThread],
        min: 0,
        max: 10,
        name: 'Graph 1'
      });

      const graph2 = mkGraph({
        processIds: ['rank2'],
        spans: [makeBlock('block2', 5, 15)],
        threads: [{threadId: 'stream2', name: 'Stream 2'} as TraceThread],
        min: 5,
        max: 15,
        name: 'Graph 2'
      });

      const mergedGraph = materializeJSONTrace(mergeJSONTraces([graph1, graph2]));

      expect(mergedGraph).toMatchObject({
        type: 'trace-graph',
        name: 'Graph 1, Graph 2',
        minTimeMs: 0,
        maxTimeMs: 15,
        spanMap: {
          block1: {spanId: 'block1'},
          block2: {spanId: 'block2'}
        },
        threadMap: {
          stream1: {threadId: 'stream1', name: 'Stream 1'},
          stream2: {threadId: 'stream2', name: 'Stream 2'}
        },
        processes: [
          {
            processId: 'rank1',
            name: 'rank1',
            spans: [{spanId: 'block1'}],
            threads: [{threadId: 'stream1', name: 'Stream 1'}],
            localDependencies: []
          },
          {
            processId: 'rank2',
            name: 'rank2',
            spans: [{spanId: 'block2'}],
            threads: [{threadId: 'stream2', name: 'Stream 2'}],
            localDependencies: []
          }
        ]
      });
      expect(mergedGraph.dependencyMap).toEqual({});
      expect(mergedGraph.instantMap).toEqual({});
      expect(mergedGraph.counterMap).toEqual({});
      expect(mergedGraph.threadInstantMap).toEqual({});
      expect(mergedGraph.threadCounterMap).toEqual({});
      expect(mergedGraph.counterExtents).toEqual({});
    });

    it('should handle empty input graphs', () => {
      const mergedGraph = materializeJSONTrace(mergeJSONTraces([]));

      expect(mergedGraph).toMatchObject({
        type: 'trace-graph',
        name: 'Trace Graph',
        minTimeMs: 0,
        maxTimeMs: 0,
        spanMap: {},
        threadMap: {},
        processes: []
      });
      expect(mergedGraph.dependencyMap).toEqual({});
      expect(mergedGraph.instantMap).toEqual({});
      expect(mergedGraph.counterMap).toEqual({});
      expect(mergedGraph.threadInstantMap).toEqual({});
      expect(mergedGraph.threadCounterMap).toEqual({});
      expect(mergedGraph.counterExtents).toEqual({});
    });

    it('should handle overlapping span and thread IDs', () => {
      const graph1 = mkGraph({
        processIds: ['rank1'],
        spans: [makeBlock('block1', 0, 10)],
        threads: [{threadId: 'stream1', name: 'Stream 1'} as TraceThread],
        min: 0,
        max: 10,
        name: 'Graph 1'
      });

      const graph2 = mkGraph({
        processIds: ['rank2'],
        spans: [makeBlock('block1', 5, 15)], // overlap
        threads: [{threadId: 'stream1', name: 'Stream 1 (Updated)'} as TraceThread], // overlap
        min: 5,
        max: 15,
        name: 'Graph 2'
      });

      const mergedGraph = materializeJSONTrace(mergeJSONTraces([graph1, graph2]));

      expect(mergedGraph.spanMap).toMatchObject({
        block1: {spanId: 'block1'}
      });

      expect(mergedGraph.threadMap).toEqual({
        stream1: {threadId: 'stream1', name: 'Stream 1 (Updated)'}
      });
    });
  });

  describe('buildCollapsedActivityByProcessRows', () => {
    it('matches the graph-shaped collapsed-activity source for equivalent rows', () => {
      const stream1 = {threadId: 'stream1' as TraceThreadId, name: 'Stream 1'} as TraceThread;
      const stream2 = {threadId: 'stream2' as TraceThreadId, name: 'Stream 2'} as TraceThread;
      const block1 = {
        ...makeBlock('block1', 0, 10),
        threadId: stream1.threadId
      } as TraceSpan;
      const block2 = {
        ...makeBlock('block2', 15, 35),
        threadId: stream2.threadId
      } as TraceSpan;
      const process = {
        type: 'trace-process',
        processId: 'rank1',
        name: 'rank1',
        rankNum: 1,
        stepNum: 0,
        threads: [stream1, stream2],
        threadMap: {
          [stream1.threadId]: stream1,
          [stream2.threadId]: stream2
        },
        spans: [block1, block2],
        spanMap: {
          [block1.spanId]: block1,
          [block2.spanId]: block2
        },
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        localDependencies: [],
        remoteDependencies: []
      } as unknown as TraceProcess;
      const graph = buildJSONTrace([process], [], {
        name: 'collapsed-activity-test'
      });
      const materializedGraph = materializeJSONTrace(graph);
      const colorScheme = {
        id: 'test-color-scheme',
        name: 'Test Color Scheme',
        blockType: {},
        streamName: {},
        processName: {},
        blockName: {},
        keywords: {}
      };
      const settings = {
        colorBy: 'stream'
      } as unknown as TraceVisSettings;

      expect(
        buildCollapsedActivityByProcessRows({
          minTimeMs: materializedGraph.minTimeMs,
          maxTimeMs: materializedGraph.maxTimeMs,
          processRows: [
            {
              processId: process.processId,
              threads: process.threads,
              spans: process.spans
            }
          ],
          colorScheme,
          settings
        })
      ).toEqual(buildCollapsedActivityByProcessId(graph, colorScheme, settings));
    });
  });
});
