import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReferences, planningReferenceContext, REFERENCE_CHUNK_SIZE, splitReferenceText } from './referenceAnalysis.js';
import type { PlanningModelConfig } from '../../src/types.js';

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
