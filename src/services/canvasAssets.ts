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
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.error || '素材操作失败');
  return result;
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
