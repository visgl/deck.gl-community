import {getHeapUsageProbeFields, log} from '../../trace/log';

/** Options for serializing heavy main-thread work. */
export type WorkSchedulerProps = {
  /** Human-readable scheduler id, used for debugging. */
  id?: string;
  /** Milliseconds to wait after one job before starting the next queued job. */
  delayMs?: number;
  /** Default action badge color used when a job does not specify one. */
  defaultBadgeColor?: WorkSchedulerBadgeColor;
};

/** Named console badge colors for WorkScheduler action probes. */
export type WorkSchedulerBadgeColor = 'blue' | 'green' | 'gray' | 'orange' | 'purple' | 'red';

/** Options for one scheduled WorkScheduler job. */
export type WorkSchedulerRunOptions = {
  /** Human-readable action name shown in scheduler probe badges. */
  actionName: string;
  /** Action badge color used to visually separate scheduler work classes. */
  badgeColor?: WorkSchedulerBadgeColor;
};

/** Queued unit of work waiting for the scheduler. */
type WorkQueueEntry<T> = {
  /** Human-readable action name shown in scheduler probe badges. */
  actionName: string;
  /** Action badge color used to visually separate scheduler work classes. */
  badgeColor: WorkSchedulerBadgeColor;
  /** Monotonic scheduler-local job id for correlating schedule/start/complete probes. */
  jobId: number;
  /** Scheduler queue length before this job was enqueued. */
  queueLengthBefore: number;
  /** Timestamp when the caller scheduled this job. */
  scheduledAtMs: number;
  /** Function to run once this entry reaches the front of the queue. */
  work: () => T | Promise<T>;
  /** Resolves the caller's `run` promise with the work result. */
  resolve: (value: T | PromiseLike<T>) => void;
  /** Rejects the caller's `run` promise with the work error. */
  reject: (error: unknown) => void;
};

const DEFAULT_PROPS: Required<WorkSchedulerProps> = {
  id: 'work-scheduler',
  delayMs: 100,
  defaultBadgeColor: 'blue'
};
const WORK_SCHEDULER_PHASE_BADGE_BASE_STYLE =
  'color:#fff;font-weight:700;padding:2px 8px;border-radius:6px;' +
  'font-family:ui-monospace, SFMono-Regular, Menlo, monospace;letter-spacing:0.3px;';
const WORK_SCHEDULER_ACTION_BADGE_BASE_STYLE =
  'color:#fff;font-weight:700;padding:2px 8px;border-radius:6px;' +
  'font-family:ui-monospace, SFMono-Regular, Menlo, monospace;letter-spacing:0.3px;';

/**
 * Runs expensive jobs one at a time and inserts a small gap between queued jobs.
 *
 * This is intended for CPU-heavy browser work where letting one large batch monopolize the event
 * loop makes progressive rendering and user input feel frozen.
 */
export class WorkScheduler {
  /** Effective scheduler options. */
  readonly props: Required<WorkSchedulerProps>;

  /** Jobs waiting to run. */
  private queue: WorkQueueEntry<unknown>[] = [];

  /** Whether a queue drain is currently active. */
  private isRunning = false;

  /** Whether a queue drain has been requested for a future microtask. */
  private isDrainScheduled = false;

  /** Whether the scheduler is currently executing a queued work callback. */
  private isExecutingWork = false;

  /** Monotonic job id used to correlate scheduler probes. */
  private nextJobId = 1;

  /** Builds a scheduler for FIFO heavy-work execution. */
  constructor(props: WorkSchedulerProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
  }

  /**
   * Enqueue one unit of work and resolve with its return value.
   *
   * Work runs in FIFO order. If another job is already active, this job starts after that job
   * settles and the configured inter-job delay has elapsed.
   */
  run<T>(options: WorkSchedulerRunOptions, work: () => T | Promise<T>): Promise<T> {
    const entryMetadata = this.createEntryMetadata(options);
    this.logEntryProbe(entryMetadata, 'schedule', {
      queueLength: this.queue.length,
      isRunning: this.isRunning,
      isExecutingWork: this.isExecutingWork
    });

    if (this.isExecutingWork) {
      return Promise.resolve().then(async () => {
        const startTime = performance.now();
        this.logEntryProbe(entryMetadata, 'start', {
          queueLength: this.queue.length,
          queuedDurationMs: startTime - entryMetadata.scheduledAtMs,
          reentrant: true
        });
        try {
          return await work();
        } finally {
          this.logEntryProbe(entryMetadata, 'complete', {
            queueLength: this.queue.length,
            queuedDurationMs: startTime - entryMetadata.scheduledAtMs,
            durationMs: performance.now() - startTime,
            reentrant: true
          });
        }
      });
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        ...entryMetadata,
        work,
        resolve: resolve as (value: unknown | PromiseLike<unknown>) => void,
        reject
      });
      this.scheduleDrain();
    });
  }

  /**
   * Run one unit of work immediately while emitting the same action/start/complete probes.
   *
   * This is useful for render-path work that must stay synchronous but should share scheduler
   * timing badges with queued work.
   */
  runSync<T>(options: WorkSchedulerRunOptions, work: () => T): T {
    const entryMetadata = this.createEntryMetadata(options);
    this.logEntryProbe(entryMetadata, 'schedule', {
      queueLength: this.queue.length,
      isRunning: this.isRunning,
      isExecutingWork: this.isExecutingWork,
      sync: true
    });

    const startTime = performance.now();
    this.logEntryProbe(entryMetadata, 'start', {
      queueLength: this.queue.length,
      queuedDurationMs: startTime - entryMetadata.scheduledAtMs,
      sync: true
    });
    try {
      this.isExecutingWork = true;
      return work();
    } finally {
      this.isExecutingWork = false;
      this.logEntryProbe(entryMetadata, 'complete', {
        queueLength: this.queue.length,
        queuedDurationMs: startTime - entryMetadata.scheduledAtMs,
        durationMs: performance.now() - startTime,
        sync: true
      });
    }
  }

  /** Request a queue drain after callers have a chance to enqueue same-tick work. */
  private scheduleDrain(): void {
    if (this.isRunning || this.isDrainScheduled) {
      return;
    }

    this.isDrainScheduled = true;
    void Promise.resolve().then(() => {
      this.isDrainScheduled = false;
      return this.drainQueue();
    });
  }

  /** Run queued jobs until the queue is empty. */
  private async drainQueue(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      while (this.queue.length > 0) {
        const entry = this.queue.shift();
        if (!entry) {
          break;
        }

        const startTime = performance.now();
        this.logEntryProbe(entry, 'start', {
          queueLength: this.queue.length,
          queuedDurationMs: startTime - entry.scheduledAtMs
        });
        let finishTime = startTime;
        try {
          this.isExecutingWork = true;
          entry.resolve(await entry.work());
        } catch (error) {
          entry.reject(error);
        } finally {
          this.isExecutingWork = false;
          finishTime = performance.now();
          this.logEntryProbe(entry, 'complete', {
            queueLength: this.queue.length,
            queuedDurationMs: startTime - entry.scheduledAtMs,
            durationMs: finishTime - startTime
          });
        }

        if (this.props.delayMs > 0) {
          await waitForBrowserYield(this.props.delayMs);
          this.logEntryProbe(entry, 'idle', {
            queueLength: this.queue.length,
            queuedNextWork: this.queue.length > 0,
            idleDelayMs: this.props.delayMs,
            durationSinceFinishMs: performance.now() - finishTime
          });
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /** Builds lightweight scheduler metadata for one work item. */
  private createEntryMetadata(options: WorkSchedulerRunOptions): WorkQueueMetadata {
    return {
      actionName: options.actionName,
      badgeColor: options.badgeColor ?? this.props.defaultBadgeColor,
      jobId: this.nextJobId++,
      queueLengthBefore: this.queue.length,
      scheduledAtMs: performance.now()
    };
  }

  /** Emits a badge-styled probe for one named work item. */
  private logEntryProbe(
    entry: WorkQueueMetadata,
    phase: WorkSchedulerProbePhase,
    fields: Record<string, unknown>
  ): void {
    const actionBadgeStyle = getWorkSchedulerActionBadgeStyle(entry.badgeColor);
    const phaseBadgeStyle = getWorkSchedulerPhaseBadgeStyle(phase);
    const probeFields = log.makeModestObject({
      ...fields,
      ...getHeapUsageProbeFields()
    });
    if (phase === 'complete' && typeof fields.durationMs === 'number') {
      log.probe(
        0,
        `%c${entry.actionName}%c %c[${phase}]%c %c${formatDurationBadge(fields.durationMs)}%c`,
        actionBadgeStyle,
        '',
        phaseBadgeStyle,
        '',
        phaseBadgeStyle,
        '',
        probeFields
      )();
      return;
    }

    log.probe(
      getWorkSchedulerProbeLogLevel(phase),
      `%c${entry.actionName}%c %c[${phase}]%c`,
      actionBadgeStyle,
      '',
      phaseBadgeStyle,
      '',
      probeFields
    )();
  }
}

/** Lightweight metadata shared by queued and re-entrant scheduler work. */
type WorkQueueMetadata = Pick<
  WorkQueueEntry<unknown>,
  'actionName' | 'badgeColor' | 'jobId' | 'queueLengthBefore' | 'scheduledAtMs'
>;
type WorkSchedulerProbePhase = 'schedule' | 'start' | 'complete' | 'idle';

/** Resolve after the requested timeout. */
function sleep(delayMs: number): Promise<void> {
  return new Promise(resolve => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

/** Returns the console style for one WorkScheduler action badge color. */
function getWorkSchedulerActionBadgeStyle(color: WorkSchedulerBadgeColor): string {
  const backgroundColor =
    color === 'green'
      ? '#047857'
      : color === 'gray'
        ? '#4b5563'
        : color === 'orange'
          ? '#b45309'
          : color === 'purple'
            ? '#7c3aed'
            : color === 'red'
              ? '#b91c1c'
              : '#1700f5';
  return `background:${backgroundColor};${WORK_SCHEDULER_ACTION_BADGE_BASE_STYLE}`;
}

/** Returns the console style for one WorkScheduler phase badge. */
function getWorkSchedulerPhaseBadgeStyle(phase: WorkSchedulerProbePhase): string {
  const backgroundColor =
    phase === 'schedule'
      ? '#6b7280'
      : phase === 'start'
        ? '#b45309'
        : phase === 'complete'
          ? '#047857'
          : '#2563eb';
  return `background:${backgroundColor};${WORK_SCHEDULER_PHASE_BADGE_BASE_STYLE}`;
}

/** Returns the probe log level for one WorkScheduler phase. */
function getWorkSchedulerProbeLogLevel(phase: WorkSchedulerProbePhase): number {
  return phase === 'schedule' || phase === 'start' ? 1 : 0;
}

/** Formats a WorkScheduler action duration for the completion badge. */
function formatDurationBadge(durationMs: number): string {
  if (!Number.isFinite(durationMs)) {
    return `${durationMs}ms`;
  }
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(2)}s`;
  }
  return `${durationMs.toFixed(durationMs >= 10 ? 0 : 1)}ms`;
}

/** Gives React, rendering, and browser idle work a chance to run before the next heavy job. */
async function waitForBrowserYield(delayMs: number): Promise<void> {
  await yieldToBrowserScheduler();
  await sleep(delayMs);
  await waitForAnimationFrame();
  await waitForIdlePeriod(Math.max(50, delayMs));
}

/** Uses the Prioritized Task Scheduling API when the browser exposes it. */
async function yieldToBrowserScheduler(): Promise<void> {
  const browserScheduler = (
    globalThis as typeof globalThis & {
      scheduler?: {yield?: () => Promise<void>};
    }
  ).scheduler;
  if (typeof browserScheduler?.yield === 'function') {
    await browserScheduler.yield();
  }
}

/** Waits for one animation frame, or a macrotask fallback outside browsers. */
function waitForAnimationFrame(): Promise<void> {
  const requestFrame = (
    globalThis as typeof globalThis & {
      requestAnimationFrame?: (callback: FrameRequestCallback) => number;
    }
  ).requestAnimationFrame;
  if (typeof requestFrame !== 'function') {
    return sleep(0);
  }

  return new Promise(resolve => {
    requestFrame(() => resolve());
  });
}

/** Waits for browser idle time, or a macrotask fallback when requestIdleCallback is unavailable. */
function waitForIdlePeriod(timeoutMs: number): Promise<void> {
  const requestIdle = (
    globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    }
  ).requestIdleCallback;
  if (typeof requestIdle !== 'function') {
    return sleep(0);
  }

  return new Promise(resolve => {
    requestIdle(() => resolve(), {timeout: timeoutMs});
  });
}

export default WorkScheduler;
