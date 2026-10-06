import { MAX_IMAGE_BYTES } from '../src/shared/imageSpecs.js';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db } from './db.js';
import type { User } from '../src/types.js';
import type { CanvasAsset } from '../src/services/canvasAssets.js';
import { dataUrlBytes, readImageDimensions } from './ppt/imageDimensions.js';

const directory = path.resolve('data/canvas-assets');
function publicAsset(asset: ReturnType<typeof db.getCanvasAssets>[number]) {
  const { userId, imageFile, deletedAt, ...result } = asset;
  return result;
}
export function createCanvasAssetRouter(requireUser: (req: express.Request, res: express.Response) => User | null, storageDirectory = directory) {
  const directory = storageDirectory;
  const router = express.Router();
  router.get('/', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    res.json({ assets: db.getCanvasAssets(user.id).map(publicAsset) });
  });
  router.get('/:id/image', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    const asset = db.getCanvasAsset(user.id, req.params.id);
    // 只取文件名拼路径：即便历史记录里的 imageFile 被写入了相对路径片段，
    // 也不会越过素材根目录。
    const imageFile = asset?.imageFile ? path.basename(asset.imageFile) : '';
    const filePath = imageFile ? path.join(directory, imageFile) : '';
    if (!filePath || !fs.existsSync(filePath)) { res.sendStatus(404); return; }
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(asset!.data.mimeType || 'image/png').sendFile(filePath);
  });
  router.put('/:id', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    const input = req.body || {};
    if (input.expectedOwnerId && input.expectedOwnerId !== user.id) { res.status(409).json({ error: '登录账号已改变，请切回生成时的账号再保存' }); return; }
    if (!/^[\w-]+$/.test(req.params.id) || !['text', 'image'].includes(input.kind) || typeof input.title !== 'string') { res.status(400).json({ error: '素材参数无效' }); return; }
    const old = db.getCanvasAsset(user.id, req.params.id, true);
    if (old?.deletedAt) { res.status(409).json({ error: '素材已删除，请重新创建素材' }); return; }
    try {
      let imageFile = old?.imageFile;
      let data: CanvasAsset['data'];
      if (input.kind === 'text') {
        if (typeof input.data?.content !== 'string') throw new Error('文本内容无效');
        data = { content: input.data.content };
      } else {
        if (input.imageData) {
          const mime = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(input.imageData)?.[1];
          if (!mime) throw new Error('请上传 PNG、JPEG 或 WebP 图片');
          const bytes = dataUrlBytes(input.imageData);
          if (bytes.length > MAX_IMAGE_BYTES) throw new Error('图片文件过大');
          const dimensions = readImageDimensions(bytes);
          if (!dimensions) throw new Error('无法识别图片尺寸');
          imageFile = crypto.createHash('sha256').update(user.id + ':' + req.params.id).digest('hex') + (mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png');
          fs.mkdirSync(directory, { recursive: true });
          const temp = path.join(directory, imageFile + '.tmp');
          fs.writeFileSync(temp, bytes); fs.renameSync(temp, path.join(directory, imageFile));
          data = { dataUrl: '/api/canvas/assets/' + encodeURIComponent(req.params.id) + '/image', ...dimensions, bytes: bytes.length, mimeType: mime };
        } else if (old?.kind === 'image') data = old.data;
        else throw new Error('缺少图片文件');
      }
      const now = new Date().toISOString();
      const metadata = Object.fromEntries(['source', 'projectId', 'nodeId', 'imageId'].flatMap(key => typeof input.metadata?.[key] === 'string' ? [[key, input.metadata[key].slice(0, 200)]] : []));
      const saved = db.putCanvasAsset({ id: req.params.id, userId: user.id, kind: input.kind, title: input.title.trim() || '未命名素材', coverUrl: input.kind === 'image' ? data.dataUrl! : '', tags: Array.isArray(input.tags) ? input.tags.filter((tag: unknown) => typeof tag === 'string') : [], note: typeof input.note === 'string' ? input.note : '', metadata: Object.keys(metadata).length ? metadata : old?.metadata, createdAt: old?.createdAt || now, updatedAt: now, data, imageFile: input.kind === 'image' ? imageFile : undefined });
      res.json({ asset: publicAsset(saved) });
    } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '保存素材失败' }); }
  });
  router.delete('/:id', (req, res) => {
    const user = requireUser(req, res); if (!user) return;
    const asset = db.getCanvasAsset(user.id, req.params.id, true);
    if (!asset) { res.status(404).json({ error: '素材不存在' }); return; }
    if (asset.deletedAt) { res.json({ success: true }); return; }
    db.deleteCanvasAsset(user.id, asset.id);
    // Existing canvas nodes may still refer to the image. Keep its file for now.
    res.json({ success: true });
  });
  return router;
}
