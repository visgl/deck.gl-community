// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import type {UpdateParameters} from '@deck.gl/core';
import {project32} from '@deck.gl/core';
import {BitmapLayer} from '@deck.gl/layers';
import {ShaderAssembler} from '@luma.gl/shadertools';

import {fs} from './raster-layer.fs';
import {vs} from './raster-layer.vs';
import {loadImages} from '../images';
import type {RasterLayerAddedProps, ImageState} from '../types';
import {modulesEqual} from '../util';

export class RasterLayer extends BitmapLayer<RasterLayerAddedProps> {
  static layerName = 'RasterLayer';
  static defaultProps: any = {
    modules: {type: 'array', value: [], compare: true},
    images: {type: 'object', value: {}, compare: true},
    moduleProps: {type: 'object', value: {}, compare: true}
  };

  // @ts-expect-error TODO - align with deck.gl
  state: BitmapLayer<RasterLayerAddedProps>['state'] & {
    images: ImageState;
  };

  initializeState(): void {
    const shaderAssebler = ShaderAssembler.getDefaultShaderAssembler();

    const fsStr1 = 'fs:DECKGL_MUTATE_COLOR(inout vec4 image, in vec2 coord)';
    const fsStr2 = 'fs:DECKGL_CREATE_COLOR(inout vec4 image, in vec2 coord)';

    // Only initialize shader hook functions _once globally_
    // Since the program manager is shared across all layers, but many layers
    // might be created, this solves the performance issue of always adding new
    // hook functions. See #22
    // @ts-expect-error TODO fix
    if (!shaderAssebler._hookFunctions.includes(fsStr1)) {
      shaderAssebler.addShaderHook(fsStr1);
    }
    // @ts-expect-error TODO fix
    if (!shaderAssebler._hookFunctions.includes(fsStr2)) {
      shaderAssebler.addShaderHook(fsStr2);
    }

    // images is a mapping from keys to Texture objects. The keys should match
    // names of uniforms in shader modules
    this.setState({images: {}});

    super.initializeState();
  }

  draw({uniforms}: {uniforms: {[key: string]: any}}): void {
    const {model, images, coordinateConversion, bounds} = this.state;

    // Render the image
    if (
      !model ||
      !images ||
      Object.keys(images).length === 0 ||
      !Object.values(images).every((item) => item)
    ) {
      return;
    }

    const {desaturate, moduleProps} = this.props;
    // @ts-ignore TODO fix
    const transparentColor = this.props.transparentColor?.map((x) => (x ? x / 255 : 0)) as number[];
    const tintColor = this.props.tintColor?.slice(0, 3).map((x) => x / 255);

    // TODO: port to UBOs
    model.setUniforms({
      ...uniforms,
      desaturate,
      transparentColor,
      tintColor,
      coordinateConversion,
      bounds
    });
    model.updateModuleSettingsWebGL({
      ...moduleProps,
      ...images
    });
    model.draw(this.context.renderPass);
  }

  // Typed as any upstream
  // https://github.com/visgl/deck.gl/blob/3ffdc5ef90ccf3d5699186f02c8807caadf70e3a/modules/core/src/lib/layer.ts#L440
  getShaders() {
    // const {device} = this.context;
    const {modules = []} = this.props;
    return {...super.getShaders(), vs, fs, modules: [project32, ...modules]};
  }

  // eslint-disable-next-line complexity
  updateState(params: UpdateParameters<BitmapLayer<RasterLayerAddedProps>>): void {
    const {props, oldProps, changeFlags} = params;
    const modules = props && props.modules;
    const oldModules = oldProps && oldProps.modules;

    // setup model first
    // If the list of modules changed, need to recompile the shaders
    if (changeFlags.extensionsChanged || !modulesEqual(modules, oldModules)) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()?.invalidateAll();
    }

    if (props && props.images) {
      this.updateImages({props, oldProps});
    }

    const attributeManager = this.getAttributeManager();

    if (props.bounds !== oldProps.bounds) {
      const oldMesh = this.state.mesh;
      const mesh = this._createMesh();
      this.state.model?.setVertexCount(mesh.vertexCount);
      for (const key in mesh) {
        if (oldMesh && oldMesh[key] !== mesh[key]) {
          attributeManager?.invalidate(key);
        }
      }
      this.setState({mesh, ...this._getCoordinateUniforms()});
    } else if (props._imageCoordinateSystem !== oldProps._imageCoordinateSystem) {
      this.setState(this._getCoordinateUniforms());
    }
  }

  updateImages({
    props,
    oldProps
  }: {
    props: RasterLayerAddedProps;
    oldProps: RasterLayerAddedProps;
  }): void {
    const {images} = this.state;
    const {device} = this.context;

    const newImages = loadImages({
      device,
      images,
      imagesData: props.images,
      oldImagesData: oldProps.images
    });
    if (newImages) {
      this.setState({images: newImages});
    }
  }

  finalizeState(): void {
    super.finalizeState(this.context);

    if (this.state.images) {
      for (const image of Object.values(this.state.images)) {
        if (Array.isArray(image)) {
          image.map((x) => x && x.delete());
        } else {
          // eslint-disable-next-line no-unused-expressions
          image && image.delete();
        }
      }
    }
  }
}
