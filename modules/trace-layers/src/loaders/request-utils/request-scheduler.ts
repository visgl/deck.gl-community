// loaders.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Function returned to the scheduler when one request has completed. */
type DoneFunction = () => void;

/** Function consulted before a queued request is issued. Return a negative number to cancel it. */
type GetPriorityFunction = () => number;

/** Opaque value used to deduplicate queued/active requests. */
type RequestHandle = unknown;

/** Scheduler grant returned when the caller may start its request. */
export type RequestSchedulerGrant = {
  /** Release this scheduler slot after the request completes, fails, or is otherwise abandoned. */
  done: DoneFunction;
};

/** RequestScheduler Options */
export type RequestSchedulerProps = {
  /** Human-readable scheduler id, used for debugging. */
  id?: string;
  /** Whether queued requests should observe the concurrency limit. */
  throttleRequests?: boolean;
  /** Maximum number of requests that may be active at once. */
  maxRequests?: number;
  /** Milliseconds to wait after queue updates before issuing available request slots. */
  debounceTime?: number;
};

/** Request waiting for a scheduler slot. */
type Request = {
  /** Opaque caller-provided request key. */
  handle: RequestHandle;
  /** Priority captured during the most recent queue refresh. */
  priority: number;
  /** Callback used to refresh priority or cancel the request before issue. */
  getPriority: GetPriorityFunction;
  /** Resolves the waiting scheduleRequest promise. */
  resolve?: (value: RequestSchedulerGrant | null) => void;
};

const DEFAULT_PROPS: Required<RequestSchedulerProps> = {
  id: 'request-scheduler',
  throttleRequests: true,
  maxRequests: 6,
  debounceTime: 0
};

/**
 * Schedules request starts so a caller does not deeply queue many fetches in the browser.
 *
 * Forked from loaders.gl's RequestScheduler with the probe.gl stats dependency removed.
 */
export class RequestScheduler {
  /** Effective scheduler options. */
  readonly props: Required<RequestSchedulerProps>;

  /** Number of requests that have received a scheduler slot and have not called done yet. */
  activeRequestCount = 0;

  /** Requests waiting for a scheduler slot. */
  private requestQueue: Request[] = [];

  /** Queued/active request promises keyed by caller handle. */
  private requestMap: Map<RequestHandle, Promise<RequestSchedulerGrant | null>> = new Map();

  /** Pending queue-refresh timer. */
  private updateTimer: ReturnType<typeof setTimeout> | null = null;

  /** Builds a scheduler with loaders.gl-compatible defaults. */
  constructor(props: RequestSchedulerProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
  }

  /** Update scheduler props while preserving active and queued requests. */
  setProps(props: Omit<RequestSchedulerProps, 'id'>): void {
    if (props.throttleRequests !== undefined) {
      this.props.throttleRequests = props.throttleRequests;
    }
    if (props.maxRequests !== undefined) {
      this.props.maxRequests = props.maxRequests;
    }
    if (props.debounceTime !== undefined) {
      this.props.debounceTime = props.debounceTime;
    }
    this.issueNewRequests();
  }

  /**
   * Wait for permission to start one request.
   *
   * Returns `null` if `getPriority` cancels the request before it receives a slot.
   */
  scheduleRequest(
    handle: RequestHandle,
    getPriority: GetPriorityFunction = () => 0
  ): Promise<RequestSchedulerGrant | null> {
    if (!this.props.throttleRequests) {
      return Promise.resolve({done: () => {}});
    }

    const scheduledRequest = this.requestMap.get(handle);
    if (scheduledRequest) {
      return scheduledRequest;
    }

    const request: Request = {handle, priority: 0, getPriority};
    const promise = new Promise<RequestSchedulerGrant | null>(resolve => {
      request.resolve = resolve;
    });

    this.requestQueue.push(request);
    this.requestMap.set(handle, promise);
    this.issueNewRequests();
    return promise;
  }

  /** Grant a scheduler slot for one queued request. */
  private issueRequest(request: Request): void {
    const {handle, resolve} = request;
    let isDone = false;

    const done = () => {
      if (isDone) {
        return;
      }
      isDone = true;
      this.requestMap.delete(handle);
      this.activeRequestCount -= 1;
      this.issueNewRequests();
    };

    this.activeRequestCount += 1;
    resolve?.({done});
  }

  /** Debounce queue refreshes to coalesce request bursts. */
  private issueNewRequests(): void {
    if (this.updateTimer !== null) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => this.issueNewRequestsAsync(), this.props.debounceTime);
  }

  /** Refresh the queue and issue as many requests as the active-request cap allows. */
  private issueNewRequestsAsync(): void {
    if (this.updateTimer !== null) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = null;

    const freeSlots = Math.max(this.props.maxRequests - this.activeRequestCount, 0);
    if (freeSlots === 0) {
      return;
    }

    this.updateAllRequests();

    for (let i = 0; i < freeSlots; i += 1) {
      const request = this.requestQueue.shift();
      if (!request) {
        return;
      }
      this.issueRequest(request);
    }
  }

  /** Refresh priorities, cancel stale queued work, and sort the remaining queue. */
  private updateAllRequests(): void {
    for (let i = 0; i < this.requestQueue.length; i += 1) {
      const request = this.requestQueue[i];
      if (!this.updateRequest(request)) {
        this.requestQueue.splice(i, 1);
        this.requestMap.delete(request.handle);
        i -= 1;
      }
    }

    this.requestQueue.sort((left, right) => left.priority - right.priority);
  }

  /** Refresh one queued request and resolve it as cancelled when priority is negative. */
  private updateRequest(request: Request): boolean {
    request.priority = request.getPriority();
    if (request.priority >= 0) {
      return true;
    }
    request.resolve?.(null);
    return false;
  }
}

export default RequestScheduler;
