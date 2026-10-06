import type { ImageResolution } from '../src/shared/imageSpecs.js';

const CHINESE_TEXT_ACCURACY_RULE = [
  '中文文字准确性要求：仅在用户需求或页面内容需要文字时生成文字，没有文字需求时不要额外添加文案。',
  '遵循用户指定的语言和简繁体。所有可见中文必须字形规范、笔画完整、清晰可读，禁止错别字、乱码、缺笔、多笔、伪汉字、形似字替换、重复字或漏字。',
  '明确要求呈现的标题、正文、引文必须忠实按原文呈现，不擅自改写、增删、翻译或使用拼音和英文替代中文；品牌名、专有名词、原文英文、数字、单位和标点保持准确。',
  '合理安排文字大小、间距和对比度，避免文字重叠、截断、模糊或变成装饰性笔画；不得为了规避文字错误删掉明确要求呈现的文案。',
  '输出前逐字核对画面文字与待呈现原文，确认没有错字、漏字、重复字和数字错误。',
].join('\n');

/** Apply at the server boundary so every 2K entry point uses the same text requirements. */
export function withChineseTextAccuracy(prompt: string, resolution: ImageResolution): string {
  if (resolution !== '2K' || prompt.includes(CHINESE_TEXT_ACCURACY_RULE)) return prompt;
  return prompt + '\n\n' + CHINESE_TEXT_ACCURACY_RULE;
}

/**
 * 生图内容规范：不生成任何真实人物、演员或知名影视/动漫角色的可辨识形象。
 * gpt-image 等生图接口会因版权角色形象触发内容安全过滤并拒绝整页，
 * 因此要求用剪影、背影或象征性元素表达人物，页面文字照常按原文呈现。
 * 注意：这里不能出现任何具体 IP 名（如"漫威""迪士尼"），否则规避指令本身会成为触发词。
 */
export const PORTRAIT_AVOIDANCE_RULE = [
  '画面内容规范：不生成任何真实人物、演员肖像或受版权保护的影视、动漫、游戏角色的可辨识形象，',
  '涉及人物时用剪影、背影、局部动作或象征性元素（盾牌、锤子、铠甲、传送门光效、星空、城市天际线等）表达，不要出现角色面部特写或标志性服装的正面形象。',
  '页面标题与正文文字仍按原文准确呈现，不受上述限制。',
].join('\n');

/** 知名影视/动漫角色名与专有名词 → 泛化描述，作为生图接口安全过滤兜底。 */
const FAMOUS_CHARACTER_MAP: Array<[RegExp, string]> = [
  // 电影/团队名
  [/复仇者联盟/g, '一群超级英雄'],
  [/终局之战/g, '最终决战'],
  [/加码臻享版/g, '重映版'],
  // 明确角色名（含常用中文译名与本名）
  [/黑寡妇|娜塔莎/g, '一位坚韧的女性特工'],
  [/美国队长|史蒂夫|斯蒂夫|史蒂文/g, '一位手持盾牌的战士'],
  [/钢铁侠|托尼/g, '一位身着装甲的英雄'],
  [/雷神/g, '一位挥动锤子的勇士'],
  [/绿巨人|浩克|班纳/g, '一位体型魁梧的英雄'],
  [/蜘蛛侠/g, '一位身手敏捷的年轻英雄'],
  [/鹰眼|克林特|巴顿/g, '一位擅长弓箭的战士'],
  [/灭霸/g, '一位强大的宇宙反派'],
  [/奇异博士/g, '一位使用法术的法师'],
  [/黑豹/g, '一位身着战甲的战士'],
  [/蚁人/g, '一位可以改变体型的英雄'],
  [/惊奇队长/g, '一位拥有强大能量的女英雄'],
  [/猎鹰|山姆/g, '一位赶来支援的伙伴'],
  // 关键道具/地点/概念
  [/无限宝石|灵魂宝石|原石/g, '蕴含强大能量的宝石'],
  [/量子领域/g, '微观时空通道'],
  [/沃米尔/g, '一颗遥远星球'],
];

export function sanitizeFamousCharacters(text: string): string {
  let out = String(text || '');
  for (const [re, replacement] of FAMOUS_CHARACTER_MAP) out = out.replace(re, replacement);
  return out;
}
