import { MAX_IMAGE_BYTES } from '../../src/shared/imageSpecs.js';
export type ImageDimensions = { width: number; height: number };

function jpegDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda) break;
    if (offset + 1 >= bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const sof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
    if (sof && length >= 7) return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    offset += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): ImageDimensions | null {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null;
  const kind = bytes.toString('ascii', 12, 16);
  if (kind === 'VP8X') {
    return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
  }
  if (kind === 'VP8 ' && bytes.length >= 30) {
    const sync = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (sync >= 0 && sync + 7 < bytes.length) return { width: bytes.readUInt16LE(sync + 3) & 0x3fff, height: bytes.readUInt16LE(sync + 5) & 0x3fff };
  }
  if (kind === 'VP8L' && bytes.length >= 25) {
    const b = bytes[21];
    if (b === 0x2f && bytes.length >= 25) {
      const width = 1 + ((bytes[22] | (bytes[23] << 8)) & 0x3fff);
      const height = 1 + (((bytes[23] >> 6) | (bytes[24] << 2) | ((bytes[25] & 0x03) << 10)) & 0x3fff);
      return { width, height };
    }
  }
  return null;
}

export function readImageDimensions(bytes: Buffer): ImageDimensions {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片超过 32MB，无法保存');
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const jpeg = jpegDimensions(bytes);
  if (jpeg) return jpeg;
  const webp = webpDimensions(bytes);
  if (webp) return webp;
  throw new Error('无法读取生成图片尺寸');
}

/**
 * 只接受原生 16:9 返回结果。这里不做裁剪、缩放或补边，避免改变 Image
 * 原生构图；不符合时让任务失败并沿用失败页退款机制。
 */
export function assertNative16x9(bytes: Buffer, label = '生成图片'): ImageDimensions {
  const dimensions = readImageDimensions(bytes);
  const ratio = dimensions.width / dimensions.height;
  if (!Number.isFinite(ratio) || Math.abs(ratio - 16 / 9) > 0.005) {
    throw new Error(label + '必须是原生 16:9，当前为 ' + dimensions.width + '×' + dimensions.height + '；未进行裁剪，请重试');
  }
  return dimensions;
}

export function dataUrlBytes(value: string): Buffer {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(value);
  if (!match) throw new Error('图片数据格式无效');
  return Buffer.from(match[2], 'base64');
}


/** Verify the native output; never resize a provider's wrong-size response. */
export function assertRequestedImageSize(bytes: Buffer, requestedSize: string, label = '生成图片'): ImageDimensions {
  const actual = readImageDimensions(bytes);
  const expected = /^(\d+)x(\d+)$/i.exec(requestedSize);
  if (!expected) throw new Error('请求图片尺寸无效');
  if (actual.width !== Number(expected[1]) || actual.height !== Number(expected[2])) {
    throw new Error(label + '尺寸不符合所选画质：请求 ' + expected[1] + '×' + expected[2] + '，接口返回 ' + actual.width + '×' + actual.height + '；请检查中转站画质参数，未进行缩放');
  }
  return actual;
}

/** 2K is the upstream medium tier; retain native pixels while checking the selected aspect ratio. */
export function assertRequestedNativeImageSize(
  bytes: Buffer,
  requestedSize: string,
  resolution: '2K' | '4K',
  label = '生成图片',
): ImageDimensions {
  if (resolution === '4K') return assertRequestedImageSize(bytes, requestedSize, label);
  const actual = readImageDimensions(bytes);
  const expected = /^(\d+)x(\d+)$/i.exec(requestedSize);
  if (!expected || Number(expected[1]) <= 0 || Number(expected[2]) <= 0) throw new Error('请求图片尺寸无效');
  const expectedRatio = Number(expected[1]) / Number(expected[2]);
  if (!actual.width || !actual.height || Math.abs(actual.width / actual.height / expectedRatio - 1) > 0.005) {
    throw new Error(label + '比例不符合要求：请求 ' + expected[1] + '×' + expected[2] + '，接口返回 ' + actual.width + '×' + actual.height + '；未进行裁剪或缩放');
  }
  if (actual.width * actual.height < 655360) throw new Error(label + '返回图片分辨率过低：' + actual.width + '×' + actual.height);
  return actual;
}

/** PPT 2K follows the reference project's medium tier and keeps native output pixels. */
export function assertPptImageSize(bytes: Buffer, requestedSize: string, resolution: '2K' | '4K', label = '生成图片'): ImageDimensions {
  assertNative16x9(bytes, label);
  return assertRequestedNativeImageSize(bytes, requestedSize, resolution, label);
}
