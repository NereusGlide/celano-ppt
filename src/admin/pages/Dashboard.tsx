import React, { useEffect, useState } from 'react';
import { adminApi } from '../api.js';
import { Card, PageHeader, Alert } from '../ui.js';

const Tile: React.FC<{ label: string; value: React.ReactNode; sub?: string; color?: string; onClick?: () => void }> = ({
  label, value, sub, color = '#F4F6F7', onClick
}) => (
  <div
    onClick={onClick}
    className={'bg-[#0B0E10] rounded shadow-[0_1px_4px_rgba(11,14,16,0.08)] p-5 ' + (onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : '')}
  >
    <div className="text-[13px] text-[#8A9299] mb-2">{label}</div>
    <div className="text-[26px] font-semibold leading-none" style={{ color }}>{value}</div>
    {sub && <div className="text-[12px] text-[#8A9299] mt-2">{sub}</div>}
  </div>
);

export const Dashboard: React.FC<{ onJump: (k: string) => void }> = ({ onJump }) => {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.stats().then(r => setStats(r.stats)).catch(e => setError(e.message || '加载失败'));
  }, []);

  return (
    <div>
      <PageHeader title="概览" desc="CELANO PPT 系统运行总览" />
      {error && <Alert type="error">{error}</Alert>}
      {!stats && !error && <Card><div className="text-[13px] text-[#8A9299]">加载中…</div></Card>}

      {stats && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Tile label="注册用户" value={stats.users.total} sub={'今日新增 ' + stats.users.newToday + ' · 禁用 ' + stats.users.disabled + ' · 在线 ' + stats.users.online} color="#F4F6F7" onClick={() => onJump('users')} />
            <Tile label="演示文稿" value={stats.presentations} sub="累计创建" color="#8A9299" />
            <Tile label="使用记录" value={stats.usage.total} sub={'今日 ' + stats.usage.today + ' · 消耗点数 ' + stats.usage.credits} color="#E8836F" onClick={() => onJump('usage')} />
            <Tile label="在线用户" value={stats.users.online} sub={'5 分钟内活跃'} color="#8A9299" onClick={() => onJump('users')} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Tile label="邀请码" value={stats.inviteCodes.total} sub={'启用 ' + stats.inviteCodes.active + ' · 已核销 ' + stats.inviteCodes.usedCount} color="#F4F6F7" onClick={() => onJump('invites')} />
            <Tile label="充值码" value={stats.rechargeCodes.total} sub={'未使用 ' + stats.rechargeCodes.unused + ' · 已使用 ' + stats.rechargeCodes.used} color="#8A9299" onClick={() => onJump('recharge')} />
            <Tile label="已发放点数" value={stats.rechargeCodes.creditsIssued} sub={'已兑换消耗 ' + stats.rechargeCodes.creditsUsed} color="#E8836F" />
            <Tile label="AI 接口" value={stats.aiConfigs.total} sub={'启用 ' + stats.aiConfigs.enabled} color="#8A9299" onClick={() => onJump('ai')} />
          </div>

          <Card title="模块说明">
            <ul className="text-[13px] text-[#8A9299] leading-7 list-disc pl-5">
              <li><b>用户注册管理</b>：在线状态与登录 IP 追踪，支持编辑资料、封禁/解封、重置密码与删除账号。</li>
              <li><b>使用记录管理</b>：注册、登录、大纲生成、生图、导出等行为流水，可按类型与关键词筛选。</li>
              <li><b>邀请码管理</b>：批量生成邀请码、限定使用次数与有效期、停用或删除；前台注册时按此校验。</li>
              <li><b>充值码管理</b>：批量生成点数充值码，前台通过 <code className="px-1 bg-[#ffffff0a] rounded">/api/wallet/redeem</code> 兑换入账。</li>
              <li><b>AI 接口配置</b>：统一维护生图模型接口（Base URL / Key / 模型名），支持连通性测试与默认模型设置。</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};
