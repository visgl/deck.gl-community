// Minimal WebGL attribute text layer ported from WIP luma.gl text utilities.
// SPDX-License-Identifier: MIT

import {color, createIterable, Layer, project32, UNIT} from '@deck.gl/core';
import {Buffer, Texture} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {Log} from '@probe.gl/log';

import {
  buildFastTextGlyphData,
  buildFastTextUtf8ColumnSource,
  collectFastTextCharacterSet,
  FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE,
  updateFastTextDynamicGlyphAttributes
} from './fast-text-layout';
import {DEFAULT_FAST_TEXT_FONT_SETTINGS, FastTextFontAtlasManager} from './font-atlas';

import type {
  FastTextAlignmentBaseline,
  FastTextAnchor,
  FastTextClipRect,
  FastTextContentAlign,
  FastTextDynamicGlyphUpdateStats,
  FastTextGlyphBuildStats,
  FastTextGlyphData,
  FastTextUtf8Column,
  FastTextUtf8ColumnSource,
  FastTextUtf8ViewAccessor
} from './fast-text-layout';
import type {FastTextCharacterMapping, FastTextFontAtlas, FastTextFontSettings} from './font-atlas';
import type {
  Accessor,
  Color,
  DefaultProps,
  LayerContext,
  LayerDataSource,
  LayerProps,
  Position,
  Unit,
  UpdateParameters
} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';

/** Fast text layer props that intentionally cover dense Tracevis-style span labels. */
export type _FastTextLayerProps<DataT> = {
  /** Source label rows. */
  data: LayerDataSource<DataT>;
  /** If true, labels face the camera in screen space. */
  billboard?: boolean;
  /** Text size multiplier. */
  sizeScale?: number;
  /** Units for `size`, matching deck.gl size units. */
  sizeUnits?: Unit;
  /** Minimum rendered text size in screen pixels. */
  sizeMinPixels?: number;
  /** Maximum rendered text size in screen pixels. */
  sizeMaxPixels?: number;
  /** Fragment alpha cutoff below which a glyph pixel is discarded. */
  alphaCutoff?: number;
  /** Character set to place in the generated atlas, or `auto` to scan `getText`. */
  characterSet?: FastTextFontSettings['characterSet'] | 'auto';
  /** CSS font family used for generated atlases. */
  fontFamily?: FastTextFontSettings['fontFamily'];
  /** CSS font weight used for generated atlases. */
  fontWeight?: FastTextFontSettings['fontWeight'];
  /** Unitless line-height multiplier. */
  lineHeight?: number;
  /** Layer-wide text size. */
  size?: number;
  /** Layer-wide pixel offset applied after glyph layout. */
  pixelOffset?: readonly [number, number];
  /** Compatibility alias for callers that still inspect TextLayer-style pixel offset props. */
  getPixelOffset?: readonly [number, number];
  /** Additional atlas rasterization settings. */
  fontSettings?: FastTextFontSettings;
  /** Optional prebuilt mapping, supplied together with `fontAtlas`. */
  characterMapping?: FastTextCharacterMapping | null;
  /** Optional prebuilt atlas, supplied together with `characterMapping`. */
  fontAtlas?: FastTextFontAtlas | null;
  /** Label text accessor. */
  getText?: Accessor<DataT, string>;
  /** Optional UTF-8 text column used instead of `getText`. */
  textUtf8Column?: FastTextUtf8Column | null;
  /** Row accessor into `textUtf8Column`. Defaults to the source row index. */
  getTextUtf8Row?: Accessor<DataT, number | null>;
  /** Optional accessor that fills a reused UTF-8 byte view instead of calling `getText`. */
  getTextUtf8?: FastTextUtf8ViewAccessor<DataT> | null;
  /** Whether labels are expected to contain one line with no newline handling. */
  singleLine?: boolean;
  /** Label anchor position accessor. */
  getPosition?: Accessor<DataT, Position>;
  /** Label color accessor. */
  getColor?: Accessor<DataT, Color>;
  /** Layer-wide horizontal alignment. */
  textAnchor?: FastTextAnchor;
  /** Layer-wide vertical alignment. */
  alignmentBaseline?: FastTextAlignmentBaseline;
  /** Per-row content clip rectangle accessor. */
  getClipRect?: Accessor<DataT, FastTextClipRect>;
  /** Compatibility alias for callers that still inspect TextLayer-style content boxes. */
  getContentBox?: Accessor<DataT, FastTextClipRect>;
  /** Minimum visible content box dimensions in screen pixels. */
  contentCutoffPixels?: readonly [width: number, height: number];
  /** Horizontal alignment mode inside the visible content box. */
  contentAlignHorizontal?: FastTextContentAlign;
  /** Vertical alignment mode inside the visible content box. */
  contentAlignVertical?: FastTextContentAlign;
};

/** Props accepted by {@link FastTextLayer}. */
export type FastTextLayerProps<DataT = unknown> = _FastTextLayerProps<DataT> & LayerProps;

const defaultProps: DefaultProps<FastTextLayerProps> = {
  billboard: true,
  sizeScale: {type: 'number', value: 1, min: 0},
  sizeUnits: 'pixels',
  sizeMinPixels: {type: 'number', value: 0, min: 0},
  sizeMaxPixels: {type: 'number', value: Number.MAX_SAFE_INTEGER, min: 0},
  alphaCutoff: {type: 'number', value: 0.001, min: 0, max: 1},
  characterSet: {type: 'object', value: DEFAULT_FAST_TEXT_FONT_SETTINGS.characterSet},
  fontFamily: DEFAULT_FAST_TEXT_FONT_SETTINGS.fontFamily,
  fontWeight: DEFAULT_FAST_TEXT_FONT_SETTINGS.fontWeight,
  lineHeight: {type: 'number', value: 1, min: 0},
  size: {type: 'number', value: 32, min: 0},
  pixelOffset: {type: 'array', value: [0, 0]},
  getPixelOffset: {type: 'array', value: [0, 0]},
  fontSettings: {type: 'object', value: {}, compare: 1},
  characterMapping: {type: 'object', value: null, optional: true},
  fontAtlas: {type: 'object', value: null, optional: true},
  getText: {type: 'accessor', value: (datum: any) => datum.text},
  textUtf8Column: {type: 'object', value: null, optional: true},
  getTextUtf8Row: {
    type: 'accessor',
    value: (_datum: any, objectInfo: {index: number}) => objectInfo.index
  },
  getTextUtf8: {type: 'accessor', value: null},
  singleLine: true,
  getPosition: {type: 'accessor', value: (datum: any) => datum.position},
  getColor: {type: 'accessor', value: [0, 0, 0, 255]},
  textAnchor: 'middle',
  alignmentBaseline: 'center',
  getClipRect: {type: 'accessor', value: [0, 0, -1, -1]},
  getContentBox: {type: 'accessor', value: [0, 0, -1, -1]},
  contentCutoffPixels: {type: 'array', value: [0, 0]},
  contentAlignHorizontal: 'none',
  contentAlignVertical: 'none'
};

/** Lightweight bitmap text layer backed by one typed-array glyph instance stream. */
export class FastTextLayer<DataT = any, ExtraPropsT extends {} = {}> extends Layer<
  ExtraPropsT & Required<_FastTextLayerProps<DataT>>
> {
  static defaultProps = defaultProps;
  static layerName = 'FastTextLayer';

  declare state: FastTextLayerState;

  /** Return the shader set used by the direct glyph instance model. */
  override getShaders() {
    return super.getShaders({
      vs: FAST_TEXT_VS,
      fs: FAST_TEXT_FS,
      modules: [project32, color, fastTextUniforms]
    });
  }

  /** Initialize the model and atlas manager. */
  override initializeState(): void {
    this.state = {
      fontAtlasManager: new FastTextFontAtlasManager()
    };
    this.state.model = this.getModel();
  }

  /** Rebuild text layout or update dynamic glyph attributes when inputs change. */
  override updateState(params: UpdateParameters<this>): void {
    super.updateState(params);

    if (params.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = this.getModel();
      if (this.state.buffers) {
        this.state.model.setAttributes(this.state.buffers);
        this.state.model.setInstanceCount(this.state.glyphData?.length ?? 0);
      }
    }

    if (shouldRebuildFastText(params) || this.hasMutableLayoutSourceChanged()) {
      this.rebuildGlyphState();
    } else {
      const dynamicUpdate = getFastTextDynamicUpdate(params);
      if (dynamicUpdate) {
        this.updateDynamicGlyphState(dynamicUpdate);
      }
    }
  }

  /** Draw the glyph model when atlas texture and glyph buffers are ready. */
  override draw(): void {
    const {atlasTexture, glyphData, model, fontSize} = this.state;
    if (!model || !atlasTexture || !glyphData || glyphData.length === 0 || !fontSize) {
      return;
    }

    model.shaderInputs.setProps({
      fastText: {
        fontAtlasTexture: atlasTexture,
        fontAtlasSize: [atlasTexture.width, atlasTexture.height],
        fontSize,
        size: this.props.size,
        sizeScale: this.props.sizeScale,
        sizeMinPixels: this.props.sizeMinPixels,
        sizeMaxPixels: this.props.sizeMaxPixels,
        pixelOffset: this.props.pixelOffset,
        billboard: this.props.billboard,
        sizeUnits: UNIT[this.props.sizeUnits],
        alphaCutoff: this.props.alphaCutoff,
        sdfEnabled: this.resolveSdfEnabled(),
        sdfBuffer: FAST_TEXT_SDF_BUFFER,
        sdfGamma: this.resolveSdfSmoothing(),
        contentCutoffPixels: this.props.contentCutoffPixels,
        contentAlign: [
          getFastTextContentAlignUniform(this.props.contentAlignHorizontal),
          getFastTextContentAlignUniform(this.props.contentAlignVertical)
        ],
        flipY: Boolean((this.context.viewport as {flipY?: boolean}).flipY)
      }
    });
    model.draw(this.context.renderPass);
  }

  /** Release GPU buffers, atlas texture, and the luma model. */
  override finalizeState(context: LayerContext): void {
    destroyFastTextBuffers(this.state.buffers);
    this.state.atlasTexture?.destroy();
    this.state.model?.destroy();
    super.finalizeState(context);
  }

  /** Build a luma model for instanced glyph quads. */
  private getModel(): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: FAST_TEXT_BUFFER_LAYOUT,
      geometry: new Geometry({
        topology: 'triangle-list',
        attributes: {
          positions: {
            size: 2,
            value: new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1])
          }
        }
      }),
      isInstanced: true
    });
  }

  /** Rebuild CPU glyph data, GPU vertex buffers, and the font atlas texture. */
  private rebuildGlyphState(): void {
    const rebuildStartTime = performance.now();
    const atlasStartTime = performance.now();
    const atlas = this.resolveFontAtlas();
    const atlasDurationMs = performance.now() - atlasStartTime;
    const mapping = this.props.characterMapping ?? atlas.mapping;
    const glyphDataStartTime = performance.now();
    const glyphData = buildFastTextGlyphData({
      data: this.props.data,
      getText: this.props.getText,
      textUtf8Column: this.props.textUtf8Column,
      getTextUtf8Row: this.props.getTextUtf8Row,
      getTextUtf8: this.props.getTextUtf8,
      singleLine: this.props.singleLine,
      getPosition: this.props.getPosition,
      getColor: this.props.getColor,
      textAnchor: this.props.textAnchor,
      alignmentBaseline: this.props.alignmentBaseline,
      getClipRect: this.props.getClipRect,
      mapping,
      baselineOffset: atlas.baselineOffset,
      fontSize: this.resolveFontSize(),
      lineHeight: this.props.lineHeight
    });
    const glyphDataDurationMs = performance.now() - glyphDataStartTime;
    const bufferStartTime = performance.now();
    const buffers = createFastTextBuffers(this.context.device, glyphData);
    const bufferCreateDurationMs = performance.now() - bufferStartTime;

    destroyFastTextBuffers(this.state.buffers);
    this.state.model?.setAttributes(buffers);
    this.state.model?.setInstanceCount(glyphData.length);
    this.setState({
      glyphData,
      buffers,
      layoutSourceSignature: getFastTextLayoutSourceSignature(this.props)
    });
    logFastTextAttributeBuildProbe({
      atlasDurationMs,
      bufferCreateDurationMs,
      glyphDataDurationMs,
      glyphStats: glyphData.buildStats,
      layerId: this.props.id,
      totalDurationMs: performance.now() - rebuildStartTime
    });
    this.setNeedsRedraw();
  }

  /** Rewrite dynamic glyph attributes in place without rebuilding text layout. */
  private updateDynamicGlyphState(update: FastTextDynamicUpdate): void {
    const {glyphData, buffers} = this.state;
    if (!glyphData || !buffers) {
      this.rebuildGlyphState();
      return;
    }

    const updateStartTime = performance.now();
    const dynamicStats = updateFastTextDynamicGlyphAttributes({
      data: this.props.data,
      glyphData,
      getPosition: this.props.getPosition,
      getColor: this.props.getColor,
      getClipRect: this.props.getClipRect,
      updatePositions: update.positions,
      updateColors: update.colors,
      updateClipRects: update.clipRects
    });
    if (dynamicStats.rowCount !== glyphData.startIndices.length - 1) {
      this.rebuildGlyphState();
      return;
    }
    const bufferUploadStartTime = performance.now();
    if (update.positions) {
      buffers.instancePositions.write(glyphData.attributes.instancePositions);
    }
    if (update.colors || update.clipRects) {
      buffers.instanceGlyphData.write(glyphData.attributes.instanceGlyphData);
    }
    const bufferUploadDurationMs = performance.now() - bufferUploadStartTime;
    logFastTextDynamicAttributeUpdateProbe({
      bufferUploadDurationMs,
      dynamicStats,
      layerId: this.props.id,
      totalDurationMs: performance.now() - updateStartTime,
      update
    });
    this.setNeedsRedraw();
  }

  /** Return whether source data or UTF-8 column growth invalidated the current glyph layout. */
  private hasMutableLayoutSourceChanged(): boolean {
    const {glyphData, layoutSourceSignature} = this.state;
    if (!glyphData || !layoutSourceSignature) {
      return true;
    }
    return !areFastTextLayoutSourceSignaturesEqual(
      getFastTextLayoutSourceSignature(this.props),
      layoutSourceSignature
    );
  }

  /** Resolve a caller-supplied atlas or rebuild the local generated atlas. */
  private resolveFontAtlas(): FastTextFontAtlas {
    const {characterMapping, fontAtlas} = this.props;
    if (
      (this.props.textUtf8Column || this.props.getTextUtf8) &&
      this.props.characterSet === 'auto'
    ) {
      throw new Error('FastTextLayer characterSet="auto" is not supported with UTF-8 text sources');
    }
    if (characterMapping || fontAtlas) {
      if (!characterMapping || !fontAtlas) {
        throw new Error(
          'FastTextLayer requires characterMapping and fontAtlas to be supplied together'
        );
      }
      this.syncAtlasTexture(fontAtlas);
      return fontAtlas;
    }

    const characterSet =
      this.props.characterSet === 'auto'
        ? collectFastTextCharacterSet({
            data: this.props.data,
            getText: this.props.getText
          })
        : this.props.characterSet;
    this.state.fontAtlasManager.setProps({
      ...this.props.fontSettings,
      fontFamily: this.props.fontFamily,
      fontWeight: this.props.fontWeight,
      characterSet
    });
    const atlas = this.state.fontAtlasManager.atlas;
    if (!atlas) {
      throw new Error('FastTextLayer failed to build a font atlas');
    }
    this.syncAtlasTexture(atlas);
    return atlas;
  }

  /** Resolve the atlas pixel size used by glyph offsets. */
  private resolveFontSize(): number {
    return this.props.fontAtlas
      ? (this.props.fontSettings.fontSize ?? DEFAULT_FAST_TEXT_FONT_SETTINGS.fontSize)
      : this.state.fontAtlasManager.props.fontSize;
  }

  /** Resolve whether the current atlas should be sampled as SDF data. */
  private resolveSdfEnabled(): boolean {
    return this.props.fontAtlas
      ? (this.props.fontSettings.sdf ?? DEFAULT_FAST_TEXT_FONT_SETTINGS.sdf)
      : this.state.fontAtlasManager.props.sdf;
  }

  /** Resolve the SDF smoothing width for the current atlas. */
  private resolveSdfSmoothing(): number {
    return this.props.fontAtlas
      ? (this.props.fontSettings.smoothing ?? DEFAULT_FAST_TEXT_FONT_SETTINGS.smoothing)
      : this.state.fontAtlasManager.props.smoothing;
  }

  /** Upload a new atlas texture when the atlas object changes. */
  private syncAtlasTexture(atlas: FastTextFontAtlas): void {
    if (this.state.textureAtlas === atlas && this.state.atlasTexture) {
      return;
    }
    this.state.atlasTexture?.destroy();
    const texture = createFastTextAtlasTexture(this.context.device, atlas);
    this.setState({
      textureAtlas: atlas,
      atlasTexture: texture,
      fontSize: this.resolveFontSize()
    });
  }
}

type FastTextLayerState = {
  /** Atlas manager owned by this layer when no external atlas is supplied. */
  fontAtlasManager: FastTextFontAtlasManager;
  /** Luma model used to draw glyph quads. */
  model?: Model;
  /** Last expanded CPU glyph data. */
  glyphData?: FastTextGlyphData;
  /** Primitive source-shape values captured when `glyphData` was built. */
  layoutSourceSignature?: FastTextLayoutSourceSignature;
  /** GPU buffers for the current glyph data. */
  buffers?: FastTextLayerBuffers;
  /** Atlas object currently uploaded to `atlasTexture`. */
  textureAtlas?: FastTextFontAtlas;
  /** GPU texture for the current font atlas. */
  atlasTexture?: Texture;
  /** Atlas font size in pixels for the current glyph offsets. */
  fontSize?: number;
};

type FastTextLayerBuffers = {
  /** Packed glyph offsets, atlas frames, clip rectangles, and colors. */
  instanceGlyphData: Buffer;
  /** Repeated per-glyph anchor positions. */
  instancePositions: Buffer;
};

type FastTextDynamicUpdate = {
  /** Whether per-glyph positions need to be rewritten. */
  positions: boolean;
  /** Whether per-glyph colors need to be rewritten. */
  colors: boolean;
  /** Whether per-glyph clip rectangles need to be rewritten. */
  clipRects: boolean;
};

type FastTextLayoutSourceSignature = {
  /** Number of source rows visible through the data iterable. */
  dataRowCount: number;
  /** Whether source text comes from a row-level UTF-8 view accessor. */
  hasTextUtf8Accessor: boolean;
  /** Number of rows in the optional UTF-8 text column. */
  textUtf8ColumnRowCount: number;
  /** Number of chunks in the optional UTF-8 text column. */
  textUtf8ColumnChunkCount: number;
  /** Total entries across UTF-8 offset buffers. */
  textUtf8ColumnOffsetCount: number;
  /** Total bytes across UTF-8 value buffers. */
  textUtf8ColumnValueByteLength: number;
};

type FastTextUniformProps = {
  /** Font atlas texture binding. */
  fontAtlasTexture: Texture;
  /** Font atlas dimensions in pixels. */
  fontAtlasSize: [number, number];
  /** Atlas font size in pixels. */
  fontSize: number;
  /** Layer-wide text size. */
  size: number;
  /** Text size multiplier. */
  sizeScale: number;
  /** Minimum rendered text size in screen pixels. */
  sizeMinPixels: number;
  /** Maximum rendered text size in screen pixels. */
  sizeMaxPixels: number;
  /** Layer-wide pixel offset applied after glyph layout. */
  pixelOffset: readonly [number, number];
  /** Whether text should face the camera in screen space. */
  billboard: boolean;
  /** Deck.gl unit enum for text size projection. */
  sizeUnits: number;
  /** Fragment alpha cutoff below which a glyph pixel is discarded. */
  alphaCutoff: number;
  /** Whether the atlas alpha channel contains signed distance values. */
  sdfEnabled: boolean;
  /** SDF edge threshold used for fill rendering. */
  sdfBuffer: number;
  /** SDF smoothing width around `sdfBuffer`. */
  sdfGamma: number;
  /** Minimum visible content-box dimensions in screen pixels. */
  contentCutoffPixels: readonly [number, number];
  /** Horizontal and vertical content alignment enum values. */
  contentAlign: readonly [number, number];
  /** Whether the active viewport flips the Y axis for content clipping. */
  flipY: boolean;
};

const FAST_TEXT_CONTENT_ALIGN: Record<FastTextContentAlign, number> = {
  none: 0,
  start: 1,
  center: 2,
  end: 3
};
const FAST_TEXT_ALIGN_START = FAST_TEXT_CONTENT_ALIGN.start;
const FAST_TEXT_ALIGN_CENTER = FAST_TEXT_CONTENT_ALIGN.center;
const FAST_TEXT_ALIGN_END = FAST_TEXT_CONTENT_ALIGN.end;
const FAST_TEXT_SDF_BUFFER = 192.0 / 256.0;
const fastTextLog = new Log({id: 'trace-layers'});
const FAST_TEXT_PROBE_LABEL_STYLE =
  'background:#f59e0b;color:#111827;font-weight:700;padding:2px 8px;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;';

const fastTextUniforms = {
  name: 'fastText',
  vs: `\
layout(std140) uniform fastTextUniforms {
  vec2 fontAtlasSize;
  float fontSize;
  float size;
  float sizeScale;
  float sizeMinPixels;
  float sizeMaxPixels;
  vec2 pixelOffset;
  bool billboard;
  highp int sizeUnits;
  float alphaCutoff;
  bool sdfEnabled;
  float sdfBuffer;
  float sdfGamma;
  vec2 contentCutoffPixels;
  highp ivec2 contentAlign;
  bool flipY;
} fastText;

#define FAST_TEXT_ALIGN_MODE_START ${FAST_TEXT_ALIGN_START}
#define FAST_TEXT_ALIGN_MODE_CENTER ${FAST_TEXT_ALIGN_CENTER}
#define FAST_TEXT_ALIGN_MODE_END ${FAST_TEXT_ALIGN_END}
`,
  fs: `\
layout(std140) uniform fastTextUniforms {
  vec2 fontAtlasSize;
  float fontSize;
  float size;
  float sizeScale;
  float sizeMinPixels;
  float sizeMaxPixels;
  vec2 pixelOffset;
  bool billboard;
  highp int sizeUnits;
  float alphaCutoff;
  bool sdfEnabled;
  float sdfBuffer;
  float sdfGamma;
  vec2 contentCutoffPixels;
  highp ivec2 contentAlign;
  bool flipY;
} fastText;
`,
  uniformTypes: {
    fontAtlasSize: 'vec2<f32>',
    fontSize: 'f32',
    size: 'f32',
    sizeScale: 'f32',
    sizeMinPixels: 'f32',
    sizeMaxPixels: 'f32',
    pixelOffset: 'vec2<f32>',
    billboard: 'f32',
    sizeUnits: 'i32',
    alphaCutoff: 'f32',
    sdfEnabled: 'f32',
    sdfBuffer: 'f32',
    sdfGamma: 'f32',
    contentCutoffPixels: 'vec2<f32>',
    contentAlign: 'vec2<i32>',
    flipY: 'f32'
  }
} as const satisfies ShaderModule<FastTextUniformProps>;

const FAST_TEXT_BUFFER_LAYOUT = [
  {name: 'instancePositions', stepMode: 'instance', format: 'float32x2'},
  {
    name: 'instanceGlyphData',
    stepMode: 'instance',
    byteStride: FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE,
    attributes: [
      {attribute: 'instanceGlyphOffsets', format: 'sint16x2', byteOffset: 0},
      {
        attribute: 'instanceGlyphFrames',
        format: 'uint16x4',
        byteOffset: Int16Array.BYTES_PER_ELEMENT * 2
      },
      {
        attribute: 'instanceClipRects',
        format: 'sint16x4',
        byteOffset: Int16Array.BYTES_PER_ELEMENT * 6
      },
      {
        attribute: 'instanceColors',
        format: 'unorm8x4',
        byteOffset: Int16Array.BYTES_PER_ELEMENT * 10
      }
    ]
  }
] as const;

const DEFAULT_SAMPLER_PARAMETERS = {
  minFilter: 'linear',
  mipmapFilter: 'linear',
  magFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge'
} as const;

const FAST_TEXT_VS = `\
#version 300 es
#define SHADER_NAME fast-text-layer-vertex-shader

in vec2 positions;
in vec2 instancePositions;
in ivec2 instanceGlyphOffsets;
in uvec4 instanceGlyphFrames;
in ivec4 instanceClipRects;
in vec4 instanceColors;

out vec4 vColor;
out vec2 vTextureCoords;
out vec2 uv;

float fastTextGetAlignmentPixelOffset(float anchor, float extent, float clipStart, float clipEnd, int mode) {
  if (clipEnd < clipStart) {
    return 0.0;
  }
  if (mode == FAST_TEXT_ALIGN_MODE_START) {
    return max(-(anchor + clipStart), 0.0);
  }
  if (mode == FAST_TEXT_ALIGN_MODE_CENTER) {
    float visibleMin = max(0.0, anchor + clipStart);
    float visibleMax = min(extent, anchor + clipEnd);
    return visibleMin < visibleMax ? (visibleMin + visibleMax) / 2.0 - anchor : 0.0;
  }
  if (mode == FAST_TEXT_ALIGN_MODE_END) {
    return min(extent - (anchor + clipEnd), 0.0);
  }
  return 0.0;
}

void fastTextClipGlyphVertex(vec2 pixelOffset, vec2 anchorPosScreen) {
  vec4 clipRect = vec4(instanceClipRects);
  vec2 clipXY = project_size_to_pixel(clipRect.xy);
  vec2 clipWH = project_size_to_pixel(clipRect.zw);
  if (fastText.flipY) {
    clipXY.y = -clipXY.y - clipWH.y;
  }

  if (fastText.contentAlign.x > 0 || fastText.contentAlign.y > 0) {
    vec2 viewportPixels = project.viewportSize / project.devicePixelRatio;
    vec2 scrollPixels = vec2(
      fastTextGetAlignmentPixelOffset(
        anchorPosScreen.x,
        viewportPixels.x,
        clipXY.x,
        clipXY.x + clipWH.x,
        fastText.contentAlign.x
      ),
      -fastTextGetAlignmentPixelOffset(
        anchorPosScreen.y,
        viewportPixels.y,
        -clipXY.y - clipWH.y,
        -clipXY.y,
        fastText.contentAlign.y
      )
    );
    pixelOffset += scrollPixels;
    gl_Position.xy += project_pixel_size_to_clipspace(scrollPixels);
  }

  if (clipRect.z >= 0.0) {
    if (pixelOffset.x < clipXY.x || pixelOffset.x > clipXY.x + clipWH.x) {
      gl_Position = vec4(0.0);
    } else if (fastText.contentCutoffPixels.x > 0.0) {
      float viewportWidth = project.viewportSize.x / project.devicePixelRatio;
      float left = max(anchorPosScreen.x + clipXY.x, 0.0);
      float right = min(anchorPosScreen.x + clipXY.x + clipWH.x, viewportWidth);
      if (right - left < fastText.contentCutoffPixels.x) {
        gl_Position = vec4(0.0);
      }
    }
  }
  if (clipRect.w >= 0.0) {
    if (pixelOffset.y < clipXY.y || pixelOffset.y > clipXY.y + clipWH.y) {
      gl_Position = vec4(0.0);
    } else if (fastText.contentCutoffPixels.y > 0.0) {
      float viewportHeight = project.viewportSize.y / project.devicePixelRatio;
      float top = max(anchorPosScreen.y - clipXY.y - clipWH.y, 0.0);
      float bottom = min(anchorPosScreen.y - clipXY.y, viewportHeight);
      if (bottom - top < fastText.contentCutoffPixels.y) {
        gl_Position = vec4(0.0);
      }
    }
  }
}

void main(void) {
  vec3 worldPosition = vec3(instancePositions, 0.0);
  geometry.worldPosition = worldPosition;
  geometry.uv = positions;
  uv = positions;

  vec4 glyphFrame = vec4(instanceGlyphFrames);
  vec2 glyphSize = glyphFrame.zw;
  float sizePixels = clamp(
    project_size_to_pixel(fastText.size * fastText.sizeScale, fastText.sizeUnits),
    fastText.sizeMinPixels,
    fastText.sizeMaxPixels
  );
  float instanceScale = fastText.fontSize == 0.0 ? 0.0 : sizePixels / fastText.fontSize;
  vec2 pixelOffset = vec2(instanceGlyphOffsets) + positions * glyphSize;
  pixelOffset = pixelOffset * instanceScale + fastText.pixelOffset;
  pixelOffset.y *= -1.0;

  vec2 anchorPosScreen;
  if (fastText.billboard) {
    gl_Position = project_position_to_clipspace(
      worldPosition,
      vec3(0.0),
      vec3(0.0),
      geometry.position
    );
    anchorPosScreen = gl_Position.xy / gl_Position.w;
    DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
    vec3 offset = vec3(pixelOffset, 0.0);
    DECKGL_FILTER_SIZE(offset, geometry);
    gl_Position.xy += project_pixel_size_to_clipspace(offset.xy);
  } else {
    vec3 offsetCommon = vec3(project_pixel_size(pixelOffset), 0.0);
    if (fastText.flipY) {
      offsetCommon.y *= -1.0;
    }
    DECKGL_FILTER_SIZE(offsetCommon, geometry);
    vec4 anchorPosition = project_position_to_clipspace(worldPosition, vec3(0.0), vec3(0.0));
    anchorPosScreen = anchorPosition.xy / anchorPosition.w;
    gl_Position = project_position_to_clipspace(
      worldPosition,
      vec3(0.0),
      offsetCommon,
      geometry.position
    );
    DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  }

  anchorPosScreen = vec2(anchorPosScreen.x + 1.0, 1.0 - anchorPosScreen.y) / 2.0 *
    project.viewportSize / project.devicePixelRatio;
  fastTextClipGlyphVertex(pixelOffset, anchorPosScreen);

  vTextureCoords = (glyphFrame.xy + positions * glyphSize) / fastText.fontAtlasSize;
  vColor = instanceColors;
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;

const FAST_TEXT_FS = `\
#version 300 es
#define SHADER_NAME fast-text-layer-fragment-shader

precision highp float;

uniform sampler2D fontAtlasTexture;

in vec4 vColor;
in vec2 vTextureCoords;
in vec2 uv;

out vec4 fragColor;

void main(void) {
  geometry.uv = uv;

  float alpha = texture(fontAtlasTexture, vTextureCoords).a;
  if (fastText.sdfEnabled) {
    alpha = smoothstep(fastText.sdfBuffer - fastText.sdfGamma, fastText.sdfBuffer + fastText.sdfGamma, alpha);
  }
  float outputAlpha = alpha * vColor.a;

  if (outputAlpha < fastText.alphaCutoff) {
    discard;
  }

  fragColor = vec4(vColor.rgb, outputAlpha * layer.opacity);

  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

/** Capture primitive source-shape values that can change without prop identity changes. */
function getFastTextLayoutSourceSignature(
  props: Required<_FastTextLayerProps<any>>
): FastTextLayoutSourceSignature {
  const textUtf8ColumnSignature = getFastTextUtf8ColumnSourceSignature(props.textUtf8Column);
  return {
    dataRowCount: getFastTextDataRowCount(props.data),
    hasTextUtf8Accessor: Boolean(props.getTextUtf8),
    textUtf8ColumnRowCount: textUtf8ColumnSignature.rowCount,
    textUtf8ColumnChunkCount: textUtf8ColumnSignature.chunkCount,
    textUtf8ColumnOffsetCount: textUtf8ColumnSignature.offsetCount,
    textUtf8ColumnValueByteLength: textUtf8ColumnSignature.valueByteLength
  };
}

/** Return whether two captured source-shape signatures match. */
function areFastTextLayoutSourceSignaturesEqual(
  signature: FastTextLayoutSourceSignature,
  oldSignature: FastTextLayoutSourceSignature
): boolean {
  return (
    signature.dataRowCount === oldSignature.dataRowCount &&
    signature.hasTextUtf8Accessor === oldSignature.hasTextUtf8Accessor &&
    signature.textUtf8ColumnRowCount === oldSignature.textUtf8ColumnRowCount &&
    signature.textUtf8ColumnChunkCount === oldSignature.textUtf8ColumnChunkCount &&
    signature.textUtf8ColumnOffsetCount === oldSignature.textUtf8ColumnOffsetCount &&
    signature.textUtf8ColumnValueByteLength === oldSignature.textUtf8ColumnValueByteLength
  );
}

/** Count source data rows without relying on deck.gl's identity-based data change flag. */
function getFastTextDataRowCount(data: LayerDataSource<any>): number {
  const arrayLikeLength = (data as {length?: unknown}).length;
  if (typeof arrayLikeLength === 'number') {
    return arrayLikeLength;
  }
  const tableLikeNumRows = (data as {numRows?: unknown}).numRows;
  if (typeof tableLikeNumRows === 'number') {
    return tableLikeNumRows;
  }

  const {iterable} = createIterable(data);
  let rowCount = 0;
  for (const _object of iterable) {
    rowCount++;
  }
  return rowCount;
}

/** Capture primitive shape values for the optional direct UTF-8 text source. */
function getFastTextUtf8ColumnSourceSignature(
  textUtf8Column: FastTextUtf8Column | null | undefined
): {
  /** Number of rows in the normalized source. */
  readonly rowCount: number;
  /** Number of chunks in the normalized source. */
  readonly chunkCount: number;
  /** Total entries across UTF-8 offset buffers. */
  readonly offsetCount: number;
  /** Total bytes across UTF-8 value buffers. */
  readonly valueByteLength: number;
} {
  if (!textUtf8Column) {
    return {rowCount: 0, chunkCount: 0, offsetCount: 0, valueByteLength: 0};
  }
  const source = normalizeFastTextUtf8ColumnForComparison(textUtf8Column);
  if (!source) {
    return {rowCount: -1, chunkCount: -1, offsetCount: -1, valueByteLength: -1};
  }

  let offsetCount = 0;
  let valueByteLength = 0;
  for (const chunk of source.chunks) {
    offsetCount += chunk.valueOffsets.length;
    valueByteLength += chunk.values.byteLength;
  }
  return {
    rowCount: source.rowCount,
    chunkCount: source.chunks.length,
    offsetCount,
    valueByteLength
  };
}

/** Decide whether a deck update requires glyph data regeneration. */
function shouldRebuildFastText(layerParams: UpdateParameters<FastTextLayer<any, any>>): boolean {
  const {props, oldProps, changeFlags} = layerParams;
  const updateTriggersChanged = changeFlags.updateTriggersChanged;
  return (
    Boolean(changeFlags.dataChanged) ||
    didFastTextAccessorPropChange(props.getText, oldProps.getText) ||
    !areFastTextUtf8ColumnsEqual(props.textUtf8Column, oldProps.textUtf8Column) ||
    didFastTextAccessorPropChange(props.getTextUtf8Row, oldProps.getTextUtf8Row) ||
    didFastTextAccessorPropChange(props.getTextUtf8, oldProps.getTextUtf8) ||
    props.singleLine !== oldProps.singleLine ||
    props.textAnchor !== oldProps.textAnchor ||
    props.alignmentBaseline !== oldProps.alignmentBaseline ||
    props.characterSet !== oldProps.characterSet ||
    props.fontFamily !== oldProps.fontFamily ||
    props.fontWeight !== oldProps.fontWeight ||
    props.lineHeight !== oldProps.lineHeight ||
    props.fontSettings !== oldProps.fontSettings ||
    props.characterMapping !== oldProps.characterMapping ||
    props.fontAtlas !== oldProps.fontAtlas ||
    Boolean(
      updateTriggersChanged &&
        (updateTriggersChanged.all ||
          updateTriggersChanged.getText ||
          updateTriggersChanged.getTextUtf8 ||
          updateTriggersChanged.getTextUtf8Row)
    )
  );
}

/** Return which dynamic FastText attributes can be updated without rebuilding text layout. */
function getFastTextDynamicUpdate(
  layerParams: UpdateParameters<FastTextLayer<any, any>>
): FastTextDynamicUpdate | null {
  const {props, oldProps, changeFlags} = layerParams;
  const updateTriggersChanged = changeFlags.updateTriggersChanged;
  const positions =
    didFastTextAccessorPropChange(props.getPosition, oldProps.getPosition) ||
    Boolean(updateTriggersChanged && updateTriggersChanged.getPosition);
  const colors =
    didFastTextAccessorPropChange(props.getColor, oldProps.getColor) ||
    Boolean(updateTriggersChanged && updateTriggersChanged.getColor);
  const clipRects =
    didFastTextAccessorPropChange(props.getClipRect, oldProps.getClipRect) ||
    Boolean(updateTriggersChanged && updateTriggersChanged.getClipRect);
  if (!positions && !colors && !clipRects) {
    return null;
  }
  return {positions, colors, clipRects};
}

/** Return whether two UTF-8 column props read from the same underlying Arrow buffers. */
function areFastTextUtf8ColumnsEqual(
  textUtf8Column: FastTextUtf8Column | null | undefined,
  oldTextUtf8Column: FastTextUtf8Column | null | undefined
): boolean {
  if (textUtf8Column === oldTextUtf8Column) {
    return true;
  }
  if (!textUtf8Column || !oldTextUtf8Column) {
    return false;
  }
  const source = normalizeFastTextUtf8ColumnForComparison(textUtf8Column);
  const oldSource = normalizeFastTextUtf8ColumnForComparison(oldTextUtf8Column);
  if (!source || !oldSource || source.rowCount !== oldSource.rowCount) {
    return false;
  }
  if (source.chunks.length !== oldSource.chunks.length) {
    return false;
  }
  for (let index = 0; index < source.chunks.length; index += 1) {
    const chunk = source.chunks[index]!;
    const oldChunk = oldSource.chunks[index]!;
    if (
      chunk.rowOffset !== oldChunk.rowOffset ||
      chunk.rowCount !== oldChunk.rowCount ||
      chunk.valueOffsetIndex !== oldChunk.valueOffsetIndex ||
      chunk.valueOffsets !== oldChunk.valueOffsets ||
      chunk.values !== oldChunk.values
    ) {
      return false;
    }
  }
  return true;
}

/** Normalize a UTF-8 column prop for same-buffer comparison. */
function normalizeFastTextUtf8ColumnForComparison(
  textUtf8Column: FastTextUtf8Column
): FastTextUtf8ColumnSource | null {
  return isFastTextUtf8ColumnSource(textUtf8Column)
    ? textUtf8Column
    : buildFastTextUtf8ColumnSource(textUtf8Column);
}

/** Return whether an object has the normalized FastText UTF-8 source shape. */
function isFastTextUtf8ColumnSource(
  textUtf8Column: FastTextUtf8Column
): textUtf8Column is FastTextUtf8ColumnSource {
  return 'rowCount' in textUtf8Column && 'chunks' in textUtf8Column;
}

/** Return whether an accessor prop changed in a way deck.gl expects attributes to observe. */
function didFastTextAccessorPropChange<ValueT>(
  accessor: Accessor<any, ValueT>,
  oldAccessor: Accessor<any, ValueT>
): boolean {
  if (typeof oldAccessor === 'function') {
    return false;
  }
  if (typeof accessor === 'function') {
    return true;
  }
  return !areFastTextAccessorConstantsEqual(accessor, oldAccessor);
}

/** Return whether two non-function accessor constants are shallowly equivalent. */
function areFastTextAccessorConstantsEqual<ValueT>(
  accessor: Accessor<any, ValueT>,
  oldAccessor: Accessor<any, ValueT>
): boolean {
  if (accessor === oldAccessor) {
    return true;
  }
  if (!Array.isArray(accessor) || !Array.isArray(oldAccessor)) {
    return false;
  }
  if (accessor.length !== oldAccessor.length) {
    return false;
  }
  for (let index = 0; index < accessor.length; index += 1) {
    if (accessor[index] !== oldAccessor[index]) {
      return false;
    }
  }
  return true;
}

/** Emit one compact timing probe for a completed FastText attribute rebuild. */
function logFastTextAttributeBuildProbe(params: {
  /** Time spent resolving or generating the font atlas. */
  atlasDurationMs: number;
  /** Time spent creating GPU vertex buffers from generated attributes. */
  bufferCreateDurationMs: number;
  /** Time spent building CPU glyph attribute arrays. */
  glyphDataDurationMs: number;
  /** Detailed CPU glyph attribute build counters. */
  glyphStats: FastTextGlyphBuildStats;
  /** Deck layer id that rebuilt text attributes. */
  layerId: string;
  /** End-to-end time spent in the layer attribute rebuild. */
  totalDurationMs: number;
}): void {
  getFastTextProbeLog().probe(
    0,
    `%cFastTextLayer%c ${params.glyphStats.rowCount} rows in ${formatFastTextDurationMs(params.totalDurationMs)} ${params.layerId}`,
    FAST_TEXT_PROBE_LABEL_STYLE,
    '',
    {
      layerId: params.layerId,
      updateMode: 'full',
      sourceMode: params.glyphStats.sourceMode,
      layoutMode: params.glyphStats.layoutMode,
      rowCount: params.glyphStats.rowCount,
      glyphCount: params.glyphStats.glyphCount,
      attributeByteLength: params.glyphStats.attributeByteLength,
      atlasDurationMs: params.atlasDurationMs,
      glyphDataDurationMs: params.glyphDataDurationMs,
      columnNormalizeDurationMs: params.glyphStats.columnNormalizeDurationMs,
      countDurationMs: params.glyphStats.countDurationMs,
      allocateDurationMs: params.glyphStats.allocateDurationMs,
      writeDurationMs: params.glyphStats.writeDurationMs,
      textResolveDurationMs: params.glyphStats.textResolveDurationMs,
      styleAccessorDurationMs: params.glyphStats.styleAccessorDurationMs,
      layoutDurationMs: params.glyphStats.layoutDurationMs,
      glyphWriteDurationMs: params.glyphStats.glyphWriteDurationMs,
      bufferCreateDurationMs: params.bufferCreateDurationMs,
      totalDurationMs: params.totalDurationMs
    }
  )();
}

/** Emit one compact timing probe for a dynamic FastText attribute update. */
function logFastTextDynamicAttributeUpdateProbe(params: {
  /** Time spent uploading rewritten dynamic CPU arrays to GPU buffers. */
  bufferUploadDurationMs: number;
  /** Detailed dynamic glyph attribute update counters. */
  dynamicStats: FastTextDynamicGlyphUpdateStats;
  /** Deck layer id that updated text attributes. */
  layerId: string;
  /** End-to-end time spent in the layer dynamic attribute update. */
  totalDurationMs: number;
  /** Dynamic attribute groups that changed. */
  update: FastTextDynamicUpdate;
}): void {
  getFastTextProbeLog().probe(
    0,
    `%cFastTextLayer%c dynamic ${params.dynamicStats.rowCount} rows in ${formatFastTextDurationMs(params.totalDurationMs)} ${params.layerId}`,
    FAST_TEXT_PROBE_LABEL_STYLE,
    '',
    {
      layerId: params.layerId,
      updateMode: 'dynamic',
      updatePositions: params.update.positions,
      updateColors: params.update.colors,
      updateClipRects: params.update.clipRects,
      rowCount: params.dynamicStats.rowCount,
      glyphCount: params.dynamicStats.glyphCount,
      attributeByteLength: params.dynamicStats.attributeByteLength,
      positionAccessorDurationMs: params.dynamicStats.positionAccessorDurationMs,
      colorAccessorDurationMs: params.dynamicStats.colorAccessorDurationMs,
      clipRectAccessorDurationMs: params.dynamicStats.clipRectAccessorDurationMs,
      writeDurationMs: params.dynamicStats.writeDurationMs,
      bufferUploadDurationMs: params.bufferUploadDurationMs,
      totalDurationMs: params.totalDurationMs
    }
  )();
}

/** Format a duration for compact inline probe messages. */
function formatFastTextDurationMs(durationMs: number): string {
  return `${durationMs.toFixed(durationMs < 10 ? 2 : 1)}ms`;
}

/** Return the shared Tracevis debug log when it is available in the page. */
function getFastTextProbeLog(): {
  /** Probe.gl-compatible timing probe method. */
  probe: (logLevel: unknown, message?: unknown, ...args: unknown[]) => () => void;
} {
  const globalLog = (globalThis as {traceLayers?: {log?: typeof fastTextLog}}).traceLayers?.log;
  return globalLog ?? fastTextLog;
}

/** Create luma buffers for every per-glyph typed array. */
function createFastTextBuffers(
  device: LayerContext['device'],
  glyphData: FastTextGlyphData
): FastTextLayerBuffers {
  const {attributes} = glyphData;
  return {
    instanceGlyphData: createVertexBuffer(
      device,
      attributes.instanceGlyphData,
      new Uint8Array(FAST_TEXT_GLYPH_VERTEX_BYTE_STRIDE)
    ),
    instancePositions: createVertexBuffer(device, attributes.instancePositions, new Float32Array(2))
  };
}

/** Create one non-empty luma vertex buffer for a typed array. */
function createVertexBuffer<T extends ArrayBufferView>(
  device: LayerContext['device'],
  data: T,
  fallback: T
): Buffer {
  return device.createBuffer({
    data: data.byteLength > 0 ? data : fallback,
    usage: Buffer.VERTEX | Buffer.COPY_DST
  });
}

/** Destroy all owned glyph vertex buffers. */
function destroyFastTextBuffers(buffers?: FastTextLayerBuffers): void {
  if (!buffers) {
    return;
  }
  for (const buffer of Object.values(buffers)) {
    buffer.destroy();
  }
}

/** Upload one canvas-backed font atlas into a luma texture. */
function createFastTextAtlasTexture(
  device: LayerContext['device'],
  atlas: FastTextFontAtlas
): Texture {
  const texture = device.createTexture({
    format: 'rgba8unorm',
    data: null,
    width: atlas.width,
    height: atlas.height,
    sampler: DEFAULT_SAMPLER_PARAMETERS,
    mipLevels: device.getMipLevelCount(atlas.width, atlas.height)
  });
  texture.copyExternalImage({
    image: atlas.data,
    width: atlas.width,
    height: atlas.height
  });
  regenerateMipmaps(texture);
  return texture;
}

/** Regenerate texture mipmaps for WebGL or WebGPU devices. */
function regenerateMipmaps(texture: Texture): void {
  if (texture.device.type === 'webgl') {
    texture.generateMipmapsWebGL();
  } else if (texture.device.type === 'webgpu') {
    texture.device.generateMipmapsWebGPU(texture);
  }
}

/** Return the shader enum value for one fast-text content alignment mode. */
function getFastTextContentAlignUniform(mode: FastTextContentAlign): number {
  return FAST_TEXT_CONTENT_ALIGN[mode];
}
