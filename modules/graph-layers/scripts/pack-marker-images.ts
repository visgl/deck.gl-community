/**
 * Generate texture atlas from PNG images
 * ```
 * # default input/output
 * npx tsx ./pack-marker-images.ts
 *
 * # custom input/output directories
 * npx tsx ./pack-marker-images.ts [inputDir] [outputDir]
 * ```
 */

/* eslint-disable */

import {readFile, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import pack from 'bin-pack';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');

const inputDir = process.argv[2] || 'src/layers/common-layers/marker-layer/markers/';
const outputDir = process.argv[3] || 'src/layers/common-layers/marker-layer/';

const INPUT_DIR = resolve(packageRoot, inputDir);
const OUTPUT_IMAGE = resolve(packageRoot, outputDir, 'marker-atlas.png');
const OUTPUT_MAPPING = resolve(packageRoot, outputDir, 'marker-mapping.ts');
const OUTPUT_DATA_URL = resolve(packageRoot, outputDir, 'atlas-data-url.ts');
const OUTPUT_LIST = resolve(packageRoot, outputDir, 'marker-list.ts');
const IMAGE_PATTERN = /\.png$/i;

// Get all images in the input path
const fileNames = (await readdir(INPUT_DIR)).filter(name => IMAGE_PATTERN.test(name));

await Promise.all(fileNames.map((name: string) => readImage(resolve(INPUT_DIR, name)))).then(
  async images => {
    // Images are loaded
    const nodes = images.map((pixels: PNG, index: number) => ({
      name: fileNames[index],
      pixels,
      width: pixels.width,
      height: pixels.height
    }));

    // Bin pack
    const result = pack(nodes);
    // console.log(result.items.length + ' items packed.');

    // Convert to texture atlas
    const outputJSON: Record<
      string,
      {x: number; y: number; width: number; height: number; mask: boolean}
    > = {};
    const outputImage = createImage(result.width, result.height);
    result.items.forEach(item => {
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
    const imageBuffer = PNG.sync.write(outputImage);
    await writeFile(OUTPUT_IMAGE, imageBuffer);
    await writeDataURL(imageBuffer, OUTPUT_DATA_URL);
    await writeList(OUTPUT_LIST, outputJSON);
  }
);

/* Utils */

function copyPixels(fromImage: PNG, toImage: PNG, x: number, y: number): void {
  PNG.bitblt(fromImage, toImage, 0, 0, fromImage.width, fromImage.height, x, y);
}

async function writeMapping(filePath: string, content: unknown): Promise<void> {
  await exportJSFile(filePath, 'MarkerMapping', JSON.stringify(content, null, 2));
}

function createImage(width: number, height: number): PNG {
  return new PNG({width, height, fill: true});
}

async function writeDataURL(imageBuffer: Buffer, outputFilePath: string): Promise<void> {
  const content = {dataURL: `data:image/png;base64,${imageBuffer.toString('base64')}`};
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

async function exportJSFile(
  filePath: string,
  exportName: string,
  contentStr: string
): Promise<void> {
  await writeFile(
    filePath,
    `/* eslint-disable */\nexport const ${exportName} = ${contentStr};\n/* eslint-enable */\n`
  );
}

async function readImage(filePath: string): Promise<PNG> {
  return PNG.sync.read(await readFile(filePath));
}

/* eslint-enable */
