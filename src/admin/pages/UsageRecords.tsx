import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, type AdminUsageRecord } from '../api.js';
import { Alert, Button, Card, PageHeader, Pagination, Select, Table, Tag, TextInput, Column } from '../ui.js';

const fmt = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

const TYPE_LABEL: Record<string, { text: string; tag: any }> = {
  register: { text: '注册', tag: 'success' },
  login: { text: '登录', tag: 'info' },
  recharge: { text: '充值', tag: 'danger' },
  slide_image: { text: '页面生图/修改', tag: 'warning' },
  outline: { text: '大纲规划', tag: 'info' },
  optimize_prompt: { text: '提示词优化', tag: 'info' },
  export_pptx: { text: '导出 PPTX', tag: 'info' }
};

/**
 * 详情里早期版本把 IP 拼在尾部（「账号登录 · IP 127.0.0.1」）；
 * 现在 IP 已有独立列，展示时剥离以免重复。
 */
const detailText = (r: AdminUsageRecord) => String(r.detail || '').replace(/\s*·\s*IP\s+[0-9a-fA-F:.]+\s*$/, '');

/** 用户列：优先展示用户表的当前资料，账号已删除时明确标注。 */
const UserCell: React.FC<{ row: AdminUsageRecord }> = ({ row }) => {
  const username = row.user?.username || row.username || '未知用户';
  const sub = row.user ? (row.user.phone || row.user.id) : '账号已删除';
  return (
    <span className="ws-user-cell">
      <span className="ws-avatar">{row.user?.avatar ? <img src={row.user.avatar} alt="" /> : username.slice(0, 1).toUpperCase()}</span>
      <span>
        <b>{username}</b>
        <small>{sub}</small>
      </span>
    </span>
  );
};

export const UsagePage: React.FC = () => {
  const [rows, setRows] = useState<AdminUsageRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.usageRecords({ page, pageSize, keyword, type });
      setRows(res.records);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, type]);

  useEffect(() => { load(); }, [load]);

  const remove = async (row: AdminUsageRecord) => {
    if (!window.confirm('确定删除该条使用记录？')) return;
    try { await adminApi.deleteUsageRecord(row.id); load(); } catch (e: any) { setError(e.message); }
  };

  const columns: Column<AdminUsageRecord>[] = [
    { title: '时间', width: '165px', render: (r) => <span className="ws-mono">{fmt(r.createdAt)}</span> },
    { title: '使用用户', width: '190px', render: (r) => <UserCell row={r} /> },
    {
      title: '类型', width: '120px', render: (r) => {
        const cfg = TYPE_LABEL[r.type] || { text: r.type, tag: 'info' };
        return <Tag type={cfg.tag}>{cfg.text}</Tag>;
      }
    },
    { title: '详情', render: (r) => <span className="text-[color:var(--text-secondary)]">{detailText(r)}</span> },
    { title: 'IP', width: '140px', render: (r) => <span className="ws-ip">{r.ip || '—'}</span> },
    { title: '点数', width: '80px', align: 'right', render: (r) => <span className={'font-mono ' + (r.credits < 0 ? 'text-[color:var(--danger-text)]' : r.credits > 0 ? 'text-[color:var(--text-secondary)]' : '')}>{r.credits > 0 ? '+' + r.credits : r.credits}</span> },
    { title: '操作', width: '80px', render: (r) => <Button size="small" variant="text" onClick={() => remove(r)}>删除</Button> }
  ];

  return (
    <div>
      <PageHeader title="使用记录管理" desc="注册、登录、生成、导出等行为流水" />

      <Card>
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <TextInput value={keyword} onChange={(v) => { setKeyword(v); setPage(1); }} placeholder="用户名 / 详情 / IP" className="w-[220px]" onEnter={load} />
          <Select
            value={type}
            onChange={(v) => { setType(v); setPage(1); }}
            options={[
              { label: '全部类型', value: '' },
              { label: '注册', value: 'register' },
              { label: '登录', value: 'login' },
              { label: '页面生图/修改', value: 'slide_image' },
              { label: '充值', value: 'recharge' }
            ]}
          />
          <Button variant="primary" onClick={load}>查询</Button>
          <Button onClick={() => { setKeyword(''); setType(''); setPage(1); }}>重置</Button>
        </div>

        {error && <Alert type="error">{error}</Alert>}

        <Table columns={columns} data={rows} loading={loading} rowKey={(r) => r.id} />
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      </Card>
    </div>
  );
};
