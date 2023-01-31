// @noflow
/**
 * Generate texture atlas from images
 * ```
 * npm install bin-pack ndarry get-pixels save-pixels datauri
 * node pack-images <input_path> <output_path>
 * ```
 */

var INPUT_DIR = process.argv[2];
var OUTPUT_IMAGE = process.argv[3] + 'marker-atlas.png';
var OUTPUT_MAPPING = process.argv[3] + 'marker-mapping.js';
var OUTPUT_DATA_URL = process.argv[3] + 'atlas-data-url.js';
var OUTPUT_LIST = process.argv[3] + 'marker-list.js';
var IMAGE_PATTERN = /\.(png|jpg|jpeg|gif|bmp|tiff)$/i;

var fs = require('fs'),
  path = require('path'),
  ndarray = require('ndarray'),
  savePixels = require('save-pixels'),
  getPixels = require('get-pixels'),
  pack = require('bin-pack'),
  Datauri = require('datauri');

// Get all images in the input path
const fileNames = fs
  .readdirSync(INPUT_DIR)
  .filter(name => IMAGE_PATTERN.test(name));

Promise.all(
  fileNames.map(name => readImage(path.resolve(INPUT_DIR, name)))
).then(images => {
  // Images are loaded
  const nodes = images.map((pixels, index) => ({
    name: fileNames[index],
    pixels,
    width: pixels.shape[0],
    height: pixels.shape[1],
  }));

  // Bin pack
  const result = pack(nodes);
  // console.log(result.items.length + ' items packed.');

  // Convert to texture atlas
  const outputJSON = {};
  const outputImage = createImage(result.width, result.height);
  result.items.forEach(item => {
    outputJSON[item.item.name.replace(IMAGE_PATTERN, '')] = {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      mask: true,
    };
    copyPixels(item.item.pixels, outputImage, item.x, item.y);
  });

  // Write to disk
  writeMapping(OUTPUT_MAPPING, outputJSON);
  writeImage(OUTPUT_IMAGE, outputImage, () =>
    writeDataURL(OUTPUT_IMAGE, OUTPUT_DATA_URL)
  );
  writeList(OUTPUT_LIST, outputJSON);
});

/* Utils */

function copyPixels(fromImage, toImage, x, y) {
  const width = fromImage.shape[0],
    height = fromImage.shape[1],
    channels = fromImage.shape[2];

  for (let i = 0; i < width; i++) {
    for (let j = 0; j < height; j++) {
      for (let k = 0; k < channels; k++) {
        const value = fromImage.get(i, j, k);
        toImage.set(i + x, j + y, k, value);
      }
    }
  }
}

function writeMapping(filePath, content) {
  const contentStr = JSON.stringify(content, null, 2);
  exportJSFile(filePath, contentStr);
}

function createImage(width, height) {
  return ndarray(new Uint8ClampedArray(width * height * 4), [width, height, 4]);
}

function writeDataURL(imagePath, outputFilePath) {
  const datauri = new Datauri(imagePath);
  const content = {dataURL: datauri.content};
  const contentStr = JSON.stringify(content, null, 2);
  exportJSFile(outputFilePath, contentStr);
}

function writeList(filePath, content) {
  const markers = Object.keys(content);
  const markerMap = markers.reduce((res, marker) => {
    res[marker] = marker;
    return res;
  }, {});
  const contentStr = JSON.stringify(markerMap, null, 2);
  exportJSFile(filePath, contentStr);
}

function exportJSFile(filePath, contentStr) {
  fs.writeFileSync(
    filePath,
    `/* eslint-disable */\nexport default ${contentStr};\n/* eslint-enable */\n`
  );
}

function readImage(filePath) {
  return new Promise(function(resolve, reject) {
    getPixels(filePath, function(err, pixels) {
      if (err) {
        resolve(null);
      } else {
        resolve(pixels);
      }
    });
  });
}

function writeImage(filePath, pixelArr, createDataURL) {
  const file = fs.createWriteStream(filePath);
  savePixels(pixelArr, 'png').pipe(file);
  file.on('finish', createDataURL);
}
