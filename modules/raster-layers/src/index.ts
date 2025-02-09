// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Copyright 2022 Foursquare Labs, Inc.

export {RasterLayer} from './layers/raster-layer/raster-layer';
export {RasterMeshLayer} from './layers/raster-mesh-layer/raster-mesh-layer';

export type {ShaderModule} from './shadermodules/types';

// Create texture
export {
  combineBandsFloat,
  combineBandsUint,
  combineBandsInt
} from './shadermodules/texture/combine-bands';
export {rgbaImage} from './shadermodules/texture/rgba-image';
export {maskFloat, maskUint, maskInt} from './shadermodules/texture/mask';
export {reorderBands} from './shadermodules/texture/reorder-bands';

// Color operations
export {colormap} from './shadermodules/color/colormap';
export {linearRescale} from './shadermodules/color/linear-rescale';
export {sigmoidalContrast} from './shadermodules/color/sigmoidal-contrast';
export {gammaContrast} from './shadermodules/color/gamma-contrast';
export {saturation} from './shadermodules/color/saturation';
export {filter} from './shadermodules/color/filter';

// Pansharpening
export {pansharpenBrovey} from './shadermodules/pansharpen/pansharpen-brovey';

// Spectral indices
export {enhancedVegetationIndex} from './shadermodules/spectral-indices/evi';
export {modifiedSoilAdjustedVegetationIndex} from './shadermodules/spectral-indices/msavi';
export {normalizedDifference} from './shadermodules/spectral-indices/normalized-difference';
export {soilAdjustedVegetationIndex} from './shadermodules/spectral-indices/savi';
