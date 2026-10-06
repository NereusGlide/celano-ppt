import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Alert, Button, Field, Modal, PageHeader, Pagination, Select, Table, Tag, TextInput, Column } from '../ui.js';
import { User } from '../../types.js';
import { MEMBERSHIP_NAMES, membershipView } from '../../shared/membership.js';

const localDate = (ts: number) => { const date = new Date(ts); return new Date(ts - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fmt = (ts?: number) => (ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '-');

type Row = User & { presentationCount: number; online?: boolean; hasPassword?: boolean };

export const UsersPage: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [online, setOnline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editing, setEditing] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  const [pwdFor, setPwdFor] = useState<Row | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);

  const [banFor, setBanFor] = useState<Row | null>(null);
  const [banBusy, setBanBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState<Row | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await adminApi.users({ page, pageSize, keyword, status, online });
      setRows(res.users);
      setTotal(res.total);
    } catch (e: any) {
      setError(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status, online]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); }, [notice]);

  const save = async () => {
    if (!editing) return;
    setSaving(true); setError('');
    try {
      await adminApi.updateUser(editing.id, {
        name: editing.name,
        phone: editing.phone,
        status: editing.status,
        role: editing.role,
        credits: Number(editing.credits) || 0,
        membership: editing.membershipPlan ? {
          planId: editing.membershipPlan,
          status: editing.membershipStatus || 'active',
          expiresAt: new Date(editing.membershipExpiry).getTime(),
        } : null
      });
      setEditing(null);
      setNotice('用户「' + editing.username + '」已保存');
      void load();
    } catch (e: any) {
      setError(e.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async () => {
    if (!pwdFor) return;
    if (newPassword.length < 6 || newPassword.length > 128) { setError('新密码长度需为 6-128 位'); return; }
    if (newPassword !== confirmPassword) { setError('两次输入的新密码不一致'); return; }
    setSavingPwd(true); setError('');
    try {
      await adminApi.resetUserPassword(pwdFor.id, newPassword);
      setPwdFor(null); setNewPassword(''); setConfirmPassword('');
      setNotice('已重置「' + pwdFor.username + '」的登录密码，其所有旧会话已失效');
    } catch (e: any) {
      setError(e.message || '重置失败');
    } finally {
      setSavingPwd(false);
    }
  };

  const toggleBan = async () => {
    if (!banFor) return;
    setBanBusy(true); setError('');
    const banning = (banFor.status || 'active') === 'active';
    try {
      if (banning) await adminApi.banUser(banFor.id);
      else await adminApi.unbanUser(banFor.id);
      setBanFor(null);
      setNotice(banning ? '用户「' + banFor.username + '」已封禁，无法再登录' : '用户「' + banFor.username + '」已解封');
      void load();
    } catch (e: any) {
      setError(e.message || '操作失败');
    } finally {
      setBanBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteFor) return;
    setDeleteBusy(true); setError('');
    try {
      await adminApi.deleteUser(deleteFor.id);
      setDeleteFor(null);
      setNotice('用户「' + deleteFor.username + '」已删除');
      void load();
    } catch (e: any) {
      setError(e.message || '删除失败');
    } finally {
      setDeleteBusy(false);
    }
  };

  const columns: Column<Row>[] = [
    {
      title: '用户', width: '180px', render: (r) => (
        <div className="ws-user-cell">
          <span className={'ws-dot ' + (r.online ? 'ws-dot-online' : '')} title={r.online ? '在线（5 分钟内活跃）' : '离线'} />
          <span className="ws-avatar">{r.name.slice(0, 1).toUpperCase()}</span>
          <span style={{ minWidth: 0 }}>
            <b>@{r.username}</b>
            <small>{r.id}</small>
          </span>
        </div>
      )
    },
    { title: '昵称', width: '110px', render: (r) => r.name },
    { title: '手机号', width: '120px', render: (r) => <span className="ws-mono">{r.phone || '—'}</span> },
    {
      title: '角色', width: '84px', render: (r) => (
        <Tag type={r.role === 'admin' ? 'danger' : r.role === 'creator' ? 'primary' : 'info'}>
          {r.role === 'admin' ? '管理员' : r.role === 'creator' ? '创作者' : '成员'}
        </Tag>
      )
    },
    {
      title: '状态', width: '84px', render: (r) => (
        (r.status || 'active') === 'active' ? <Tag type="success">正常</Tag> : <Tag type="danger">已封禁</Tag>
      )
    },
    { title: '会员', width: '145px', render: (r) => <span>{membershipView(r).name}<small style={{ display: 'block', color: '#8A9299' }}>{r.membership ? fmt(r.membership.expiresAt) : '—'}</small></span> },
    { title: '点数', width: '70px', align: 'right', render: (r) => <span className="ws-mono">{r.credits ?? 0}</span> },
    { title: '文稿', width: '60px', align: 'right', render: (r) => <span className="ws-mono">{r.presentationCount}</span> },
    { title: '邀请码', width: '110px', render: (r) => <span className="ws-mono">{r.inviteCode || '—'}</span> },
    {
      title: '最近登录', width: '190px', render: (r) => (
        <span>
          <span className="ws-mono" style={{ display: 'block', color: '#8A9299' }}>{fmt(r.lastLoginAt)}</span>
          {r.lastLoginIp ? <span className="ws-ip">IP {r.lastLoginIp}</span> : <span className="ws-ip">IP —</span>}
        </span>
      )
    },
    { title: '注册时间', width: '150px', render: (r) => <span className="ws-mono">{fmt(r.createdAt)}</span> },
    {
      title: '操作', width: '220px', render: (r) => (
        <div className="ws-button-group" style={{ gap: 4 }}>
          <Button size="small" variant="text" onClick={() => setEditing({ ...r, credits: r.credits ?? 0, status: r.status || 'active', membershipPlan: r.membership?.planId || '', membershipStatus: r.membership?.status || 'active', membershipExpiry: r.membership ? localDate(r.membership.expiresAt) : '' })}>编辑</Button>
          <Button size="small" variant="text" onClick={() => { setPwdFor(r); setNewPassword(''); setConfirmPassword(''); }}>改密</Button>
          <Button size="small" variant={(r.status || 'active') === 'active' ? 'warning' : 'success'}
            onClick={() => setBanFor(r)}>
            {(r.status || 'active') === 'active' ? '封禁' : '解封'}
          </Button>
          <Button size="small" variant="danger" onClick={() => setDeleteFor(r)}>删除</Button>
        </div>
      )
    }
  ];

  return (
    <div>
      <PageHeader title="用户注册管理" desc="在线状态、登录 IP、账号编辑、封禁与密码管理" extra={<Button size="small" onClick={() => void load()}>刷新</Button>} />

      <div className="ws-panel">
        <div className="ws-toolbar">
          <div className="ws-search">
            <TextInput value={keyword} onChange={(v) => { setKeyword(v); setPage(1); }} placeholder="账号 / 昵称 / 手机号 / ID" className="w-[240px]" onEnter={() => void load()} />
          </div>
          <Select value={status} onChange={(v) => { setStatus(v); setPage(1); }}
            options={[{ label: '全部状态', value: '' }, { label: '正常', value: 'active' }, { label: '已封禁', value: 'disabled' }]} />
          <Select value={online} onChange={(v) => { setOnline(v); setPage(1); }}
            options={[{ label: '全部在线', value: '' }, { label: '在线', value: 'online' }, { label: '离线', value: 'offline' }]} />
          <Button variant="primary" onClick={() => void load()}>查询</Button>
          <Button onClick={() => { setKeyword(''); setStatus(''); setOnline(''); setPage(1); }}>重置</Button>
        </div>

        {error && <div style={{ padding: '0 20px' }}><Alert type="error">{error}</Alert></div>}
        {notice && <div style={{ padding: '0 20px' }}><Alert type="success">{notice}</Alert></div>}

        <Table columns={columns} data={rows} loading={loading} rowKey={(r) => r.id} />
        <Pagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={(s) => { setPageSize(s); setPage(1); }} />
      </div>

      {/* 编辑用户 */}
      <Modal open={!!editing} title="编辑用户" onClose={() => setEditing(null)}
        footer={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" loading={saving} onClick={save}>保存</Button></>}>
        {editing && (
          <>
            <div style={{ fontSize: 12, color: '#8A9299', marginBottom: 16 }}>
              账号：<b style={{ color: '#E2E5E8' }}>@{editing.username}</b>{editing.id ? <span className="ws-mono" style={{ marginLeft: 8 }}>{editing.id}</span> : null}
            </div>
            <Field label="昵称"><TextInput value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} className="w-full" /></Field>
            <Field label="手机号" hint="留空表示清除手机号；不能与其他账号重复"><TextInput value={editing.phone || ''} onChange={(v) => setEditing({ ...editing, phone: v })} className="w-full" /></Field>
            <Field label="账号状态" hint="封禁后该账号立即无法登录，正在进行的会话也将失效">
              <Select value={editing.status || 'active'} onChange={(v) => setEditing({ ...editing, status: v })}
                options={[{ label: '正常', value: 'active' }, { label: '封禁', value: 'disabled' }]} className="w-full" />
            </Field>
            <Field label="角色">
              <Select value={editing.role} onChange={(v) => setEditing({ ...editing, role: v })}
                options={[{ label: '创作者', value: 'creator' }, { label: '成员', value: 'member' }, { label: '管理员', value: 'admin' }]} className="w-full" />
            </Field>
            <Field label="剩余点数"><TextInput value={String(editing.credits)} onChange={(v) => setEditing({ ...editing, credits: v })} type="number" className="w-full" /></Field>
            <Field label="会员套餐" hint="确认办理后设置；会员资格与点数余额、账号角色独立">
              <Select value={editing.membershipPlan || ''} onChange={v => setEditing({ ...editing, membershipPlan: v })} options={[{ label: '未开通会员', value: '' }, ...Object.entries(MEMBERSHIP_NAMES).map(([value, label]) => ({ value, label }))]} className="w-full" />
            </Field>
            {editing.membershipPlan ? <>
              <Field label="会员状态"><Select value={editing.membershipStatus || 'active'} onChange={v => setEditing({ ...editing, membershipStatus: v })} options={[{ label: '有效', value: 'active' }, { label: '已取消', value: 'cancelled' }]} className="w-full" /></Field>
              <Field label="会员到期时间" hint="到期后自动恢复为非会员；此处不自动充值点数"><TextInput type="datetime-local" value={editing.membershipExpiry || ''} onChange={v => setEditing({ ...editing, membershipExpiry: v })} className="w-full" /></Field>
            </> : null}
          </>
        )}
      </Modal>

      {/* 重置密码 */}
      <Modal open={!!pwdFor} title={'重置密码 · @' + (pwdFor?.username || '')} onClose={() => setPwdFor(null)}
        footer={<><Button onClick={() => setPwdFor(null)}>取消</Button><Button variant="primary" loading={savingPwd} onClick={savePassword}>重置密码</Button></>}>
        <p style={{ marginBottom: 16 }}>为该用户设置新密码，其所有已登录会话将立即失效。</p>
        <Field label="新密码（6-128 位）"><TextInput value={newPassword} onChange={setNewPassword} type="password" className="w-full" /></Field>
        <Field label="确认新密码"><TextInput value={confirmPassword} onChange={setConfirmPassword} type="password" className="w-full" /></Field>
      </Modal>

      {/* 封禁/解封确认 */}
      <Modal open={!!banFor} title={((banFor?.status || 'active') === 'active' ? '封禁用户 · @' : '解封用户 · @') + (banFor?.username || '')} onClose={() => setBanFor(null)}
        footer={<><Button onClick={() => setBanFor(null)}>取消</Button><Button variant={((banFor?.status || 'active') === 'active') ? 'danger' : 'success'} loading={banBusy} onClick={toggleBan}>{(banFor?.status || 'active') === 'active' ? '确认封禁' : '确认解封'}</Button></>}>
        <p>{((banFor?.status || 'active') === 'active')
          ? '封禁后该账号无法登录前台，正在进行的会话也会失效；账号数据保留，可随时解封。'
          : '解封后该账号可正常登录，数据保持不变。'}</p>
      </Modal>

      {/* 删除确认 */}
      <Modal open={!!deleteFor} title={'删除用户 · @' + (deleteFor?.username || '')} onClose={() => setDeleteFor(null)}
        footer={<><Button onClick={() => setDeleteFor(null)}>取消</Button><Button variant="danger" loading={deleteBusy} onClick={remove}>确认删除</Button></>}>
        <p>删除后该账号的文稿与配置会一并移除，且不可恢复。请确认这是你想要的。</p>
      </Modal>
    </div>
  );
};
