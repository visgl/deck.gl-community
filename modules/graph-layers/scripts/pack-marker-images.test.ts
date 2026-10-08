import {execFile} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {PNG} from 'pngjs';
import {expect, test} from 'vitest';

test('packs PNG pixels and emits matching metadata and data URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'marker-packing-'));
  try {
    const source = new PNG({width: 2, height: 1});
    source.data = Buffer.from([255, 0, 0, 255, 0, 128, 255, 64]);
    await writeFile(join(directory, 'color.png'), PNG.sync.write(source));
    const gray = new PNG({width: 1, height: 2});
    gray.data = Buffer.from([100, 100, 100, 255, 200, 200, 200, 255]);
    await writeFile(join(directory, 'gray.png'), PNG.sync.write(gray, {colorType: 0}));
    await promisify(execFile)(process.execPath, [
      new URL('./pack-marker-images.ts', import.meta.url).pathname,
      directory,
      directory
    ]);
    const readExport = async (name: string) => {
      const text = await readFile(join(directory, name), 'utf8');
      return JSON.parse(text.slice(text.indexOf('=') + 1, text.lastIndexOf(';')));
    };
    const mapping = await readExport('marker-mapping.ts');
    const atlasBuffer = await readFile(join(directory, 'marker-atlas.png'));
    const atlas = PNG.sync.read(atlasBuffer);
    for (const [name, image] of [
      ['color', source],
      ['gray', gray]
    ] as const) {
      const {x, y, width, height, mask} = mapping[name];
      expect({width, height, mask}).toEqual({width: image.width, height: image.height, mask: true});
      for (let row = 0; row < height; row++) {
        const offset = ((y + row) * atlas.width + x) * 4;
        expect(atlas.data.subarray(offset, offset + width * 4)).toEqual(
          image.data.subarray(row * width * 4, (row + 1) * width * 4)
        );
      }
    }
    expect(await readExport('marker-list.ts')).toEqual({color: 'color', gray: 'gray'});
    expect((await readExport('atlas-data-url.ts')).dataURL).toBe(
      `data:image/png;base64,${atlasBuffer.toString('base64')}`
    );
    for (let y = 0; y < atlas.height; y++) {
      for (let x = 0; x < atlas.width; x++) {
        const occupied = Object.values(mapping).some(
          (item: {x: number; y: number; width: number; height: number}) =>
            x >= item.x && x < item.x + item.width && y >= item.y && y < item.y + item.height
        );
        if (!occupied) {
          const offset = (y * atlas.width + x) * 4;
          expect([...atlas.data.subarray(offset, offset + 4)]).toEqual([0, 0, 0, 0]);
        }
      }
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
