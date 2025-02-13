var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// dist/index.js
var dist_exports = {};
__export(dist_exports, {
  RasterLayer: () => RasterLayer,
  RasterMeshLayer: () => RasterMeshLayer,
  colormap: () => colormap,
  combineBandsFloat: () => combineBandsFloat,
  combineBandsInt: () => combineBandsInt,
  combineBandsUint: () => combineBandsUint,
  enhancedVegetationIndex: () => enhancedVegetationIndex,
  filter: () => filter,
  gammaContrast: () => gammaContrast,
  linearRescale: () => linearRescale,
  maskFloat: () => maskFloat,
  maskInt: () => maskInt,
  maskUint: () => maskUint,
  modifiedSoilAdjustedVegetationIndex: () => modifiedSoilAdjustedVegetationIndex,
  normalizedDifference: () => normalizedDifference,
  pansharpenBrovey: () => pansharpenBrovey,
  reorderBands: () => reorderBands,
  rgbaImage: () => rgbaImage,
  saturation: () => saturation,
  sigmoidalContrast: () => sigmoidalContrast,
  soilAdjustedVegetationIndex: () => soilAdjustedVegetationIndex
});
module.exports = __toCommonJS(dist_exports);

// dist/layers/raster-layer/raster-layer.js
var import_core2 = require("@deck.gl/core");
var import_layers = require("@deck.gl/layers");
var import_shadertools = require("@luma.gl/shadertools");

// dist/layers/raster-layer/raster-layer.fs.js
var fs = (
  /* glsl */
  `#version 300 es
#define SHADER_NAME raster-layer-fragment-shader

// Ref https://www.khronos.org/registry/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf#page=60
precision mediump float;
precision mediump int;
precision mediump usampler2D;

in vec2 vTexCoord;
in vec2 vTexPos;

out vec4 color;

uniform float desaturate;
uniform vec4 transparentColor;
uniform vec3 tintColor;
uniform float opacity;

uniform float coordinateConversion;
uniform vec4 bounds;

/* projection utils */
const float TILE_SIZE = 512.0;
const float PI = 3.1415926536;
const float WORLD_SCALE = TILE_SIZE / PI / 2.0;

// from degrees to Web Mercator
vec2 lnglat_to_mercator(vec2 lnglat) {
  float x = lnglat.x;
  float y = clamp(lnglat.y, -89.9, 89.9);
  return vec2(
    radians(x) + PI,
    PI + log(tan(PI * 0.25 + radians(y) * 0.5))
  ) * WORLD_SCALE;
}

// from Web Mercator to degrees
vec2 mercator_to_lnglat(vec2 xy) {
  xy /= WORLD_SCALE;
  return degrees(vec2(
    xy.x - PI,
    atan(exp(xy.y - PI)) * 2.0 - PI * 0.5
  ));
}
/* End projection utils */

// apply desaturation
vec3 color_desaturate(vec3 color) {
  float luminance = (color.r + color.g + color.b) * 0.333333333;
  return mix(color, vec3(luminance), desaturate);
}

// apply tint
vec3 color_tint(vec3 color) {
  return color * tintColor;
}

// blend with background color
vec4 apply_opacity(vec3 color, float alpha) {
  if (transparentColor.a == 0.0) {
    return vec4(color, alpha);
  }
  float blendedAlpha = alpha + transparentColor.a * (1.0 - alpha);
  float highLightRatio = alpha / blendedAlpha;
  vec3 blendedRGB = mix(transparentColor.rgb, color, highLightRatio);
  return vec4(blendedRGB, blendedAlpha);
}

vec2 getUV(vec2 pos) {
  return vec2(
    (pos.x - bounds[0]) / (bounds[2] - bounds[0]),
    (pos.y - bounds[3]) / (bounds[1] - bounds[3])
  );
}

void main(void) {
  vec2 uv = vTexCoord;
  if (coordinateConversion < -0.5) {
    vec2 lnglat = mercator_to_lnglat(vTexPos);
    uv = getUV(lnglat);
  } else if (coordinateConversion > 0.5) {
    vec2 commonPos = lnglat_to_mercator(vTexPos);
    uv = getUV(commonPos);
  }

  vec4 image;
  DECKGL_CREATE_COLOR(image, vTexCoord);

  DECKGL_MUTATE_COLOR(image, vTexCoord);

  color = apply_opacity(color_tint(color_desaturate(image.rgb)), opacity);

  geometry.uv = uv;
  DECKGL_FILTER_COLOR(color, geometry);
}
`
);

// dist/layers/raster-layer/raster-layer.vs.js
var vs = (
  /* glsl */
  `#version 300 es
#define SHADER_NAME raster-layer-vertex-shader

precision mediump float;

in vec2 texCoords;
in vec3 positions;
in vec3 positions64Low;

out vec2 vTexCoord;
out vec2 vTexPos;

uniform float coordinateConversion;

const vec3 pickingColor = vec3(1.0, 0.0, 0.0);

void main(void) {
  geometry.worldPosition = positions;
  geometry.uv = texCoords;
  geometry.pickingColor = pickingColor;

  gl_Position = project_position_to_clipspace(positions, positions64Low, vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  vTexCoord = texCoords;

  if (coordinateConversion < -0.5) {
    vTexPos = geometry.position.xy;
  } else if (coordinateConversion > 0.5) {
    vTexPos = geometry.worldPosition.xy;
  }

  vec4 color = vec4(0.0);
  DECKGL_FILTER_COLOR(color, geometry);
}
`
);

// dist/layers/images.js
var import_core = require("@luma.gl/core");
var import_lodash = __toESM(require("lodash.isequal"));
var DEFAULT_UNIVERSAL_SAMPLER_PROPS = {
  minFilter: "nearest",
  magFilter: "nearest",
  addressModeU: "clamp-to-edge",
  addressModeV: "clamp-to-edge"
};
function loadImages({ device, images, imagesData, oldImagesData }) {
  let imagesDirty = false;
  if (oldImagesData) {
    for (const key in oldImagesData) {
      if (imagesData && !(key in imagesData) && key in images) {
        delete images[key];
        imagesDirty = true;
      }
    }
  }
  const changedKeys = [];
  for (const key in imagesData) {
    if (!oldImagesData || oldImagesData && !(key in oldImagesData)) {
      changedKeys.push(key);
      continue;
    }
    if (!(0, import_lodash.default)(imagesData[key], oldImagesData[key])) {
      changedKeys.push(key);
    }
  }
  for (const key of changedKeys) {
    const imageData = imagesData[key];
    if (!imageData) {
      continue;
    }
    const loadedItem = loadImageItem(device, imageData);
    if (loadedItem) {
      images[key] = loadedItem;
    }
    imagesDirty = true;
  }
  if (imagesDirty) {
    return images;
  }
  return null;
}
function loadImageItem(device, imageItem) {
  let result;
  if (Array.isArray(imageItem)) {
    const dirtyResult = imageItem.map((x) => loadTexture(device, x));
    result = [];
    for (const texture of dirtyResult) {
      if (texture) {
        result.push(texture);
      }
    }
    if (!result.length) {
      result = null;
    }
  } else {
    result = loadTexture(device, imageItem);
  }
  return result;
}
function loadTexture(device, imageProps) {
  if (!imageProps) {
    return null;
  }
  if (imageProps instanceof import_core.Texture) {
    return imageProps;
  }
  return device.createTexture({
    ...imageProps,
    sampler: DEFAULT_UNIVERSAL_SAMPLER_PROPS
  });
}

// dist/layers/util.js
function modulesEqual(modules, oldModules) {
  if (modules.length !== oldModules.length) {
    return false;
  }
  for (let i = 0; i < modules.length; i++) {
    if (modules[i].name !== oldModules[i].name) {
      return false;
    }
  }
  return true;
}

// dist/layers/raster-layer/raster-layer.js
var RasterLayer = class extends import_layers.BitmapLayer {
  // @ts-expect-error TODO - align with deck.gl
  state;
  initializeState() {
    const shaderAssebler = import_shadertools.ShaderAssembler.getDefaultShaderAssembler();
    const fsStr1 = "fs:DECKGL_MUTATE_COLOR(inout vec4 image, in vec2 coord)";
    const fsStr2 = "fs:DECKGL_CREATE_COLOR(inout vec4 image, in vec2 coord)";
    if (!shaderAssebler._hookFunctions.includes(fsStr1)) {
      shaderAssebler.addShaderHook(fsStr1);
    }
    if (!shaderAssebler._hookFunctions.includes(fsStr2)) {
      shaderAssebler.addShaderHook(fsStr2);
    }
    this.setState({ images: {} });
    super.initializeState();
  }
  draw({ uniforms }) {
    var _a, _b;
    const { model, images, coordinateConversion, bounds } = this.state;
    if (!model || !images || Object.keys(images).length === 0 || !Object.values(images).every((item) => item)) {
      return;
    }
    const { desaturate, moduleProps } = this.props;
    const transparentColor = (_a = this.props.transparentColor) == null ? void 0 : _a.map((x) => x ? x / 255 : 0);
    const tintColor = (_b = this.props.tintColor) == null ? void 0 : _b.slice(0, 3).map((x) => x / 255);
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
    const { modules = [] } = this.props;
    return { ...super.getShaders(), vs, fs, modules: [import_core2.project32, ...modules] };
  }
  // eslint-disable-next-line complexity
  updateState(params) {
    var _a, _b, _c;
    const { props, oldProps, changeFlags } = params;
    const modules = props && props.modules;
    const oldModules = oldProps && oldProps.modules;
    if (changeFlags.extensionsChanged || !modulesEqual(modules, oldModules)) {
      (_a = this.state.model) == null ? void 0 : _a.destroy();
      this.state.model = this._getModel();
      (_b = this.getAttributeManager()) == null ? void 0 : _b.invalidateAll();
    }
    if (props && props.images) {
      this.updateImages({ props, oldProps });
    }
    const attributeManager = this.getAttributeManager();
    if (props.bounds !== oldProps.bounds) {
      const oldMesh = this.state.mesh;
      const mesh = this._createMesh();
      (_c = this.state.model) == null ? void 0 : _c.setVertexCount(mesh.vertexCount);
      for (const key in mesh) {
        if (oldMesh && oldMesh[key] !== mesh[key]) {
          attributeManager == null ? void 0 : attributeManager.invalidate(key);
        }
      }
      this.setState({ mesh, ...this._getCoordinateUniforms() });
    } else if (props._imageCoordinateSystem !== oldProps._imageCoordinateSystem) {
      this.setState(this._getCoordinateUniforms());
    }
  }
  updateImages({ props, oldProps }) {
    const { images } = this.state;
    const { device } = this.context;
    const newImages = loadImages({
      device,
      images,
      imagesData: props.images,
      oldImagesData: oldProps.images
    });
    if (newImages) {
      this.setState({ images: newImages });
    }
  }
  finalizeState() {
    super.finalizeState(this.context);
    if (this.state.images) {
      for (const image of Object.values(this.state.images)) {
        if (Array.isArray(image)) {
          image.map((x) => x && x.delete());
        } else {
          image && image.delete();
        }
      }
    }
  }
};
__publicField(RasterLayer, "layerName", "RasterLayer");
__publicField(RasterLayer, "defaultProps", {
  modules: { type: "array", value: [], compare: true },
  images: { type: "object", value: {}, compare: true },
  moduleProps: { type: "object", value: {}, compare: true }
});

// dist/layers/raster-mesh-layer/raster-mesh-layer.js
var import_core4 = require("@deck.gl/core");
var import_mesh_layers = require("@deck.gl/mesh-layers");
var import_engine = require("@luma.gl/engine");
var import_shadertools2 = require("@luma.gl/shadertools");

// dist/layers/raster-mesh-layer/matrix.js
var import_core3 = require("@deck.gl/core");
function shouldComposeModelMatrix(viewport, coordinateSystem) {
  return coordinateSystem === import_core3.COORDINATE_SYSTEM.CARTESIAN || coordinateSystem === import_core3.COORDINATE_SYSTEM.METER_OFFSETS || coordinateSystem === import_core3.COORDINATE_SYSTEM.DEFAULT && !viewport.isGeospatial;
}

// dist/layers/raster-mesh-layer/raster-mesh-layer.fs.js
var fs2 = (
  /* glsl */
  `#version 300 es
#define SHADER_NAME raster-mesh-layer-fs

precision highp float;

uniform bool hasTexture;

uniform bool flatShading;
uniform float opacity;

in vec2 vTexCoord;
in vec3 cameraPosition;
in vec3 normals_commonspace;
in vec4 position_commonspace;
in vec4 vColor;

out vec4 fragColor;

void main(void) {
  geometry.uv = vTexCoord;
  vec4 image;
  DECKGL_CREATE_COLOR(image, vTexCoord);

  DECKGL_MUTATE_COLOR(image, vTexCoord);

  vec3 normal;
  if (flatShading) {

// NOTE(Tarek): This is necessary because
// headless.gl reports the extension as
// available but does not support it in
// the shader.
#ifdef DERIVATIVES_AVAILABLE
    normal = normalize(cross(dFdx(position_commonspace.xyz), dFdy(position_commonspace.xyz)));
#else
    normal = vec3(0.0, 0.0, 1.0);
#endif
  } else {
    normal = normals_commonspace;
  }

  vec3 lightColor = lighting_getLightColor(image.rgb, cameraPosition, position_commonspace.xyz, normal);
  fragColor = vec4(lightColor, opacity);

  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
);

// dist/layers/raster-mesh-layer/raster-mesh-layer.vs.js
var vs2 = (
  /* glsl */
  `#version 300 es
#define SHADER_NAME raster-mesh-layer-vs

// Scale the model
uniform float sizeScale;
uniform bool composeModelMatrix;

// Primitive attributes
in vec3 positions;
in vec3 normals;
in vec3 colors;
in vec2 texCoords;

// Instance attributes
in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec4 instanceColors;
in vec3 instancePickingColors;
in mat3 instanceModelMatrix;
in vec3 instanceTranslation;

// Outputs to fragment shader
out vec2 vTexCoord;
out vec3 cameraPosition;
out vec3 normals_commonspace;
out vec4 position_commonspace;
out vec4 vColor;

void main(void) {
  geometry.worldPosition = instancePositions;
  geometry.uv = texCoords;
  geometry.pickingColor = instancePickingColors;

  vTexCoord = texCoords;
  cameraPosition = project_uCameraPosition;
  normals_commonspace = project_normal(instanceModelMatrix * normals);
  vColor = vec4(colors * instanceColors.rgb, instanceColors.a);
  geometry.normal = normals_commonspace;

  vec3 pos = (instanceModelMatrix * positions) * sizeScale + instanceTranslation;

  if (composeModelMatrix) {
    DECKGL_FILTER_SIZE(pos, geometry);
    gl_Position = project_position_to_clipspace(pos + instancePositions, instancePositions64Low, vec3(0.0), position_commonspace);
  }
  else {
    pos = project_size(pos);
    DECKGL_FILTER_SIZE(pos, geometry);
    gl_Position = project_position_to_clipspace(instancePositions, instancePositions64Low, pos, position_commonspace);
  }

  geometry.position = position_commonspace;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  DECKGL_FILTER_COLOR(vColor, geometry);
}
`
);

// dist/layers/raster-mesh-layer/raster-mesh-layer.js
function validateGeometryAttributes(attributes) {
  import_core4.log.assert(attributes.positions || attributes.POSITION, 'RasterMeshLayer requires "postions" or "POSITION" attribute in mesh property.');
}
function getGeometry(data) {
  if (data.attributes) {
    validateGeometryAttributes(data.attributes);
    if (data instanceof import_engine.Geometry) {
      return data;
    }
    return new import_engine.Geometry(data);
  } else if (data.positions || data.POSITION) {
    validateGeometryAttributes(data);
    return new import_engine.Geometry({
      topology: "triangle-list",
      attributes: data
    });
  }
  throw Error("Invalid mesh");
}
var RasterMeshLayer = class extends import_mesh_layers.SimpleMeshLayer {
  // @ts-expect-error TODO align with deck.gl
  state;
  initializeState() {
    const shaderAssembler = import_shadertools2.ShaderAssembler.getDefaultShaderAssembler();
    const fsStr1 = "fs:DECKGL_MUTATE_COLOR(inout vec4 image, in vec2 coord)";
    const fsStr2 = "fs:DECKGL_CREATE_COLOR(inout vec4 image, in vec2 coord)";
    if (!shaderAssembler._hookFunctions.includes(fsStr1)) {
      shaderAssembler.addShaderHook(fsStr1);
    }
    if (!shaderAssembler._hookFunctions.includes(fsStr2)) {
      shaderAssembler.addShaderHook(fsStr2);
    }
    this.setState({ images: {} });
    super.initializeState();
  }
  getShaders() {
    const { modules = [] } = this.props;
    return {
      ...super.getShaders(),
      vs: vs2,
      fs: fs2,
      modules: [import_core4.project32, import_core4.phongLighting, ...modules]
    };
  }
  // eslint-disable-next-line complexity
  updateState(params) {
    var _a;
    const { props, oldProps, changeFlags, context } = params;
    super.updateState({ props, oldProps, changeFlags, context });
    const modules = props && props.modules;
    const oldModules = oldProps && oldProps.modules;
    if (props.mesh !== oldProps.mesh || changeFlags.extensionsChanged || !modulesEqual(modules, oldModules)) {
      if (this.state.model) {
        this.state.model.destroy();
      }
      if (props.mesh) {
        this.state.model = this.getModel(props.mesh);
        const attributes = props.mesh.attributes || props.mesh;
        this.setState({
          hasNormals: Boolean(attributes.NORMAL || attributes.normals)
        });
      }
      (_a = this.getAttributeManager()) == null ? void 0 : _a.invalidateAll();
    }
    if (props && props.images) {
      this.updateImages({ props, oldProps });
    }
    if (this.state.model) {
      this.state.model.setTopology(this.props.wireframe ? "line-strip" : "triangle-list");
    }
  }
  updateImages({ props, oldProps }) {
    const { images } = this.state;
    const { device } = this.context;
    const newImages = loadImages({
      device,
      images,
      imagesData: props.images,
      oldImagesData: oldProps.images
    });
    if (newImages) {
      this.setState({ images: newImages });
    }
  }
  draw({ uniforms }) {
    const { model, images } = this.state;
    const { moduleProps } = this.props;
    if (!model || !images || Object.keys(images).length === 0 || !Object.values(images).every((item) => item)) {
      return;
    }
    const { viewport } = this.context;
    const { sizeScale, coordinateSystem, _instanced } = this.props;
    model.setUniforms(Object.assign({}, uniforms, {
      sizeScale,
      composeModelMatrix: !_instanced || shouldComposeModelMatrix(viewport, coordinateSystem),
      flatShading: !this.state.hasNormals
    }));
    model.updateModuleSettingsWebGL({
      ...moduleProps,
      ...images
    });
    model.draw(this.context.renderPass);
  }
  finalizeState() {
    super.finalizeState(this.context);
    if (this.state.images) {
      for (const image of Object.values(this.state.images)) {
        if (Array.isArray(image)) {
          image.map((x) => x && x.delete());
        } else {
          image && image.delete();
        }
      }
    }
  }
  getModel(mesh) {
    const { device } = this.context;
    const model = new import_engine.Model(device, Object.assign({}, this.getShaders(), {
      id: this.props.id,
      geometry: getGeometry(mesh),
      isInstanced: true
    }));
    return model;
  }
};
__publicField(RasterMeshLayer, "layerName", "RasterMeshLayer");
__publicField(RasterMeshLayer, "defaultProps", {
  modules: { type: "array", value: [], compare: true },
  images: { type: "object", value: {}, compare: true },
  moduleProps: { type: "object", value: {}, compare: true }
});

// dist/shadermodules/texture/combine-bands.js
function getUniforms(opts = {}) {
  const { imageBands } = opts;
  if (!imageBands || imageBands.length === 0) {
    return null;
  }
  const [bitmapTextureR, bitmapTextureG, bitmapTextureB, bitmapTextureA] = imageBands;
  return {
    bitmapTextureR,
    bitmapTextureG,
    bitmapTextureB,
    bitmapTextureA
  };
}
var fs3 = (
  /* glsl */
  `precision mediump float;
precision mediump int;
precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTextureR;
  uniform SAMPLER_TYPE bitmapTextureG;
  uniform SAMPLER_TYPE bitmapTextureB;
  uniform SAMPLER_TYPE bitmapTextureA;
#else
  uniform sampler2D bitmapTextureR;
  uniform sampler2D bitmapTextureG;
  uniform sampler2D bitmapTextureB;
  uniform sampler2D bitmapTextureA;
#endif
`
);
var combineBands = {
  name: "combine-bands",
  fs: fs3,
  getUniforms,
  defines: {
    SAMPLER_TYPE: "sampler2D"
  },
  inject: {
    "fs:DECKGL_CREATE_COLOR": `
    float channel1 = float(texture2D(bitmapTextureR, coord).r);
    float channel2 = float(texture2D(bitmapTextureG, coord).r);
    float channel3 = float(texture2D(bitmapTextureB, coord).r);
    float channel4 = float(texture2D(bitmapTextureA, coord).r);

    image = vec4(channel1, channel2, channel3, channel4);
    `
  }
};
var combineBandsFloat = {
  ...combineBands,
  name: "combine-bands-float"
};
var combineBandsUint = {
  ...combineBands,
  name: "combine-bands-uint",
  defines: {
    SAMPLER_TYPE: "usampler2D"
  }
};
var combineBandsInt = {
  ...combineBands,
  name: "combine-bands-int",
  defines: {
    SAMPLER_TYPE: "isampler2D"
  }
};

// dist/shadermodules/texture/rgba-image.js
function getUniforms2(opts = {}) {
  const { imageRgba } = opts;
  if (!imageRgba) {
    return null;
  }
  return {
    bitmapTextureRgba: imageRgba
  };
}
var fs4 = (
  /* glsl */
  `precision mediump float;
precision mediump int;
precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTextureRgba;
#else
  uniform sampler2D bitmapTextureRgba;
#endif
`
);
var rgbaImage = {
  name: "rgba-image",
  fs: fs4,
  getUniforms: getUniforms2,
  defines: {
    SAMPLER_TYPE: "sampler2D"
  },
  inject: {
    "fs:DECKGL_CREATE_COLOR": `
    image = vec4(texture2D(bitmapTextureRgba, coord));
    `
  }
};

// dist/shadermodules/texture/mask.js
var inf = Math.pow(2, 62);
function getUniforms3(opts = {}) {
  const { imageMask, maskKeepMin, maskKeepMax } = opts;
  if (!imageMask) {
    return null;
  }
  return {
    bitmapTextureMask: imageMask,
    uMaskKeepMin: Number.isFinite(maskKeepMin) ? maskKeepMin : -inf,
    uMaskKeepMax: Number.isFinite(maskKeepMax) ? maskKeepMax : inf
  };
}
var fs5 = (
  /* glsl */
  `precision mediump float;
precision mediump int;
precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTextureMask;
#else
  uniform sampler2D bitmapTextureMask;
#endif

uniform float uMaskKeepMin;
uniform float uMaskKeepMax;
`
);
var mask = {
  name: "mask-image",
  fs: fs5,
  getUniforms: getUniforms3,
  defines: {
    SAMPLER_TYPE: "sampler2D"
  },
  inject: {
    "fs:DECKGL_CREATE_COLOR": `
    float mask_value = float(texture2D(bitmapTextureMask, coord).r);
    if (mask_value < uMaskKeepMin) discard;
    if (mask_value > uMaskKeepMax) discard;
    `
  }
};
var maskFloat = {
  ...mask,
  name: "mask-image-float"
};
var maskUint = {
  ...mask,
  name: "mask-image-uint",
  defines: {
    SAMPLER_TYPE: "usampler2D"
  }
};
var maskInt = {
  ...mask,
  name: "mask-image-int",
  defines: {
    SAMPLER_TYPE: "isampler2D"
  }
};

// dist/shadermodules/texture/reorder-bands.js
var fs6 = (
  /* glsl */
  `uniform mat4 uReorder;

vec4 reorder_image(vec4 image, mat4 ordering) {
  return image.rgba * ordering;
}
`
);
function getUniforms4(opts = {}) {
  const { ordering } = opts;
  if (!ordering) {
    return null;
  }
  return {
    uReorder: constructPermutationMatrix(ordering)
  };
}
function constructPermutationMatrix(vector) {
  const mat4 = Array(16).fill(0);
  let row = 0;
  for (const index of vector) {
    mat4[row * 4 + index] = 1;
    row += 1;
  }
  for (let r = row; r < 4; r++) {
    mat4[r * 4 + r] = 1;
  }
  return mat4;
}
var reorderBands = {
  name: "reorder-bands",
  fs: fs6,
  getUniforms: getUniforms4,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = reorder_image(image, uReorder);
    `
  }
};

// dist/shadermodules/color/colormap.js
var fs7 = (
  /* glsl */
  `uniform sampler2D uColormapTexture;
uniform int uHasCategoricalColors;
uniform int uCategoricalMinValue;
uniform int uCategoricalMaxValue;
uniform int uMaxPixelValue;

// Apply colormap texture given value
// Since the texture only varies in the x direction, setting v to 0.5 as a
// constant is fine
// Assumes the input range of value is -1 to 1
vec4 colormap(sampler2D cmap, vec4 image) {
  vec2 uv;
  if (uHasCategoricalColors == 1) {
    float step = float(uMaxPixelValue) / float(uCategoricalMaxValue - uCategoricalMinValue);
    uv = vec2(image.r * step, 0.5);
  } else {
    uv = vec2(0.5 * image.r + 0.5, 0.5);
  }
  vec4 color = texture2D(cmap, uv);
  if(color.a <= 0.0) discard;
  return color;
}
`
);
function getUniforms5(opts = {}) {
  const { imageColormap, minCategoricalBandValue, maxCategoricalBandValue, dataTypeMaxValue, maxPixelValue } = opts;
  if (!imageColormap) {
    return null;
  }
  const isSupportedDataType = Number.isFinite(dataTypeMaxValue);
  const isCategorical = isSupportedDataType && Number.isFinite(maxPixelValue) && Number.isFinite(minCategoricalBandValue) && Number.isFinite(maxCategoricalBandValue);
  return {
    uColormapTexture: imageColormap,
    uHasCategoricalColors: isCategorical ? 1 : 0,
    uCategoricalMinValue: Number.isFinite(minCategoricalBandValue) ? minCategoricalBandValue : 0,
    uCategoricalMaxValue: Number.isFinite(maxCategoricalBandValue) ? maxCategoricalBandValue : 0,
    uMaxPixelValue: Number.isFinite(maxPixelValue) ? maxPixelValue : 0
  };
}
var colormap = {
  name: "colormap",
  fs: fs7,
  getUniforms: getUniforms5,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = colormap(uColormapTexture, image);
    `
  }
};

// dist/shadermodules/color/linear-rescale.js
var fs8 = (
  /* glsl */
  `uniform float linearRescaleScaler;
uniform float linearRescaleOffset;

// Perform a linear rescaling of image
vec4 linear_rescale(vec4 arr, float scaler, float offset) {
  return arr * scaler + offset;
}
`
);
function getUniforms6(opts = {}) {
  const { linearRescaleScaler, linearRescaleOffset } = opts;
  if (!Number.isFinite(linearRescaleScaler) && !Number.isFinite(linearRescaleOffset)) {
    return null;
  }
  return {
    linearRescaleScaler: Number.isFinite(linearRescaleScaler) ? linearRescaleScaler : 1,
    linearRescaleOffset: Number.isFinite(linearRescaleOffset) ? linearRescaleOffset : 0
  };
}
var linearRescale = {
  name: "linear_rescale",
  fs: fs8,
  getUniforms: getUniforms6,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = linear_rescale(image, linearRescaleScaler, linearRescaleOffset);
    `
  }
};

// dist/shadermodules/color/sigmoidal-contrast.js
var fs9 = (
  /* glsl */
  `#define epsilon 0.00000001

uniform float sigmoidalContrast;
uniform float sigmoidalBias;

// NOTE: Input array must have float values between 0 and 1!
// NOTE: bias must be a scalar float between 0 and 1!
vec4 calculateSigmoidalContrast(vec4 arr, float contrast, float bias) {
  // We use the names alpha and beta to match documentation.
  float alpha = bias;
  float beta = contrast;

  // alpha must be >= 0
  alpha = clamp(alpha, epsilon, alpha);

  if (beta > 0.) {
    vec4 numerator = 1. / (1. + exp(beta * (alpha - arr))) - 1. / (
      1. + exp(beta * alpha)
    );
    float denominator = 1. / (1. + exp(beta * (alpha - 1.))) - 1. / (
      1. + exp(beta * alpha)
    );
    arr = numerator / denominator;
  } else if (beta < 0.) {
    arr = (
      (beta * alpha) - log(
        (
          1.0 / (
            (arr / (1.0 + exp((beta * alpha) - beta))) -
            (arr / (1.0 + exp(beta * alpha))) +
            (1.0 / (1.0 + exp(beta * alpha)))
          )
        ) - 1.0)
    ) / beta;
  }

  return arr;
}
`
);
function getUniforms7(opts = {}) {
  const { sigmoidalContrast: sigmoidalContrast2, sigmoidalBias } = opts;
  if (!(Number.isFinite(sigmoidalContrast2) || Number.isFinite(sigmoidalBias))) {
    return null;
  }
  return {
    sigmoidalContrast: Number.isFinite(sigmoidalContrast2) ? sigmoidalContrast2 : 0,
    sigmoidalBias: Number.isFinite(sigmoidalBias) ? sigmoidalBias : 0.5
  };
}
var sigmoidalContrast = {
  name: "sigmoidalContrast",
  fs: fs9,
  getUniforms: getUniforms7,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = calculateSigmoidalContrast(image, sigmoidalContrast, sigmoidalBias);
    `
  }
};

// dist/shadermodules/color/gamma-contrast.js
var fs10 = (
  /* glsl */
  `#define epsilon 0.00000001

uniform float gamma1;
uniform float gamma2;
uniform float gamma3;
uniform float gamma4;

float gammaContrast(float arr, float g) {
  // Gamma must be > 0
  g = clamp(g, epsilon, g);

  return pow(arr, 1.0 / g);
}

vec4 gammaContrast(vec4 arr, float g1, float g2, float g3, float g4) {
  arr.r = gammaContrast(arr.r, g1);
  arr.g = gammaContrast(arr.g, g2);
  arr.b = gammaContrast(arr.b, g3);
  arr.a = gammaContrast(arr.a, g4);

  return arr;
}
`
);
function getUniforms8(opts = {}) {
  const { gammaContrastValue, gammaContrastValue1, gammaContrastValue2, gammaContrastValue3, gammaContrastValue4 } = opts;
  if (gammaContrastValue) {
    return {
      gamma1: gammaContrastValue,
      gamma2: gammaContrastValue,
      gamma3: gammaContrastValue,
      gamma4: gammaContrastValue
    };
  } else if (gammaContrastValue1 || gammaContrastValue2 || gammaContrastValue3 || gammaContrastValue4) {
    return {
      gamma1: gammaContrastValue1 || 1,
      gamma2: gammaContrastValue2 || 1,
      gamma3: gammaContrastValue3 || 1,
      gamma4: gammaContrastValue4 || 1
    };
  }
  return null;
}
var gammaContrast = {
  name: "gamma_contrast",
  fs: fs10,
  getUniforms: getUniforms8,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = gammaContrast(image, gamma1, gamma2, gamma3, gamma4);
    `
  }
};

// dist/shadermodules/color/saturation.js
var fs11 = (
  /* glsl */
  `uniform float uSaturationValue;
vec3 saturate(vec3 rgb, float adjustment) {
    // Algorithm from Chapter 16 of OpenGL Shading Language
    const vec3 W = vec3(0.2125, 0.7154, 0.0721);
    vec3 intensity = vec3(dot(rgb, W));
    return mix(intensity, rgb, adjustment);
}
`
);
function getUniforms9(opts = {}) {
  const { saturationValue } = opts;
  if (!saturationValue) {
    return null;
  }
  return {
    uSaturationValue: Number.isFinite(saturationValue) ? saturationValue : 1
  };
}
var saturation = {
  name: "saturation",
  fs: fs11,
  getUniforms: getUniforms9,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = vec4(saturate(image.rgb, uSaturationValue), image.a);
    `
  }
};

// dist/shadermodules/color/filter.js
var fs12 = (
  /* glsl */
  `uniform float filterMin1;
uniform float filterMax1;
uniform float filterMin2;
uniform float filterMax2;
uniform float filterMin3;
uniform float filterMax3;
uniform float filterMin4;
uniform float filterMax4;
`
);
var inf2 = Math.pow(2, 62);
function getUniforms10(opts = {}) {
  const { filterMin1, filterMin2, filterMin3, filterMin4, filterMax1, filterMax2, filterMax3, filterMax4 } = opts;
  if (Number.isFinite(filterMin1) || Number.isFinite(filterMin2) || Number.isFinite(filterMin3) || Number.isFinite(filterMin4) || Number.isFinite(filterMax1) || Number.isFinite(filterMax2) || Number.isFinite(filterMax3) || Number.isFinite(filterMax4)) {
    return {
      filterMin1: Number.isFinite(filterMin1) ? filterMin1 : -inf2,
      filterMin2: Number.isFinite(filterMin2) ? filterMin2 : -inf2,
      filterMin3: Number.isFinite(filterMin3) ? filterMin3 : -inf2,
      filterMin4: Number.isFinite(filterMin4) ? filterMin4 : -inf2,
      filterMax1: Number.isFinite(filterMax1) ? filterMax1 : inf2,
      filterMax2: Number.isFinite(filterMax2) ? filterMax2 : inf2,
      filterMax3: Number.isFinite(filterMax3) ? filterMax3 : inf2,
      filterMax4: Number.isFinite(filterMax4) ? filterMax4 : inf2
    };
  }
  return null;
}
var filter = {
  name: "filter",
  fs: fs12,
  getUniforms: getUniforms10,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    if (image.r < filterMin1) discard;
    if (image.g < filterMin2) discard;
    if (image.b < filterMin3) discard;
    if (image.a < filterMin4) discard;
    if (image.r > filterMax1) discard;
    if (image.g > filterMax2) discard;
    if (image.b > filterMax3) discard;
    if (image.a > filterMax4) discard;
    `
  }
};

// dist/shadermodules/pansharpen/pansharpen-brovey.js
var fs13 = (
  /* glsl */
  `precision mediump usampler2D;

#ifdef SAMPLER_TYPE
  uniform SAMPLER_TYPE bitmapTexturePan;
#else
  uniform sampler2D bitmapTexturePan;
#endif

uniform float panWeight;

float pansharpen_brovey_ratio(vec4 rgb, float pan, float weight) {
  return pan / ((rgb.r + rgb.g + rgb.b * weight) / (2. + weight));
}

vec4 pansharpen_brovey_calc(vec4 rgb, float pan, float weight) {
  float ratio = pansharpen_brovey_ratio(rgb, pan, weight);
  return ratio * rgb;
}
`
);
function getUniforms11(opts = {}) {
  const { imagePan, panWeight = 0.2 } = opts;
  if (!imagePan) {
    return null;
  }
  return {
    bitmapTexturePan: imagePan,
    panWeight
  };
}
var pansharpenBrovey = {
  name: "pansharpen_brovey",
  fs: fs13,
  defines: {
    SAMPLER_TYPE: "sampler2D"
  },
  getUniforms: getUniforms11,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    float pan_band = float(texture2D(bitmapTexturePan, coord).r);
    image = pansharpen_brovey_calc(image, pan_band, panWeight);
    `
  }
};

// dist/shadermodules/spectral-indices/evi.js
var fs14 = (
  /* glsl */
  `float enhanced_vegetation_index_calc(vec4 image) {
  float band5 = image.r;
  float band4 = image.g;
  float band2 = image.b;

  float numerator = band5 - band4;
  float denominator = band5 + (6. * band4) - (7.5 * band2) + 1.;
  return 2.5 * (numerator / denominator);
}
`
);
var enhancedVegetationIndex = {
  name: "enhanced_vegetation_index",
  fs: fs14,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = vec4(enhanced_vegetation_index_calc(image), 0., 0., 0.);
    `
  }
};

// dist/shadermodules/spectral-indices/msavi.js
var fs15 = (
  /* glsl */
  `float modified_soil_adjusted_vegetation_index_calc(vec4 image) {
  float band5 = image.r;
  float band4 = image.g;

  float to_sqrt = ((2. * band5 + 1.) * (2. * band5 + 1.)) - (8. * (band5 - band4));
  return ((2. * band5) + 1. - sqrt(to_sqrt)) / 2.;
}
`
);
var modifiedSoilAdjustedVegetationIndex = {
  name: "modified_soil_adjusted_vegetation_index",
  fs: fs15,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = vec4(modified_soil_adjusted_vegetation_index_calc(image), 0., 0., 0.);
    `
  }
};

// dist/shadermodules/spectral-indices/normalized-difference.js
var fs16 = (
  /* glsl */
  `float normalized_difference_calc(vec4 image) {
  return ((image.r - image.g) / (image.r + image.g));
}
`
);
var normalizedDifference = {
  name: "normalized_difference",
  fs: fs16,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = vec4(normalized_difference_calc(image), 0., 0., 0.);
    `
  }
};

// dist/shadermodules/spectral-indices/savi.js
var fs17 = (
  /* glsl */
  `float soil_adjusted_vegetation_index_calc(vec4 image) {
  float band5 = image.r;
  float band4 = image.g;

  float numerator = band5 - band4;
  float denominator = (band5 + band4 + 0.5) * 1.5;
  return numerator / denominator;
}
`
);
var soilAdjustedVegetationIndex = {
  name: "soil_adjusted_vegetation_index",
  fs: fs17,
  inject: {
    "fs:DECKGL_MUTATE_COLOR": `
    image = vec4(soil_adjusted_vegetation_index_calc(image), 0., 0., 0.);
    `
  }
};
//# sourceMappingURL=dist.index.cjs.map
