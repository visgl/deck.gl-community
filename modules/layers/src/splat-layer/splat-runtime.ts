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
type SceneDemand = {
  id: string;
  desired: number;
  floor: number;
  maxTotalSplats: number;
  group?: SplatBudgetGroup;
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
  private sceneLimit = Infinity;
  private sceneGrant = 0;
  private sceneGroupGrants = new Map<SplatBudgetGroup, number>();
  /** Share global and nested parent allowances across prepared and scene registrations. */
  setSceneDemands(ids: Set<string>, scenes: SceneDemand[]): Map<string, number> {
    const prepared = [...this.demands[0]].filter(([id]) => ids.has(id)).map(([, demand]) => demand);
    const records = [
      ...scenes,
      ...prepared.map(demand => ({
        id: '',
        group: demand.group,
        maxTotalSplats: demand.maxTotalSplats,
        floor: demand.rows.reduce(
          (cost, row) => cost + demand.hierarchy(row.owner).at(-1)!.source.positions.length / 3,
          0
        ),
        desired: Math.min(
          demand.maxSplats,
          demand.rows.reduce(
            (cost, row) =>
              cost + demand.hierarchy(row.owner)[row.level].source.positions.length / 3,
            0
          )
        )
      }))
    ];
    const total = Math.min(Infinity, ...records.map(record => record.maxTotalSplats));
    const constraints = new Map<object, {budget: number; records: SceneDemand[]}>();
    constraints.set(this, {budget: total, records});
    for (const record of records)
      for (let group = record.group; group; group = group.parent) {
        let constraint = constraints.get(group);
        if (!constraint) {
          constraint = {budget: group.maxSplats, records: []};
          constraints.set(group, constraint);
        }
        constraint.records.push(record);
      }
    const factors = new Map(records.map(record => [record, 1]));
    for (const {budget, records: members} of constraints.values()) {
      if (!Number.isFinite(budget)) continue;
      const floor = members.reduce((sum, record) => sum + record.floor, 0);
      const extra = members.reduce(
        (sum, record) => sum + Math.max(0, record.desired - record.floor),
        0
      );
      const factor = Math.min(1, Math.max(0, budget - floor) / Math.max(1, extra));
      for (const record of members) factors.set(record, Math.min(factors.get(record)!, factor));
    }
    const grants = new Map<string, number>();
    const groupGrants = new Map<SplatBudgetGroup, number>();
    let grant = 0;
    for (const scene of scenes) {
      const allowance =
        scene.floor + Math.max(0, scene.desired - scene.floor) * factors.get(scene)!;
      grants.set(scene.id, allowance);
      grant += allowance;
      for (let group = scene.group; group; group = group.parent)
        groupGrants.set(group, (groupGrants.get(group) ?? 0) + allowance);
    }
    if (
      grant !== this.sceneGrant ||
      total !== this.sceneLimit ||
      groupGrants.size !== this.sceneGroupGrants.size ||
      [...groupGrants].some(([group, value]) => this.sceneGroupGrants.get(group) !== value)
    ) {
      this.sceneLimit = total;
      this.sceneGrant = grant;
      this.sceneGroupGrants = groupGrants;
      this.snapshots[0].clear();
    }
    return grants;
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
          ...(operation === 0 && (this.sceneGrant > 0 || Number.isFinite(this.sceneLimit))
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
            budget:
              Math.max(
                0,
                (operation ? group.maxShadowSplats : group.maxSplats) -
                  (operation ? 0 : (this.sceneGroupGrants.get(group) ?? 0))
              ) * 0.75
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
