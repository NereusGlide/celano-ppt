import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Alert, Button, Card, Field, Modal, PageHeader, Pagination, Select, Table, Tag, TextInput, Column } from '../ui.js';
import { MembershipCode, MembershipPlanConfig } from '../../types.js';

const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-');

export const MembershipCodesPage: React.FC = () => {
  const [rows, setRows] = useState<MembershipCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [plans, setPlans] = useState<MembershipPlanConfig[]>([]);

  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState('10');
  const [genPlanId, setGenPlanId] = useState('');
  const [genMonths, setGenMonths] = useState('1');
  const [genPrefix, setGenPrefix] = useState('MC');
  const [genNote, setGenNote] = useState('');
  const [genLoading, setGenLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.membershipCodes({ page, pageSize, keyword, status });
      setRows(res.membershipCodes);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    adminApi.membershipPlans().then(res => { setPlans(res.membershipPlans); if (!genPlanId && res.membershipPlans[0]) setGenPlanId(res.membershipPlans[0].id); }).catch(() => {});
  }, []);

  const generate = async () => {
    if (!genPlanId) { setError('请选择会员套餐'); return; }
    setGenLoading(true); setError('');
    try {
      const res = await adminApi.createMembershipCodes({
        count: Number(genCount) || 1,
        planId: genPlanId,
        months: Number(genMonths) || 1,
        prefix: genPrefix,
        note: genNote,
      });
      const plan = plans.find(p => p.id === genPlanId);
      setNotice('已生成 ' + res.created.length + ' 个会员兑换码（' + (plan?.name || '') + ' ' + genMonths + ' 个月）');
      setGenOpen(false);
      setPage(1);
      void load();
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  const remove = async (row: MembershipCode) => {
    if (!window.confirm('确定删除会员兑换码 ' + row.code + '？')) return;
    try { await adminApi.deleteMembershipCode(row.code); void load(); } catch (e: any) { setError(e.message); }
  };

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setNotice('已复制：' + code); }
    catch { setNotice('复制失败，请手动选择：' + code); }
  };

  const planName = (planId: string) => plans.find(p => p.id === planId)?.name || planId;

  const columns: Column<MembershipCode>[] = [
    {
      title: '兑换码', width: '200px', render: (r) => (
        <button onClick={() => copy(r.code)} title="点击复制" className="font-mono text-[#F4F6F7] hover:underline">{r.code}</button>
      )
    },
    { title: '套餐', width: '110px', render: (r) => <span>{planName(r.planId)}</span> },
    { title: '时长', width: '80px', align: 'right', render: (r) => <span className="font-mono">{r.months} 个月</span> },
    {
      title: '状态', width: '90px', render: (r) => (
        r.status === 'unused' ? <Tag type="success">未使用</Tag>
          : r.status === 'used' ? <Tag type="primary">已使用</Tag>
            : <Tag type="info">已停用</Tag>
      )
    },
    { title: '使用者', width: '120px', render: (r) => r.usedByName || '-' },
    { title: '使用时间', width: '160px', render: (r) => fmt(r.usedAt) },
    { title: '备注', render: (r) => r.note || '-' },
    { title: '创建时间', width: '160px', render: (r) => fmt(r.createdAt) },
    {
      title: '操作', width: '90px', render: (r) => (
        <div className="flex items-center gap-2">
          <Button size="small" variant="text" onClick={() => remove(r)}>删除</Button>
        </div>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="会员兑换码管理"
        desc="生成会员兑换码，用户在系统内兑换后开通对应套餐并顺延时长"
        extra={<Button variant="primary" onClick={() => setGenOpen(true)}>批量生成兑换码</Button>}
      />

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <TextInput value={keyword} onChange={(v) => { setKeyword(v); setPage(1); }} placeholder="兑换码 / 备注" className="w-[220px]" onEnter={load} />
          <Select
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ label: '全部状态', value: '' }, { label: '未使用', value: 'unused' }, { label: '已使用', value: 'used' }, { label: '已停用', value: 'disabled' }]}
          />
          <Button variant="primary" onClick={load}>查询</Button>
          <Button onClick={() => { setKeyword(''); setStatus(''); setPage(1); }}>重置</Button>
        </div>

        {error && <Alert type="error">{error}</Alert>}
        {notice && <Alert type="success">{notice}</Alert>}

        <Table columns={columns} data={rows} loading={loading} rowKey={(r) => r.code} />
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      </Card>

      <Modal
        open={genOpen}
        title="批量生成会员兑换码"
        onClose={() => setGenOpen(false)}
        footer={
          <>
            <Button onClick={() => setGenOpen(false)}>取消</Button>
            <Button variant="primary" loading={genLoading} onClick={generate}>生成</Button>
          </>
        }
      >
        <Field label="会员套餐">
          <Select value={genPlanId} onChange={setGenPlanId} options={plans.map(p => ({ value: p.id, label: p.name + '（' + p.points.toLocaleString() + ' 点/月）' }))} className="w-full" />
        </Field>
        <Field label="会员时长（月）" hint="单次 1-36 个月">
          <TextInput value={genMonths} onChange={setGenMonths} type="number" className="w-full" />
        </Field>
        <Field label="生成数量" hint="单次最多 100 个">
          <TextInput value={genCount} onChange={setGenCount} type="number" className="w-full" />
        </Field>
        <Field label="前缀">
          <TextInput value={genPrefix} onChange={setGenPrefix} className="w-full" />
        </Field>
        <Field label="备注（可选）">
          <TextInput value={genNote} onChange={setGenNote} placeholder="例如：赠送给合作客户" className="w-full" />
        </Field>
      </Modal>
    </div>
  );
};
