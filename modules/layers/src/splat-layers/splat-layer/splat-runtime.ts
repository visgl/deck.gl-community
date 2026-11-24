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
      const values: unknown[] = [demand.rows, demand.maxSplats, demand.maxTotalSplats];
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
    const total = Math.min(...demands.map(demand => demand.maxTotalSplats));
    const limits = new Map<Demand, SplatBudgetLimit[]>();
    for (const demand of demands) {
      const list: SplatBudgetLimit[] = [
        {key: demand, budget: demand.maxSplats * SETTLED_SPLAT_BUDGET_FRACTION}
      ];
      for (let group = demand.group; group; group = group.parent)
        list.push({
          key: group,
          budget: resolveSplatBudget(group.maxSplats, this.device) * SETTLED_SPLAT_BUDGET_FRACTION
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
