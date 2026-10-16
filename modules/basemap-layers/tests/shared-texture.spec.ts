/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {SharedTextureSet, getSharedTextureCount} from '../src/shared-texture';

/** A device stub that records the textures it creates. */
function createDevice() {
  const textures: any[] = [];
  const device = {
    type: 'webgl',
    getMipLevelCount: vi.fn(() => 3),
    createTexture: vi.fn((props: any) => {
      const texture = {
        props,
        destroy: vi.fn(),
        generateMipmapsWebGL: vi.fn()
      };
      textures.push(texture);
      return texture;
    })
  };
  return {device: device as any, textures};
}

class FakeBitmap {
  width = 4;
  height = 2;
}

describe('SharedTextureSet', () => {
  test('creates one texture per image and device, shared by every user', () => {
    const {device, textures} = createDevice();
    const image = new FakeBitmap();
    const a = new SharedTextureSet(device);
    const b = new SharedTextureSet(device);
    expect(a.get(image)).toBe(b.get(image));
    expect(a.get(image)).toBe(textures[0]);
    expect(device.createTexture).toHaveBeenCalledTimes(1);
    // Created as deck.gl creates the texture of an `image` prop.
    expect(textures[0].props).toMatchObject({
      data: image,
      mipLevels: 3,
      sampler: {
        minFilter: 'linear',
        mipmapFilter: 'linear',
        magFilter: 'linear'
      }
    });
    expect(textures[0].generateMipmapsWebGL).toHaveBeenCalledTimes(1);

    const other = createDevice();
    expect(new SharedTextureSet(other.device).get(image)).not.toBe(textures[0]);
  });

  test('passes a plain image object through, as deck.gl does', () => {
    const {device, textures} = createDevice();
    const canvas = new FakeBitmap();
    new SharedTextureSet(device).get({data: canvas, width: 4, height: 1});
    expect(textures[0].props).toMatchObject({
      data: canvas,
      width: 4,
      height: 1
    });
  });

  test('takes the mip levels from the size of a plain image object with raw pixels', () => {
    const {device} = createDevice();
    new SharedTextureSet(device).get({data: new Uint8Array(4 * 8 * 2), width: 8, height: 2});
    expect(device.getMipLevelCount).toHaveBeenCalledWith(8, 2);
    new SharedTextureSet(device).get(new FakeBitmap());
    expect(device.getMipLevelCount).toHaveBeenLastCalledWith(4, 2);
  });

  test('destroys a texture when its last user releases it', () => {
    const {device, textures} = createDevice();
    const image = new FakeBitmap();
    const a = new SharedTextureSet(device);
    const b = new SharedTextureSet(device);
    a.get(image);
    a.get(image);
    b.get(image);
    a.releaseAll();
    expect(textures[0].destroy).not.toHaveBeenCalled();
    expect(getSharedTextureCount(device)).toBe(1);
    b.retainOnly([]);
    expect(textures[0].destroy).toHaveBeenCalledTimes(1);
    expect(getSharedTextureCount(device)).toBe(0);
    // A later user gets a new texture.
    expect(a.get(image)).toBe(textures[1]);
  });

  test('retainOnly keeps the images still in use', () => {
    const {device, textures} = createDevice();
    const [first, second] = [new FakeBitmap(), new FakeBitmap()];
    const set = new SharedTextureSet(device);
    set.get(first);
    set.get(second);
    set.retainOnly([second]);
    expect(textures[0].destroy).toHaveBeenCalledTimes(1);
    expect(textures[1].destroy).not.toHaveBeenCalled();
    expect(set.get(second)).toBe(textures[1]);
    expect(device.createTexture).toHaveBeenCalledTimes(2);
  });

  test('keeps at most maxMipLevels levels, in textures of their own', () => {
    const {device, textures} = createDevice();
    const image = new FakeBitmap();
    const full = new SharedTextureSet(device);
    const two = new SharedTextureSet(device, {maxMipLevels: 2});
    const alsoTwo = new SharedTextureSet(device, {maxMipLevels: 2});
    expect(full.get(image)).toBe(textures[0]);
    expect(two.get(image)).toBe(textures[1]);
    expect(alsoTwo.get(image)).toBe(textures[1]);
    expect(textures[0].props.mipLevels).toBe(3);
    expect(textures[1].props.mipLevels).toBe(2);
    expect(getSharedTextureCount(device)).toBe(2);
    // Each set releases its own texture.
    two.releaseAll();
    alsoTwo.releaseAll();
    expect(textures[1].destroy).toHaveBeenCalledTimes(1);
    expect(textures[0].destroy).not.toHaveBeenCalled();
    // A cap above the full chain keeps the full chain; one level is the image alone.
    new SharedTextureSet(device, {maxMipLevels: 8}).get(image);
    expect(textures[2].props.mipLevels).toBe(3);
    new SharedTextureSet(device, {maxMipLevels: 1}).get(image);
    expect(textures[3].props.mipLevels).toBe(1);
  });
});
