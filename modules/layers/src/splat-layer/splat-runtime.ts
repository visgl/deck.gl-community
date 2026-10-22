// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Effect, EffectContext, PreRenderOptions} from '@deck.gl/core';
import type {DeviceInfo} from '@luma.gl/core';
import type {SplatHierarchy} from './splat-hierarchy';
import {
  budgetSplatSelections,
  getSplatLevelCounts,
  type SplatSelection,
  type SplatBudgetLimit
} from './splat-budget';

/** A caller-specified cap or a stable device-aware default. */
export type SplatBudget = number | 'auto';

/** Internal parent cap shared by canopy children and nested inventory consumers. */
export type SplatBudgetGroup = {
  maxSplats: SplatBudget;
  parent?: SplatBudgetGroup;
};

type SplatBudgetDevice = {
  info?: Pick<DeviceInfo, 'fallback' | 'gpu' | 'gpuType'>;
};

const DEFAULT_AUTO_SPLAT_BUDGET = 20_000;
const SOFTWARE_AUTO_SPLAT_BUDGET = 5_000;
const AUTO_SPLAT_BUDGETS = new WeakMap<object, number>();

/**
 * Resolve automatic selection once per device. GPU resource limits describe allocation ceilings,
 * not Gaussian throughput, so only known software/fallback adapters are down-tiered here.
 */
export function resolveSplatBudget(
  budget: SplatBudget | undefined,
  device?: SplatBudgetDevice
): number {
  if (budget !== 'auto' && budget !== undefined)
    return typeof budget === 'number' ? budget : DEFAULT_AUTO_SPLAT_BUDGET;
  if (!device) return DEFAULT_AUTO_SPLAT_BUDGET;
  let resolved = AUTO_SPLAT_BUDGETS.get(device);
  if (resolved === undefined) {
    const info = device.info;
    resolved =
      info?.fallback || info?.gpu === 'software' || info?.gpuType === 'cpu'
        ? SOFTWARE_AUTO_SPLAT_BUDGET
        : DEFAULT_AUTO_SPLAT_BUDGET;
    AUTO_SPLAT_BUDGETS.set(device, resolved);
  }
  return resolved;
}

/**
 * Reserve a small part of each public cap for temporary old/new optical mixtures.
 * Settled selection may spend this fraction; the full public cap remains available
 * while a refinement transition advances.
 */
export const SETTLED_SPLAT_BUDGET_FRACTION = 0.9;

/** Sorted scene registration charged against the same host and parent caps as prepared layers. */
type SceneDemand = {
  id: string;
  /** Gaussians the scene would draw without a shared cap. */
  desired: number;
  /** Complete coarse/static coverage, retained even when a soft cap is lower. */
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
      runtime = new SplatRuntime(device as SplatBudgetDevice);
      devices.set(device, runtime);
    }
    return runtime;
  }
  private constructor(private device: SplatBudgetDevice) {}
  private sceneLimit = Infinity;
  private sceneGrant = 0;
  private sceneGroupGrants = new Map<SplatBudgetGroup, number>();
  /**
   * Share global and nested parent allowances across prepared and scene registrations.
   * Returns each scene's grant; the remainder is reserved for the next prepared reconcile.
   */
  setSceneDemands(ids: Set<string>, scenes: SceneDemand[]): Map<string, number> {
    const prepared = [...this.demands].filter(([id]) => ids.has(id)).map(([, demand]) => demand);
    const records: SceneDemand[] = [
      ...scenes,
      ...prepared.map(demand => {
        let floor = 0;
        let desired = 0;
        for (const row of demand.rows) {
          const counts = getSplatLevelCounts(demand.hierarchy(row.owner));
          floor += counts[counts.length - 1];
          desired += counts[row.level];
        }
        return {
          id: '',
          group: demand.group,
          maxTotalSplats: demand.maxTotalSplats,
          floor,
          desired: Math.min(demand.maxSplats, desired)
        };
      })
    ];
    const total = Math.min(Infinity, ...records.map(record => record.maxTotalSplats));
    const constraints = new Map<object, {budget: number; records: SceneDemand[]}>();
    constraints.set(this, {budget: total, records});
    for (const record of records)
      for (let group = record.group; group; group = group.parent) {
        let constraint = constraints.get(group);
        if (!constraint) {
          constraint = {budget: resolveSplatBudget(group.maxSplats, this.device), records: []};
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
      this.snapshot.clear();
    }
    return grants;
  }
  private snapshot = new Map<string, unknown[]>();
  private demands = new Map<string, Demand>();

  set(id: string, demand: Demand) {
    this.demands.set(id, demand);
  }
  delete(id: string) {
    this.demands.delete(id);
    this.snapshot.clear();
  }

  sample(ids: Set<string>, now: number) {
    for (const [id, demand] of this.demands) if (ids.has(id)) demand.tick?.(now);
  }

  /** Reconcile once before presentation, after all participating layers have published demand. */
  reconcile(ids: Set<string>) {
    const participating = [...this.demands].filter(([id]) => ids.has(id));
    const snapshot = new Map<string, unknown[]>();
    for (const [id, demand] of participating) {
      const values: unknown[] = [
        demand.rows,
        demand.maxSplats,
        demand.maxTotalSplats,
        ...(this.sceneGrant > 0 || Number.isFinite(this.sceneLimit)
          ? [this.sceneGrant, this.sceneLimit]
          : [])
      ];
      for (let group = demand.group; group; group = group.parent)
        values.push(group, resolveSplatBudget(group.maxSplats, this.device));
      snapshot.set(id, values);
    }
    if (
      snapshot.size === this.snapshot.size &&
      [...snapshot].every(([id, values]) => {
        const old = this.snapshot.get(id);
        return old?.length === values.length && values.every((value, i) => value === old[i]);
      })
    )
      return;
    this.snapshot = snapshot;
    if (!participating.length) return;
    if (
      [...snapshot.values()].every(values =>
        values.slice(1).every(value => typeof value !== 'number' || value === Infinity)
      )
    ) {
      participating.forEach(([, demand]) => demand.apply(demand.rows, Infinity));
      return;
    }
    // Concatenate demand without per-row wrappers. Budgeting keeps row order, so each
    // registration's allocation is the contiguous slice it contributed.
    const demands = participating.map(([, demand]) => demand);
    const rows = demands.length === 1 ? demands[0].rows : demands.flatMap(demand => demand.rows);
    const owners: Demand[] = new Array(rows.length);
    const starts: number[] = [];
    let offset = 0;
    for (const demand of demands) {
      starts.push(offset);
      owners.fill(demand, offset, offset + demand.rows.length);
      offset += demand.rows.length;
    }
    // Scene grants are charged first; prepared selection spends the remaining host and parent caps.
    const total = Math.max(
      0,
      Math.min(...demands.map(demand => demand.maxTotalSplats), this.sceneLimit) - this.sceneGrant
    );
    const limits = new Map<Demand, SplatBudgetLimit[]>();
    for (const demand of demands) {
      const list: SplatBudgetLimit[] = [
        {key: demand, budget: demand.maxSplats * SETTLED_SPLAT_BUDGET_FRACTION}
      ];
      for (let group = demand.group; group; group = group.parent)
        list.push({
          key: group,
          budget:
            Math.max(
              0,
              resolveSplatBudget(group.maxSplats, this.device) -
                (this.sceneGroupGrants.get(group) ?? 0)
            ) * SETTLED_SPLAT_BUDGET_FRACTION
        });
      limits.set(demand, list);
    }
    const allocated = budgetSplatSelections(
      rows,
      (owner, index) => owners[index].hierarchy(owner),
      total * SETTLED_SPLAT_BUDGET_FRACTION,
      (_, index) => limits.get(owners[index])!
    );
    demands.forEach((demand, index) => {
      const start = starts[index];
      const selected =
        allocated === rows ? demand.rows : allocated.slice(start, start + demand.rows.length);
      let cost = 0;
      for (const row of selected) {
        const counts = getSplatLevelCounts(demand.hierarchy(row.owner));
        cost += counts[row.level] + (row.blend > 0 ? counts[row.level + 1] : 0);
      }
      // The reserved headroom allows each registration's optical mixtures to advance.
      // Existing transition overlap remains a soft submission allowance, not a GPU byte cap.
      const budget = Math.min(
        demand.maxSplats,
        Number.isFinite(total) || demand.group ? cost / SETTLED_SPLAT_BUDGET_FRACTION : Infinity
      );
      demand.apply(selected, budget);
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
