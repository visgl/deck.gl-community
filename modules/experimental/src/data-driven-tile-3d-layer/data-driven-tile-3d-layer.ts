// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Tile3DLayer, Tile3DLayerProps} from '@deck.gl/geo-layers';
import {UpdateParameters, Viewport, DefaultProps} from '@deck.gl/core';
import {TILE_TYPE, Tile3D, Tileset3D} from '@loaders.gl/tiles';
import {load} from '@loaders.gl/core';

const defaultProps: DefaultProps<DataDrivenTile3DLayerProps> = {
  colorsByAttribute: null,
  filtersByAttribute: null
};

type DataDrivenTile3DLayerProps<DataT = any> = _DataDrivenTile3DLayerProps &
  Tile3DLayerProps<DataT>;

type _DataDrivenTile3DLayerProps = {
  onTraversalComplete?: (selectedTiles: Tile3D[]) => Tile3D[];
  colorsByAttribute?: ColorsByAttribute | null;
  customizeColors?: (
    tile: Tile3D,
    colorsByAttribute: ColorsByAttribute | null
  ) => Promise<{isColored: boolean; id: string}>;
  filtersByAttribute?: FiltersByAttribute | null;
  filterTile?: (
    tile: Tile3D,
    filtersByAttribute: FiltersByAttribute | null
  ) => Promise<{isFiltered: boolean; id: string}>;
};

export type ColorsByAttribute = {
  /** Feature attribute name */
  attributeName: string;
  /** Minimum attribute value */
  minValue: number;
  /** Maximum attribute value */
  maxValue: number;
  /** Minimum color. 3DObject will be colorized with gradient from `minColor to `maxColor` */
  minColor: [number, number, number, number];
  /** Maximum color. 3DObject will be colorized with gradient from `minColor to `maxColor` */
  maxColor: [number, number, number, number];
  /** Colorization mode. `replace` - replace vertex colors with a new colors, `multiply` - multiply vertex colors with new colors */
  mode: string;
};

export type FiltersByAttribute = {
  /** Feature attribute name */
  attributeName: string;
  /** Filter value */
  value: number;
};

// @ts-expect-error call of private method of the base class
export class DataDrivenTile3DLayer<
  DataT = any,
  ExtraProps extends Record<string, unknown> = Record<string, unknown>
> extends Tile3DLayer<DataT, Required<_DataDrivenTile3DLayerProps> & ExtraProps> {
  static layerName = 'DataDrivenTile3DLayer';
  static defaultProps = defaultProps as any;

  state: {
    activeViewports: any;
    frameNumber?: number;
    lastUpdatedViewports: {[viewportId: string]: Viewport} | null;
    layerMap: {[layerId: string]: any};
    tileset3d: Tileset3D | null;

    colorsByAttribute: ColorsByAttribute | null;
    filtersByAttribute: FiltersByAttribute | null;
    loadingCounter: number;
  } = undefined!;

  initializeState() {
    super.initializeState();

    this.setState({
      colorsByAttribute: this.props.colorsByAttribute,
      filtersByAttribute: this.props.filtersByAttribute,
      loadingCounter: 0
    });
  }

  updateState(params: UpdateParameters<this>): void {
    const {props, oldProps, changeFlags} = params;

    if (props.data && props.data !== oldProps.data) {
      this._loadTileset(props.data);
    } else if (props.colorsByAttribute !== oldProps.colorsByAttribute) {
      this.setState({
        colorsByAttribute: props.colorsByAttribute
      });
      this._colorizeTileset();
    } else if (props.filtersByAttribute !== oldProps.filtersByAttribute) {
      this.setState({
        filtersByAttribute: props.filtersByAttribute
      });
      this._filterTileset();
    } else if (changeFlags.viewportChanged) {
      const {activeViewports} = this.state;
      const viewportsNumber = Object.keys(activeViewports).length;
      if (viewportsNumber) {
        if (!this.state.loadingCounter) {
          // @ts-expect-error call of private method of the base class
          super._updateTileset(activeViewports);
        }
        this.state.lastUpdatedViewports = activeViewports;
        this.state.activeViewports = {};
      }
    } else {
      super.updateState(params);
    }
  }

  private override async _loadTileset(tilesetUrl) {
    const {loadOptions = {}} = this.props;

    // TODO: deprecate `loader` in v9.0
    let loader: any = this.props.loader || this.props.loaders;
    if (Array.isArray(loader)) {
      loader = loader[0];
    }

    const options = {loadOptions: {...loadOptions}};
    if (loader.preload) {
      const preloadOptions = await loader.preload(tilesetUrl, loadOptions);

      if (preloadOptions.headers) {
        options.loadOptions.fetch = {
          ...options.loadOptions.fetch,
          headers: preloadOptions.headers
        };
      }
      Object.assign(options, preloadOptions);
    }
    const tilesetJson = await load(tilesetUrl, loader, options.loadOptions);

    const tileset3d = new Tileset3D(tilesetJson, {
      onTileLoad: this._onTileLoad.bind(this),
      // @ts-expect-error call of private method of the base class
      onTileUnload: super._onTileUnload.bind(this),
      onTileError: this.props.onTileError,
      // New code ------------------
      onTraversalComplete: this._onTraversalComplete.bind(this),
      // ---------------------------
      ...options
    });

    this.setState({
      tileset3d,
      layerMap: {}
    });

    // @ts-expect-error call of private method of the base class
    super._updateTileset(this.state.activeViewports);
    this.props.onTilesetLoad(tileset3d);
  }

  private override _onTileLoad(tileHeader: Tile3D): void {
    const {lastUpdatedViewports} = this.state;
    // New code ------------------
    this._colorizeTiles([tileHeader]);
    this._filterTiles([tileHeader]);
    // ---------------------------
    this.props.onTileLoad(tileHeader);
    // New code ------------------ condition is added
    if (!this.state.colorsByAttribute && !this.state.filtersByAttribute) {
      // ---------------------------
      // @ts-expect-error call of private method of the base class
      super._updateTileset(lastUpdatedViewports);
      this.setNeedsUpdate();
      // New code ------------------
    }
    // ------------------
  }

  private _onTraversalComplete(selectedTiles: Tile3D[]): Tile3D[] {
    this._colorizeTiles(selectedTiles);
    this._filterTiles(selectedTiles);
    return this.props.onTraversalComplete
      ? this.props.onTraversalComplete(selectedTiles)
      : selectedTiles;
  }

  private _colorizeTiles(tiles: Tile3D[]): void {
    if (this.props.customizeColors && tiles[0]?.type === TILE_TYPE.MESH) {
      const {layerMap, colorsByAttribute} = this.state;
      const promises: Promise<{isColored: boolean; id: string}>[] = [];
      for (const tile of tiles) {
        promises.push(this.props.customizeColors(tile, colorsByAttribute));
      }
      this.setState({
        loadingCounter: this.state.loadingCounter + 1
      });
      Promise.allSettled(promises).then((result) => {
        this.setState({
          loadingCounter: this.state.loadingCounter - 1
        });
        let isTileChanged = false;
        for (const item of result) {
          if (item.status === 'fulfilled' && item.value.isColored) {
            isTileChanged = true;
            delete layerMap[item.value.id];
          }
        }
        if (isTileChanged && !this.state.loadingCounter) {
          // @ts-expect-error call of private method of the base class
          super._updateTileset(this.state.activeViewports);
          this.setNeedsUpdate();
        }
      });
    }
  }

  private _colorizeTileset(): void {
    const {tileset3d} = this.state;

    if (tileset3d) {
      this._colorizeTiles(tileset3d.selectedTiles);
    }
  }

  private _filterTiles(tiles: Tile3D[]): void {
    if (this.props.filterTile && tiles[0]?.type === TILE_TYPE.MESH) {
      const {layerMap, filtersByAttribute} = this.state;
      const promises: Promise<{isFiltered: boolean; id: string}>[] = [];
      for (const tile of tiles) {
        promises.push(this.props.filterTile(tile, filtersByAttribute));
      }
      this.setState({
        loadingCounter: this.state.loadingCounter + 1
      });
      Promise.allSettled(promises).then((result) => {
        this.setState({
          loadingCounter: this.state.loadingCounter - 1
        });
        let isTileChanged = false;
        for (const item of result) {
          if (item.status === 'fulfilled' && item.value.isFiltered) {
            isTileChanged = true;
            delete layerMap[item.value.id];
          }
        }
        if (isTileChanged && !this.state.loadingCounter) {
          // @ts-expect-error call of private method of the base class
          super._updateTileset(this.state.activeViewports);
          this.setNeedsUpdate();
        }
      });
    }
  }

  private _filterTileset(): void {
    const {tileset3d} = this.state;

    if (tileset3d) {
      this._filterTiles(tileset3d.selectedTiles);
    }
  }
}
