import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFamousCharacters, PORTRAIT_AVOIDANCE_RULE, withChineseTextAccuracy } from './imagePrompt.js';
import { generateImage, editImage } from './ppt/aiClient.js';
import type { ThirdPartyApiConfig } from '../src/types.js';

function pngHeader(size: string) {
  const [width, height] = size.split('x').map(Number);
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

const config = { apiKey: 'mock-key', baseUrl: 'https://mock.invalid', modelName: 'mock-image' } as ThirdPartyApiConfig;

test('sanitizeFamousCharacters 泛化知名角色名，避免版权角色触发安全过滤', () => {
  const source = '五年后的黑寡妇守在基地，美国队长收紧断盾，雷神举起锤子，灭霸让复仇者联盟陷入绝境';
  const out = sanitizeFamousCharacters(source);
  assert.ok(!/黑寡妇|美国队长|雷神|灭霸|复仇者联盟/.test(out), '角色名应被替换');
  assert.match(out, /女性特工|战士|勇士|反派|超级英雄/);
});

test('sanitizeFamousCharacters 不误伤普通人名与普通文本', () => {
  const out = sanitizeFamousCharacters('团队协作、按时交作业、主动帮助同学');
  assert.equal(out, '团队协作、按时交作业、主动帮助同学');
});

test('PORTRAIT_AVOIDANCE_RULE 明确要求不生成真人/角色肖像', () => {
  assert.match(PORTRAIT_AVOIDANCE_RULE, /不生成任何真实人物/);
  assert.match(PORTRAIT_AVOIDANCE_RULE, /剪影/);
});

test('withChineseTextAccuracy 仅对 2K 追加中文规则，4K 保持不变', () => {
  const p = '生成一张演示页';
  assert.equal(withChineseTextAccuracy(p, '4K'), p);
  assert.notEqual(withChineseTextAccuracy(p, '2K'), p);
});

test('generateImage 遭遇内容安全过滤时自动净化提示词并重试成功', async t => {
  let calls = 0;
  const seen: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls += 1;
    seen.push(String((JSON.parse(String(init.body)) as { prompt: string }).prompt));
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'Your request was rejected as a result of our safety system.' } }), { status: 400 });
    }
    return Response.json({ data: [{ b64_json: pngHeader('2048x1152') }] });
  });
  await generateImage(config, '黑寡妇守在基地，画面表现她的孤独', '2048x1152');
  assert.equal(calls, 2, '应在安全拒绝后重试一次');
  assert.match(seen[0], /黑寡妇/);
  assert.ok(!/黑寡妇/.test(seen[1]), '重试的提示词应已净化角色名');
});

test('editImage 遭遇安全过滤同样自动净化重试', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { message: 'The request was rejected by the content safety filter.' } }), { status: 451 });
    }
    return Response.json({ data: [{ b64_json: pngHeader('2048x1152') }] });
  });
  await editImage(config, ['data:image/png;base64,' + pngHeader('2048x1152')], '美国队长面对敌军', '2048x1152');
  assert.equal(calls, 2);
});

test('非安全类错误不触发净化重试', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'Internal server error' } }), { status: 500 });
  });
  await assert.rejects(
    generateImage(config, 'test', '2048x1152'),
    /生图接口 HTTP 500/,
  );
  assert.equal(calls, 1, '非安全错误应直接抛出，不重试');
});
