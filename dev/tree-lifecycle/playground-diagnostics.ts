// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';
import type {FieldFrame} from './field/field';
import {
  ShellNearPriority,
  ShellNearReason,
  ShellVisibilityReason,
  type ShellSetup
} from './field/shell/shell-field';
import type {FieldShadowDiagnostics} from './playground-lighting';
import {
  getGroundPoint,
  getPlantedTree,
  getPlantingLayout,
  projectPlantingEdge
} from './playground-planting';

const SHELL_LABELS = {
  [ShellVisibilityReason.Empty]: 'Empty cell',
  [ShellVisibilityReason.Behind]: 'Behind the camera',
  [ShellVisibilityReason.OutsideHorizontal]: 'Outside the left or right plane',
  [ShellVisibilityReason.OutsideVertical]: 'Outside the top or bottom plane',
  [ShellVisibilityReason.Detailed]: 'Handed off to detailed geometry',
  [ShellVisibilityReason.Tiny]: 'Coarse shell',
  [ShellVisibilityReason.Coarse]: 'Medium shell',
  [ShellVisibilityReason.Fine]: 'Fine shell'
};
const NEAR_LABELS = {
  [ShellNearReason.Empty]: 'No near candidate',
  [ShellNearReason.Behind]: 'Behind the camera',
  [ShellNearReason.OutsideView]: 'Outside the near view',
  [ShellNearReason.BelowThreshold]: 'Below the detail size threshold',
  [ShellNearReason.Budget]: 'Near detail budget filled by higher priorities',
  [ShellNearReason.Waiting]: 'Waiting for a departing crown to fade',
  [ShellNearReason.Detailed]: 'Assigned a detailed slot'
};
const TIER_COLORS = ['#ff9a80', '#bb98ee', '#7da8f8', '#69d9d4', '#c9f49d'];

type Inspection = {
  setup: ShellSetup;
  frame: FieldFrame;
  viewport: Viewport;
  selected: number;
  shadow?: FieldShadowDiagnostics | null;
};
type Marker = {index: number; x: number; y: number; distance: number; tier: number};

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function getCell(setup: ShellSetup, index: number): number {
  return Math.floor(setup.rowOf[index] / setup.field.rowsPerCell);
}

function readCrown(inspection: Inspection, index: number) {
  const {setup, viewport} = inspection;
  const cellIndex = getCell(setup, index);
  const cell = setup.cells[cellIndex];
  const diagnostics = setup.diagnostics!;
  const tree = setup.trees[index];
  const position = [cell.east, cell.north, cell.up];
  const screen = viewport.project(position);
  const [cx, cy, cz] = viewport.cameraPosition;
  const resident = setup.nearByTree.get(index);
  const bucket = setup.bucketOfCell[cellIndex];
  const flags = diagnostics.nearFlags[cellIndex];
  return {
    tree: index + 1,
    row: tree.row + 1,
    column: tree.column + 1,
    cell: cellIndex,
    position,
    radius: cell.radius,
    distance: Math.hypot(cell.east - cx, cell.north - cy, cell.up - cz),
    screen,
    centerInDepthRange: screen[2] >= -1 && screen[2] <= 1,
    shell: SHELL_LABELS[diagnostics.shellReasons[cellIndex] as ShellVisibilityReason],
    shellBucket: bucket,
    shellPass: bucket < 0 ? null : bucket >= 3 ? 'dissolve' : 'opaque',
    near: NEAR_LABELS[diagnostics.nearReasons[cellIndex] as ShellNearReason],
    crownPixels: diagnostics.nearPixels[cellIndex],
    nearPriority: diagnostics.nearPriority[cellIndex],
    nearCoverage: diagnostics.nearCoverage[cellIndex],
    enclosesCamera: Boolean(flags & ShellNearPriority.EnclosesCamera),
    retainsSlot: Boolean(flags & ShellNearPriority.RetainsSlot),
    selectionBonus: Boolean(flags & ShellNearPriority.Selected),
    nearResident: Boolean(resident),
    detailedOpacity: (resident?.spec.canopyColor[3] ?? 0) / 255
  };
}

export class FieldInspector {
  private readonly panel = element<HTMLDetailsElement>('render-diagnostics');
  private readonly overlay = element<HTMLCanvasElement>('diagnostics-overlay');
  private readonly showMarkers = element<HTMLInputElement>('show-diagnostics');
  private readonly showPlanting = element<HTMLInputElement>('show-planting');
  private readonly compareShell = element<HTMLInputElement>('compare-shell-frustum');
  private readonly compare = element<HTMLInputElement>('compare-compaction');
  private readonly tree = element<HTMLInputElement>('inspect-tree');
  private readonly result = element<HTMLDivElement>('diagnostic-result');
  private snapshotRequested = false;
  private markers: Marker[] = [];
  private lastUpdate = -Infinity;
  private viewport: Viewport | null = null;
  private planting: ReturnType<typeof getPlantingLayout> | null = null;
  private plantingTrees: ShellSetup['trees'] | null = null;
  private groundProbe: [number, number] | null = null;

  constructor() {
    this.panel.addEventListener('toggle', () => {
      this.lastUpdate = -Infinity;
      this.updateOverlay();
      if (!this.enabled) {
        this.snapshotRequested = false;
        this.markers = [];
        this.groundProbe = null;
      }
    });
    this.showMarkers.addEventListener('change', () => this.updateOverlay());
    this.showPlanting.addEventListener('change', () => this.updateOverlay());
    this.tree.addEventListener('input', () => {
      this.groundProbe = null;
      this.lastUpdate = -Infinity;
    });
    window.addEventListener(
      'click',
      event => {
        if (!this.enabled || !event.altKey || !this.viewport || !this.planting) return;
        if (!(event.target instanceof Element) || !event.target.closest('#scene')) return;
        let match: Marker | undefined;
        let radius = 18;
        for (const marker of this.markers) {
          const distance = Math.hypot(marker.x - event.clientX, marker.y - event.clientY);
          if (distance < radius) {
            match = marker;
            radius = distance;
          }
        }
        event.preventDefault();
        event.stopPropagation();
        this.groundProbe = match
          ? null
          : getGroundPoint(this.viewport, [event.clientX, event.clientY]);
        const index =
          match?.index ?? (this.groundProbe ? getPlantedTree(this.planting, this.groundProbe) : -1);
        if (index >= 0) this.tree.value = String(index + 1);
        this.lastUpdate = -Infinity;
      },
      {capture: true}
    );
    element<HTMLButtonElement>('save-diagnostics').onclick = () => {
      this.snapshotRequested = true;
      this.lastUpdate = -Infinity;
    };
  }

  get enabled(): boolean {
    return this.panel.open;
  }

  get bypassCompaction(): boolean {
    return this.enabled && this.compare.checked;
  }

  get bypassShellFrustum(): boolean {
    return this.enabled && this.compareShell.checked;
  }

  private updateOverlay(): void {
    this.overlay.hidden =
      !this.enabled || (!this.showMarkers.checked && !this.showPlanting.checked);
    if (!this.showMarkers.checked) this.markers = [];
    this.lastUpdate = -Infinity;
  }

  update(now: number, inspection: Inspection): void {
    this.viewport = inspection.viewport;
    if (now - this.lastUpdate < 120 || !inspection.setup.diagnostics) return;
    this.lastUpdate = now;
    this.tree.max = String(inspection.setup.trees.length);
    const index = this.getInspectedIndex(inspection);
    const crown = readCrown(inspection, index);
    const ranking = [
      crown.nearPriority > 0 ? `${Math.round(crown.nearCoverage * 100)}% view overlap` : '',
      crown.enclosesCamera ? 'camera inside crown' : '',
      crown.retainsSlot ? 'retained slot' : '',
      crown.selectionBonus ? 'selected bonus' : ''
    ].filter(Boolean);
    const {setup, frame} = inspection;
    if (setup.trees !== this.plantingTrees) {
      this.plantingTrees = setup.trees;
      this.planting = getPlantingLayout(setup.trees);
      this.groundProbe = null;
    }
    const probeTree =
      this.groundProbe && this.planting
        ? getPlantedTree(this.planting, this.groundProbe)
        : undefined;
    let lowestPriority: ReturnType<typeof readCrown> | undefined;
    for (const candidate of setup.nearByTree.keys()) {
      const cell = getCell(setup, candidate);
      if (setup.diagnostics.nearReasons[cell] !== ShellNearReason.Detailed) continue;
      if (!lowestPriority || setup.diagnostics.nearPriority[cell] < lowestPriority.nearPriority) {
        lowestPriority = readCrown(inspection, candidate);
      }
    }
    this.result.textContent = [
      probeTree === undefined
        ? ''
        : probeTree < 0
          ? 'Ground probe is outside the planted rows'
          : `Ground probe · planted slot ${probeTree + 1}`,
      this.bypassShellFrustum ? 'Shell frustum culling bypassed' : '',
      `Tree ${crown.tree} · row ${crown.row}, column ${crown.column}`,
      `${crown.distance.toFixed(1)} m · projected width ${crown.crownPixels.toFixed(0)} px · priority ${crown.nearPriority.toFixed(1)}`,
      `Shell — ${crown.shell}${crown.shellPass ? ` · ${crown.shellPass}` : ''}`,
      `Near — ${crown.near}${crown.nearResident ? ` · ${Math.round(crown.detailedOpacity * 100)}% opacity` : ''}`,
      ranking.join(' · '),
      crown.centerInDepthRange ? '' : 'Crown center is outside the camera depth range',
      `Detailed crowns ${setup.nearByTree.size}/${frame.params.nearMost} · bias ${frame.params.lodBias.toFixed(2)}`,
      lowestPriority
        ? `Lowest detailed priority ${lowestPriority.nearPriority.toFixed(1)} · tree ${lowestPriority.tree}`
        : '',
      inspection.shadow
        ? `Shadow map ${inspection.shadow.mapSize.join(' × ')} · ${(inspection.shadow.texelMetres * 100).toFixed(1)} cm per texel`
        : ''
    ]
      .filter(Boolean)
      .join('\n');
    if (!this.overlay.hidden) this.drawOverlay(inspection, index);
    if (this.snapshotRequested) {
      this.snapshotRequested = false;
      this.saveSnapshot(inspection, index);
    }
  }

  private getInspectedIndex({setup, selected}: Inspection): number {
    const index = this.tree.valueAsNumber - 1;
    return Number.isInteger(index) && index >= 0 && index < setup.trees.length ? index : selected;
  }

  private drawOverlay({setup, viewport}: Inspection, inspected: number): void {
    const {width, height, cameraPosition} = viewport;
    if (this.overlay.width !== width || this.overlay.height !== height) {
      this.overlay.width = width;
      this.overlay.height = height;
    }
    const context = this.overlay.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    if (this.showPlanting.checked && this.planting) {
      const {outline} = this.planting;
      context.beginPath();
      for (let edge = 0; edge < outline.length; edge++) {
        const projected = projectPlantingEdge(
          viewport,
          outline[edge],
          outline[(edge + 1) % outline.length]
        );
        if (!projected) continue;
        context.moveTo(...projected[0]);
        context.lineTo(...projected[1]);
      }
      context.strokeStyle = '#18221b';
      context.lineWidth = 4;
      context.stroke();
      context.strokeStyle = '#f5e1a6';
      context.lineWidth = 1.5;
      context.stroke();
    }
    if (this.groundProbe) {
      const [x, y, z] = viewport.project([...this.groundProbe, 0]);
      if (z >= -1 && z <= 1) {
        context.beginPath();
        context.moveTo(x - 7, y);
        context.lineTo(x + 7, y);
        context.moveTo(x, y - 7);
        context.lineTo(x, y + 7);
        context.strokeStyle = '#f5e1a6';
        context.lineWidth = 2;
        context.stroke();
      }
    }
    if (!this.showMarkers.checked) return;
    const [cx, cy, cz] = cameraPosition;
    const range = Math.max(
      70,
      Math.hypot(cx - viewport.center[0], cy - viewport.center[1], cz - viewport.center[2]) * 2
    );
    const stride = range > 180 ? Math.max(1, Math.floor(setup.cells.length / 1500)) : 1;
    const byPixel = new Map<string, Marker>();
    const inspectedCell = getCell(setup, inspected);
    const visit = (cellIndex: number) => {
      const cell = setup.cells[cellIndex];
      const index = cell.trees[0];
      if (index === undefined) return;
      const distance = Math.hypot(cell.east - cx, cell.north - cy, cell.up - cz);
      if (distance > range && cellIndex !== inspectedCell) return;
      const [x, y, z] = viewport.project([cell.east, cell.north, cell.up]);
      if (z < -1 || z > 1 || x < 2 || y < 2 || x > width - 2 || y > height - 2) return;
      const key = `${Math.floor(x / 18)}:${Math.floor(y / 18)}`;
      const bucket = setup.bucketOfCell[cellIndex];
      const tier = setup.nearByTree.has(index) ? 4 : bucket >= 0 ? (bucket % 3) + 1 : 0;
      const prior = byPixel.get(key);
      if (!prior || cellIndex === inspectedCell || distance < prior.distance) {
        byPixel.set(key, {index, x, y, distance, tier});
      }
    };
    for (let cell = 0; cell < setup.cells.length; cell += stride) visit(cell);
    visit(inspectedCell);
    this.markers = [...byPixel.values()]
      .sort(
        (a, b) =>
          Number(b.index === inspected) - Number(a.index === inspected) || a.distance - b.distance
      )
      .slice(0, 220);
    for (const marker of this.markers) {
      context.beginPath();
      context.arc(marker.x, marker.y, marker.index === inspected ? 7 : 3, 0, Math.PI * 2);
      context.fillStyle = TIER_COLORS[marker.tier];
      context.strokeStyle = '#101710';
      context.lineWidth = 1.5;
      context.fill();
      context.stroke();
    }
  }

  private saveSnapshot(inspection: Inspection, index: number): void {
    const {setup, frame, viewport, shadow} = inspection;
    const diagnostics = setup.diagnostics!;
    const snapshot = {
      version: 1,
      frame: frame.frame,
      treeCount: setup.trees.length,
      camera: frame.camera,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        eye: viewport.cameraPosition,
        viewProjectionMatrix: Array.from(viewport.viewProjectionMatrix)
      },
      shadow,
      nearBudget: frame.params.nearMost,
      lodBias: frame.params.lodBias,
      thresholds: {
        nearEntry: frame.params.nearIn,
        nearExit: frame.params.nearOut,
        fine: frame.params.finePixels,
        medium: frame.params.tinyPixels
      },
      leafCompaction: frame.params.leafCulling !== 0,
      woodCompaction: frame.params.woodCulling !== 0,
      shellFrustumCulling: !this.bypassShellFrustum,
      plantedBoundary: this.planting?.outline,
      groundProbe: this.groundProbe,
      inspected: readCrown(inspection, index),
      detailed: [...setup.nearByTree.keys()].map(index => readCrown(inspection, index)),
      cells: setup.cells.map((cell, index) => ({
        trees: cell.trees.map(tree => tree + 1),
        bounds: [cell.east, cell.north, cell.up, cell.radius],
        bucket: setup.bucketOfCell[index],
        shell: SHELL_LABELS[diagnostics.shellReasons[index] as ShellVisibilityReason],
        near: NEAR_LABELS[diagnostics.nearReasons[index] as ShellNearReason],
        crownPixels: diagnostics.nearPixels[index],
        nearPriority: diagnostics.nearPriority[index],
        nearCoverage: diagnostics.nearCoverage[index],
        nearFlags: diagnostics.nearFlags[index]
      }))
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot)], {type: 'application/json'})
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `tree-field-frame-${frame.frame}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
