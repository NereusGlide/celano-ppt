import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReferences, analyzeStyleReferences, planningReferenceContext, REFERENCE_CHUNK_SIZE, splitReferenceText } from './referenceAnalysis.js';
import type { PlanningModelConfig } from '../../src/types.js';

test('风格视觉分析只提炼设计维度，不把其中商品人物提为独立素材', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests++;
    const body = JSON.parse(String(init.body));
    const content = body.messages[0].content;
    assert.match(content[0].text, /颜色、形式、排版、结构/);
    assert.match(content[0].text, /不得提取或复用.*商品、人物/);
    assert.match(content[0].text, /抽象占位/);
    assert.equal(content.filter((part: { type: string }) => part.type === 'image_url').length, 1);
    return Response.json({ choices: [{ message: { content: '颜色：蓝灰；形式：平面；排版：左文右图；结构：两级信息层次' } }] });
  });
  const config = { baseUrl: 'https://mock.invalid', apiKey: 'mock', modelName: 'text', visionModelName: 'vision' } as PlanningModelConfig;
  assert.match(await analyzeStyleReferences(config, ['data:image/png;base64,abc']), /蓝灰/);
  assert.equal(await analyzeStyleReferences(config, []), '');
  assert.equal(requests, 1);
});

test('all reference segments are analyzed without dropping text or overflowing the planner', async t => {
  const original = ('第一份资料：营业额 120 万，单位和年份不能省略。\n').repeat(2500) + '最后一段不能漏掉';
  const chunks = splitReferenceText(original);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), original);
  assert.ok(chunks.every(chunk => chunk.length <= REFERENCE_CHUNK_SIZE + 1));
  const received: string[] = [];
  const progress: number[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const payload = JSON.parse(body.messages[1].content);
    received.push(payload.referenceText);
    assert.equal(payload.segment, received.length);
    assert.equal(payload.segments, chunks.length);
    return Response.json({ choices: [{ message: { content: `资料片段${received.length}的分析` } }] });
  });
  const config = { baseUrl: 'https://mock.invalid', apiKey: 'mock', modelName: 'text', reasoningEffort: 'auto' } as PlanningModelConfig;
  const analysis = await analyzeReferences(config, '经营报告', original, undefined, done => progress.push(done));
  assert.equal(received.join(''), original);
  assert.deepEqual(progress, chunks.map((_, index) => index + 1));
  assert.equal(planningReferenceContext(original, analysis), analysis);
  assert.match(planningReferenceContext('短文原文', analysis), /短文原文/);
  assert.match(analysis, new RegExp(`资料片段${chunks.length}的分析`));
});
