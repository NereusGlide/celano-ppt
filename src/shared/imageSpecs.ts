/** Native image specifications shared by the UI, billing and image requests. */
export type ImageResolution = '2K' | '4K';
/** 零售价：2K 生图/修改 5 点，4K 生图/修改 10 点。 */
export const IMAGE_COST: Record<ImageResolution, number> = { '2K': 5, '4K': 10 };
export const IMAGE_QUALITY: Record<ImageResolution, string> = { '2K': 'medium', '4K': 'high' };
export const IMAGE_SIZE_PRESETS: Record<string, Record<string, string>> = {
  // Reference canvas: explicit 2K presets plus its 2048² area / 16-pixel unit calculation.
  '2k': { '1:1': '2048x2048', '2:3': '1664x2496', '3:2': '2496x1664', '4:3': '2368x1776', '3:4': '1776x2368', '16:9': '2048x1152', '9:16': '1152x2048', '21:9': '3136x1344', '9:21': '1344x3136' },
  '4k': { '1:1': '2880x2880', '2:3': '2336x3520', '3:2': '3520x2336', '4:3': '3312x2480', '3:4': '2480x3312', '16:9': '3840x2160', '9:16': '2160x3840', '21:9': '3840x1648', '9:21': '1648x3840' },
};
export const PPT_PAGE_WIDTH = 40 / 3;
export const PPT_PAGE_HEIGHT = 7.5;
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
export const MAX_IMAGE_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 100;
export function normalizeImageResolution(value: unknown): ImageResolution {
  const resolution = String(value || '').toUpperCase();
  return resolution === '2K' || resolution === '4K' ? resolution : '2K';
}
export function imageSizeFor(value: unknown, ratio = '16:9'): string {
  const size = IMAGE_SIZE_PRESETS[normalizeImageResolution(value).toLowerCase()][ratio];
  if (!size) throw new Error('不支持的图片比例');
  return size;
}
export function pixelResolution(size: string): ImageResolution | undefined {
  const match = /^(\d+)x(\d+)$/i.exec(size);
  if (!match) return undefined;
  const normalized = Number(match[1]) + 'x' + Number(match[2]);
  const preset = Object.entries(IMAGE_SIZE_PRESETS).find(([, sizes]) => Object.values(sizes).includes(normalized));
  if (preset) return preset[0].toUpperCase() as ImageResolution;
  const pixels = Number(match[1]) * Number(match[2]);
  return pixels <= 2048 * 2048 ? '2K' : '4K';
}
