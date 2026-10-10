import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPrompts, buildSlidePrompt, parseSlidePlan, shouldUseProductReference } from './plan.js';
import type { PptSlidePlan } from '../../src/types.js';

const slide = (overrides: Partial<PptSlidePlan> = {}): PptSlidePlan => ({ title: '本页内容', bullets: [], pageType: 'core-insight', ...overrides });

test('混合参考按编号限定职责，风格只提供颜色形式排版结构', () => {
  const prompt = buildSlidePrompt({ deckPrompt: '品牌介绍', slide: slide(), index: 0, referenceCount: 3, faithfulReference: true, personReference: true, productReference: true, referenceLabels: ['人物参考：模特', '商品参考：商品', '视觉风格参考：版式'] });
  assert.match(prompt, /输入参考图1：人物参考：模特；仅提供人物原型/);
  assert.match(prompt, /输入参考图2：商品参考：商品；仅提供商品原型/);
  assert.match(prompt, /输入参考图3：视觉风格参考：版式；仅提供颜色、形式、排版、结构/);
  assert.match(prompt, /不得提取或复用风格参考中的商品、人物/);
  assert.match(prompt, /仅以标注为“人物参考”的输入图作为人物原型/);
  assert.match(prompt, /仅以标注为“商品参考”的输入图作为商品原型/);
  assert.doesNotMatch(prompt, /参考图中的人物是唯一人物原型|参考图中的商品是唯一商品原型/);
});

test('单图兼容仍保留独立参考职责，不把商品当作风格参考', () => {
  const prompt = buildSlidePrompt({ deckPrompt: '商品介绍', slide: slide(), index: 0, referenceCount: 1, productReference: true, referenceLabels: ['商品参考：原型'], styleAnalysis: '冷色、分栏' });
  assert.match(prompt, /输入参考图1：商品参考：原型；仅提供商品原型/);
  assert.doesNotMatch(prompt, /可结合参考图理解主题语境/);
});

test('参考文件优先作为页面内容主要依据而不是风格资料', () => {
  const prompts = buildPlanPrompts({ topic: '报告', references: '资料原文：年度销量120件', pageCount: 2, faithfulReference: true });
  assert.match(prompts.system, /参考文件正文及资料分析是页面内容的主要依据/);
  assert.match(prompts.system, /不以风格图内容替代/);
  assert.match(prompts.user, /年度销量120件/);
});

test('风格参考不提供内容规划或商品原型', () => {
  const prompt = buildPlanPrompts({ topic: '行业报告', pageCount: 2, faithfulReference: true });
  assert.match(prompt.system, /风格参考仅提供颜色、形式、排版、结构/);
  assert.match(prompt.system, /商品、人物.*独立/);
  assert.doesNotMatch(prompt.system, /product_reference/);
});

test('商品引用仅按单页规划决定，排除指令优先而明确修改可覆盖旧 false', () => {
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品介绍', productReference: false }), productReferenceAvailable: true }), false);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '市场趋势', productReference: true }), productReferenceAvailable: true }), true);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品介绍', productReference: true }), productReferenceAvailable: true, editInstruction: '不要展示商品' }), false);
  assert.equal(shouldUseProductReference({ slide: slide({ productReference: false }), productReferenceAvailable: true, editInstruction: '请加入商品包装' }), true);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品概览', pageType: 'agenda' }), productReferenceAvailable: true }), false);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '产品总结', pageType: 'conclusion' }), productReferenceAvailable: true }), false);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品介绍' }), productReferenceAvailable: false }), false);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品介绍', productReference: true }), productReferenceAvailable: true, editInstruction: '不要改动商品外观' }), true);
  assert.equal(shouldUseProductReference({ slide: slide({ title: '商品介绍', productReference: true }), productReferenceAvailable: true, editInstruction: '去掉商品' }), false);
});

test('商品参考仅在规划请求声明时注入条件字段，且解析布尔规划字段', () => {
  const withoutProduct = buildPlanPrompts({ topic: '产品策略', pageCount: 2 });
  const withProduct = buildPlanPrompts({ topic: '产品策略', pageCount: 2, productReference: true });
  assert.doesNotMatch(withoutProduct.system, /product_reference/);
  assert.match(withProduct.system, /逐页输出布尔字段 product_reference/);
  const parsed = parseSlidePlan(JSON.stringify({
    deck_title: '策略',
    slides: [
      { title: '商品展示', image_prompt: '展示原型', product_reference: true },
      { title: '趋势分析', product_reference: false },
      { title: '兼容缺省' },
    ],
  }), 3);
  assert.equal(parsed.slides[0].productReference, true);
  assert.equal(parsed.slides[1].productReference, false);
  assert.equal('productReference' in parsed.slides[2], false);
});
