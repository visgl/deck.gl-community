// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

import type {UpdateParameters} from '@deck.gl/core';
import {project32, phongLighting, log} from '@deck.gl/core';
import type {SimpleMeshLayerProps} from '@deck.gl/mesh-layers';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {Model, Geometry} from '@luma.gl/engine';
import {ShaderAssembler} from '@luma.gl/shadertools';
// import {UniformsOptions} from '@luma.gl/webgl/src/classes/uniforms';

import {shouldComposeModelMatrix} from './matrix';
import {fs} from './raster-mesh-layer.fs';
import {vs} from './raster-mesh-layer.vs';
import {loadImages} from '../images';
import type {RasterLayerAddedProps, ImageState} from '../types';
import {modulesEqual} from '../util';

type UniformsOptions = Record<string, any>;

type Mesh = SimpleMeshLayerProps['mesh'];

function validateGeometryAttributes(attributes) {
  log.assert(
    attributes.positions || attributes.POSITION,
    'RasterMeshLayer requires "postions" or "POSITION" attribute in mesh property.'
  );
}

/*
 * Convert mesh data into geometry
 * @returns {Geometry} geometry
 */
function getGeometry(data) {
  if (data.attributes) {
    validateGeometryAttributes(data.attributes);
    if (data instanceof Geometry) {
      return data;
    }
    return new Geometry(data);
  } else if (data.positions || data.POSITION) {
    validateGeometryAttributes(data);
    return new Geometry({
      topology: 'triangle-list',
      attributes: data
    });
  }
  throw Error('Invalid mesh');
}

export class RasterMeshLayer extends SimpleMeshLayer<any, RasterLayerAddedProps> {
  static layerName = 'RasterMeshLayer';
  static defaultProps = {
    ...SimpleMeshLayer.defaultProps,
    modules: {type: 'array', value: [], compare: true},
    images: {type: 'object', value: {}, compare: true},
    moduleProps: {type: 'object', value: {}, compare: true}
  };

  // @ts-expect-error TODO align with deck.gl
  state: SimpleMeshLayer<RasterLayerAddedProps>['state'] & {
    images: ImageState;
  };

  initializeState(): void {
    const shaderAssembler = ShaderAssembler.getDefaultShaderAssembler();

    const fsStr1 = 'fs:DECKGL_MUTATE_COLOR(inout vec4 image, in vec2 coord)';
    const fsStr2 = 'fs:DECKGL_CREATE_COLOR(inout vec4 image, in vec2 coord)';

    // Only initialize shader hook functions _once globally_
    // Since the program manager is shared across all layers, but many layers
    // might be created, this solves the performance issue of always adding new
    // hook functions. See #22
    // @ts-expect-error TODO align with deck.gl
    if (!shaderAssembler._hookFunctions.includes(fsStr1)) {
      shaderAssembler.addShaderHook(fsStr1);
    }
    // @ts-expect-error TODO align with deck.gl
    if (!shaderAssembler._hookFunctions.includes(fsStr2)) {
      shaderAssembler.addShaderHook(fsStr2);
    }

    // images is a mapping from keys to Texture objects. The keys should match
    // names of uniforms in shader modules
    this.setState({images: {}});

    super.initializeState();
  }

  getShaders(): any {
    const {modules = []} = this.props;

    return {
      ...super.getShaders(),
      vs,
      fs,
      modules: [project32, phongLighting, ...modules]
    };
  }

  // eslint-disable-next-line complexity
  updateState(params: UpdateParameters<SimpleMeshLayer<any, RasterLayerAddedProps>>): void {
    const {props, oldProps, changeFlags, context} = params;
    super.updateState({props, oldProps, changeFlags, context});

    const modules = props && props.modules;
    const oldModules = oldProps && oldProps.modules;

    // If the list of modules changed, need to recompile the shaders
    if (
      props.mesh !== oldProps.mesh ||
      changeFlags.extensionsChanged ||
      !modulesEqual(modules, oldModules)
    ) {
      if (this.state.model) {
        this.state.model.destroy();
      }
      if (props.mesh) {
        this.state.model = this.getModel(props.mesh);

        // Typed as any along with upstream:
        // https://github.com/visgl/deck.gl/blob/3ffdc5ef90ccf3d5699186f02c8807caadf70e3a/modules/mesh-layers/src/simple-mesh-layer/simple-mesh-layer.ts#LL269
        const attributes = (props.mesh as any).attributes || props.mesh;
        this.setState({
          hasNormals: Boolean(attributes.NORMAL || attributes.normals)
        });
      }
      this.getAttributeManager()?.invalidateAll();
    }

    if (props && props.images) {
      this.updateImages({props, oldProps});
    }

    if (this.state.model) {
      this.state.model.setTopology(this.props.wireframe ? 'line-strip' : 'triangle-list');
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

  draw({uniforms}: UniformsOptions): void {
    const {model, images} = this.state;
    const {moduleProps} = this.props;

    // Render the image
    if (
      !model ||
      !images ||
      Object.keys(images).length === 0 ||
      !Object.values(images).every((item) => item)
    ) {
      return;
    }

    const {viewport} = this.context;
    const {sizeScale, coordinateSystem, _instanced} = this.props;

    model.setUniforms(
      Object.assign({}, uniforms, {
        sizeScale,
        composeModelMatrix: !_instanced || shouldComposeModelMatrix(viewport, coordinateSystem),
        flatShading: !this.state.hasNormals
      })
    );
    model.updateModuleSettings({
      ...moduleProps,
      ...images
    });
    model.draw(this.context.renderPass);
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

  protected getModel(mesh: Mesh): Model {
    const {device} = this.context;

    const model = new Model(
      device,
      Object.assign({}, this.getShaders(), {
        id: this.props.id,
        geometry: getGeometry(mesh),
        isInstanced: true
      })
    );

    return model;
  }
}
