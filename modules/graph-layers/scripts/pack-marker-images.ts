/**
 * Generate texture atlas from images
 * ```
 * # default input/output
 * npx tsx ./pack-marker-images.ts
 *
 * # custom input/output directories
 * npx tsx ./pack-marker-images.ts [inputDir] [outputDir]
 * ```
 */

import {readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import { fileURLToPath } from 'node:url';
import ndarray, {NdArray} from 'ndarray';
import {getPixels, savePixels} from 'ndarray-pixels';
import pack from 'bin-pack';
import Datauri from 'datauri';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');

const inputDir = process.argv[2] || 'src/layers/common-layers/marker-layer/markers/';
const outputDir = process.argv[3] || 'src/layers/common-layers/marker-layer/';

const INPUT_DIR = resolve(packageRoot, inputDir);
const OUTPUT_IMAGE = resolve(packageRoot, outputDir, 'marker-atlas.png');
const OUTPUT_MAPPING = resolve(packageRoot, outputDir, `marker-mapping.ts`);
const OUTPUT_DATA_URL = resolve(packageRoot, outputDir, 'atlas-data-url.ts');
const OUTPUT_LIST = resolve(packageRoot, outputDir, 'marker-list.ts');
const IMAGE_PATTERN = /\.(png|jpg|jpeg|gif|bmp|tiff)$/i;

// Get all images in the input path
const fileNames = (await readdir(INPUT_DIR)).filter((name) => IMAGE_PATTERN.test(name));

Promise.all(fileNames.map((name: string) => readImage(resolve(INPUT_DIR, name)))).then(async (images) => {
  // Images are loaded
  const nodes = images.map((pixels: NdArray, index: number) => ({
    name: fileNames[index],
    pixels,
    width: pixels.shape[0],
    height: pixels.shape[1]
  }));

  // Bin pack
  const result = pack(nodes);
  // console.log(result.items.length + ' items packed.');

  // Convert to texture atlas
  const outputJSON = {};
  const outputImage = createImage(result.width, result.height);
  result.items.forEach((item) => {
    outputJSON[item.item.name.replace(IMAGE_PATTERN, '')] = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      mask: true
    };
    copyPixels(item.item.pixels, outputImage, item.x, item.y);
  });

  // Write to disk
  await writeMapping(OUTPUT_MAPPING, outputJSON);
  await writeImage(OUTPUT_IMAGE, outputImage, () => writeDataURL(OUTPUT_IMAGE, OUTPUT_DATA_URL));
  await writeList(OUTPUT_LIST, outputJSON);
});

/* Utils */

function copyPixels(fromImage: NdArray, toImage: NdArray, x: number, y: number): void {
  const width = fromImage.shape[0];
  const height = fromImage.shape[1];
  const channels = fromImage.shape[2];

  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      for (let k = 0; k < channels; k++) {
        const value = fromImage.get(i, j, k);
        toImage.set(i + x, j + y, k, value);
      }
    }
  }
}

async function writeMapping(filePath: string, content: unknown): Promise<void> {
  await exportJSFile(filePath, 'MarkerMapping', JSON.stringify(content, null, 2));
}

function createImage(width: number, height: number): NdArray<Uint8ClampedArray> {
  return ndarray(new Uint8ClampedArray(width * height * 4), [width, height, 4]);
}

async function writeDataURL(imagePath: string, outputFilePath: string): Promise<void> {
  const content = {dataURL: await Datauri(imagePath)};
  await exportJSFile(outputFilePath, 'AtlasDataURL', JSON.stringify(content, null, 2));
}

async function writeList(filePath: string, content: object): Promise<void> {
  const markers = Object.keys(content);
  const markerMap = markers.reduce((res, marker) => {
    res[marker] = marker;
    return res;
  }, {});
  const contentStr = JSON.stringify(markerMap, null, 2);
  await exportJSFile(filePath, 'MarkerList', contentStr);
}

async function exportJSFile(filePath: string, exportName: string, contentStr: string): Promise<void> {
  await writeFile(
    filePath,
    `/* eslint-disable */\nexport const ${exportName} = ${contentStr};\n/* eslint-enable */\n`
  );
}

async function readImage(filePath: string): Promise<NdArray> {
  return readFile(filePath).then((buffer) => getPixels(buffer, 'image/png'));
}

async function writeImage(filePath: string, pixelArr: NdArray<Uint8ClampedArray>, createDataURL: () => void): Promise<void> {
  await writeFile(filePath, await savePixels(pixelArr, 'image/png'));
  createDataURL();
}
