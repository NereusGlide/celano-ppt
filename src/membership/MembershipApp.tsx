import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, CreditCard, Crown, Sparkles } from 'lucide-react';
import '../styles/membership.css';
import { useAuth } from '../context/AuthContext.js';
import { membershipView } from '../shared/membership.js';

type MembershipPlan = { id: string; name: string; price: string; renewal: string; points: number; note: string; accent: string; recommended?: boolean; benefits: string[] };
type RechargePlan = { id: string; name: string; price: string; points: number; note: string; accent: string };
type DisplayPlan = { id: string; name: string; price: string; priceUnit: string; points: number; pointsUnit: string; note: string; accent: string; recommended?: boolean; renewalLabel: string; benefits: string[] };
type BillingPeriod = 'annual' | 'monthly' | 'quarterly' | 'single';

const billingPeriods: Array<{ id: BillingPeriod; label: string; discount: string }> = [
  { id: 'annual', label: '连续包年', discount: '4.5 折' },
  { id: 'monthly', label: '连续包月', discount: '4.8 折' },
  { id: 'quarterly', label: '连续包季', discount: '7 折' },
  { id: 'single', label: '单独购买', discount: '无续费' },
];

function amount(value: string) { return Number(value.replace(/[^\d.]/g, '')) || 0; }
function money(value: number) { return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`; }
function displayMembershipPlan(plan: MembershipPlan, period: BillingPeriod): DisplayPlan {
  const renewal = amount(plan.renewal);
  if (period === 'annual') {
    const points = plan.points;
    return { ...plan, points, pointsUnit: '点 / 月 · 12 期', price: money(renewal * 12 * 0.45), priceUnit: ' / 年', renewalLabel: `每月发放 ${points.toLocaleString()} 点 · 共 12 期`, benefits: plan.benefits.map((item, index) => index === 0 ? `每月发放 ${points.toLocaleString()} 点` : item) };
  }
  if (period === 'quarterly') {
    const points = plan.points;
    return { ...plan, points, pointsUnit: '点 / 月 · 3 期', price: money(renewal * 3 * 0.7), priceUnit: ' / 季', renewalLabel: `每月发放 ${points.toLocaleString()} 点 · 共 3 期`, benefits: plan.benefits.map((item, index) => index === 0 ? `每月发放 ${points.toLocaleString()} 点` : item) };
  }
  if (period === 'single') {
    return { ...plan, points: plan.points, pointsUnit: '点', price: money(renewal), priceUnit: ' / 月', renewalLabel: `一次性到账 ${plan.points.toLocaleString()} 点`, benefits: plan.benefits.map((item, index) => index === 0 ? `本次到账 ${plan.points.toLocaleString()} 点` : item) };
  }
  return { ...plan, price: plan.price, priceUnit: ' / 月', pointsUnit: '点 / 月', renewalLabel: plan.renewal, benefits: plan.benefits };
}

// 套餐结构参照即梦公开会员页，权益映射为 CELANO 的 PPT / 文生图 / 画布能力。
// 真实成交价格仍应由后端支付配置决定，前端只展示产品目录。
const membershipPlans: MembershipPlan[] = [
  { id: 'celano-basic', name: '基础会员', price: '¥33', renewal: '下月续费 ¥69', points: 725, note: '适合轻量创作与个人演示', accent: 'slate', benefits: ['每月到账 725 点', 'PPT 2K 生成', '标准生成队列', '作品库账号归属'] },
  { id: 'celano-standard', name: '标准会员', price: '¥96', renewal: '下月续费 ¥199', points: 2210, note: '适合稳定制作演示文稿', accent: 'blue', recommended: true, benefits: ['每月到账 2,210 点', 'PPT 2K / 4K 生成', '优先生成队列', '风格参考与 Logo 素材库'] },
  { id: 'celano-advanced', name: '高级会员', price: '¥519', renewal: '下月续费 ¥998', points: 12320, note: '适合高频视觉创作', accent: 'violet', benefits: ['每月到账 12,320 点', 'PPT 六路并发生成', '高级画布节点与素材管理', '单页局部修改优先处理'] },
  { id: 'celano-super', name: '超级会员', price: '¥2,235', renewal: '下月续费 ¥4,299', points: 54600, note: '适合团队和商业化生产', accent: 'gold', benefits: ['每月到账 54,600 点', 'PPT 六路并发与高峰优先', '团队级创作额度预留', '支持 API / 商用配置扩展'] },
];

const rechargePlans: RechargePlan[] = [
  { id: 'recharge-500', name: '500 点', points: 500, price: '¥50', note: '有效期 2 年', accent: 'slate' },
  { id: 'recharge-750', name: '750 点', points: 750, price: '¥75', note: '有效期 2 年', accent: 'slate' },
  { id: 'recharge-1500', name: '1,500 点', points: 1500, price: '¥150', note: '有效期 2 年', accent: 'blue' },
  { id: 'recharge-2250', name: '2,250 点', points: 2250, price: '¥225', note: '有效期 2 年', accent: 'blue' },
  { id: 'recharge-4500', name: '4,500 点', points: 4500, price: '¥450', note: '有效期 2 年', accent: 'violet' },
  { id: 'recharge-9000', name: '9,000 点', points: 9000, price: '¥900', note: '有效期 2 年', accent: 'gold' },
];

export const MembershipApp: React.FC = () => {
  const { currentUser: user } = useAuth();
  const membership = membershipView(user);
  const [mode, setMode] = useState<'membership' | 'recharge'>('membership');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [selected, setSelected] = useState('celano-standard');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (membership.active) { setMode('recharge'); setSelected('recharge-1500'); }
  }, [membership.active]);

  const activeItems = mode === 'membership' ? membershipPlans : rechargePlans;
  const active = useMemo(() => activeItems.find(item => item.id === selected) || activeItems[0], [activeItems, selected]);
  const displayActive = mode === 'membership' ? displayMembershipPlan(active as MembershipPlan, billingPeriod) : active;
  const goHome = () => {
    if ((window.location.pathname.replace(/\/+$/, '') || '/') === '/membership') { window.history.pushState({}, '', '/#/'); window.dispatchEvent(new Event('hashchange')); }
    else window.location.hash = '/';
  };
  const switchMode = (next: 'membership' | 'recharge') => { setMode(next); setSelected(next === 'membership' ? 'celano-standard' : 'recharge-1500'); setNotice(''); };
  const startPayment = () => {
    if (!active) return;
    if (!user) { setNotice('请先登录后再开通或充值'); return; }
    const label = mode === 'membership' ? `${active.name} · ${billingPeriods.find(item => item.id === billingPeriod)?.label}（${displayActive.points.toLocaleString()} 点）` : `${active.name}充值`;
    setNotice(`${label}已选中，当前账户余额 ${user.credits ?? 0} 点。支付通道配置后即可完成支付。`);
  };

  return <div className="membership-page celano-page-surface">
    <header className="membership-topbar">
      <button className="membership-back" onClick={goHome}><ArrowLeft size={16} /> 返回创作首页</button>
      <div className="membership-brand"><span><Sparkles size={15} /></span> CELANO <em>会员中心</em></div>
      <nav className="membership-nav" aria-label="产品导航">
        <button onClick={() => { window.location.hash = '/image'; }}>文生图</button>
        <button onClick={goHome}>PPT 生成</button>
        <button onClick={() => { window.location.hash = '/canvas'; }}>智能画布</button>
        <button className="active">会员中心</button>
      </nav>
      <div className="membership-balance"><CreditCard size={15} /> {user ? `${user.credits ?? 0} 点` : '登录后查看余额'}</div>
    </header>
    <main className="membership-content">
      {membership.active ? <section className="membership-current" aria-label="当前会员"><Crown size={20} /><div><strong>{membership.name}</strong><p>有效期至 {new Date(membership.expiresAt!).toLocaleString('zh-CN')} · 点数与作品同步到个人中心</p></div><button onClick={() => window.location.hash = '/account'}>查看个人中心</button></section> : null}<section className="membership-hero"><div className="membership-kicker"><Crown size={16} /> CELANO CREATOR</div><h1>让每一次创作，都有足够的表达空间。</h1><p>会员点数用于 PPT 生成、文生图、单页局部修改和智能画布。生成前会明确展示本次消耗。</p></section>
      <div className="membership-mode-tabs" role="tablist" aria-label="付费类型"><button className={mode === 'membership' ? 'active' : ''} onClick={() => switchMode('membership')} role="tab" aria-selected={mode === 'membership'}>会员订阅</button><button className={mode === 'recharge' ? 'active' : ''} onClick={() => switchMode('recharge')} role="tab" aria-selected={mode === 'recharge'}>积分充值</button><span>余额：{user ? `${user.credits ?? 0} 点` : '登录后查看'}</span></div>
      {mode === 'membership' ? <>
        <div className="membership-period-picker" role="tablist" aria-label="会员计费周期">
          {billingPeriods.map(period => <button key={period.id} className={billingPeriod === period.id ? 'active' : ''} onClick={() => { setBillingPeriod(period.id); setNotice(''); }} role="tab" aria-selected={billingPeriod === period.id}><span>{period.label}</span><small>{period.discount}</small></button>)}
        </div>
        <div className="membership-period-hint"><span>{billingPeriods.find(item => item.id === billingPeriod)?.label}套餐</span><small>{billingPeriod === 'single' ? '一次购买，不自动续费' : '具体成交价以结算页为准'}</small></div>
      </> : <div className="membership-period-hint recharge-hint"><span>充值点数有效期 2 年</span><small>优先消耗即将到期的点数</small></div>}
      <section className={`membership-plans ${mode === 'recharge' ? 'recharge-plans' : 'subscription-plans'}`} aria-label={mode === 'membership' ? '会员套餐' : '积分充值套餐'}>
        {activeItems.map(plan => {
          const displayPlan: DisplayPlan = mode === 'membership' ? displayMembershipPlan(plan as MembershipPlan, billingPeriod) : { ...(plan as RechargePlan), priceUnit: '', pointsUnit: '点', renewalLabel: (plan as RechargePlan).note, benefits: [] };
          return <button key={plan.id} className={`membership-plan ${plan.accent} ${active?.id === plan.id ? 'selected' : ''}`} onClick={() => { setSelected(plan.id); setNotice(''); }}>
          {'recommended' in plan && plan.recommended ? <span className="membership-recommended">推荐</span> : null}
          <span className="membership-plan-mark"><Sparkles size={17} /></span><strong>{displayPlan.name}</strong><span className="membership-points">{displayPlan.points.toLocaleString()} <small>{displayPlan.pointsUnit}</small></span><span className="membership-price">{displayPlan.price}{mode === 'membership' ? <small>{displayPlan.priceUnit}</small> : ''}</span><span className="membership-note">{mode === 'membership' ? displayPlan.renewalLabel : displayPlan.note}</span>
          {mode === 'membership' ? <ul className="membership-benefits">{displayPlan.benefits.map(benefit => <li key={benefit}><Check size={13} /> {benefit}</li>)}</ul> : <span className="membership-check"><Check size={14} /> 点数到账后可用于所有创作</span>}
        </button>;
        })}
      </section>
      <section className="membership-action"><div><strong>当前选择：{displayActive?.name}</strong><span>{mode === 'membership' ? `${billingPeriods.find(item => item.id === billingPeriod)?.label} · ${(displayActive as DisplayPlan).price}${(displayActive as DisplayPlan).priceUnit} · ${(displayActive as DisplayPlan).points.toLocaleString()} ${(displayActive as DisplayPlan).pointsUnit}` : `${(active as RechargePlan)?.points?.toLocaleString()} 点 · ${(active as RechargePlan)?.note}`}</span></div><button onClick={startPayment}><CreditCard size={16} /> {mode === 'membership' ? membership.active ? '续费 / 升级' : '立即开通' : '立即充值'}</button></section>
      {notice ? <div className="membership-notice" role="status">{notice}</div> : null}
      <p className="membership-footnote">CELANO 的点数、作品和使用记录均归属于当前账号。实际支付通道将在配置商户号和支付回调后启用。</p>
    </main>
  </div>;
};
