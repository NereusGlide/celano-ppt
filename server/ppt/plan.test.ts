import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanPrompts, parseSlidePlan, shouldUseProductReference } from './plan.js';
import type { PptSlidePlan } from '../../src/types.js';

const slide = (overrides: Partial<PptSlidePlan> = {}): PptSlidePlan => ({ title: '本页内容', bullets: [], pageType: 'core-insight', ...overrides });

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
