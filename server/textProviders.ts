/**
 * 文本模型（内容规划 / 提示词优化）的真实连通性测试。
 *
 * 与生图通道的「测试接口」只读一次 `/models` 列表不同，这里**真的发起一次
 * chat/completions 请求**：接口地址、密钥、模型名三者必须同时可用才算通过。
 * 因此能捕捉「模型名不在账号下」「渠道停用」「额度耗尽」这类只看模型列表
 * 发现不了的问题；失败时再补读一次模型列表，用来区分「网络 / 密钥问题」
 * 与「模型名不存在」。
 *
 * 测试复用线上同一个 chatText 实现（同样的参数构造、重试与超时策略），
 * 只有超时被压到 60s，避免管理员在后台干等。
 */
import type { TextModelCallConfig } from '../src/types.js';
import { chatText } from './ppt/aiClient.js';
import { listThirdPartyModels } from './imageProviders.js';

export interface TextConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  model?: string;
  /** 上游实际返回的内容片段（成功时） */
  reply?: string;
  /** 上游可用模型数量（诊断用） */
  availableModels?: number;
}

/** 测试请求超时：真实调用，但不让管理员等太久 */
const TEXT_TEST_TIMEOUT_MS = 60_000;
const TEST_PROMPT = '连通性测试：请只回复 pong。';

/**
 * chatText 的报错文案里写死了「规划模型」字样，而这里会被提示词优化通道复用，
 * 直接把原文抛给管理员会误导，因此按通道名改写。
 */
function relabel(raw: string, label: string): string {
  return raw
    .replace(/^未配置规划模型接口，请在管理后台设置$/, `未配置${label}接口`)
    .replace(/^规划模型 API Key 未配置，请在管理后台设置$/, `未配置${label} API Key`)
    .replace(/^规划模型接口 HTTP/, `${label}接口 HTTP`)
    .replace(/^规划模型未返回内容$/, `${label}未返回内容`)
    .slice(0, 240);
}

/**
 * 把管理端表单里尚未保存的值合并到已保存配置之上，让「改完先测再存」可用。
 * 只接受四个关键字符串字段；温度与输出上限这类数值沿用已保存配置，
 * 因为它们需要范围校验，走保存接口更合适。
 */
export function mergeTextTestOverride(base: TextModelCallConfig, body: unknown): TextModelCallConfig {
  const source = (body || {}) as Record<string, unknown>;
  const pick = (key: string, fallback?: string) => {
    const value = source[key];
    return typeof value === 'string' && value.trim() ? value.trim() : (fallback || '');
  };
  return {
    baseUrl: pick('baseUrl', base.baseUrl),
    apiKey: pick('apiKey', base.apiKey),
    modelName: pick('modelName', base.modelName),
    reasoningEffort: pick('reasoningEffort', base.reasoningEffort),
    temperature: base.temperature,
    maxOutputTokens: base.maxOutputTokens,
  };
}

export async function testTextModelConnection(config: TextModelCallConfig, label = '文本模型'): Promise<TextConnectionTestResult> {
  if (!String(config?.baseUrl || '').trim()) return { success: false, message: '接口地址不能为空' };
  if (!String(config?.apiKey || '').trim()) return { success: false, message: 'API Key 不能为空' };
  if (!String(config?.modelName || '').trim()) return { success: false, message: '真实模型 ID 不能为空' };

  const started = Date.now();
  try {
    const reply = await chatText(config, [{ role: 'user', content: TEST_PROMPT }], undefined, TEXT_TEST_TIMEOUT_MS);
    return {
      success: true,
      message: '真实调用成功，上游返回了有效内容',
      latencyMs: Date.now() - started,
      model: config.modelName,
      reply: reply.replace(/\s+/g, ' ').trim().slice(0, 60),
    };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    const reason = relabel(String(err?.message || '未知错误'), label);
    // 失败时补读模型列表：模型名不在列表里是最常见的配置错误，值得单独指出。
    let hint = '';
    let availableModels: number | undefined;
    try {
      const list = await listThirdPartyModels({ baseUrl: config.baseUrl, apiKey: config.apiKey });
      if (list.success && list.models.length) {
        availableModels = list.models.length;
        const wanted = String(config.modelName).trim();
        hint = list.models.includes(wanted)
          ? '（模型名在可用列表中，可能是渠道停用、额度不足或上游限流）'
          : `（模型名不在可用列表中，可用示例：${list.models.slice(0, 6).join('、')}）`;
      }
    } catch { /* 诊断失败不影响主结论 */ }
    return { success: false, message: reason + hint, latencyMs, model: config.modelName, availableModels };
  }
}
