import React, { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, CircleAlert, Copy, Database, Eye, EyeOff, Image as ImageIcon, RefreshCw, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { adminApi } from '../api.js';
import { Alert, Button, Card, Field, PageHeader, Select, TextInput } from '../ui.js';
import type { ImageResolution, PlanningModelConfig, PromptOptimizeModelConfig } from '../../types.js';
import type { ImageConfigSlot } from '../api.js';

const tiers: Array<{ resolution: ImageResolution; title: string; description: string; cost: number }> = [
  { resolution: '2K', title: '高清', description: '适合正式图片与页面', cost: 5 },
  { resolution: '4K', title: '超高清', description: '适合高质量导出', cost: 10 },
];

type Draft = { displayName: string; baseUrl: string; apiKey: string; modelName: string; provider: string; enabled: boolean; remark: string };

const emptyDraft = (): Draft => ({ displayName: '', baseUrl: '', apiKey: '', modelName: '', provider: 'custom', enabled: true, remark: '' });

export const AiConfigsPage: React.FC = () => {
  const [slots, setSlots] = useState<ImageConfigSlot[]>([]);
  const [drafts, setDrafts] = useState<Record<ImageResolution, Draft>>({ '2K': emptyDraft(), '4K': emptyDraft() });
  const [planning, setPlanning] = useState<PlanningModelConfig | null>(null);
  const [promptOptimize, setPromptOptimize] = useState<PromptOptimizeModelConfig | null>(null);
  const [savingOptimize, setSavingOptimize] = useState(false);
  const [open, setOpen] = useState<ImageResolution>('2K');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ImageResolution | null>(null);
  const [testing, setTesting] = useState<ImageResolution | null>(null);
  /** 真实出图测试（会消耗一张图额度），与「测试连通」分开用独立 loading 状态 */
  const [testingImage, setTestingImage] = useState<ImageResolution | null>(null);
  const [testingPlanning, setTestingPlanning] = useState(false);
  const [testingOptimize, setTestingOptimize] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState<Record<ImageResolution, boolean>>({ '2K': false, '4K': false });
  const [models, setModels] = useState<Record<ImageResolution, string[]>>({ '2K': [], '4K': [] });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [image, plan, optimize] = await Promise.all([adminApi.imageConfigs(), adminApi.planningConfig(), adminApi.promptOptimizeConfig()]);
      setSlots(image.slots);
      const next = { ...drafts };
      for (const tier of tiers) {
        const slot = image.slots.find(item => item.resolution === tier.resolution);
        next[tier.resolution] = {
          displayName: slot?.displayName || slot?.name || '', baseUrl: slot?.baseUrl || '', apiKey: '',
          modelName: slot?.modelName || '', provider: slot?.provider || 'custom', enabled: slot?.enabled !== false, remark: slot?.remark || ''
        };
      }
      setDrafts(next);
      setPlanning(plan.planningConfig);
      setPromptOptimize(optimize.promptOptimizeConfig);
    } catch (e: any) { setError(e.message || '配置加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (resolution: ImageResolution, field: keyof Draft, value: string | boolean) => setDrafts(current => ({ ...current, [resolution]: { ...current[resolution], [field]: value } }));

  const save = async (resolution: ImageResolution) => {
    const draft = drafts[resolution];
    if (!draft.displayName.trim() || !draft.baseUrl.trim() || !draft.modelName.trim()) { setError(`${resolution} 请填写展示名称、接口地址和真实模型 ID`); setOpen(resolution); return; }
    setSaving(resolution); setError('');
    try {
      await adminApi.updateImageConfig(resolution, { ...draft, displayName: draft.displayName.trim(), name: draft.displayName.trim(), baseUrl: draft.baseUrl.trim(), modelName: draft.modelName.trim(), apiKey: draft.apiKey.trim() || undefined });
      setNotice(`${resolution} 配置已保存，前端会按该档位调用对应接口`); setDrafts(current => ({ ...current, [resolution]: { ...current[resolution], apiKey: '' } })); await load();
    } catch (e: any) { setError(e.message || '保存失败'); }
    finally { setSaving(null); }
  };

  const test = async (resolution: ImageResolution) => {
    setTesting(resolution); setNotice(''); setError('');
    try { const result = await adminApi.testImageConfig(resolution, 'connection'); setNotice(`${resolution} ${result.message || '连接正常'}${result.latencyMs ? ` · ${result.latencyMs}ms` : ''}`); }
    catch (e: any) { setError(`${resolution} 测试失败：${e.message || '接口不可用'}`); }
    finally { setTesting(null); }
  };

  /** 真实出图测试：真的生成一张该档位的图并校验尺寸，会消耗一次出图额度。 */
  const testImage = async (resolution: ImageResolution) => {
    setTestingImage(resolution); setNotice(''); setError('');
    try {
      const r = await adminApi.testImageConfig(resolution, 'image');
      const detail = [
        r.latencyMs ? `${r.latencyMs}ms` : '',
        r.bytes ? `${Math.round(r.bytes / 1024)} KB` : '',
        r.actualSize ? `上游实际 ${r.actualSize}` : '',
        r.requestedSize ? `请求 ${r.requestedSize}` : '',
        r.exact ? '精确匹配' : '',
      ].filter(Boolean).join(' · ');
      setNotice(`${resolution} 真实出图成功${detail ? ' · ' + detail : ''}`);
    } catch (e: any) { setError(`${resolution} 真实出图失败：${e.message || '接口不可用'}`); }
    finally { setTestingImage(null); }
  };

  const testPlanning = async () => {
    if (!planning) return;
    setTestingPlanning(true); setNotice(''); setError('');
    try {
      const r = await adminApi.testPlanningConfig({ baseUrl: planning.baseUrl, apiKey: planning.apiKey, modelName: planning.modelName, reasoningEffort: planning.reasoningEffort });
      const detail = [r.latencyMs ? `${r.latencyMs}ms` : '', r.model || '', r.reply ? `返回「${r.reply}」` : ''].filter(Boolean).join(' · ');
      setNotice(`内容规划模型真实连通正常${detail ? ' · ' + detail : ''}`);
    } catch (e: any) { setError(`内容规划模型测试失败：${e.message || '接口不可用'}`); }
    finally { setTestingPlanning(false); }
  };

  const testOptimize = async () => {
    if (!promptOptimize) return;
    setTestingOptimize(true); setNotice(''); setError('');
    try {
      const r = await adminApi.testPromptOptimizeConfig({ baseUrl: promptOptimize.baseUrl, apiKey: promptOptimize.apiKey, modelName: promptOptimize.modelName, reasoningEffort: promptOptimize.reasoningEffort });
      const via = r.channel === 'planning' ? '实测通道：内容规划模型（回退）' : '实测通道：独立配置';
      const detail = [via, r.latencyMs ? `${r.latencyMs}ms` : '', r.model || '', r.reply ? `返回「${r.reply}」` : ''].filter(Boolean).join(' · ');
      setNotice(`提示词优化模型真实连通正常 · ${detail}`);
    } catch (e: any) { setError(`提示词优化模型测试失败：${e.message || '接口不可用'}`); }
    finally { setTestingOptimize(false); }
  };

  const discover = async (resolution: ImageResolution) => {
    const draft = drafts[resolution];
    if (!draft.baseUrl.trim() && !draft.apiKey.trim()) { setError(`${resolution} 请先填写接口地址和 API Key，再读取模型列表`); return; }
    try { const result = await adminApi.discoverImageModels({ resolution, baseUrl: draft.baseUrl, apiKey: draft.apiKey }); setModels(current => ({ ...current, [resolution]: result.models || [] })); setNotice(`${resolution} 已读取 ${result.models?.length || 0} 个模型`); }
    catch (e: any) { setError(e.message || '读取模型失败'); }
  };

  const copyFrom = (source: ImageResolution, target: ImageResolution) => {
    setDrafts(current => ({ ...current, [target]: { ...current[source], displayName: `${current[source].displayName} · ${target}`, apiKey: '' } }));
    setNotice(`已复制 ${source} 的连接配置到 ${target}，请确认模型 ID 后保存`); setOpen(target);
  };

  const savePlanning = async () => {
    if (!planning) return;
    try { await adminApi.updatePlanningConfig(planning); setNotice('内容规划模型已保存'); }
    catch (e: any) { setError(e.message || '规划配置保存失败'); }
  };

  const savePromptOptimize = async () => {
    if (!promptOptimize) return;
    setSavingOptimize(true); setError(''); setNotice('');
    try {
      const saved = await adminApi.updatePromptOptimizeConfig({
        enabled: promptOptimize.enabled,
        baseUrl: promptOptimize.baseUrl.trim(),
        // 留空表示保持已保存的密钥
        apiKey: promptOptimize.apiKey.trim() || undefined,
        modelName: promptOptimize.modelName.trim(),
        reasoningEffort: promptOptimize.reasoningEffort.trim(),
        temperature: promptOptimize.temperature.trim(),
        maxOutputTokens: promptOptimize.maxOutputTokens.trim(),
        systemPrompt: promptOptimize.systemPrompt
      });
      setPromptOptimize({ ...saved.promptOptimizeConfig, apiKey: '' });
      setNotice(saved.promptOptimizeConfig.enabled
        ? '提示词优化已切换为独立通道，前台与画布的「优化提示词」立即生效'
        : '提示词优化配置已保存，当前回退使用内容规划模型');
    } catch (e: any) { setError(e.message || '提示词优化配置保存失败'); }
    finally { setSavingOptimize(false); }
  };

  return <div>
    <PageHeader title="AI 接口配置" desc="统一管理内容规划与两档原生生图通道。展示名称给用户看，真实模型只在服务端使用。" extra={<Button size="small" onClick={() => void load()}><RefreshCw size={13} /> 刷新状态</Button>} />
    {error && <Alert type="error"><CircleAlert size={14} /> {error}</Alert>}
    {notice && <Alert type="success"><Check size={14} /> {notice}</Alert>}

    <Card title="生图通道 · 2K / 4K 独立映射" extra={<span className="text-[11px] text-[color:var(--text-secondary)]">每张图片按档位扣除 5 / 10 点</span>}>
      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        {tiers.map(tier => { const slot = slots.find(item => item.resolution === tier.resolution); return <button key={tier.resolution} onClick={() => setOpen(tier.resolution)} className="rounded-2xl border p-4 text-left transition hover:-translate-y-0.5" style={{ borderColor: open === tier.resolution ? 'var(--accent)' : 'var(--border-subtle)', background: open === tier.resolution ? 'var(--accent-soft)' : 'var(--fill-soft)' }}><div className="flex items-center justify-between"><strong style={{ color: open === tier.resolution ? 'var(--accent)' : 'var(--text-primary)' }}>{tier.resolution}</strong>{slot?.ready ? <span className="text-[11px] text-[color:var(--accent)]">已就绪</span> : <span className="text-[11px] text-[color:var(--text-secondary)]">待配置</span>}</div><p className="mt-2 text-[12px] text-[color:var(--text-secondary)]">{tier.title}</p><p className="mt-1 text-[11px] text-[color:var(--text-secondary)]">{tier.description} · {tier.cost} 点/张</p></button>; })}
      </div>
      {loading ? <div className="py-10 text-center text-[color:var(--text-secondary)]">正在读取三档配置…</div> : <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[var(--fill-soft)] p-5">
        {tiers.map(tier => open === tier.resolution ? <div key={tier.resolution}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} /><h2 className="text-[16px] font-semibold">{tier.resolution} · {tier.title}</h2></div><p className="mt-1 text-[11px] text-[color:var(--text-secondary)]">此档位会固定调用自己的接口与真实 Model ID，并校验返回图片尺寸。</p></div><label className="flex items-center gap-2 text-[12px] text-[color:var(--text-secondary)]"><input type="checkbox" checked={drafts[tier.resolution].enabled} onChange={e => update(tier.resolution, 'enabled', e.target.checked)} />启用此档位</label></div>
          <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2">
            <Field label="前端展示名称" hint="用户和画布下拉框看到的文字"><TextInput value={drafts[tier.resolution].displayName} onChange={v => update(tier.resolution, 'displayName', v)} placeholder={`例如：${tier.resolution} 原生高清`} className="w-full" /></Field>
            <Field label="提供商"><Select value={drafts[tier.resolution].provider} onChange={v => update(tier.resolution, 'provider', v)} options={[{ label: '自定义 OpenAI 兼容接口', value: 'custom' }, { label: 'OpenAI', value: 'openai' }, { label: '其他兼容服务', value: 'custom' }]} className="w-full" /></Field>
            <Field label="接口地址 (Base URL)" hint="填写到 /v1，例如 https://example.com/v1"><TextInput value={drafts[tier.resolution].baseUrl} onChange={v => update(tier.resolution, 'baseUrl', v)} placeholder="https://example.com/v1" className="w-full" /></Field>
            <Field label="真实模型 ID" hint="只发送给上游接口，不会展示给前端用户"><div className="flex gap-2"><TextInput value={drafts[tier.resolution].modelName} onChange={v => update(tier.resolution, 'modelName', v)} placeholder="gpt-image-2.5-sunburst-vip" className="w-full" /><Button size="small" onClick={() => void discover(tier.resolution)} title="读取模型列表"><Database size={14} /></Button></div>{models[tier.resolution].length > 0 && <select className="ws-select mt-2 w-full" value={drafts[tier.resolution].modelName} onChange={e => update(tier.resolution, 'modelName', e.target.value)}><option value="">从接口模型列表选择</option>{models[tier.resolution].map(model => <option key={model}>{model}</option>)}</select>}</Field>
            <Field label="API Key" hint={slots.find(item => item.resolution === tier.resolution)?.hasApiKey ? '已保存密钥；留空表示保持原密钥' : '仅保存在服务端'}><div className="flex gap-2"><TextInput type={showKey[tier.resolution] ? 'text' : 'password'} value={drafts[tier.resolution].apiKey} onChange={v => update(tier.resolution, 'apiKey', v)} placeholder={slots.find(item => item.resolution === tier.resolution)?.hasApiKey ? '已配置，留空保持不变' : '粘贴 API Key'} className="w-full" /><Button size="small" onClick={() => setShowKey(current => ({ ...current, [tier.resolution]: !current[tier.resolution] }))}>{showKey[tier.resolution] ? <EyeOff size={14} /> : <Eye size={14} />}</Button></div></Field>
            <Field label="备注"><TextInput value={drafts[tier.resolution].remark} onChange={v => update(tier.resolution, 'remark', v)} placeholder="例如：小易原生 4K 通道" className="w-full" /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border-subtle)] pt-4"><Button variant="primary" loading={saving === tier.resolution} onClick={() => void save(tier.resolution)}><ShieldCheck size={14} /> 保存 {tier.resolution}</Button><Button loading={testing === tier.resolution} onClick={() => void test(tier.resolution)} title="只检查接口地址与模型列表，不消耗出图额度"><Zap size={14} /> 测试连通</Button><Button loading={testingImage === tier.resolution} onClick={() => void testImage(tier.resolution)} title="真实生成一张该档位的图并校验尺寸，会消耗一次出图额度"><ImageIcon size={14} /> 真实出图</Button>{tiers.filter(item => item.resolution !== tier.resolution).map(item => <Button key={item.resolution} size="small" onClick={() => copyFrom(tier.resolution, item.resolution)}><Copy size={13} /> 复制到 {item.resolution}</Button>)}<span className="ml-auto text-[11px] text-[color:var(--text-secondary)]">请求尺寸：{tier.resolution === '2K' ? '2048 × 1152' : '3840 × 2160'}</span></div><p className="mt-3 text-[11px] leading-6 text-[color:var(--text-secondary)]">连通测试只检查接口地址与模型列表（快、不消耗额度）；真实出图会实际生成一张图并校验尺寸（消耗一次出图额度，可发现渠道停用或尺寸策略变化）。{tier.resolution === '2K' ? '2K 使用 medium 画质与参考项目的尺寸参数，保留接口原图并检查所选比例；实际像素以返回结果为准。' : '4K 按所选原生像素尺寸校验，不匹配时退款。'}</p>
        </div> : null)}
      </div>}
    </Card>

    <Card title="内容规划模型" extra={planning && <div className="flex flex-wrap items-center gap-2"><Button size="small" loading={testingPlanning} onClick={() => void testPlanning()} title="真实向该接口发一次最小对话请求，验证接口地址、密钥与模型是否同时可用"><Zap size={13} /> 测试连通</Button><Button size="small" variant="primary" onClick={() => void savePlanning()}><Sparkles size={13} /> 保存规划配置</Button></div>}>
      {planning && <div className="grid grid-cols-1 gap-x-5 md:grid-cols-2"><Field label="接口地址"><TextInput value={planning.baseUrl} onChange={v => setPlanning({ ...planning, baseUrl: v })} className="w-full" /></Field><Field label="API Key"><TextInput type="password" value={planning.apiKey} onChange={v => setPlanning({ ...planning, apiKey: v })} className="w-full" /></Field><Field label="真实模型 ID" hint="DeepSeek 官方接口填写 deepseek-flash；版本展示名称不能直接作为 API 模型名"><TextInput value={planning.modelName} onChange={v => setPlanning({ ...planning, modelName: v })} className="w-full" /></Field><Field label="思考强度"><Select value={planning.reasoningEffort || 'auto'} onChange={v => setPlanning({ ...planning, reasoningEffort: v })} options={['auto', 'low', 'medium', 'high', 'xhigh'].map(value => ({ label: value, value }))} className="w-full" /></Field><Field label="视觉理解模型" hint="扫描版参考文件用多模态模型直接读图；留空则退回 OCR"><TextInput value={planning.visionModelName || ''} onChange={v => setPlanning({ ...planning, visionModelName: v })} placeholder="gpt-5.6-sol" className="w-full" /></Field></div>}
    </Card>

    <Card title="提示词优化模型" extra={
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-[color:var(--text-secondary)]">{promptOptimize?.enabled ? '独立通道已启用' : '当前回退内容规划模型'}</span>
        <Button size="small" loading={testingOptimize} onClick={() => void testOptimize()} title="按当前实际生效的通道，真实发一次最小对话请求"><Zap size={13} /> 测试连通</Button>
        <Button size="small" variant="primary" loading={savingOptimize} onClick={() => void savePromptOptimize()}><Sparkles size={13} /> 保存配置</Button>
      </div>
    }>
      {promptOptimize && <div>
        <label className="flex items-start gap-2 text-[12px] text-[color:var(--text-secondary)]">
          <input type="checkbox" className="mt-0.5" checked={promptOptimize.enabled} onChange={e => setPromptOptimize({ ...promptOptimize, enabled: e.target.checked })} />
          <span>使用独立接口<span className="text-[color:var(--text-tertiary)]">（关闭时回退「内容规划模型」，与开启前行为完全一致）</span></span>
        </label>
        <div className="mt-4 grid grid-cols-1 gap-x-5 md:grid-cols-2">
          <Field label="接口地址 (Base URL)" hint="填写到 /v1，例如 https://example.com/v1"><TextInput value={promptOptimize.baseUrl} onChange={v => setPromptOptimize({ ...promptOptimize, baseUrl: v })} placeholder="https://example.com/v1" className="w-full" /></Field>
          <Field label="API Key" hint="留空表示保持已保存的密钥"><TextInput type="password" value={promptOptimize.apiKey} onChange={v => setPromptOptimize({ ...promptOptimize, apiKey: v })} placeholder="粘贴 API Key" className="w-full" /></Field>
          <Field label="真实模型 ID" hint="只发送给上游接口，不会展示给前端用户"><TextInput value={promptOptimize.modelName} onChange={v => setPromptOptimize({ ...promptOptimize, modelName: v })} placeholder="gpt-5.6-luna" className="w-full" /></Field>
          <Field label="思考强度" hint="提示词优化属轻量调用，建议 medium"><Select value={promptOptimize.reasoningEffort || 'auto'} onChange={v => setPromptOptimize({ ...promptOptimize, reasoningEffort: v })} options={['auto', 'low', 'medium', 'high', 'xhigh'].map(value => ({ label: value, value }))} className="w-full" /></Field>
          <Field label="采样温度" hint="0–2 之间的数字；留空使用上游默认"><TextInput value={promptOptimize.temperature} onChange={v => setPromptOptimize({ ...promptOptimize, temperature: v })} placeholder="留空使用上游默认" className="w-full" /></Field>
          <Field label="最大输出 token" hint="正整数；留空使用上游默认"><TextInput value={promptOptimize.maxOutputTokens} onChange={v => setPromptOptimize({ ...promptOptimize, maxOutputTokens: v })} placeholder="留空使用上游默认" className="w-full" /></Field>
        </div>
        <Field label="系统提示词补充" hint="追加在内置优化提示词之后，例如统一语气或输出语言；留空只用内置提示词"><TextInput value={promptOptimize.systemPrompt} onChange={v => setPromptOptimize({ ...promptOptimize, systemPrompt: v })} placeholder="留空使用内置提示词" className="w-full" /></Field>
        <p className="text-[11px] leading-6 text-[color:var(--text-secondary)]">生效范围：PPT 生成页「优化」按钮、旧版首页「优化」、画布节点「优化提示词」。提示词优化每次扣除 1 点。</p>
      </div>}
    </Card>
  </div>;
};
