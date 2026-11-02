import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const directory = path.resolve('data/canvas-generated');
const TTL_MS = 30 * 60 * 1000;
type Stored = { userId: string; file: string; mime: string; at: number };
const stored = new Map<string, Stored>();

function sweep() {
  const now = Date.now();
  for (const [id, item] of stored) {
    if (now - item.at <= TTL_MS) continue;
    stored.delete(id);
    fs.promises.unlink(path.join(directory, item.file)).catch(() => undefined);
  }
}

/** 物化后的画布图片只留短地址。调用方已完成格式与尺寸校验。 */
export async function storeGeneratedImage(userId: string, bytes: Buffer, mime: string): Promise<string> {
  sweep();
  const id = crypto.randomBytes(16).toString('hex');
  const ext = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
  const file = id + ext;
  await fs.promises.mkdir(directory, { recursive: true });
  const full = path.join(directory, file);
  const temp = full + '.tmp';
  await fs.promises.writeFile(temp, bytes);
  await fs.promises.rename(temp, full);
  stored.set(id, { userId, file, mime, at: Date.now() });
  return '/api/canvas/generated/' + id;
}

export function readGeneratedImage(userId: string, url: string): { bytes: Buffer; mime: string } | null {
  const match = /^\/api\/canvas\/generated\/([a-f0-9]{32})$/.exec(String(url || ''));
  if (!match) return null;
  const item = stored.get(match[1]);
  if (!item || item.userId !== userId || Date.now() - item.at > TTL_MS) return null;
  const full = path.join(directory, path.basename(item.file));
  if (!full.startsWith(directory + path.sep)) return null;
  try { return { bytes: fs.readFileSync(full), mime: item.mime }; }
  catch { return null; }
}

export function generatedImageFile(userId: string, id: string): { full: string; mime: string } | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const item = stored.get(id);
  if (!item || item.userId !== userId || Date.now() - item.at > TTL_MS) return null;
  const full = path.join(directory, path.basename(item.file));
  if (!full.startsWith(directory + path.sep) || !fs.existsSync(full)) return null;
  return { full, mime: item.mime };
}
