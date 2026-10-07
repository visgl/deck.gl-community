// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device} from '@luma.gl/core';
import {GPUPagedSplatRenderer, makeGPUSplatData, SplatResidencyManager} from '@luma.gl/splats';
import type {SplatHierarchyView, GPUPagedSplatPage} from '@luma.gl/splats';
import {PageScheduler} from './page-scheduler';
import {RADSourceClient, type RADPage, type RADWorker} from './rad-source-client';
import type {RADSelection} from './rad-selection';

/** Loading diagnostics reported by the experimental SplatLayer. */
export type SplatLayerStatus = {
  /** Current loading/refinement state; ready means selection settled within configured budgets. */
  phase: 'loading' | 'refining' | 'ready' | 'budget-limited' | 'error';
  /** Human-readable progress or error description. */
  message: string;
  /** Number of original source rows in the displayed frontier. */
  activeSplats: number;
  /** Number of intact source pages currently admitted to GPU residency. */
  residentPages: number;
  /** Number of pages requested by the current selection, including pending admission. */
  pendingPages: number;
  /** Total original source rows reported by RAD metadata. */
  sourceSplats: number;
};

export type RADSceneRenderer = Pick<GPUPagedSplatRenderer, 'setProps' | 'setFrontier' | 'destroy'>;
export type RADSceneOptions = {
  /** A shared host runtime can retain frontiers without allocating a second ordering graph. */
  createRenderer?: (device: Device) => RADSceneRenderer;
  data: string | Blob;
  worker?: RADWorker;
  maxActiveSplats: number;
  maxResidentSplats: number;
  maxConcurrentLoads: number;
  onChange: () => void;
  onStatus: (status: SplatLayerStatus) => void;
  onError: (error: Error) => void;
};

/** Owns GPU pages and worker lifecycle, never the host canvas, animation loop, or device. */
export class RADScene {
  readonly renderer: RADSceneRenderer;
  readonly residency: SplatResidencyManager;
  readonly scheduler: PageScheduler;
  private readonly source: RADSourceClient;
  private readonly abortController = new AbortController();
  private destroyed = false;
  private rootReady = false;
  private sourceSplats = 0;
  private pageSize = 0;
  private currentView?: SplatHierarchyView;
  private views = new Map<string, SplatHierarchyView>();
  private frontiers = new Map<string, readonly GPUPagedSplatPage[]>();
  private selectionVersion = 0;
  private viewVersion = 0;
  private appliedVersion = 0;
  private selecting = false;
  private selectionNeeded = true;
  private pendingSelection?: {
    result: RADSelection;
    leasedIds: Set<string>;
    frontiers?: Map<string, RADSelection['frontier']>;
  };
  private readonly pendingUploads: Array<() => void> = [];
  private uploadsSinceSelection = 0;
  private requests: RADSelection['requests'] = [];
  private presentedFrontier: readonly GPUPagedSplatPage[] = [];
  private lastStatus = '';
  private error?: Error;

  constructor(
    private readonly device: Device,
    private readonly options: RADSceneOptions
  ) {
    this.renderer =
      options.createRenderer?.(device) ??
      new GPUPagedSplatRenderer(device, {
        sortMode: 'global',
        alphaCutoff: 0.5 / 255,
        gaussianSupportRadius: Math.sqrt(8),
        kernel2DSize: Math.sqrt(0.3),
        maxScreenSpaceSplatSize: 512,
        toneMapping: 'none',
        lodOpacity: true
      });
    this.source = new RADSourceClient(options.data, options.worker);
    this.residency = new SplatResidencyManager({
      // Bounded transition headroom covers old visible pages until a coherent replacement arrives.
      maxResidentSplats: options.maxResidentSplats + options.maxActiveSplats,
      ownsData: true,
      onEvict: chunk => {
        if (!this.destroyed) {
          this.selectionNeeded = true;
          void this.source.remove(chunk.id).catch(error => this.fail(error));
        }
      }
    });
    this.scheduler = new PageScheduler(
      options.maxConcurrentLoads,
      (request, signal) => this.loadPage(request.pageIndex, request.priority, signal),
      options.onChange,
      error => this.fail(error)
    );
    this.report('loading', 'Loading RAD metadata and root page…');
    void this.initialize().catch(error => this.fail(error));
  }

  /** Retarget budgets without restarting the source worker or discarding resident coverage. */
  setBudget(maxActiveSplats: number, maxResidentSplats: number): void {
    if (
      maxActiveSplats === this.options.maxActiveSplats &&
      maxResidentSplats === this.options.maxResidentSplats
    )
      return;
    this.options.maxActiveSplats = maxActiveSplats;
    this.options.maxResidentSplats = maxResidentSplats;
    this.residency.setBudget({maxResidentSplats: maxResidentSplats + maxActiveSplats});
    this.selectionNeeded = true;
    this.scheduler.invalidate();
    this.options.onChange();
  }

  /** Selects each instance/view independently while borrowing one source and residency window. */
  updateViews(views: Map<string, SplatHierarchyView>, now: number): void {
    if (
      views.size !== this.views.size ||
      [...views].some(([id, view]) => !this.views.has(id) || !sameView(this.views.get(id)!, view))
    ) {
      this.views = views;
      void this.source.retain([...views.keys()]).catch(error => this.fail(error));
      this.viewVersion++;
      this.selectionNeeded = true;
      this.scheduler.invalidate();
    }
    const first = views.values().next().value;
    if (first) this.update(first, 1, now);
    else this.scheduler.update([]);
  }
  getFrontier(viewKey: string): readonly GPUPagedSplatPage[] {
    return this.frontiers.get(viewKey) ?? this.presentedFrontier;
  }

  /** Camera updates are immediate; CPU traversal never executes on the host rendering thread. */
  update(view: SplatHierarchyView, opacity: number, _now: number): void {
    if (this.destroyed || !this.rootReady || this.error) return;
    if (!this.currentView || !sameView(this.currentView, view)) {
      this.currentView = view;
      this.viewVersion++;
      this.selectionNeeded = true;
      this.scheduler.invalidate();
      this.renderer.setProps(view);
    }
    this.renderer.setProps({alphaScale: opacity});
    this.applySelection();
    // Upload only while no worker owns a residency lease. Yield between pages, so decode
    // completions cannot enqueue an unbounded run of GPU allocation work ahead of input.
    if (!this.selecting && this.pendingUploads.length) {
      this.uploadsSinceSelection++;
      this.pendingUploads.shift()!();
    }
    this.scheduler.update(this.requests);
    if (
      !this.selecting &&
      this.selectionNeeded &&
      (!this.pendingUploads.length || this.uploadsSinceSelection >= 4)
    ) {
      this.uploadsSinceSelection = 0;
      this.select();
    }
    if (!this.selecting && this.pendingUploads.length) this.options.onChange();
    const runnable = this.requests.some(request => !this.scheduler.rejected.has(request.pageIndex));
    const refining = this.selecting || this.selectionNeeded || Boolean(this.scheduler.active.size);
    this.report(
      refining || runnable ? 'refining' : this.requests.length ? 'budget-limited' : 'ready',
      refining || runnable
        ? 'Refining off-thread; camera and visible detail remain live.'
        : this.requests.length
          ? 'Resident budget reached; visible detail remains available.'
          : 'Current view resolved.'
    );
  }

  /** Intact admitted pages and original selected row offsets. */
  get frontier(): readonly GPUPagedSplatPage[] {
    return this.presentedFrontier;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.abortController.abort();
    this.scheduler.destroy();
    this.source.destroy();
    for (const upload of this.pendingUploads.splice(0)) upload();
    this.pendingSelection = undefined;
    this.renderer.destroy();
    this.residency.destroy();
  }

  private async initialize(): Promise<void> {
    const metadata = await this.source.getMetadata();
    if (this.destroyed) return;
    if (!metadata.lodTree || !metadata.chunkSize) {
      throw new Error('SplatLayer requires a RAD hierarchy with a declared chunkSize.');
    }
    this.sourceSplats = metadata.count;
    this.pageSize = metadata.chunkSize;
    await this.source.configure({
      pageSize: this.pageSize,
      maxActiveSplats: this.options.maxActiveSplats,
      // The selector spends the base page budget, not the old/new-view transition headroom.
      maxResidentSplats: this.options.maxResidentSplats,
      maxConcurrentLoads: this.options.maxConcurrentLoads
    });
    if (this.destroyed) return;
    const accepted = await this.loadPage(0, Number.MAX_SAFE_INTEGER, this.abortController.signal);
    if (this.destroyed) return;
    if (!accepted) throw new Error('The RAD root page exceeds maxResidentSplats.');
    this.rootReady = true;
    this.options.onChange();
  }

  private select(): void {
    if (!this.currentView) return;
    this.selecting = true;
    this.selectionNeeded = false;
    // Lease all possible traversal inputs until the worker returns its exact protected set.
    // Pages admitted after dispatch retain their admission pins until a subsequent selection.
    const leasedIds = new Set(this.residency.residentChunks.map(chunk => chunk.id));
    for (const id of leasedIds) this.residency.pin(id);
    const views = this.views.size ? [...this.views] : [['default', this.currentView] as const];
    const viewVersion = this.viewVersion;
    void Promise.all(
      views.map(async ([key, view]) => ({
        key,
        result: await this.source.select(
          view,
          viewVersion,
          key,
          Math.max(1, Math.floor(this.options.maxActiveSplats / views.length)),
          this.options.maxResidentSplats
        )
      }))
    )
      .then(results => {
        if (this.destroyed) return;
        const rows = new Map<string, Set<number>>();
        const frontiers = new Map<string, RADSelection['frontier']>();
        const protectedIds = new Set<string>();
        const requests = new Map<number, RADSelection['requests'][number]>();
        for (const {key, result} of results) {
          frontiers.set(key, result.frontier);
          for (const entry of result.frontier ?? this.frontiers.get(key) ?? []) {
            let selected = rows.get(entry.id);
            if (!selected) {
              selected = new Set();
              rows.set(entry.id, selected);
            }
            for (const row of entry.activeRows) selected.add(row);
          }
          for (const id of result.protectedPageIds) protectedIds.add(id);
          for (const request of result.requests) {
            if (request.priority > (requests.get(request.pageIndex)?.priority ?? -Infinity))
              requests.set(request.pageIndex, request);
          }
        }
        const result: RADSelection = {
          version: ++this.selectionVersion,
          viewVersion,
          frontier: rows.size
            ? [...rows].map(([id, selected]) => ({
                id,
                activeRows: new Uint32Array([...selected].sort((a, b) => a - b))
              }))
            : undefined,
          protectedPageIds: [...protectedIds],
          requests: [...requests.values()],
          hasPendingTraversal: results.some(entry => entry.result.hasPendingTraversal),
          duration: results.reduce((sum, entry) => sum + entry.result.duration, 0)
        };
        this.pendingSelection = {result, leasedIds, frontiers};
        this.options.onChange();
      })
      .catch(error => this.fail(error));
  }

  private applySelection(): void {
    const pending = this.pendingSelection;
    if (!pending) return;
    this.pendingSelection = undefined;
    this.selecting = false;
    const {result, leasedIds} = pending;
    if (pending.frontiers)
      for (const [key, frontier] of pending.frontiers) {
        if (frontier)
          this.frontiers.set(
            key,
            frontier.map(entry => {
              const chunk = this.residency.getChunk(entry.id);
              if (!chunk) throw new Error('RAD instance frontier references an unleased page.');
              return {...entry, data: chunk.data};
            })
          );
      }
    for (const key of this.frontiers.keys())
      if (this.views.size && !this.views.has(key)) this.frontiers.delete(key);
    if (result.version <= this.appliedVersion) {
      this.selectionNeeded = true;
      return;
    }
    if (result.frontier) {
      const nextFrontier = result.frontier.map(entry => {
        const chunk = this.residency.getChunk(entry.id);
        if (!chunk) throw new Error('RAD selection referenced a page outside its residency lease.');
        return {...entry, data: chunk.data};
      });
      this.renderer.setFrontier(nextFrontier);
      this.presentedFrontier = nextFrontier;
    }
    this.appliedVersion = result.version;
    this.requests = result.requests;
    this.selectionNeeded ||= result.hasPendingTraversal || result.viewVersion !== this.viewVersion;
    const protectedIds = new Set([
      'rad:0',
      ...result.protectedPageIds,
      ...this.presentedFrontier.map(entry => entry.id),
      ...[...this.frontiers.values()].flatMap(frontier => frontier.map(entry => entry.id))
    ]);
    for (const id of protectedIds) this.residency.pin(id);
    for (const id of leasedIds) {
      if (!protectedIds.has(id)) this.residency.unpin(id);
    }
    for (const id of leasedIds) {
      // Off-frontier, unprotected pages must not retain their old download importance forever.
      if (!protectedIds.has(id)) this.residency.setPriority(id, 0);
    }
    this.scheduler.invalidate();
    if (
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).get('diagnostic') === 'worker'
    ) {
      console.debug(
        'COIT_SLICE',
        JSON.stringify({
          duration: result.duration,
          viewVersion: result.viewVersion,
          requestedViewVersion: this.viewVersion,
          pending: result.hasPendingTraversal,
          published: Boolean(result.frontier),
          requests: result.requests.length,
          activeSplats: this.presentedFrontier.reduce(
            (count, entry) => count + (entry.activeRows?.length ?? 0),
            0
          ),
          residentPages: this.residency.stats.residentChunkCount,
          protectedPages: protectedIds.size,
          evictedPages: this.residency.stats.evictedChunkCount
        })
      );
    }
  }

  private async loadPage(
    pageIndex: number,
    priority: number,
    signal: AbortSignal
  ): Promise<boolean> {
    if (this.destroyed || signal.aborted) return false;
    let page: RADPage | undefined;
    const pageId = `rad:${pageIndex}`;
    try {
      page = await this.source.getPage(pageIndex, signal);
      const decoded = page;
      const accepted = await new Promise<boolean>((resolve, reject) => {
        const upload = () => {
          if (this.destroyed || signal.aborted) {
            resolve(false);
            return;
          }
          try {
            const {splats, colors} = decoded;
            void this.residency
              .load(
                pageId,
                () => {
                  signal.throwIfAborted();
                  if (this.destroyed) throw new DOMException('RAD scene destroyed.', 'AbortError');
                  return makeGPUSplatData(this.device, {
                    positions: splats.positions,
                    scales: splats.scales,
                    rotations: splats.rotations,
                    colors,
                    opacities: splats.opacities,
                    sphericalHarmonics: splats.sphericalHarmonics,
                    sourceBatchIndex: pageIndex,
                    rowIndexBase: Number(splats.loaderData?.base)
                  });
                },
                {priority, pinned: true, estimatedSplatCount: splats.splatCount}
              )
              .then(async chunk => {
                if (!chunk || this.destroyed) {
                  resolve(false);
                  return;
                }
                await this.source.admit(decoded.requestId);
                if (!this.destroyed) {
                  this.selectionNeeded = true;
                  this.options.onChange();
                }
                resolve(true);
              })
              .catch(reject);
          } catch (error) {
            reject(error);
          }
        };
        if (this.rootReady) {
          this.pendingUploads.push(upload);
          this.options.onChange();
        } else {
          upload();
        }
      });
      if (!accepted || this.destroyed) {
        if (page && !this.destroyed) await this.source.discard(page.requestId);
        return false;
      }
      // Once admitted, finish the transaction even if the old camera's request was cancelled.
      this.selectionNeeded = true;
      this.options.onChange();
      return true;
    } catch (error) {
      if (page && !this.destroyed) {
        this.residency.remove(pageId);
        await this.source.discard(page.requestId);
      }
      throw error;
    }
  }

  private fail(error: Error): void {
    if (this.destroyed) return;
    this.error = error;
    this.report('error', error.message);
    this.options.onError(error);
  }

  private report(phase: SplatLayerStatus['phase'], message: string): void {
    const status: SplatLayerStatus = {
      phase,
      message,
      activeSplats: this.presentedFrontier.reduce(
        (total, entry) => total + (entry.activeRows?.length ?? entry.data.length),
        0
      ),
      residentPages: this.residency.stats.residentChunkCount,
      pendingPages: this.requests.length,
      sourceSplats: this.sourceSplats
    };
    const serialized = JSON.stringify(status);
    if (serialized !== this.lastStatus) {
      this.lastStatus = serialized;
      this.options.onStatus(status);
    }
  }
}

function sameView(left: SplatHierarchyView, right: SplatHierarchyView): boolean {
  return (
    left.viewportSize[0] === right.viewportSize[0] &&
    left.viewportSize[1] === right.viewportSize[1] &&
    Boolean(
      left.modelViewProjectionMatrix?.every(
        (value, index) => value === right.modelViewProjectionMatrix?.[index]
      )
    )
  );
}
