// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';
import {PathStyleExtension} from '@deck.gl/extensions';
import {PathLayer} from '@deck.gl/layers';

import type {Accessor, Color, DefaultProps, Layer, LayerExtension} from '@deck.gl/core';
import type {PathLayerProps} from '@deck.gl/layers';

const DEFAULT_OUTLINE_COLOR: Color = [15, 23, 42, 180];
const DEFAULT_OUTLINE_WIDTH_SCALE = 1.2;

type PathOutlineLayerExtraProps<DataT> = {
  /** Dash pattern accessor forwarded through `PathStyleExtension`. */
  getDashArray?: Accessor<DataT, readonly [number, number] | null>;
  /** Whether dash lengths are stretched to align with path endpoints. */
  dashJustified?: boolean;
  /** Color accessor used by the outline stroke rendered behind the path. */
  getOutlineColor?: Accessor<DataT, Color>;
  /** Multiplier applied to `widthScale` for the outline stroke. */
  outlineWidthScale?: number;
  /** Legacy z-order accessor retained for compatibility with older nebula.gl callers. */
  getZLevel?: Accessor<DataT, number>;
};

/** Properties supported by {@link PathOutlineLayer}. */
export type PathOutlineLayerProps<DataT = unknown> = PathLayerProps<DataT> &
  PathOutlineLayerExtraProps<DataT>;

const defaultProps: DefaultProps<PathOutlineLayerExtraProps<any>> = {
  getDashArray: {type: 'accessor', value: null},
  dashJustified: false,
  getOutlineColor: {type: 'accessor', value: DEFAULT_OUTLINE_COLOR},
  outlineWidthScale: {type: 'number', min: 1, value: DEFAULT_OUTLINE_WIDTH_SCALE},
  getZLevel: {type: 'accessor', value: 0}
};

/** Renders a deck.gl `PathLayer` with a crisp outline stroke behind it. */
export class PathOutlineLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<
  ExtraPropsT & PathOutlineLayerProps<DataT> & Required<PathOutlineLayerExtraProps<DataT>>
> {
  static override layerName = 'PathOutlineLayer';
  static override defaultProps = defaultProps;

  override renderLayers(): Layer[] {
    const {
      extensions,
      getColor,
      getOutlineColor,
      outlineWidthScale,
      parameters,
      updateTriggers = {},
      widthScale,
      dashJustified,
      getDashArray,
      getZLevel: _getZLevel
    } = this.props as PathOutlineLayerProps<DataT>;

    const pathExtensions = getDashArray
      ? ensurePathStyleExtension(extensions)
      : getLayerExtensions(extensions);
    const pathParameters = getPathRenderParameters(parameters);
    const baseWidthScale = widthScale ?? 1;
    const resolvedOutlineWidthScale = outlineWidthScale ?? DEFAULT_OUTLINE_WIDTH_SCALE;
    const pathDashProps = getDashArray
      ? {
          dashJustified,
          getDashArray: normalizeDashArrayAccessor(getDashArray)
        }
      : {};
    const outlineDashProps = getDashArray
      ? {
          dashJustified,
          getDashArray: normalizeDashArrayAccessor(getDashArray, 1 / resolvedOutlineWidthScale)
        }
      : {};

    return [
      new PathLayer<DataT>(
        this.props as unknown as PathLayerProps<DataT>,
        this.getSubLayerProps({
          ...outlineDashProps,
          id: 'outline',
          extensions: pathExtensions,
          getColor: getOutlineColor,
          parameters: pathParameters,
          updateTriggers: {
            ...updateTriggers,
            getColor: updateTriggers['getOutlineColor'],
            getWidth: updateTriggers['getWidth']
          },
          widthScale: baseWidthScale * resolvedOutlineWidthScale
        })
      ),
      new PathLayer<DataT>(
        this.props as unknown as PathLayerProps<DataT>,
        this.getSubLayerProps({
          ...pathDashProps,
          id: 'path',
          extensions: pathExtensions,
          getColor,
          parameters: pathParameters,
          updateTriggers,
          widthScale
        })
      )
    ];
  }
}

function ensurePathStyleExtension(extensions: readonly LayerExtension[] = []): LayerExtension[] {
  const hasPathStyle = extensions.some(
    extension =>
      (extension.constructor as typeof PathStyleExtension).extensionName ===
      PathStyleExtension.extensionName
  );

  return hasPathStyle
    ? [...extensions]
    : [...extensions, new PathStyleExtension({dash: true, highPrecisionDash: true})];
}

function getLayerExtensions(extensions: readonly LayerExtension[] = []): LayerExtension[] {
  return [...extensions];
}

function normalizeDashArrayAccessor<DataT>(
  getDashArray: PathOutlineLayerProps<DataT>['getDashArray'],
  scale = 1
) {
  if (typeof getDashArray === 'function') {
    return (datum: DataT, info: any) => scaleDashArray(getDashArray(datum, info), scale);
  }
  return scaleDashArray(getDashArray, scale);
}

function scaleDashArray(
  dashArray: readonly [number, number] | null | undefined,
  scale: number
): [number, number] {
  const [dashSize, gapSize] = dashArray ?? [0, 0];
  return [dashSize * scale, gapSize * scale];
}

function getPathRenderParameters(parameters: PathLayerProps['parameters']) {
  const {depthTest: _depthTest, ...rest} = (parameters ?? {}) as Record<string, unknown>;

  return {
    ...rest,
    depthCompare: 'always' as const,
    depthWriteEnabled: false
  };
}
