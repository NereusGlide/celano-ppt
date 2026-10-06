import test from 'node:test';
import assert from 'node:assert/strict';
import { composeEditInput } from './draw.js';

test('local edits and masks preserve native pixels at every resolution', async t => {
  let dimensions = [1280, 720];
  const canvases: any[] = [];
  class MockImage {
    naturalWidth = dimensions[0]; naturalHeight = dimensions[1];
    onload?: () => void; crossOrigin = '';
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'Image', { configurable: true, value: MockImage });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => {
    const canvas = { width: 0, height: 0, drawn: [] as unknown[], getContext: () => ({ drawImage: (...args: unknown[]) => { canvas.drawn = args; }, fillRect: () => {} }), toDataURL: () => 'data:image/png;base64,test' };
    canvases.push(canvas); return canvas;
  } } });
  t.after(() => {
    if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage); else delete (globalThis as any).Image;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete (globalThis as any).document;
  });
  for (dimensions of [[1280,720],[2048,1152],[3840,2160]]) {
    canvases.length = 0;
    await composeEditInput('test', [{ kind: 'box', x: .1, y: .1, w: .2, h: .2, number: 1, instruction: 'test' }]);
    assert.equal(canvases.length, 2);
    for (const canvas of canvases) assert.deepEqual([canvas.width, canvas.height], dimensions);
    assert.deepEqual(canvases[0].drawn.slice(1), [0, 0, ...dimensions]);
  }
  await assert.rejects(composeEditInput('test', [], 1280, 720), /保留原图像素尺寸/);
});
