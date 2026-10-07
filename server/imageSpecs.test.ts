import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_SIZE_PRESETS, imageSizeFor, pixelResolution, PPT_PAGE_HEIGHT, PPT_PAGE_WIDTH, IMAGE_COST } from '../src/shared/imageSpecs.js';
import { assertRequestedNativeImageSize } from './ppt/imageDimensions.js';

test('all image presets have consistent resolution tiers and valid native dimensions', () => {
  for (const [scale, presets] of Object.entries(IMAGE_SIZE_PRESETS)) for (const size of Object.values(presets)) {
    const [width, height] = size.split('x').map(Number);
    assert.equal(pixelResolution(size), scale.toUpperCase());
    assert.equal(width % 16, 0); assert.equal(height % 16, 0);
    assert.ok(width * height >= 655360 && width * height <= 8294400);
    assert.ok(Math.max(width, height) <= 3840);
  }
  for (const resolution of ['2K','4K']) {
    const [width, height] = imageSizeFor(resolution).split('x').map(Number);
    assert.equal(width / height, 16 / 9);
  }
  assert.ok(Math.abs(PPT_PAGE_WIDTH / PPT_PAGE_HEIGHT - 16 / 9) < 1e-12);
  assert.deepEqual(IMAGE_COST, { '2K': 10, '4K': 20 });
});

test('every 2K ratio matches the reference canvas presets or its area-based calculation', () => {
  const presets: Record<string, string> = { '1:1': '2048x2048', '16:9': '2048x1152', '9:16': '1152x2048', '21:9': '3136x1344', '9:21': '1344x3136' };
  for (const [ratio, size] of Object.entries(IMAGE_SIZE_PRESETS['2k'])) {
    const [w, h] = ratio.split(':').map(Number);
    const unit = Math.round(Math.sqrt(2048 * 2048 / (w * h)) / 16) * 16;
    assert.equal(size, presets[ratio] || `${w * unit}x${h * unit}`);
    const [requestedWidth, requestedHeight] = size.split('x').map(Number);
    const bytes = Buffer.alloc(24);
    Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
    bytes.writeUInt32BE(Math.round(requestedWidth * 0.85), 16);
    bytes.writeUInt32BE(Math.round(requestedHeight * 0.85), 20);
    const dimensions = assertRequestedNativeImageSize(bytes, size, '2K');
    assert.equal(dimensions.width, Math.round(requestedWidth * 0.85));
    assert.equal(dimensions.height, Math.round(requestedHeight * 0.85));
    assert.throws(() => assertRequestedNativeImageSize(bytes, size, '4K'), /尺寸不符合/);
  }
});
