import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Alert, Button, Card, Field, Modal, PageHeader, Pagination, Select, Table, Tag, TextInput, Column } from '../ui.js';
import { RechargeCode } from '../../types.js';

const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-');

export const RechargeCodesPage: React.FC = () => {
  const [rows, setRows] = useState<RechargeCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState('10');
  const [genCredits, setGenCredits] = useState('100');
  const [genPrefix, setGenPrefix] = useState('RC');
  const [genNote, setGenNote] = useState('');
  const [genLoading, setGenLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.rechargeCodes({ page, pageSize, keyword, status });
      setRows(res.rechargeCodes);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setGenLoading(true); setError('');
    try {
      const res = await adminApi.createRechargeCodes({
        count: Number(genCount) || 1,
        credits: Number(genCredits) || 100,
        prefix: genPrefix,
        note: genNote
      });
      setNotice('已生成 ' + res.created.length + ' 个充值码（每码 ' + genCredits + ' 点）');
      setGenOpen(false);
      setPage(1);
      load();
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  const disable = async (row: RechargeCode) => {
    try { await adminApi.updateRechargeCode(row.code, { status: 'disabled' }); load(); } catch (e: any) { setError(e.message); }
  };

  const remove = async (row: RechargeCode) => {
    if (!window.confirm('确定删除充值码 ' + row.code + '？')) return;
    try { await adminApi.deleteRechargeCode(row.code); load(); } catch (e: any) { setError(e.message); }
  };

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); setNotice('已复制：' + code); }
    catch { setNotice('复制失败，请手动选择：' + code); }
  };

  const columns: Column<RechargeCode>[] = [
    {
      title: '充值码', width: '210px', render: (r) => (
        <button onClick={() => copy(r.code)} title="点击复制" className="font-mono text-[#F4F6F7] hover:underline">{r.code}</button>
      )
    },
    { title: '面额', width: '90px', align: 'right', render: (r) => <span className="font-mono font-medium">{r.credits}</span> },
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
      title: '操作', width: '140px', render: (r) => (
        <div className="flex items-center gap-2">
          {r.status === 'unused' && <Button size="small" variant="text" onClick={() => disable(r)}>停用</Button>}
          <Button size="small" variant="text" onClick={() => remove(r)}>删除</Button>
        </div>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="充值码管理"
        desc="生成点数充值码，用户在系统内兑换后点数入账"
        extra={<Button variant="primary" onClick={() => setGenOpen(true)}>批量生成充值码</Button>}
      />

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <TextInput value={keyword} onChange={(v) => { setKeyword(v); setPage(1); }} placeholder="充值码 / 备注" className="w-[220px]" onEnter={load} />
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
        title="批量生成充值码"
        onClose={() => setGenOpen(false)}
        footer={
          <>
            <Button onClick={() => setGenOpen(false)}>取消</Button>
            <Button variant="primary" loading={genLoading} onClick={generate}>生成</Button>
          </>
        }
      >
        <Field label="生成数量" hint="单次最多 100 个">
          <TextInput value={genCount} onChange={setGenCount} type="number" className="w-full" />
        </Field>
        <Field label="每码面额（点）">
          <TextInput value={genCredits} onChange={setGenCredits} type="number" className="w-full" />
        </Field>
        <Field label="前缀">
          <TextInput value={genPrefix} onChange={setGenPrefix} className="w-full" />
        </Field>
        <Field label="备注（可选）">
          <TextInput value={genNote} onChange={setGenNote} placeholder="例如：双十一活动" className="w-full" />
        </Field>
      </Modal>
    </div>
  );
};
