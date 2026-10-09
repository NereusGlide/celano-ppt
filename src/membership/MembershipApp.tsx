import React, { useEffect, useMemo, useState } from 'react';
import { Check, CreditCard, Crown, Sparkles } from 'lucide-react';
import '../styles/membership.css';
import { useAuth } from '../context/AuthContext.js';
import { membershipView, applyMembershipCatalog, FREE_TIER_NAME, FREE_TIER_BENEFITS } from '../shared/membership.js';
import { MembershipPlanConfig } from '../types.js';

type RechargePlan = { id: string; name: string; price: string; points: number; note: string; accent: string; bonus?: string };
type DisplayPlan = { id: string; name: string; price: string; priceUnit: string; points: number; pointsUnit: string; note: string; accent: string; recommended?: boolean; renewalLabel: string; benefits: string[] };

function displayMembershipPlan(plan: MembershipPlanConfig): DisplayPlan {
  const points = plan.points;
  return {
    ...plan,
    points,
    pointsUnit: '点 / 月',
    price: plan.price,
    priceUnit: ' / 月',
    renewalLabel: `每月发放 ${points.toLocaleString()} 点`,
    benefits: [`2K ${plan.discount2k} 点 · 4K ${plan.discount4k} 点（会员折扣）`, ...plan.benefits],
  };
}

// 接口不可用时的兜底目录，与后端默认套餐保持一致。
const DEFAULT_MEMBERSHIP_PLANS: MembershipPlanConfig[] = [
  { id: 'celano-basic', name: '基础会员', price: '¥29', renewalPrice: 29, points: 300, note: '适合轻度创作与日常出图', accent: 'blue', benefits: ['无水印 · PNG 无损', '失败免费重试'], discount2k: 4, discount4k: 9, enabled: true },
  { id: 'celano-pro', name: '专业会员', price: '¥79', renewalPrice: 79, points: 850, note: '适合稳定高频的视觉创作', accent: 'teal', recommended: true, benefits: ['优先生成队列', '批量生成（一次 4 张）'], discount2k: 4, discount4k: 8, enabled: true },
  { id: 'celano-premium', name: '尊享会员', price: '¥199', renewalPrice: 199, points: 2400, note: '适合重度个人创作者', accent: 'violet', benefits: ['极速生成通道', '批量生成（一次 20 张）'], discount2k: 3, discount4k: 7, enabled: true },
  { id: 'celano-flagship', name: '旗舰会员', price: '¥399', renewalPrice: 399, points: 5000, note: '适合专业商用与团队生产', accent: 'gold', benefits: ['极速 + 最高并发', '批量生成（一次 100 张）'], discount2k: 3, discount4k: 6, enabled: true },
];

const rechargePlans: RechargePlan[] = [
  { id: 'recharge-100', name: '100 点', points: 100, price: '¥10', note: '首充翻倍得 200 点', accent: 'slate', bonus: '首充翻倍' },
  { id: 'recharge-300', name: '300 点', points: 300, price: '¥30', note: '有效期 12 个月', accent: 'slate' },
  { id: 'recharge-520', name: '520 点', points: 520, price: '¥50', note: '加赠 4%', accent: 'blue', bonus: '+4%' },
  { id: 'recharge-1100', name: '1,100 点', points: 1100, price: '¥100', note: '加赠 10%', accent: 'blue', bonus: '+10%' },
  { id: 'recharge-2400', name: '2,400 点', points: 2400, price: '¥200', note: '加赠 20%', accent: 'violet', bonus: '+20%' },
];

export const MembershipApp: React.FC = () => {
  const { currentUser: user } = useAuth();
  const membership = membershipView(user);
  const [mode, setMode] = useState<'membership' | 'recharge'>('membership');
  const [selected, setSelected] = useState('celano-pro');
  const [notice, setNotice] = useState('');
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlanConfig[]>(DEFAULT_MEMBERSHIP_PLANS);
  const [membershipCode, setMembershipCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (membership.active) { setMode('recharge'); setSelected('recharge-1100'); }
  }, [membership.active]);

  useEffect(() => {
    fetch('/api/membership-plans')
      .then(res => res.json())
      .then(data => {
        if (data?.success && Array.isArray(data.membershipPlans) && data.membershipPlans.length) {
          setMembershipPlans(data.membershipPlans);
          applyMembershipCatalog(data.membershipPlans);
        }
      })
      .catch(() => { /* 接口不可用时回退到内置目录 */ });
  }, []);

  const activeItems = mode === 'membership' ? membershipPlans : rechargePlans;
  const active = useMemo(() => activeItems.find(item => item.id === selected) || activeItems[0], [activeItems, selected]);
  const displayActive = mode === 'membership' ? displayMembershipPlan(active as MembershipPlanConfig) : active;
  const switchMode = (next: 'membership' | 'recharge') => { setMode(next); setSelected(next === 'membership' ? 'celano-pro' : 'recharge-1100'); setNotice(''); };
  const startPayment = () => {
    if (!active) return;
    if (!user) { setNotice('请先登录后再开通或充值'); return; }
    const label = mode === 'membership' ? `${active.name}（${(displayActive as DisplayPlan).points.toLocaleString()} 点/月）` : `${active.name}充值`;
    setNotice(`${label}已选中，当前账户余额 ${user.credits ?? 0} 点。支付通道配置后即可完成支付。`);
  };
  const redeemMembershipCode = async () => {
    const code = membershipCode.trim();
    if (!code || redeeming) return;
    if (!user) { setNotice('请先登录后再兑换会员兑换码'); return; }
    setRedeeming(true); setNotice('');
    try {
      const response = await fetch('/api/wallet/redeem-membership', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ code }) });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.success) throw new Error(result?.error || '兑换失败');
      setMembershipCode('');
      setNotice(`会员已开通：${result.planName} ${result.months} 个月${result.granted > 0 ? `，赠送 ${result.granted} 点` : ''}`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '兑换失败');
    } finally {
      setRedeeming(false);
    }
  };

  return <div className="membership-page celano-page-surface">
    <main className="membership-content">
      {membership.active ? <section className="membership-current" aria-label="当前会员"><Crown size={20} /><div><strong>{membership.name}</strong><p>有效期至 {new Date(membership.expiresAt!).toLocaleString('zh-CN')} · 点数与作品同步到个人中心</p></div><button onClick={() => window.location.hash = '/account'}>查看个人中心</button></section> : null}<section className="membership-hero"><h1>让每一次创作，都有足够的表达空间。</h1><p>会员点数用于 PPT 生成、文生图、单页局部修改和智能画布。生成前会明确展示本次消耗。</p></section>
      <div className="membership-mode-tabs" role="tablist" aria-label="付费类型"><button className={mode === 'membership' ? 'active' : ''} onClick={() => switchMode('membership')} role="tab" aria-selected={mode === 'membership'}>会员订阅</button><button className={mode === 'recharge' ? 'active' : ''} onClick={() => switchMode('recharge')} role="tab" aria-selected={mode === 'recharge'}>积分充值</button><span>余额：{user ? `${user.credits ?? 0} 点` : '登录后查看'}</span></div>
      {mode === 'recharge'
        ? <div className="membership-period-hint recharge-hint"><span>充值点数有效期 12 个月</span><small>大额充值享梯度加赠</small></div>
        : null}
      <section className={`membership-plans ${mode === 'recharge' ? 'recharge-plans' : 'subscription-plans'}`} aria-label={mode === 'membership' ? '会员套餐' : '积分充值套餐'}>
        {mode === 'membership' ? (
          <div className={`membership-plan free-tier ${!membership.active ? 'is-current' : ''}`} aria-label="免费版">
            <span className="membership-free-mark"><Sparkles size={17} /></span>
            <strong>{FREE_TIER_NAME}</strong>
            <span className="membership-points">0 <small>点 / 月</small></span>
            <span className="membership-price">¥0<small> / 月</small></span>
            <span className="membership-note">{membership.active ? '升级或续费后替换' : '当前版本'}</span>
            <ul className="membership-benefits">{FREE_TIER_BENEFITS.map(benefit => <li key={benefit}><Check size={13} /> {benefit}</li>)}</ul>
          </div>
        ) : null}
        {activeItems.map(plan => {
          const displayPlan: DisplayPlan = mode === 'membership' ? displayMembershipPlan(plan as MembershipPlanConfig) : { ...(plan as RechargePlan), priceUnit: '', pointsUnit: '点', renewalLabel: (plan as RechargePlan).note, benefits: [] };
          const bonus = (plan as RechargePlan).bonus;
          return <button key={plan.id} className={`membership-plan ${plan.accent} ${active?.id === plan.id ? 'selected' : ''}`} onClick={() => { setSelected(plan.id); setNotice(''); }}>
          {'recommended' in plan && plan.recommended ? <span className="membership-recommended">推荐</span> : null}
          {bonus ? <span className="membership-recommended bonus">{bonus}</span> : null}
          <span className="membership-plan-mark"><Sparkles size={17} /></span><strong>{displayPlan.name}</strong><span className="membership-points">{displayPlan.points.toLocaleString()} <small>{displayPlan.pointsUnit}</small></span><span className="membership-price">{displayPlan.price}{mode === 'membership' ? <small>{displayPlan.priceUnit}</small> : ''}</span><span className="membership-note">{mode === 'membership' ? displayPlan.renewalLabel : displayPlan.note}</span>
          {mode === 'membership' ? <ul className="membership-benefits">{displayPlan.benefits.map(benefit => <li key={benefit}><Check size={13} /> {benefit}</li>)}</ul> : <span className="membership-check"><Check size={14} /> 点数到账后可用于所有创作</span>}
        </button>;
        })}
      </section>
      <section className="membership-action"><div><strong>当前选择：{displayActive?.name}</strong><span>{mode === 'membership' ? `${(displayActive as DisplayPlan).price}${(displayActive as DisplayPlan).priceUnit} · ${(displayActive as DisplayPlan).points.toLocaleString()} ${(displayActive as DisplayPlan).pointsUnit}` : `${(active as RechargePlan)?.points?.toLocaleString()} 点 · ${(active as RechargePlan)?.note}`}</span></div><button onClick={startPayment}><CreditCard size={16} /> {mode === 'membership' ? membership.active ? '续费 / 升级' : '立即开通' : '立即充值'}</button></section>
      {notice ? <div className="membership-notice" role="status">{notice}</div> : null}
      <section className="membership-redeem" aria-label="会员兑换码" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', maxWidth: 640, margin: '18px auto 0', padding: '14px 16px', border: '1px solid rgba(255,255,255,.12)', borderRadius: 14, background: 'rgba(255,255,255,.03)' }}>
        <div style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>有会员兑换码？</strong><span style={{ fontSize: 12, color: '#8A9299' }}>输入兑换码，立即开通对应会员</span></div>
        <div style={{ display: 'flex', gap: 8, flex: '1 1 260px' }}>
          <input value={membershipCode} onChange={e => setMembershipCode(e.target.value.toUpperCase())} placeholder="输入会员兑换码" maxLength={100} style={{ flex: 1, minWidth: 0, height: 38, padding: '0 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,.14)', background: 'transparent', color: '#F4F6F7', fontSize: 13, outline: 'none' }} />
          <button onClick={() => void redeemMembershipCode()} disabled={redeeming || !membershipCode.trim()} style={{ height: 38, padding: '0 16px', borderRadius: 9, border: 0, background: '#F4F6F7', color: '#0B0E10', fontWeight: 600, fontSize: 13, cursor: 'pointer', opacity: redeeming || !membershipCode.trim() ? .5 : 1 }}>{redeeming ? '兑换中…' : '兑换会员'}</button>
        </div>
      </section>
      <p className="membership-footnote">CELANO 的点数、作品和使用记录均归属于当前账号。实际支付通道将在配置商户号和支付回调后启用。</p>
    </main>
  </div>;
};
