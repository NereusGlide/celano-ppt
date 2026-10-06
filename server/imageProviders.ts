import { imageSizeFor, IMAGE_QUALITY, pixelResolution, MAX_IMAGE_BYTES } from '../src/shared/imageSpecs.js';
import type { ThirdPartyApiConfig } from '../src/types.js';
import { assertNative16x9, assertRequestedImageSize, dataUrlBytes } from './ppt/imageDimensions.js';
import { withChineseTextAccuracy } from './imagePrompt.js';

export type ProviderModelList = { success: boolean; message: string; models: string[]; latencyMs?: number };

/** Read the model catalog without exposing credentials to the caller. */
export async function listThirdPartyModels(config: Pick<ThirdPartyApiConfig, 'baseUrl' | 'apiKey'>): Promise<ProviderModelList> {
  if (!config?.baseUrl?.trim()) return { success: false, message: '接口地址不能为空', models: [] };
  if (!config.apiKey?.trim()) return { success: false, message: 'API Key 不能为空', models: [] };
  const started = Date.now();
  try {
    const base = config.baseUrl.trim().replace(/\/+$/, '');
    const url = base.endsWith('/v1') ? base + '/models' : base + '/v1/models';
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + config.apiKey.trim() }, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let payload: any = null;
    try { payload = JSON.parse(text); } catch { /* handled below */ }
    const models = Array.isArray(payload?.data) ? payload.data.map((item: any) => String(item?.id || '')).filter(Boolean) : [];
    if (!res.ok) return { success: false, message: '接口返回 HTTP ' + res.status, models, latencyMs: Date.now() - started };
    if (!models.length) return { success: false, message: '接口可连接，但没有返回可用模型列表', models, latencyMs: Date.now() - started };
    return { success: true, message: '已读取 ' + models.length + ' 个可用模型', models, latencyMs: Date.now() - started };
  } catch (err: any) {
    return { success: false, message: '网络连接失败：' + String(err?.message || '未知错误').slice(0, 120), models: [], latencyMs: Date.now() - started };
  }
}

export async function testThirdPartyConnection(config: ThirdPartyApiConfig): Promise<{success:boolean;message:string}> {
  if (!config || typeof config.baseUrl !== 'string' || !config.baseUrl.trim()) return {success:false,message:'接口地址不能为空'};
  if (!config.apiKey || !config.apiKey.trim()) return {success:false,message:'API Key 不能为空'};
  try {
    const base=config.baseUrl.replace(/\/$/,'');
    const url=base.endsWith('/v1')?base+'/models':base+'/v1/models';
    const res=await fetch(url,{headers:{Authorization:'Bearer '+config.apiKey.trim()},signal:AbortSignal.timeout(15000)});
    if (!res.ok) return {success:false,message:'接口返回 HTTP '+res.status};
    let payload: any = null;
    try { payload = await res.json(); } catch { /* 某些兼容服务不返回 JSON */ }
    const models = Array.isArray(payload?.data) ? payload.data.map((item: any) => String(item?.id || '')).filter(Boolean) : [];
    const configured = String(config.modelName || '').trim();
    if (configured && models.length > 0 && !models.includes(configured)) {
      return {success:false,message:'接口可连通，但模型 '+configured+' 不在当前账号可用模型列表中'};
    }
    return {success:true,message:'接口和模型列表可连通；实际生成仍需检查模型渠道与原生尺寸'};
  } catch(err:any){return {success:false,message:'网络连接失败：'+String(err?.message||'未知错误').slice(0,120)};}
}
/** 图生图编辑：原图 + 局部遮罩 + 修改指令 → 图像编辑接口。遮罩透明区域才允许重绘。 */
export async function generateImageEdit(
  config: ThirdPartyApiConfig,
  imageDataUrl: string,
  prompt: string,
  size = imageSizeFor('2K'),
  maskDataUrl?: string,
): Promise<string> {
  if (!config || !config.apiKey) throw new Error('未配置生图模型接口');
  const base = String(config.baseUrl || '').replace(/\/$/, '');
  const endpoint = base.includes('/images/edits')
    ? base
    : base + (base.endsWith('/v1') ? '' : '/v1') + '/images/edits';

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!match) throw new Error('页面图片格式无效');
  const mime = 'image/' + match[1];
  const buffer = Buffer.from(match[2], 'base64');

  const form = new FormData();
  const resolution = pixelResolution(size) || '2K';
  form.append('model', config.modelName || 'gpt-image-2.5-sunburst');
  form.append('prompt', withChineseTextAccuracy(prompt, resolution));
  // The reference 2K protocol requests its standard size; local edits still validate against original pixels.
  form.append('size', resolution === '2K' ? imageSizeFor('2K') : size);
  form.append('quality', IMAGE_QUALITY[resolution]);
  if (resolution === '4K') {
    form.append('output_format', 'png');
    form.append('n', '1');
  }
  form.append('image', new Blob([new Uint8Array(buffer)], { type: mime }), 'page.' + (match[1] === 'png' ? 'png' : 'jpg'));
  if (maskDataUrl) {
    const maskMatch = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(maskDataUrl);
    if (!maskMatch) throw new Error('局部编辑遮罩格式无效');
    const maskMime = 'image/' + maskMatch[1];
    const maskBuffer = Buffer.from(maskMatch[2], 'base64');
    form.append('mask', new Blob([new Uint8Array(maskBuffer)], { type: maskMime }), 'mask.' + (maskMatch[1] === 'png' ? 'png' : 'jpg'));
  }

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + config.apiKey.trim() },
    body: form,
    signal: AbortSignal.timeout(resolution === '2K' ? 600_000 : 300_000)
  });

  if (!resp.ok) {
    const text = (await resp.text()).slice(0, 400);
    let msg = text;
    try { const parsed = JSON.parse(text); msg = parsed.error?.message || parsed.message || text; } catch { /* 原文 */ }
    throw new Error('图像编辑接口 HTTP ' + resp.status + '：' + String(msg).slice(0, 180));
  }

  const data = await resp.json();
  const item = data?.data?.[0];
  if (!item) throw new Error('图像编辑接口未返回图像');
  if (item.url) {
    // 编辑结果会被工作台立即写回作品库。很多 OpenAI 兼容接口返回的
    // `url` 只是短期签名地址，浏览器和服务重启后都可能失效，因此在服务端
    // 先物化为 data URL，再交给 replace-image 持久化。
    const remoteUrl = String(item.url);
    if (remoteUrl.startsWith('data:')) {
      assertNative16x9(dataUrlBytes(remoteUrl), '单页修改结果');
      assertRequestedImageSize(dataUrlBytes(remoteUrl), size, '单页修改结果');
      return remoteUrl;
    }
    let parsed: URL;
    try { parsed = new URL(remoteUrl); } catch { throw new Error('图像编辑接口返回了无效图片地址'); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('图像编辑接口返回了不支持的图片地址');
    const imageResp = await fetch(remoteUrl, { signal: AbortSignal.timeout(120_000) });
    if (!imageResp.ok) throw new Error('下载图像编辑结果失败 HTTP ' + imageResp.status);
    const contentType = String(imageResp.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) {
      throw new Error('图像编辑接口返回的内容不是受支持的图片格式');
    }
    const bytes = Buffer.from(await imageResp.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('图像编辑结果过大，无法保存');
    assertNative16x9(bytes, '单页修改结果');
    assertRequestedImageSize(bytes, size, '单页修改结果');
    return 'data:' + contentType + ';base64,' + bytes.toString('base64');
  }
  if (item.b64_json) {
    const result = 'data:image/png;base64,' + item.b64_json;
    assertNative16x9(dataUrlBytes(result), '单页修改结果');
    assertRequestedImageSize(dataUrlBytes(result), size, '单页修改结果');
    return result;
  }
  throw new Error('图像编辑接口未返回 b64_json 或 url');
}
