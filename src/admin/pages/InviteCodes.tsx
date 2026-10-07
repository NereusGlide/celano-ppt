import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Alert, Button, Card, Field, Modal, PageHeader, Pagination, Select, Table, Tag, TextInput, Column } from '../ui.js';
import { type AdminInviteCode } from '../api.js';

const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-');

export const InviteCodesPage: React.FC = () => {
  const [rows, setRows] = useState<AdminInviteCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [genOpen, setGenOpen] = useState(false);
  const [genCount, setGenCount] = useState('5');
  const [genPrefix, setGenPrefix] = useState('INV');
  const [genMaxUses, setGenMaxUses] = useState('1');
  const [genNote, setGenNote] = useState('');
  const [genLoading, setGenLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.inviteCodes({ page, pageSize, keyword, status });
      setRows(res.inviteCodes);
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
      const res = await adminApi.createInviteCodes({
        count: Number(genCount) || 1,
        prefix: genPrefix,
        maxUses: Number(genMaxUses) || 0,
        note: genNote
      });
      setNotice('已生成 ' + res.created.length + ' 个邀请码：' + res.created.map(c => c.code).join('、'));
      setGenOpen(false);
      setPage(1);
      load();
    } catch (e: any) {
      setError(e.message || '生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  const toggle = async (row: AdminInviteCode) => {
    try {
      await adminApi.updateInviteCode(row.code, { status: row.status === 'active' ? 'disabled' : 'active' });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (row: AdminInviteCode) => {
    if (!window.confirm('确定删除邀请码 ' + row.code + '？')) return;
    try { await adminApi.deleteInviteCode(row.code); load(); } catch (e: any) { setError(e.message); }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice('已复制：' + code);
    } catch {
      setNotice('复制失败，请手动选择：' + code);
    }
  };

  const columns: Column<AdminInviteCode>[] = [
    {
      title: '邀请码', width: '190px', render: (r) => (
        <button onClick={() => copy(r.code)} title="点击复制" className="font-mono text-[color:var(--text-primary)] hover:underline">{r.code}</button>
      )
    },
    {
      title: '状态', width: '90px', render: (r) => (r.status === 'active' ? <Tag type="success">启用</Tag> : <Tag type="info">已停用</Tag>)
    },
    {
      title: '使用情况', width: '130px', render: (r) => (
        <span className="font-mono">{r.usedCount} / {r.maxUses === 0 ? '不限' : r.maxUses}</span>
      )
    },
    {
      title: '使用用户', width: '200px', render: (r) => {
        const users = r.usedByUsers || [];
        if (!users.length) return <span className="text-[color:var(--text-secondary)]">—</span>;
        const first = users[0];
        return (
          <span className="ws-user-cell" title={users.map(u => u.phone ? `${u.username} · ${u.phone}` : u.username).join('；')}>
            <span className="ws-avatar">{first.username.slice(0, 1).toUpperCase()}</span>
            <span>
              <b>{first.username}</b>
              <small>{users.length > 1 ? `等 ${users.length} 人` : (first.phone || first.id)}</small>
            </span>
          </span>
        );
      }
    },
    { title: '备注', render: (r) => r.note || '-' },
    { title: '有效期', width: '160px', render: (r) => (r.expiresAt ? fmt(r.expiresAt) : '永久') },
    { title: '创建时间', width: '160px', render: (r) => fmt(r.createdAt) },
    {
      title: '操作', width: '150px', render: (r) => (
        <div className="flex items-center gap-2">
          <Button size="small" variant="text" onClick={() => toggle(r)}>{r.status === 'active' ? '停用' : '启用'}</Button>
          <Button size="small" variant="text" onClick={() => remove(r)}>删除</Button>
        </div>
      )
    }
  ];

  return (
    <div>
      <PageHeader
        title="邀请码管理"
        desc="前台注册时必须填写有效邀请码，此处控制生成与核销"
        extra={<Button variant="primary" onClick={() => setGenOpen(true)}>批量生成邀请码</Button>}
      />

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <TextInput value={keyword} onChange={(v) => { setKeyword(v); setPage(1); }} placeholder="邀请码 / 备注" className="w-[220px]" onEnter={load} />
          <Select
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ label: '全部状态', value: '' }, { label: '启用', value: 'active' }, { label: '已停用', value: 'disabled' }]}
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
        title="批量生成邀请码"
        onClose={() => setGenOpen(false)}
        footer={
          <>
            <Button onClick={() => setGenOpen(false)}>取消</Button>
            <Button variant="primary" loading={genLoading} onClick={generate}>生成</Button>
          </>
        }
      >
        <Field label="生成数量" hint="单次最多 50 个">
          <TextInput value={genCount} onChange={setGenCount} type="number" className="w-full" />
        </Field>
        <Field label="前缀" hint="生成形如 PREFIX-XXXX-XXXX 的邀请码">
          <TextInput value={genPrefix} onChange={setGenPrefix} className="w-full" />
        </Field>
        <Field label="每个码可用次数" hint="填 0 表示不限次数">
          <TextInput value={genMaxUses} onChange={setGenMaxUses} type="number" className="w-full" />
        </Field>
        <Field label="备注（可选）">
          <TextInput value={genNote} onChange={setGenNote} placeholder="例如：2026 春季渠道" className="w-full" />
        </Field>
      </Modal>
    </div>
  );
};
