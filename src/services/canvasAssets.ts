import { publishLibraryChange } from '../shared/libraryEvents.js';

export type CanvasAsset = {
  id: string;
  kind: 'text' | 'image';
  title: string;
  coverUrl: string;
  tags: string[];
  note?: string;
  metadata?: { source?: string; projectId?: string; nodeId?: string; imageId?: string };
  createdAt: string;
  updatedAt: string;
  data: { content?: string; dataUrl?: string; width?: number; height?: number; bytes?: number; mimeType?: string };
};

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  if (!response.ok) {
    // 服务异常时可能返回非 JSON（如 502 HTML 页），json() 会抛 SyntaxError，先兜底
    const result = await response.json().catch(() => null) as { error?: { message?: string } | string } | null;
    const error = result?.error;
    const message = typeof error === 'string' ? error : (error && error.message) || '素材操作失败';
    throw new Error(message);
  }
  return response.json();
}
export const fetchCanvasAssets = async (): Promise<CanvasAsset[]> => (await request('/api/canvas/assets')).assets;
export const deleteCanvasAsset = async (id: string) => {
  const result = await request('/api/canvas/assets/' + encodeURIComponent(id), { method: 'DELETE' });
  publishLibraryChange({ resource: 'asset', action: 'deleted', id });
  return result;
};
export const saveCanvasAsset = async (asset: Partial<CanvasAsset> & { imageData?: string; expectedOwnerId?: string }) => {
  const id = asset.id || crypto.randomUUID();
  const result = await request('/api/canvas/assets/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(asset) });
  publishLibraryChange({ resource: 'asset', action: 'saved', id });
  return result;
};
