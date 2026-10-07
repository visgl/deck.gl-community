// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Effect, EffectContext, PreRenderOptions} from '@deck.gl/core';
import type {SplatHierarchy} from './splat-hierarchy';
import {budgetSplatSelections, type SplatSelection, type SplatBudgetLimit} from './splat-budget';

/** Internal parent cap shared by canopy children and nested inventory consumers. */
export type SplatBudgetGroup = {
  maxSplats: number;
  maxShadowSplats: number;
  parent?: SplatBudgetGroup;
};
type Demand = {
  rows: SplatSelection<any>[];
  hierarchy: (owner: any) => SplatHierarchy;
  maxSplats: number;
  maxTotalSplats: number;
  group?: SplatBudgetGroup;
  apply: (rows: SplatSelection<any>[], budget: number) => void;
  tick?: (now: number) => void;
};
const RUNTIMES = new WeakMap<object, WeakMap<object, SplatRuntime>>();

/** Joint prepared-source selection scoped to the host deck and its current device. */
export class SplatRuntime {
  static get(deck: object, device: object): SplatRuntime {
    let devices = RUNTIMES.get(deck);
    if (!devices) {
      devices = new WeakMap();
      RUNTIMES.set(deck, devices);
    }
    let runtime = devices.get(device);
    if (!runtime) {
      runtime = new SplatRuntime();
      devices.set(device, runtime);
    }
    return runtime;
  }
  private sceneDemand = 0;
  private sceneFloor = 0;
  private sceneLimit = Infinity;
  private sceneGrant = 0;
  /** Reserve a proportional source-row grant for scene refinement on the same host. */
  setSceneDemand(ids: Set<string>, desired: number, floor: number, limit: number): number {
    const prepared = [...this.demands[0]].filter(([id]) => ids.has(id)).map(([, demand]) => demand);
    const preparedFloor = prepared.reduce(
      (sum, demand) =>
        sum +
        demand.rows.reduce(
          (cost, row) => cost + demand.hierarchy(row.owner).at(-1)!.source.positions.length / 3,
          0
        ),
      0
    );
    const preparedDesired = prepared.reduce(
      (sum, demand) =>
        sum +
        Math.min(
          demand.maxSplats,
          demand.rows.reduce(
            (cost, row) =>
              cost + demand.hierarchy(row.owner)[row.level].source.positions.length / 3,
            0
          )
        ),
      0
    );
    const total = Math.min(limit, ...prepared.map(demand => demand.maxTotalSplats));
    const extra = Math.max(0, total - preparedFloor - floor);
    const sceneExtra = Math.max(0, desired - floor);
    const preparedExtra = Math.max(0, preparedDesired - preparedFloor);
    const grant = Number.isFinite(total)
      ? floor + Math.min(sceneExtra, extra * (sceneExtra / Math.max(1, sceneExtra + preparedExtra)))
      : desired;
    if (
      grant !== this.sceneGrant ||
      limit !== this.sceneLimit ||
      desired !== this.sceneDemand ||
      floor !== this.sceneFloor
    ) {
      this.sceneDemand = desired;
      this.sceneFloor = floor;
      this.sceneLimit = limit;
      this.sceneGrant = grant;
      this.snapshots[0].clear();
    }
    return grant;
  }
  private snapshots: Map<string, unknown[]>[] = [new Map(), new Map()];
  private demands = [new Map<string, Demand>(), new Map<string, Demand>()];

  set(id: string, shadow: boolean, demand: Demand) {
    this.demands[Number(shadow)].set(id, demand);
  }
  delete(id: string) {
    this.demands.forEach(demands => demands.delete(id));
    this.snapshots.forEach(snapshot => snapshot.clear());
  }

  sample(ids: Set<string>, now: number) {
    for (const [id, demand] of this.demands[0]) if (ids.has(id)) demand.tick?.(now);
  }

  /** Reconcile once before presentation, after all participating layers have published demand. */
  reconcile(ids: Set<string>) {
    this.demands.forEach((demands, operation) => {
      const participating = [...demands].filter(([id]) => ids.has(id));
      const snapshot = new Map<string, unknown[]>();
      for (const [id, demand] of participating) {
        const values: unknown[] = [
          demand.rows,
          demand.maxSplats,
          demand.maxTotalSplats,
          ...(operation === 0 && (this.sceneDemand > 0 || Number.isFinite(this.sceneLimit))
            ? [this.sceneGrant, this.sceneLimit]
            : [])
        ];
        for (let group = demand.group; group; group = group.parent)
          values.push(group, operation ? group.maxShadowSplats : group.maxSplats);
        snapshot.set(id, values);
      }
      const previous = this.snapshots[operation];
      if (
        snapshot.size === previous.size &&
        [...snapshot].every(([id, values]) => {
          const old = previous.get(id);
          return old?.length === values.length && values.every((value, i) => value === old[i]);
        })
      )
        return;
      this.snapshots[operation] = snapshot;
      if (!participating.length) return;
      if (
        [...snapshot.values()].every(values =>
          values.slice(1).every(value => typeof value !== 'number' || value === Infinity)
        )
      ) {
        participating.forEach(([, demand]) => demand.apply(demand.rows, Infinity));
        return;
      }
      const rows = participating.flatMap(([, demand]) =>
        demand.rows.map(row => ({...row, owner: {demand, row}}))
      );
      const total = Math.max(
        0,
        Math.min(
          ...participating.map(([, demand]) => demand.maxTotalSplats),
          operation === 0 ? this.sceneLimit : Infinity
        ) - (operation === 0 ? this.sceneGrant : 0)
      );
      const limits = ({demand}: {demand: Demand}): SplatBudgetLimit[] => {
        const result: SplatBudgetLimit[] = [{key: demand, budget: demand.maxSplats * 0.75}];
        for (let group = demand.group; group; group = group.parent)
          result.push({
            key: group,
            budget: (operation ? group.maxShadowSplats : group.maxSplats) * 0.75
          });
        return result;
      };
      const allocated = budgetSplatSelections<{demand: Demand; row: SplatSelection<any>}>(
        rows,
        owner => owner.demand.hierarchy(owner.row.owner),
        total * 0.75,
        limits
      );
      const selections = new Map<Demand, SplatSelection<any>[]>();
      const costs = new Map<Demand, number>();
      for (const row of allocated) {
        const {demand, row: original} = row.owner;
        let selected = selections.get(demand);
        if (!selected) {
          selected = [];
          selections.set(demand, selected);
        }
        selected.push({...row, owner: original.owner});
        const hierarchy = demand.hierarchy(original.owner);
        const cost =
          hierarchy[row.level].source.positions.length / 3 +
          (row.blend > 0 ? hierarchy[row.level + 1].source.positions.length / 3 : 0);
        costs.set(demand, (costs.get(demand) ?? 0) + cost);
      }
      for (const [, demand] of participating) {
        // The reserved quarter allows each registration's optical mixtures to advance.
        // Existing transition overlap remains a soft submission allowance, not a GPU byte cap.
        const budget = Math.min(
          demand.maxSplats,
          Number.isFinite(total) || demand.group ? (costs.get(demand) ?? 0) / 0.75 : Infinity
        );
        demand.apply(selections.get(demand) ?? [], budget);
      }
    });
  }
}

const EFFECTS = new WeakMap<object, SplatSelectionEffect>();
/** One frame driver for prepared selection, shared by weighted splats and mesh comparison hosts. */
export class SplatSelectionEffect implements Effect {
  static get(deck: EffectContext['deck']) {
    let effect = EFFECTS.get(deck);
    if (!effect) {
      effect = new SplatSelectionEffect();
      EFFECTS.set(deck, effect);
      deck._addDefaultEffect(effect);
    }
    return effect;
  }
  id = 'gaussian-splat-selection';
  props = {};
  order = 9;
  private runtime!: SplatRuntime;
  setup({deck, device}: EffectContext) {
    this.runtime = SplatRuntime.get(deck, device);
  }
  preRender(options: PreRenderOptions) {
    const ids = new Set(options.layers.filter(layer => layer.props.visible).map(layer => layer.id));
    this.runtime.reconcile(ids);
    this.runtime.sample(ids, performance.now());
  }
  cleanup() {}
}
