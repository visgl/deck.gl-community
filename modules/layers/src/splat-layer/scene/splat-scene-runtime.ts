// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {
  CompositeLayer,
  Deck,
  Effect,
  FilterContext,
  PreRenderOptions,
  Viewport
} from '@deck.gl/core';
import type {Device, RenderPass, RenderPipelineParameters} from '@luma.gl/core';
import {
  GPUPagedSplatRenderer,
  makeGPUSplatData,
  type GPUSplatData,
  type SplatHierarchyView
} from '@luma.gl/splats';
import {Matrix4} from '@math.gl/core';
import {
  DEFAULT_GET_SOURCE,
  isSplatDataInput,
  isSplatSceneData,
  resolveSplatAsset,
  type SplatDataInput
} from '../splat-input';
import {SplatRuntime} from '../splat-runtime';
import type {SplatSource} from '../splat-source';
import {loadStaticSplatSource} from './static-source-client';
import {RADScene, type SplatLayerStatus} from './rad-scene';
import type {SplatSceneLayer} from './splat-scene-layer';
import {SplatCPUSceneRenderer, type SplatScenePage} from './splat-cpu-scene-renderer';
import {getSplatSceneProjectionError, isOrthographicSplatView} from './splat-scene-projection';

type Owner = {object: unknown; index: number; data: unknown[]; asset: SplatDataInput; key: string};
type SceneEntry = {
  layer: SplatSceneLayer;
  viewport: Viewport;
  owner: Owner;
  view: SplatHierarchyView;
  alpha: number;
  colorScale: [number, number, number];
};
type Asset = {
  id: number;
  data?: GPUSplatData;
  scene?: RADScene;
  users: Set<string>;
  status?: SplatLayerStatus;
  budgetKey: string;
  destroyLoading?: () => void;
};
type Renderer = {
  setProps: GPUPagedSplatRenderer['setProps'];
  setFrontier: GPUPagedSplatRenderer['setFrontier'];
  prepare: GPUPagedSplatRenderer['prepare'];
  draw: GPUPagedSplatRenderer['draw'];
  destroy: () => void;
};
type Domain = {
  renderer: Renderer;
  leader: string;
  layers: Set<string>;
  owners: Owner[];
  pages: SplatScenePage[];
};
const RUNTIMES = new WeakMap<Deck, WeakMap<Device, SplatSceneRuntime>>();

function getViewLayerKey(viewportId: string, layerId: string): string {
  return JSON.stringify([viewportId, layerId]);
}

function keyMatchesLayerId(key: string, layerId: string): boolean {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) && parts[1] === layerId;
  } catch {
    return false;
  }
}

/** One source cache and one ordering renderer per viewport/domain on the host deck/device. */
export class SplatSceneRuntime implements Effect {
  id = 'splat-scene-runtime';
  props = null;
  order = 10;
  useInPicking = true;
  private readonly pickers = new Map<string, SplatCPUSceneRenderer>();
  private readonly pickingEntries = new Map<string, SceneEntry[]>();
  private readonly layers = new Map<string, SplatSceneLayer>();
  private readonly radLayers = new Set<string>();
  private readonly owners = new Map<string, Owner[]>();
  private readonly assets = new Map<SplatDataInput, Asset>();
  private readonly domains = new Map<string, Domain>();
  private nextAssetId = 0;
  private readonly projectionErrors = new Map<string, string>();

  static get(deck: Deck, device: Device): SplatSceneRuntime {
    let devices = RUNTIMES.get(deck);
    if (!devices) {
      devices = new WeakMap();
      RUNTIMES.set(deck, devices);
    }
    let runtime = devices.get(device);
    if (!runtime) {
      runtime = new SplatSceneRuntime(deck, device);
      devices.set(device, runtime);
      deck._addDefaultEffect(runtime);
    }
    return runtime;
  }
  constructor(
    private readonly deck: Deck,
    private readonly device: Device
  ) {}
  setup(): void {}
  cleanup(): void {
    for (const picker of this.pickers.values()) picker.destroy();
    this.pickers.clear();
    this.pickingEntries.clear();
    for (const domain of this.domains.values()) domain.renderer.destroy();
    for (const asset of this.assets.values()) {
      asset.scene?.destroy();
      asset.destroyLoading?.();
      asset.data?.destroy();
    }
    this.domains.clear();
    this.assets.clear();
    this.layers.clear();
    this.owners.clear();
    this.radLayers.clear();
    this.projectionErrors.clear();
  }
  register(layer: SplatSceneLayer): void {
    const direct = isSplatDataInput(layer.props.data);
    let data: unknown[];
    if (direct) {
      if (layer.props.getSource !== DEFAULT_GET_SOURCE || layer.props.source)
        throw new Error('Direct splat assets cannot be combined with getSource or source.');
      data =
        this.owners.get(layer.id)?.[0]?.asset === layer.props.data
          ? this.owners.get(layer.id)![0].data
          : [{splats: layer.props.data, position: [0, 0, 0]}];
    } else {
      if (!Array.isArray(layer.props.data))
        throw new Error('SplatLayer data must be an asset or owner rows.');
      data = layer.props.data;
    }
    const owners = data.map((object, index) => {
      const accessor = layer.props.getSource;
      const asset = direct
        ? (layer.props.data as SplatDataInput)
        : (layer.props._resolvedAssets?.[index] ??
          layer.props.source ??
          (typeof accessor === 'function'
            ? accessor(object, {index, data, target: []})
            : accessor));
      if (!isSplatDataInput(asset))
        throw new Error('Each SplatLayer owner requires a Gaussian or RAD asset.');
      if (!isSplatSceneData(asset) && resolveSplatAsset(asset).source.opticalDepths)
        throw new Error(
          'Sorted SplatLayer does not support opticalDepths. Use weighted transparency for optical-density sources.'
        );
      return {
        object,
        index,
        data,
        asset:
          typeof asset === 'object' &&
          'type' in asset &&
          asset.type === 'prepared-splats' &&
          'source' in asset
            ? asset.source
            : asset,
        key: `${layer.id}/${index}`
      };
    });
    for (const key of this.pickingEntries.keys())
      if (keyMatchesLayerId(key, layer.id)) this.pickingEntries.delete(key);
    this.layers.set(layer.id, layer);
    this.owners.set(layer.id, owners);
    if (owners.some(owner => isRADAsset(owner.asset))) this.radLayers.add(layer.id);
    else this.radLayers.delete(layer.id);
    this.releaseUnusedAssets();
  }
  unregister(id: string): void {
    for (const key of this.projectionErrors.keys())
      if (keyMatchesLayerId(key, id)) this.projectionErrors.delete(key);
    this.layers.delete(id);
    this.owners.delete(id);
    this.radLayers.delete(id);
    this.releaseUnusedAssets();
    for (const [key, picker] of this.pickers)
      if (keyMatchesLayerId(key, id)) {
        picker.destroy();
        this.pickers.delete(key);
      }
    for (const key of this.pickingEntries.keys())
      if (keyMatchesLayerId(key, id)) this.pickingEntries.delete(key);
    this.deck.redraw('splat source finalized');
  }
  isLoaded(id: string): boolean {
    return (this.owners.get(id) ?? []).every(owner => {
      const asset = this.assets.get(owner.asset);
      return (
        asset?.status?.phase !== 'error' && Boolean(asset?.data || asset?.scene?.frontier.length)
      );
    });
  }
  preRender({
    layers,
    viewports,
    isPicking,
    layerFilter,
    canvasContext,
    pass = 'screen',
    cullRect
  }: PreRenderOptions): void {
    const pixelRatio =
      canvasContext?.cssToDeviceRatio() ?? this.device.canvasContext?.cssToDeviceRatio() ?? 1;
    // Match Deck's leaf operation, ancestor filtering and root-level layerFilter contract.
    // Cache root decisions separately for each viewport and render pass, as LayersPass does.
    const activePairs = new Set(
      viewports.flatMap(viewport =>
        [...this.layers.keys()].map(id => getViewLayerKey(viewport.id, id))
      )
    );
    if (!isPicking)
      for (const key of this.projectionErrors.keys())
        if (!activePairs.has(key)) this.projectionErrors.delete(key);
    const filterCache = new Map<string, Map<string, boolean>>();
    const shouldDraw = (layer: SplatSceneLayer, viewport: Viewport, picking: boolean) => {
      const {operation, visible, pickable} = layer.props;
      if (!visible || (picking && !pickable)) return false;
      if (
        !(
          operation.includes('draw') ||
          operation.includes('terrain') ||
          (picking && operation.includes('mask'))
        )
      )
        return false;
      const context: FilterContext = {
        layer,
        viewport,
        isPicking: picking,
        renderPass: pass,
        cullRect
      };
      let parent = layer.parent;
      while (parent) {
        if (
          !parent.props.visible ||
          (!(picking && !isPicking) && !(parent as CompositeLayer).filterSubLayer(context))
        )
          return false;
        context.layer = parent;
        parent = parent.parent;
      }
      // The next pick may be a query, hover or depth pass with its own cull rectangle.
      // Preserve candidates until that actual pass supplies its complete filter context.
      const projectionError = getSplatSceneProjectionError(
        layer.props.coordinateSystem,
        viewport,
        this.radLayers.has(layer.id)
      );
      if (picking && !isPicking) return !projectionError;
      if (layerFilter) {
        const key = `${viewport.id}/${context.renderPass}`;
        let roots = filterCache.get(key);
        if (!roots) {
          roots = new Map();
          filterCache.set(key, roots);
        }
        if (!roots.has(context.layer.id)) roots.set(context.layer.id, layerFilter(context));
        if (!roots.get(context.layer.id)) return false;
      }
      const projectionKey = getViewLayerKey(viewport.id, layer.id);
      if (projectionError) {
        if (this.projectionErrors.get(projectionKey) !== projectionError) {
          this.projectionErrors.set(projectionKey, projectionError);
          layer.raiseError(new Error(projectionError), 'unsupported scene projection');
        }
        return false;
      }
      this.projectionErrors.delete(projectionKey);
      return true;
    };
    if (isPicking) {
      for (const viewport of viewports)
        for (const layer of this.layers.values()) {
          const key = getViewLayerKey(viewport.id, layer.id);
          if (!shouldDraw(layer, viewport, true)) {
            this.pickers.get(key)?.destroy();
            this.pickers.delete(key);
            if (
              getSplatSceneProjectionError(
                layer.props.coordinateSystem,
                viewport,
                this.radLayers.has(layer.id)
              )
            )
              this.pickingEntries.delete(key);
            continue;
          }
          const entries = this.pickingEntries.get(key);
          if (!entries?.length) continue;
          let picker = this.pickers.get(key);
          if (!picker) {
            picker = new SplatCPUSceneRenderer(this.device, true);
            this.pickers.set(key, picker);
          }
          const pages = this.getPages(
            entries.filter(entry => layer.isOwnerPickable(entry.owner.index))
          ).map(page => ({
            ...page,
            pickingColor: layer.encodePickingColor(page.ownerIndex!).map(channel => channel / 255)
          }));
          picker.setProps({
            alphaCutoff: layer.props.alphaCutoff,
            kernel2DSize: Math.sqrt(layer.props.kernelVariance),
            gaussianSupportRadius: layer.props.support,
            viewportSize: [
              Math.max(1, viewport.width * pixelRatio),
              Math.max(1, viewport.height * pixelRatio)
            ]
          });
          picker.setFrontier(pages);
          picker.prepare(this.device.commandEncoder);
        }
      return;
    }
    this.pickingEntries.clear();
    const visible = layers.filter(
      layer =>
        this.layers.has(layer.id) &&
        viewports.some(
          viewport =>
            shouldDraw(layer as SplatSceneLayer, viewport, false) ||
            shouldDraw(layer as SplatSceneLayer, viewport, true)
        )
    ) as SplatSceneLayer[];
    const radCount = new Set(
      visible.flatMap(layer =>
        (this.owners.get(layer.id) ?? [])
          .filter(owner => isRADAsset(owner.asset))
          .map(owner => owner.asset)
      )
    ).size;
    const limit = Math.min(...visible.map(layer => layer.props.maxTotalSplats), Infinity);
    const coverage = (owner: Owner) =>
      this.assets.get(owner.asset)?.data?.length ??
      (isSplatSceneData(owner.asset) ? 1 : (owner.asset as SplatSource).opacities.length);
    const staticCosts = new Map(
      visible.map(layer => [
        layer.id,
        (this.owners.get(layer.id) ?? []).reduce(
          (sum, owner) => sum + (isRADAsset(owner.asset) ? 0 : coverage(owner)),
          0
        )
      ])
    );
    const staticFloor = [...staticCosts.values()].reduce((sum, cost) => sum + cost, 0);
    const ids = new Set(layers.filter(layer => layer.props.visible).map(layer => layer.id));
    const prepared = SplatRuntime.get(this.deck, this.device);
    const grants = prepared.setSceneDemands(
      ids,
      visible.map(layer => {
        const owners = this.owners.get(layer.id) ?? [];
        const maxSplats = Number.isFinite(layer.props.maxSplats)
          ? layer.props.maxSplats
          : 2_000_000;
        return {
          id: layer.id,
          maxTotalSplats: limit,
          group: layer.props._splatBudgetGroup,
          floor: owners.reduce((cost, owner) => cost + coverage(owner), 0),
          desired: Math.min(
            maxSplats,
            owners.reduce(
              (cost, owner) =>
                cost +
                (isSplatSceneData(owner.asset)
                  ? (this.assets.get(owner.asset)?.data?.length ?? maxSplats)
                  : (owner.asset as SplatSource).opacities.length),
              0
            )
          )
        };
      })
    );
    const cap = [...grants.values()].reduce((sum, grant) => sum + grant, 0);
    prepared.reconcile(ids);
    const residentCap = Math.min(...visible.map(layer => layer.props.maxResidentSplats), Infinity);
    const assetCaps = new Map<SplatDataInput, number>();
    const assetConcurrency = new Map<SplatDataInput, number>();
    for (const layer of visible) {
      const sources = new Set((this.owners.get(layer.id) ?? []).map(owner => owner.asset));
      const localRadCount = [...sources].filter(isRADAsset).length;
      const localGrant =
        (grants.get(layer.id)! - staticCosts.get(layer.id)!) / Math.max(localRadCount, 1);
      const sharedGrant = (cap - staticFloor) / Math.max(radCount, 1);
      for (const input of sources) {
        assetCaps.set(input, Math.min(assetCaps.get(input) ?? Infinity, localGrant, sharedGrant));
        assetConcurrency.set(
          input,
          Math.min(assetConcurrency.get(input) ?? Infinity, layer.props.maxConcurrentLoads)
        );
      }
    }
    const assetViews = new Map<Asset, Map<string, SplatHierarchyView>>();
    const submissions = new Map<string, SceneEntry[]>();
    for (const layer of visible)
      for (const viewport of viewports) {
        const screen = shouldDraw(layer, viewport, false);
        const pick = shouldDraw(layer, viewport, true);
        if (!screen && !pick) continue;
        const entries: SceneEntry[] = [];
        for (const owner of this.owners.get(layer.id) ?? []) {
          const asset = this.acquireAsset(
            owner.asset,
            layer,
            assetCaps.get(owner.asset)!,
            residentCap / Math.max(radCount, 1),
            assetConcurrency.get(owner.asset)!
          );
          const model = layer.getOwnerMatrix(owner.object, owner.index, owner.data, viewport);
          if (!Number.isFinite(model.determinant()) || Math.abs(model.determinant()) < 1e-15)
            continue;
          const camera = new Matrix4(model).invert().transformAsPoint(viewport.cameraPosition);
          const view: SplatHierarchyView = {
            modelViewProjectionMatrix: Array.from(
              new Matrix4(viewport.viewProjectionMatrix).multiplyRight(model)
            ),
            cameraPosition: [camera[0], camera[1], camera[2]],
            viewportSize: [
              Math.max(1, viewport.width * pixelRatio),
              Math.max(1, viewport.height * pixelRatio)
            ],
            verticalFieldOfView: isOrthographicSplatView(viewport)
              ? undefined
              : 2 * Math.atan(1 / viewport.projectionMatrix[5]),
            foveation: {
              center: [0.5, 0.5],
              radius: 0.5,
              strength: layer.props.foveationStrength * 12
            }
          };
          let views = assetViews.get(asset);
          if (!views) {
            views = new Map();
            assetViews.set(asset, views);
          }
          views.set(`${viewport.id}/${owner.key}`, view);
          const color = layer.getOwnerValue(
            'getColor',
            owner.object,
            owner.index,
            owner.data
          ) as number[];
          const colorScale = color.slice(0, 3).map(channel => channel / 255) as [
            number,
            number,
            number
          ];
          const alpha =
            ((color[3] ?? 255) / 255) *
            layer.props.opacity *
            Number(
              layer.getOwnerValue('getCoverageWeight', owner.object, owner.index, owner.data) ?? 1
            );
          entries.push({layer, viewport, owner, view, alpha, colorScale});
        }
        if (screen) {
          const key = `${viewport.id}:${layer.props.sortDomain}`;
          const domainEntries = submissions.get(key) ?? [];
          domainEntries.push(...entries);
          submissions.set(key, domainEntries);
        }
        if (pick) this.pickingEntries.set(getViewLayerKey(viewport.id, layer.id), entries);
      }
    // Prune against the complete screen-frame submission, not a picking pass's
    // potentially smaller viewport subset. Removed views and hidden/filtered
    // layers must release their dedicated picking models and buffers.
    for (const [key, picker] of this.pickers)
      if (!this.pickingEntries.get(key)?.length) {
        picker.destroy();
        this.pickers.delete(key);
      }
    for (const asset of this.assets.values())
      asset.scene?.updateViews(assetViews.get(asset) ?? new Map(), performance.now());
    for (const [key, domain] of this.domains)
      if (!submissions.get(key)?.length) {
        domain.renderer.destroy();
        this.domains.delete(key);
      }
    for (const [key, entries] of submissions) {
      if (!entries.length) continue;
      let domain = this.domains.get(key);
      if (!domain) {
        const renderer =
          this.device.type === 'webgpu'
            ? new GPUPagedSplatRenderer(this.device, {
                sortMode: 'global',
                alphaCutoff: 0.5 / 255,
                gaussianSupportRadius: Math.sqrt(8),
                kernel2DSize: Math.sqrt(0.3),
                maxScreenSpaceSplatSize: 512,
                toneMapping: 'none',
                lodOpacity: true
              })
            : new SplatCPUSceneRenderer(this.device);
        if (typeof renderer.prepare !== 'function')
          throw new Error(
            'Sorted SplatLayer requires the luma 9.4 host-pass backport; see the scene installation guide.'
          );
        domain = {renderer, leader: entries[0].layer.id, layers: new Set(), owners: [], pages: []};
        this.domains.set(key, domain);
      }
      domain.leader = entries[0].layer.id;
      domain.layers = new Set(entries.map(entry => entry.layer.id));
      domain.owners = entries.map(entry => entry.owner);
      const pages = this.getPages(entries);
      domain.pages = pages;
      domain.renderer.setProps({
        alphaCutoff: entries[0].layer.props.alphaCutoff,
        kernel2DSize: Math.sqrt(entries[0].layer.props.kernelVariance),
        gaussianSupportRadius: entries[0].layer.props.support,
        viewportSize: entries[0].view.viewportSize,
        sphericalHarmonicsDegree: 3
      });
      domain.renderer.setFrontier(pages);
      domain.renderer.prepare(this.device.commandEncoder);
    }
  }
  private getPages(entries: SceneEntry[]): SplatScenePage[] {
    const pages: SplatScenePage[] = [];

    for (const {layer, viewport, owner, view, alpha, colorScale} of entries) {
      const asset = this.assets.get(owner.asset);
      if (!asset) continue;
      const frontier =
        asset.scene?.getFrontier(`${viewport.id}/${owner.key}`) ??
        (asset.data ? [{id: 'static', data: asset.data}] : []);
      for (const page of frontier) {
        const rowCount = page.activeRows?.length ?? page.data.length;
        // Retain coherent coverage while a smaller grant is being applied by the worker.
        const count = rowCount;
        if (!count) continue;
        const activeRows = page.activeRows;
        pages.push({
          ...page,
          layerId: layer.id,
          ownerIndex: owner.index,
          id: `${owner.key}/${asset.id}/${page.id}`,
          activeRows,
          modelViewProjectionMatrix: view.modelViewProjectionMatrix,
          cameraPosition: view.cameraPosition,
          alphaScale: alpha,
          colorScale
        });
      }
    }
    return pages;
  }
  draw(
    layer: SplatSceneLayer,
    renderPass: RenderPass,
    viewport: Viewport,
    picking = false,
    parameters?: RenderPipelineParameters
  ): void {
    if (picking) {
      this.pickers.get(getViewLayerKey(viewport.id, layer.id))?.draw(renderPass, parameters);
      return;
    }
    const domain = this.domains.get(`${viewport.id}:${layer.props.sortDomain}`);
    if (domain?.leader === layer.id) domain.renderer.draw(renderPass, parameters);
  }
  getStats(id: string) {
    const owners = this.owners.get(id) ?? [];
    const counts = [...this.domains.values()].map(domain =>
      domain.pages
        .filter(page => page.layerId === id)
        .reduce((sum, page) => sum + (page.activeRows?.length ?? page.data.length), 0)
    );
    return {
      sourceCount: new Set(owners.map(owner => owner.asset)).size,
      visibleInstances: counts.some(Boolean) ? owners.length : 0,
      renderedSplats: Math.max(0, ...counts),
      shadowInstances: 0,
      shadowSplats: 0,
      coverageFloor: owners.reduce(
        (sum, owner) =>
          sum +
          (this.assets.get(owner.asset)?.data?.length ??
            (isSplatSceneData(owner.asset) ? 1 : (owner.asset as SplatSource).opacities.length)),
        0
      ),
      shadowCoverageFloor: 0,
      refiningInstances: owners.filter(
        owner => this.assets.get(owner.asset)?.status?.phase === 'refining'
      ).length
    };
  }
  getPickingOwner(id: string, index: number): unknown {
    return this.owners.get(id)?.[index]?.object;
  }
  private acquireAsset(
    input: SplatDataInput,
    layer: SplatSceneLayer,
    active: number,
    resident: number,
    concurrency: number
  ): Asset {
    const budgetKey = `${active}/${resident}/${concurrency}`;
    let asset = this.assets.get(input);
    if (asset?.scene && asset.budgetKey !== budgetKey) {
      asset.scene.setBudget(
        Number.isFinite(active) ? Math.max(1, Math.floor(active)) : 2_000_000,
        Number.isFinite(resident) ? Math.max(1, Math.floor(resident)) : 8_000_000,
        concurrency
      );
      asset.budgetKey = budgetKey;
    }
    if (!asset) {
      asset = {id: this.nextAssetId++, users: this.getAssetUsers(input), budgetKey};
      this.assets.set(input, asset);
      if (isSplatSceneData(input)) {
        const target = asset;
        const data = typeof input === 'object' && 'url' in input ? input.url : input;
        const rad =
          typeof input === 'object' && 'url' in input
            ? input.type === 'rad'
            : typeof input === 'string'
              ? /\.rad(?:$|[?#])/i.test(input)
              : true;
        if (!rad) {
          const loading = loadStaticSplatSource(
            data,
            typeof input === 'object' && 'format' in input ? input.format : undefined,
            layer.props.workerFactory?.('static')
          );
          asset.destroyLoading = loading.destroy;
          target.status = {
            phase: 'loading',
            message: 'Decoding static Gaussian source off-thread…',
            activeSplats: 0,
            residentPages: 0,
            pendingPages: 1,
            sourceSplats: 0
          };
          for (const id of target.users) this.layers.get(id)?.props.onStatusChange?.(target.status);
          void loading.promise
            .then(source => {
              if (this.assets.get(input) !== target) return;
              target.destroyLoading = undefined;
              target.data = makeGPUSplatData(this.device, source);
              target.status = {
                phase: 'ready',
                message: 'Static source ready.',
                activeSplats: source.opacities.length,
                residentPages: 1,
                pendingPages: 0,
                sourceSplats: source.opacities.length
              };
              for (const id of target.users) {
                this.layers.get(id)?.props.onStatusChange?.(target.status);
                this.layers.get(id)?.setNeedsRedraw();
              }
            })
            .catch(error => {
              if (this.assets.get(input) !== target) return;
              target.status = {
                ...target.status!,
                phase: 'error',
                message: error instanceof Error ? error.message : String(error),
                pendingPages: 0
              };
              for (const id of target.users) {
                const user = this.layers.get(id);
                user?.props.onStatusChange?.(target.status);
                user?.raiseError(error, 'decoding splat asset');
              }
            });
        } else
          asset.scene = new RADScene(this.device, {
            data,
            worker: layer.props.workerFactory?.('rad'),
            maxActiveSplats: Number.isFinite(active) ? Math.max(1, Math.floor(active)) : 2_000_000,
            maxResidentSplats: Number.isFinite(resident)
              ? Math.max(1, Math.floor(resident))
              : 8_000_000,
            maxConcurrentLoads: concurrency,
            createRenderer: () => ({setProps() {}, setFrontier() {}, destroy() {}}),
            onChange: () => {
              for (const id of target.users) this.layers.get(id)?.setNeedsRedraw();
            },
            onStatus: status => {
              target.status = status;
              for (const id of target.users) this.layers.get(id)?.props.onStatusChange?.(status);
            },
            onError: error => {
              for (const id of target.users)
                this.layers.get(id)?.raiseError(error, 'loading splat asset');
            }
          });
      } else asset.data = makeGPUSplatData(this.device, input as SplatSource);
    }
    asset.users.add(layer.id);
    return asset;
  }
  private getAssetUsers(input: SplatDataInput): Set<string> {
    return new Set(
      [...this.owners]
        .filter(([, owners]) => owners.some(owner => owner.asset === input))
        .map(([id]) => id)
    );
  }
  private releaseUnusedAssets(): void {
    for (const [input, asset] of this.assets) {
      const users = this.getAssetUsers(input);
      if (asset.status)
        for (const id of users)
          if (!asset.users.has(id)) this.layers.get(id)?.props.onStatusChange?.(asset.status);
      asset.users = users;
      if (!asset.users.size) {
        asset.scene?.destroy();
        asset.destroyLoading?.();
        asset.data?.destroy();
        this.assets.delete(input);
      }
    }
  }
}

function isRADAsset(input: SplatDataInput): boolean {
  if (!isSplatSceneData(input)) return false;
  if (typeof input === 'object' && 'type' in input) return input.type === 'rad';
  return typeof input !== 'string' || /\.rad(?:$|[?#])/i.test(input);
}
