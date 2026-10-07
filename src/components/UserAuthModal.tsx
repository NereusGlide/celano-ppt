import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  X, User as UserIcon, Lock, Phone, Ticket, Eye, EyeOff,
  ShieldCheck, AlertCircle, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { useFocusTrap } from '../hooks/useFocusTrap.js';
import { CelanoLogo } from './CelanoLogo.js';
import { CaptchaCanvas } from './CaptchaCanvas.js';
import '../styles/auth.css';

interface Props {
  onClose: () => void;
  onSuccess?: (mode: 'login' | 'register') => void;
}

const LEGAL_TEXT: Record<'terms' | 'privacy', { title: string; body: string }> = {
  terms: {
    title: 'CELANO 平台用户服务协议',
    body: '欢迎使用 CELANO AI 创作平台。使用本平台服务即表示您同意以下条款：\n\n一、您上传与生成的内容需符合法律法规，不得包含违法、侵权或危害他人权益的信息。\n\n二、平台提供的 AI 生成能力按算力点计费，生成结果仅供您在平台授权范围内使用。\n\n三、您应对自己账号下的全部操作负责，请妥善保管账号与密码。\n\n四、平台会持续迭代服务质量，功能与计费规则如有调整将提前公告。\n\n如需完整协议文本，请联系管理员获取。',
  },
  privacy: {
    title: 'CELANO 平台隐私权保护政策',
    body: '我们重视您的个人信息保护：\n\n一、平台仅收集为提供服务所必需的信息（账号、手机号、登录凭证），不会向第三方出售您的个人信息。\n\n二、您的作品与生成记录仅您本人及授权管理员可见。\n\n三、会话凭证通过加密 Cookie 保存，密码以单向哈希存储，任何人（包括管理员）均无法查看明文。\n\n四、您可随时联系管理员注销账号并删除相关数据。',
  },
};

/**
 * 登录 / 注册弹窗（celano-ai-studio JiMeng 风格移植版）。
 *
 * 视觉完全来自参考项目 AuthModal，登录注册仍走真实接口：
 *  · useAuth().login(identifier, password)
 *  · useAuth().register({ username, phone, password, confirmPassword, inviteCode })
 *
 * 无障碍保持原有标准：
 *  · role="dialog" + aria-modal + aria-labelledby
 *  · Esc 关闭 / 遮罩关闭 / 焦点锁（useFocusTrap）/ 关闭后归还焦点
 *  · label 关联、aria-invalid + aria-describedby 错误提示
 */
export const UserAuthModal: React.FC<Props> = ({ onClose, onSuccess }) => {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');

  // 登录表单
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // 注册表单
  const [username, setUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(true);

  const [captchaCode, setCaptchaCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [legal, setLegal] = useState<'terms' | 'privacy' | null>(null);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const [captchaSeed, setCaptchaSeed] = useState(0);

  // 切换 tab 时清空错误与验证码输入
  useEffect(() => {
    setErrors({});
    setCaptchaInput('');
    setCaptchaSeed(s => s + 1);
  }, [tab]);

  const handleCaptchaCode = useCallback((code: string) => { setCaptchaCode(code); }, []);

  const fieldError = (field: string, id: string) =>
    errors[field] ? (
      <p className="cxauth-ferr" id={id}>
        <AlertCircle size={12} aria-hidden="true" />
        {errors[field]}
      </p>
    ) : null;

  /* ---------------- 登录 ---------------- */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!identifier.trim()) next.identifier = '请输入账号或手机号码';
    if (!password) next.password = '请输入密码';
    else if (password.length < 6) next.password = '密码长度至少为 6 个字符';
    if (!captchaInput.trim()) next.captcha = '请输入 4 位字母验证码';
    else if (captchaInput.trim().toLowerCase() !== captchaCode.toLowerCase()) next.captcha = '验证码不匹配，请重新输入';
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.captcha) setCaptchaSeed(s => s + 1);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      onSuccess?.('login');
      onClose();
    } catch (errUnknown: unknown) {
      setErrors({ form: errUnknown instanceof Error ? errUnknown.message : '登录失败' });
      setCaptchaSeed(s => s + 1);
      setCaptchaInput('');
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- 注册 ---------------- */
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!username.trim()) next.username = '请输入账号';
    else if (!/^[A-Za-z0-9_]{3,20}$/.test(username.trim())) next.username = '账号需为 3-20 位字母、数字或下划线';
    if (!regPassword) next.regPassword = '请输入密码';
    else if (regPassword.length < 6) next.regPassword = '密码长度至少为 6 位';
    if (!phone.trim()) next.phone = '请输入手机号码';
    else if (!/^1[3-9]\d{9}$/.test(phone.trim())) next.phone = '请输入有效的 11 位手机号';
    if (!inviteCode.trim()) next.inviteCode = '请输入邀请码';
    if (!captchaInput.trim()) next.captcha = '请输入 4 位字母验证码';
    else if (captchaInput.trim().toLowerCase() !== captchaCode.toLowerCase()) next.captcha = '验证码不匹配，请重新输入';
    if (!agreeTerms) next.agreeTerms = '请阅读并勾选用户协议和隐私政策';
    if (Object.keys(next).length) {
      setErrors(next);
      if (next.captcha) setCaptchaSeed(s => s + 1);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await register({
        username: username.trim(),
        phone: phone.trim(),
        password: regPassword,
        confirmPassword: regPassword,
        inviteCode: inviteCode.trim().toUpperCase(),
      });
      onSuccess?.('register');
      onClose();
    } catch (errUnknown: unknown) {
      setErrors({ form: errUnknown instanceof Error ? errUnknown.message : '注册失败' });
      setCaptchaSeed(s => s + 1);
      setCaptchaInput('');
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- 密码强度 ---------------- */
  const strength = (() => {
    const pwd = regPassword;
    if (!pwd) return { label: '', score: 0, level: 0 };
    let score = 0;
    if (pwd.length >= 6) score += 1;
    if (pwd.length >= 10) score += 1;
    if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9]/.test(pwd)) score += 1;
    if (score <= 2) return { label: '弱', score: 1, level: 1 };
    if (score <= 4) return { label: '中', score: 2, level: 2 };
    return { label: '强', score: 3, level: 3 };
  })();

  const invalid = (field: string) => (errors[field] ? true : undefined);
  const describedBy = (field: string) => (errors[field] ? `${baseId}-err-${field}` : undefined);

  return (
    <div
      className="cxauth-backdrop"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className="cxauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="cxauth-glow" aria-hidden="true" />

        {/* 顶栏：品牌 + 关闭 */}
        <div className="cxauth-topbar">
          <CelanoLogo variant="white" className="cxauth-topbar-logo" />
          <button type="button" className="cxauth-close" onClick={onClose} aria-label="关闭窗口">
            <X size={18} />
          </button>
        </div>

        {/* 模式切换 */}
        <div className="cxauth-tabs" role="tablist" aria-label="登录或注册">
          <div className="cxauth-tabs-left">
            <button
              type="button"
              role="tab"
              id={`${baseId}-tab-login`}
              aria-selected={tab === 'login'}
              aria-controls={`${baseId}-panel-login`}
              className={`cxauth-tab ${tab === 'login' ? 'is-active' : ''}`}
              onClick={() => setTab('login')}
            >
              账号登录
              {tab === 'login' ? <span className="cxauth-tab-ind" aria-hidden="true" /> : null}
            </button>
            <button
              type="button"
              role="tab"
              id={`${baseId}-tab-register`}
              aria-selected={tab === 'register'}
              aria-controls={`${baseId}-panel-register`}
              className={`cxauth-tab ${tab === 'register' ? 'is-active' : ''}`}
              onClick={() => setTab('register')}
            >
              账号注册
              <span className="cxauth-vip" aria-hidden="true">VIP</span>
              {tab === 'register' ? <span className="cxauth-tab-ind" aria-hidden="true" /> : null}
            </button>
          </div>
        </div>

        {/* 副标题 */}
        <div className="cxauth-subhead">
          <h2 className="cxauth-sub-title" id={titleId}>
            {tab === 'login' ? '登录 CELANO 账号' : '注册 CELANO 账号'}
          </h2>
          <p className="cxauth-sub-desc">
            {tab === 'login'
              ? '从一句主题到一份完整演示，AI 让表达更高效'
              : '凭邀请码尊享创作算力与高阶生成模型'}
          </p>
        </div>

        {errors.form ? (
          <div className="cxauth-formerr" role="alert">
            <AlertCircle size={13} aria-hidden="true" />
            {errors.form}
          </div>
        ) : null}

        {/* ============ 登录 ============ */}
        {tab === 'login' ? (
          <form
            className="cxauth-form"
            onSubmit={handleLogin}
            role="tabpanel"
            id={`${baseId}-panel-login`}
            aria-labelledby={`${baseId}-tab-login`}
          >
            <div className="cxauth-field">
              <label htmlFor={`${baseId}-identifier`} className="cxauth-label">账号 / 手机号</label>
              <div className="cxauth-input-wrap">
                <span className="cxauth-ico" aria-hidden="true"><UserIcon size={15} /></span>
                <input
                  id={`${baseId}-identifier`}
                  className="cxauth-input"
                  data-autofocus
                  autoComplete="username"
                  aria-invalid={invalid('identifier')}
                  aria-describedby={describedBy('identifier')}
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  placeholder="请输入账号或手机号码"
                  disabled={loading}
                />
              </div>
              {fieldError('identifier', `${baseId}-err-identifier`)}
            </div>

            <div className="cxauth-field">
              <label htmlFor={`${baseId}-password`} className="cxauth-label">密码</label>
              <div className="cxauth-input-wrap">
                <span className="cxauth-ico" aria-hidden="true"><Lock size={15} /></span>
                <input
                  id={`${baseId}-password`}
                  className="cxauth-input has-action"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-invalid={invalid('password')}
                  aria-describedby={describedBy('password')}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="请输入密码 (不少于6位)"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="cxauth-eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>
              {fieldError('password', `${baseId}-err-password`)}
            </div>

            <div className="cxauth-field">
              <label htmlFor={`${baseId}-captcha`} className="cxauth-label">4位字母验证码</label>
              <div className="cxauth-row">
                <div className="cxauth-input-wrap cxauth-grow">
                  <span className="cxauth-ico" aria-hidden="true"><ShieldCheck size={15} /></span>
                  <input
                    id={`${baseId}-captcha`}
                    className="cxauth-input cxauth-captcha-input"
                    maxLength={4}
                    autoComplete="off"
                    aria-invalid={invalid('captcha')}
                    aria-describedby={describedBy('captcha')}
                    value={captchaInput}
                    onChange={e => setCaptchaInput(e.target.value)}
                    placeholder="请输入右侧4位字母"
                    disabled={loading}
                  />
                </div>
                <CaptchaCanvas key={`login-${captchaSeed}`} onCodeChange={handleCaptchaCode} refreshText="点击图案刷新验证码 (不区分大小写)" />
              </div>
              {fieldError('captcha', `${baseId}-err-captcha`)}
            </div>

            <div className="cxauth-checkrow">
              <label className="cxauth-check">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                />
                自动登录
              </label>
              <button
                type="button"
                className="cxauth-link"
                onClick={() => setErrors(prev => ({ ...prev, forgot: '请联系管理员重置密码' }))}
              >
                忘记密码？
              </button>
            </div>
            {errors.forgot ? (
              <p className="cxauth-ferr"><AlertCircle size={12} aria-hidden="true" />{errors.forgot}</p>
            ) : null}

            <button type="submit" className="cxauth-submit" disabled={loading}>
              {loading ? <RefreshCw size={15} className="cxauth-spin" aria-hidden="true" /> : <span>立即登录</span>}
            </button>
          </form>
        ) : (
          /* ============ 注册 ============ */
          <form
            className="cxauth-form"
            onSubmit={handleRegister}
            role="tabpanel"
            id={`${baseId}-panel-register`}
            aria-labelledby={`${baseId}-tab-register`}
          >
            <div className="cxauth-field">
              <label htmlFor={`${baseId}-username`} className="cxauth-label">账号</label>
              <div className="cxauth-input-wrap">
                <span className="cxauth-ico" aria-hidden="true"><UserIcon size={15} /></span>
                <input
                  id={`${baseId}-username`}
                  className="cxauth-input"
                  data-autofocus
                  autoComplete="username"
                  aria-invalid={invalid('username')}
                  aria-describedby={describedBy('username')}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="3-20位字符，支持字母、数字或下划线"
                  disabled={loading}
                />
              </div>
              {fieldError('username', `${baseId}-err-username`)}
            </div>

            <div className="cxauth-field">
              <div className="cxauth-label-row">
                <label htmlFor={`${baseId}-reg-password`} className="cxauth-label">密码</label>
                {regPassword ? (
                  <span className="cxauth-strength-label">
                    密码强度：<b className={`cxauth-strength-text is-l${strength.level}`}>{strength.label}</b>
                  </span>
                ) : null}
              </div>
              <div className="cxauth-input-wrap">
                <span className="cxauth-ico" aria-hidden="true"><Lock size={15} /></span>
                <input
                  id={`${baseId}-reg-password`}
                  className="cxauth-input has-action"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  aria-invalid={invalid('regPassword')}
                  aria-describedby={describedBy('regPassword')}
                  value={regPassword}
                  onChange={e => setRegPassword(e.target.value)}
                  placeholder="包含字母与数字，6-20位"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="cxauth-eye"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>
              {regPassword ? (
                <span className="cxauth-strength-bar" aria-hidden="true">
                  {[1, 2, 3].map(n => (
                    <i key={n} className={`cxauth-seg ${strength.score >= n ? `is-l${strength.level}` : ''}`} />
                  ))}
                </span>
              ) : null}
              {fieldError('regPassword', `${baseId}-err-regPassword`)}
            </div>

            <div className="cxauth-field">
              <label htmlFor={`${baseId}-phone`} className="cxauth-label">手机号</label>
              <div className="cxauth-row">
                <span className="cxauth-dial" aria-hidden="true">🇨🇳 +86</span>
                <div className="cxauth-input-wrap cxauth-grow">
                  <span className="cxauth-ico" aria-hidden="true"><Phone size={15} /></span>
                  <input
                    id={`${baseId}-phone`}
                    className="cxauth-input"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    aria-invalid={invalid('phone')}
                    aria-describedby={describedBy('phone')}
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="请输入手机号码"
                    disabled={loading}
                  />
                </div>
              </div>
              {fieldError('phone', `${baseId}-err-phone`)}
            </div>

            <div className="cxauth-field">
              <label htmlFor={`${baseId}-invite`} className="cxauth-label">邀请码</label>
              <div className="cxauth-input-wrap">
                <span className="cxauth-ico" aria-hidden="true"><Ticket size={15} /></span>
                <input
                  id={`${baseId}-invite`}
                  className="cxauth-input cxauth-mono"
                  aria-invalid={invalid('inviteCode')}
                  aria-describedby={describedBy('inviteCode')}
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="请输入企业/内测邀请码"
                  disabled={loading}
                />
              </div>
              {fieldError('inviteCode', `${baseId}-err-inviteCode`)}
            </div>

            <div className="cxauth-field">
              <label htmlFor={`${baseId}-captcha`} className="cxauth-label">4位字母验证码</label>
              <div className="cxauth-row">
                <div className="cxauth-input-wrap cxauth-grow">
                  <span className="cxauth-ico" aria-hidden="true"><ShieldCheck size={15} /></span>
                  <input
                    id={`${baseId}-captcha`}
                    className="cxauth-input cxauth-captcha-input"
                    maxLength={4}
                    autoComplete="off"
                    aria-invalid={invalid('captcha')}
                    aria-describedby={describedBy('captcha')}
                    value={captchaInput}
                    onChange={e => setCaptchaInput(e.target.value)}
                    placeholder="请输入右侧4位字母"
                    disabled={loading}
                  />
                </div>
                <CaptchaCanvas key={`reg-${captchaSeed}`} onCodeChange={handleCaptchaCode} refreshText="点击图案刷新验证码 (不区分大小写)" />
              </div>
              {fieldError('captcha', `${baseId}-err-captcha`)}
            </div>

            <div className="cxauth-agree">
              <label className="cxauth-check cxauth-agree-check">
                <input
                  type="checkbox"
                  checked={agreeTerms}
                  onChange={e => setAgreeTerms(e.target.checked)}
                  aria-invalid={invalid('agreeTerms')}
                />
                <span>
                  我已阅读并同意
                  <button type="button" className="cxauth-link" onClick={e => { e.preventDefault(); setLegal('terms'); }}>《用户服务协议》</button>
                  和
                  <button type="button" className="cxauth-link" onClick={e => { e.preventDefault(); setLegal('privacy'); }}>《隐私政策》</button>
                </span>
              </label>
              {fieldError('agreeTerms', `${baseId}-err-agreeTerms`)}
            </div>

            <button type="submit" className="cxauth-submit" disabled={loading}>
              {loading ? <RefreshCw size={15} className="cxauth-spin" aria-hidden="true" /> : <span>立即注册</span>}
            </button>
          </form>
        )}

        {/* 底部切换 */}
        <div className="cxauth-switch">
          {tab === 'login' ? (
            <p>还没有账号？<button type="button" className="cxauth-link cxauth-strong" onClick={() => setTab('register')}>立即注册</button></p>
          ) : (
            <p>已有账号？<button type="button" className="cxauth-link cxauth-strong" onClick={() => setTab('login')}>去登录</button></p>
          )}
        </div>
      </div>

      {/* 法律条款弹窗 */}
      {legal ? (
        <div
          className="cxauth-legal-backdrop"
          onMouseDown={event => { if (event.target === event.currentTarget) setLegal(null); }}
        >
          <div className="cxauth-legal" role="dialog" aria-modal="true" aria-labelledby={`${baseId}-legal-title`}>
            <div className="cxauth-legal-head">
              <h3 id={`${baseId}-legal-title`}>{LEGAL_TEXT[legal].title}</h3>
              <button type="button" className="cxauth-close" onClick={() => setLegal(null)} aria-label="关闭窗口">
                <X size={16} />
              </button>
            </div>
            <div className="cxauth-legal-body">{LEGAL_TEXT[legal].body}</div>
            <button type="button" className="cxauth-submit cxauth-legal-ok" onClick={() => setLegal(null)}>我已了解并知悉</button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
