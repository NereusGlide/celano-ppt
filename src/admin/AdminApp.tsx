import React, { useEffect, useState, useCallback } from 'react';
import { LayoutDashboard, Users, History, Ticket, CreditCard, Cpu, Crown, Gift, LogOut, ChevronDown, RefreshCw, Lock } from 'lucide-react';
import { AdminAccount } from '../types.js';
import { adminApi, getAdminToken, setAdminToken, clearAdminToken } from './api.js';
import { Button, TextInput, Alert, Field } from './ui.js';
import { BrandLogo } from '../components/BrandLogo.js';
import { Dashboard } from './pages/Dashboard.js';
import { UsersPage } from './pages/Users.js';
import { UsagePage } from './pages/UsageRecords.js';
import { InviteCodesPage } from './pages/InviteCodes.js';
import { RechargeCodesPage } from './pages/RechargeCodes.js';
import { AiConfigsPage } from './pages/AiConfigs.js';
import { MembershipPlansPage } from './pages/MembershipPlans.js';
import { MembershipCodesPage } from './pages/MembershipCodes.js';
import '../styles/workspace.css';

const MENUS = [
  { key: 'dashboard', label: '概览', Icon: LayoutDashboard },
  { key: 'users', label: '用户注册管理', Icon: Users },
  { key: 'usage', label: '使用记录管理', Icon: History },
  { key: 'invites', label: '邀请码管理', Icon: Ticket },
  { key: 'recharge', label: '充值码管理', Icon: CreditCard },
  { key: 'membership', label: '会员套餐管理', Icon: Crown },
  { key: 'membership-codes', label: '会员兑换码', Icon: Gift },
  { key: 'ai', label: 'AI 接口配置', Icon: Cpu }
];

function readHashMenu(): string {
  const h = window.location.hash.replace(/^#\/?/, '');
  return MENUS.some(m => m.key === h) ? h : 'dashboard';
}

/* ==================== 独立登录页 ==================== */
const AdminLogin: React.FC<{ onSuccess: (admin: AdminAccount) => void }> = ({ onSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) { setError('请输入管理员账号与密码'); return; }
    setError(''); setLoading(true);
    try { const res = await adminApi.login(username.trim(), password); setAdminToken(res.token); onSuccess(res.admin); }
    catch (err: any) { setError(err.message || '登录失败'); }
    finally { setLoading(false); }
  };
  return (
    <div className="ws-root" style={{ display: 'grid', placeItems: 'center', padding: 20 }}>
      <form onSubmit={submit} className="ws-panel" style={{ width: 420, maxWidth: '100%', padding: 30, margin: 0 }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}><BrandLogo height={36} /></div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>PPT 管理后台</h1>
          <p className="ws-subtitle">用户 · 使用记录 · 邀请码 · 充值码 · AI 接口</p>
        </div>
        {error && <Alert type="error">{error}</Alert>}
        <div className="ws-form">
          <Field label="管理员账号"><TextInput value={username} onChange={setUsername} placeholder="管理员账号" className="!h-11" /></Field>
          <Field label="密码"><TextInput value={password} onChange={setPassword} type="password" placeholder="密码" className="!h-11" onEnter={() => submit({ preventDefault: () => {} } as any)} /></Field>
          <button type="submit" disabled={loading} className="ws-button ws-primary" style={{ height: 44 }}>{loading ? '登录中…' : '登 录'}</button>
        </div>
        <p className="ws-sidebar-note" style={{ textAlign: 'center', marginTop: 18 }}>默认账号 admin / admin123，登录后请及时修改密码</p>
      </form>
    </div>
  );
};

/* ==================== 修改密码弹窗 ==================== */
const ChangePassword: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    setErr(''); setMsg(''); setLoading(true);
    try { await adminApi.changePassword(oldPassword, newPassword); setMsg('密码已更新'); setOld(''); setNew(''); }
    catch (e: any) { setErr(e.message || '修改失败'); }
    finally { setLoading(false); }
  };
  return (
    <div className="ws-modal-backdrop" onClick={onClose}>
      <div className="ws-modal" onClick={e => e.stopPropagation()}>
        <div className="ws-modal-head"><h2>修改密码</h2><button className="ws-modal-close" onClick={onClose} aria-label="关闭">×</button></div>
        {err && <Alert type="error">{err}</Alert>}
        {msg && <Alert type="success">{msg}</Alert>}
        <div className="ws-form">
          <Field label="当前密码"><TextInput value={oldPassword} onChange={setOld} type="password" /></Field>
          <Field label="新密码（至少 6 位）"><TextInput value={newPassword} onChange={setNew} type="password" /></Field>
        </div>
        <div className="ws-modal-actions">
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" loading={loading} onClick={submit}>确定</Button>
        </div>
      </div>
    </div>
  );
};

/* ==================== 主框架 ==================== */
export const AdminApp: React.FC = () => {
  const [admin, setAdmin] = useState<AdminAccount | null>(null);
  const [booting, setBooting] = useState(true);
  const [menu, setMenu] = useState<string>(readHashMenu());
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    (async () => {
      if (!getAdminToken()) { setBooting(false); return; }
      try { const res = await adminApi.profile(); setAdmin(res.admin); }
      catch { clearAdminToken(); }
      finally { setBooting(false); }
    })();
  }, []);

  useEffect(() => {
    const onHash = () => setMenu(readHashMenu());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goto = (key: string) => { window.location.hash = '/' + key; setMenu(key); };
  const logout = () => { clearAdminToken(); setAdmin(null); setUserMenuOpen(false); };
  const refresh = useCallback(() => setVersion(v => v + 1), []);

  if (booting) {
    return <div className="ws-root" style={{ display: 'grid', placeItems: 'center', color: '#8A9299', fontSize: 14 }}>正在加载管理后台…</div>;
  }
  if (!admin) return <AdminLogin onSuccess={setAdmin} />;

  const current = MENUS.find(m => m.key === menu) || MENUS[0];

  return (
    <div className="ws-root">
      <header className="ws-topbar">
        <div className="ws-brand">
          <span className="ws-brand-mark"><BrandLogo height={28} /></span>
          <span><strong>管理后台</strong><small>用户与 AI 接口维护</small></span>
        </div>
        <div className="ws-header-tools">
          <button className="ws-button ws-ghost" onClick={refresh} title="刷新当前页数据"><RefreshCw className="ws-spin" size={14} style={{ animation: 'none' }} /> 刷新</button>
          <div style={{ position: 'relative' }}>
            <button className="ws-account-chip" onClick={() => setUserMenuOpen(v => !v)} title="管理员账号">
              <span className="ws-avatar" style={{ width: 28, height: 28 }}>{admin.name.slice(0, 1)}</span>
              <span>{admin.name}</span>
              <ChevronDown size={13} style={{ opacity: .5 }} />
            </button>
            {userMenuOpen && (
              <div className="ws-panel" style={{ position: 'absolute', right: 0, top: 46, width: 200, zIndex: 40, margin: 0 }}
                onMouseLeave={() => setUserMenuOpen(false)}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #ffffff0f', fontSize: 11, color: '#8A9299' }}>
                  {admin.username} · {admin.role === 'super' ? '超级管理员' : '运营'}
                </div>
                <button className="ws-nav button-clear" style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 0, color: '#8A9299', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}
                  onClick={() => { setPwdOpen(true); setUserMenuOpen(false); }}>
                  <Lock size={13} /> 修改密码
                </button>
                <button style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 0, color: '#E8836F', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}
                  onClick={logout}>
                  <LogOut size={13} /> 退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="ws-layout">
        <aside className="ws-sidebar">
          <p className="ws-nav-label">ADMIN CONSOLE</p>
          <nav className="ws-nav" aria-label="管理后台导航">
            {MENUS.map(({ key, label, Icon }) => (
              <button key={key} aria-current={key === menu ? 'page' : undefined} onClick={() => goto(key)}>
                <Icon size={16} /><span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="ws-sidebar-bottom">
            <p className="ws-sidebar-note">CELANO PPT · AI 演示文稿系统</p>
          </div>
        </aside>
        <main className="ws-main">
          <div className="ws-content">
            <div className="ws-crumb" style={{ marginBottom: 14 }}><span>管理后台</span><span>/</span><b>{current.label}</b></div>
            {menu === 'dashboard' && <Dashboard key={version} onJump={goto} />}
            {menu === 'users' && <UsersPage key={version} />}
            {menu === 'usage' && <UsagePage key={version} />}
            {menu === 'invites' && <InviteCodesPage key={version} />}
            {menu === 'recharge' && <RechargeCodesPage key={version} />}
            {menu === 'membership' && <MembershipPlansPage key={version} />}
            {menu === 'membership-codes' && <MembershipCodesPage key={version} />}
            {menu === 'ai' && <AiConfigsPage key={version} />}
          </div>
        </main>
      </div>
      {pwdOpen && <ChangePassword onClose={() => setPwdOpen(false)} />}
    </div>
  );
};
