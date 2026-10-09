import React, { useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { IMAGE_COST } from '../../shared/imageSpecs.js';
import { Alert, Button, Field, Modal, PageHeader, Select, Table, Tag, TextInput, Column } from '../ui.js';
import { MembershipPlanConfig } from '../../types.js';

const ACCENTS = [
  { label: '商务蓝', value: 'blue' },
  { label: '青碧', value: 'teal' },
  { label: '紫罗兰', value: 'violet' },
  { label: '鎏金', value: 'gold' },
];

const BOOL_OPTIONS = [
  { label: '是', value: 'yes' },
  { label: '否', value: 'no' },
];

const blankPlan = (): MembershipPlanConfig => ({
  id: '', name: '', price: '¥', renewalPrice: 0, points: 0, note: '', accent: 'blue', recommended: false, benefits: [], enabled: true, discount2k: IMAGE_COST['2K'], discount4k: IMAGE_COST['4K'],
});

export const MembershipPlansPage: React.FC = () => {
  const [plans, setPlans] = useState<MembershipPlanConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MembershipPlanConfig | null>(null);
  const [isNew, setIsNew] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.membershipPlans();
      setPlans(res.membershipPlans);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);

  const move = (index: number, dir: -1 | 1) => {
    const next = [...plans];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPlans(next);
  };

  const remove = (index: number) => {
    setPlans(prev => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!plans.length) { setError('至少保留一个会员套餐'); return; }
    setSaving(true); setError('');
    try {
      const res = await adminApi.saveMembershipPlans(plans);
      setPlans(res.membershipPlans);
      setNotice('会员套餐已保存');
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<MembershipPlanConfig>[] = [
    { title: '套餐', width: '200px', render: (r) => <span><b>{r.name}</b><small style={{ display: 'block', color: 'var(--text-secondary)' }} className="ws-mono">{r.id}</small></span> },
    { title: '首月价', width: '80px', render: (r) => <span className="ws-mono">{r.price || '—'}</span> },
    { title: '续费价', width: '80px', align: 'right', render: (r) => <span className="ws-mono">¥{r.renewalPrice}</span> },
    { title: '月点数', width: '90px', align: 'right', render: (r) => <span className="ws-mono">{r.points.toLocaleString()}</span> },
    { title: '2K/4K 实扣', width: '110px', align: 'right', render: (r) => <span className="ws-mono">{r.discount2k} / {r.discount4k} 点</span> },
    { title: '权益', width: '90px', align: 'right', render: (r) => <span className="ws-mono">{r.benefits.length} 项</span> },
    { title: '推荐', width: '70px', render: (r) => (r.recommended ? <Tag type="warning">推荐</Tag> : <span style={{ color: 'var(--text-secondary)' }}>—</span>) },
    { title: '上架', width: '70px', render: (r) => (r.enabled ? <Tag type="success">上架</Tag> : <Tag>下架</Tag>) },
    {
      title: '操作', width: '210px', render: (r, i) => (
        <div className="ws-button-group" style={{ gap: 4 }}>
          <Button size="small" variant="text" onClick={() => move(i, -1)} title="上移">↑</Button>
          <Button size="small" variant="text" onClick={() => move(i, 1)} title="下移">↓</Button>
          <Button size="small" variant="text" onClick={() => { setIsNew(false); setEditing({ ...r, benefits: [...r.benefits] }); }}>编辑</Button>
          <Button size="small" variant="danger" onClick={() => remove(i)}>删除</Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="会员套餐管理" desc="编辑会员订阅体系：套餐名称、价格、点数、权益与上下架；顺序即前台展示顺序。免费版为系统内置第 0 档，用户未开通付费套餐时自动处于该档。" extra={<><Button size="small" onClick={() => void load()}>刷新</Button><Button size="small" variant="primary" onClick={() => { setIsNew(true); setEditing(blankPlan()); }}>新增套餐</Button></>} />

      <div className="ws-panel">
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontSize: 13 }}>
          <Tag type="info">内置</Tag>
          <span><b style={{ color: 'var(--text-primary)' }}>免费版</b>（celano-free）— 每日 3 张 2K 免费 · 提示词优化 1 点/次 · 带水印 · 无画质折扣，随用户注册自动生效，无需配置。</span>
        </div>
        {error && <div style={{ padding: '0 20px' }}><Alert type="error">{error}</Alert></div>}
        {notice && <div style={{ padding: '0 20px' }}><Alert type="success">{notice}</Alert></div>}
        <Table columns={columns} data={plans} loading={loading} rowKey={(r) => r.id || String(Math.random())} />
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)' }}>
          <Button variant="primary" loading={saving} onClick={save}>保存全部套餐</Button>
        </div>
      </div>

      <Modal open={!!editing} title={isNew ? '新增会员套餐' : '编辑会员套餐'} onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" onClick={() => { if (editing) { setPlans(prev => isNew ? [...prev, editing] : prev.map(p => p.id === editing.id ? editing : p)); setEditing(null); } }}>加入列表</Button></>}>
        {editing && (
          <>
            <Field label="套餐 ID" hint={isNew ? '唯一标识，如 celano-vip；保存后不可改，用户会员数据引用此 ID' : '已开通用户的会员数据引用此 ID，请勿随意变更'}>
              <TextInput value={editing.id} onChange={(v) => setEditing({ ...editing, id: v })} disabled={!isNew} className="w-full" />
            </Field>
            <Field label="套餐名称"><TextInput value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} className="w-full" placeholder="如：超级会员" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="首月展示价"><TextInput value={editing.price} onChange={(v) => setEditing({ ...editing, price: v })} className="w-full" placeholder="如：¥33" /></Field>
              <Field label="续费价（元）"><TextInput type="number" value={String(editing.renewalPrice)} onChange={(v) => setEditing({ ...editing, renewalPrice: Number(v) || 0 })} className="w-full" /></Field>
            </div>
            <Field label="每月发放点数"><TextInput type="number" value={String(editing.points)} onChange={(v) => setEditing({ ...editing, points: Math.max(0, Math.floor(Number(v) || 0)) })} className="w-full" /></Field>
            <Field label="画质折扣（实扣点数）" hint={`2K 与 4K 的会员实扣点数；零售价为 2K=${IMAGE_COST['2K']} 点、4K=${IMAGE_COST['4K']} 点，折扣不得高于零售价`}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <TextInput type="number" value={String(editing.discount2k)} onChange={(v) => setEditing({ ...editing, discount2k: Math.max(1, Math.min(IMAGE_COST['2K'], Math.floor(Number(v) || IMAGE_COST['2K']))) })} className="w-full" />
                <TextInput type="number" value={String(editing.discount4k)} onChange={(v) => setEditing({ ...editing, discount4k: Math.max(1, Math.min(IMAGE_COST['4K'], Math.floor(Number(v) || IMAGE_COST['4K']))) })} className="w-full" />
              </div>
            </Field>
            <Field label="套餐说明"><TextInput value={editing.note} onChange={(v) => setEditing({ ...editing, note: v })} className="w-full" placeholder="如：适合团队和商业化生产" /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="配色"><Select value={editing.accent} onChange={(v) => setEditing({ ...editing, accent: v })} options={ACCENTS} className="w-full" /></Field>
              <Field label="推荐套餐"><Select value={editing.recommended ? 'yes' : 'no'} onChange={(v) => setEditing({ ...editing, recommended: v === 'yes' })} options={BOOL_OPTIONS} className="w-full" /></Field>
              <Field label="上架状态"><Select value={editing.enabled ? 'yes' : 'no'} onChange={(v) => setEditing({ ...editing, enabled: v === 'yes' })} options={BOOL_OPTIONS} className="w-full" /></Field>
            </div>
            <Field label="权益列表" hint="每行一条权益，最多 12 条；首条「每月发放点数」由系统自动生成">
              <textarea
                value={editing.benefits.join('\n')}
                onChange={(e) => setEditing({ ...editing, benefits: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) })}
                className="ws-input"
                rows={5}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
            </Field>
          </>
        )}
      </Modal>
    </div>
  );
};
