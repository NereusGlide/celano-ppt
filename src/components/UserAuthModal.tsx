import React, { useCallback, useId, useState } from 'react';
import { X, Eye, EyeOff, User as UserIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import '../styles/auth.css';

interface Props {
  onClose: () => void;
  onSuccess?: (mode: 'login' | 'register') => void;
}

/**
 * 登录 / 注册弹窗。
 *
 * 无障碍要点（此前完全缺失，属上线阻断项）：
 *  · role="dialog" + aria-modal，读屏软件才会把它识别为模态对话框
 *  · aria-labelledby 指向标题，进入时能听到弹窗用途
 *  · Esc 关闭、点击遮罩关闭、焦点锁在弹窗内、关闭后归还焦点（见 useFocusTrap）
 *  · 每个输入框都有 htmlFor/id 关联的 label
 *  · 校验失败时设置 aria-invalid 并用 aria-describedby 关联错误文案
 */
export const UserAuthModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const errorId = `${baseId}-error`;
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) { setError('请输入账号与密码'); return; }
    setError(''); setLoading(true);
    try { await login(identifier.trim(), password); onSuccess?.('login'); onClose(); }
    catch (err: unknown) { setError(err instanceof Error ? err.message : '登录失败'); }
    finally { setLoading(false); }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) { setError('账号需为 3-20 位字母、数字或下划线'); return; }
    if (!/^1[3-9]\d{9}$/.test(phone.trim())) { setError('请输入有效的 11 位手机号'); return; }
    if (regPassword.length < 6) { setError('密码长度至少 6 位'); return; }
    if (regPassword !== confirmPassword) { setError('两次输入的密码不一致'); return; }
    if (!inviteCode.trim()) { setError('请输入邀请码'); return; }
    setError(''); setLoading(true);
    try {
      await register({ username: username.trim(), phone: phone.trim(), password: regPassword, confirmPassword, inviteCode: inviteCode.trim() });
      onSuccess?.('register'); onClose();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : '注册失败'); }
    finally { setLoading(false); }
  };

  const switchTab = useCallback((next: 'login' | 'register') => { setTab(next); setError(''); }, []);
  const invalid = (field: string) => (error && error.includes(field) ? true : undefined);

  return (
    <div
      className="celano-auth-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="celano-auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="celano-auth-head">
          <div className="celano-auth-ident">
            <span className="celano-auth-mark" aria-hidden="true"><UserIcon size={16} /></span>
            <div>
              <h2 className="celano-auth-title" id={titleId}>
                {tab === 'login' ? '账户登录' : '创建账户'}
              </h2>
              <p className="celano-auth-sub">管理你的 CELANO PPT 账号</p>
            </div>
          </div>
          <button type="button" className="celano-auth-close" onClick={onClose} aria-label="关闭对话框">
            <X size={16} />
          </button>
        </div>

        <div className="celano-auth-tabs" role="tablist" aria-label="登录或注册">
          {(['login', 'register'] as const).map(key => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${baseId}-tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`${baseId}-panel-${key}`}
              className="celano-auth-tab"
              onClick={() => switchTab(key)}
            >
              {key === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        {error ? (
          <div className="celano-auth-error" id={errorId} role="alert">{error}</div>
        ) : null}

        {tab === 'login' ? (
          <form
            className="celano-auth-form"
            onSubmit={handleLogin}
            role="tabpanel"
            id={`${baseId}-panel-login`}
            aria-labelledby={`${baseId}-tab-login`}
          >
            <div className="celano-auth-field">
              <label htmlFor={`${baseId}-identifier`}>账号 / 手机号</label>
              <input
                id={`${baseId}-identifier`}
                className="celano-auth-input"
                data-autofocus
                autoComplete="username"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="输入账号或手机号"
                disabled={loading}
              />
            </div>
            <div className="celano-auth-field">
              <label htmlFor={`${baseId}-password`}>密码</label>
              <div className="celano-auth-input-wrap">
                <input
                  id={`${baseId}-password`}
                  className="celano-auth-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="输入密码"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="celano-auth-reveal"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <button type="submit" className="celano-auth-submit" disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </button>
            <p className="celano-auth-hint">登录即表示同意平台服务条款与隐私政策。</p>
          </form>
        ) : (
          <form
            className="celano-auth-form"
            onSubmit={handleRegister}
            role="tabpanel"
            id={`${baseId}-panel-register`}
            aria-labelledby={`${baseId}-tab-register`}
          >
            <div className="celano-auth-field">
              <label htmlFor={`${baseId}-username`}>账号</label>
              <input
                id={`${baseId}-username`}
                className="celano-auth-input"
                data-autofocus
                autoComplete="username"
                aria-invalid={invalid('账号')}
                aria-describedby={invalid('账号') ? errorId : undefined}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="3-20 位字母、数字或下划线"
                disabled={loading}
              />
            </div>
            <div className="celano-auth-field">
              <label htmlFor={`${baseId}-phone`}>手机号</label>
              <input
                id={`${baseId}-phone`}
                className="celano-auth-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel"
                aria-invalid={invalid('手机号')}
                aria-describedby={invalid('手机号') ? errorId : undefined}
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="11 位手机号"
                disabled={loading}
              />
            </div>
            <div className="celano-auth-field-row">
              <div className="celano-auth-field">
                <label htmlFor={`${baseId}-reg-password`}>密码</label>
                <input
                  id={`${baseId}-reg-password`}
                  className="celano-auth-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-invalid={invalid('密码')}
                  aria-describedby={invalid('密码') ? errorId : undefined}
                  value={regPassword}
                  onChange={e => setRegPassword(e.target.value)}
                  placeholder="至少 6 位"
                  disabled={loading}
                />
              </div>
              <div className="celano-auth-field">
                <label htmlFor={`${baseId}-confirm`}>确认密码</label>
                <input
                  id={`${baseId}-confirm`}
                  className="celano-auth-input"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-invalid={invalid('密码')}
                  aria-describedby={invalid('密码') ? errorId : undefined}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="再次输入"
                  disabled={loading}
                />
              </div>
            </div>
            <div className="celano-auth-field">
              <label htmlFor={`${baseId}-invite`}>邀请码</label>
              <input
                id={`${baseId}-invite`}
                className="celano-auth-input"
                aria-invalid={invalid('邀请码')}
                aria-describedby={invalid('邀请码') ? errorId : undefined}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value.toUpperCase())}
                placeholder="输入邀请码"
                disabled={loading}
              />
            </div>
            <label className="celano-auth-check">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={e => setShowPassword(e.target.checked)}
              />
              显示密码
            </label>
            <button type="submit" className="celano-auth-submit" disabled={loading}>
              {loading ? '注册中…' : '完成注册并登录'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
