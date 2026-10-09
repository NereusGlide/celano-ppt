import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extractReferenceFile, officeText, renderStyleReference, spreadsheetText } from './referenceFiles.js';
import { referenceContext } from '../../src/shared/referenceFiles.js';

test('reference extraction keeps paragraphs and resolves spreadsheet shared-string values', () => {
  assert.equal(officeText('<w:p><w:r><w:t>主题</w:t></w:r></w:p><w:p><w:r><w:t>第二段 &amp; &#x4E2D;文</w:t></w:r></w:p>'), '主题\n第二段 & 中文');
  assert.equal(spreadsheetText('<row r="1"><c r="A1" t="s"><v>1</v></c><c r="B1"><v>120</v></c><c r="C1" t="inlineStr"><is><t>万元</t></is></c></row>', ['表名', '营业额']), 'A1: 营业额 | B1: 120 | C1: 万元');
  assert.equal(referenceContext([{ name: '数据表.xlsx', extractedText: '营业额 120 万元' }, { name: '没读到的文件.docx' }]), '【参考文件：数据表.xlsx】\n营业额 120 万元');
});

test('upload reports unreadable references explicitly and does not silently truncate long text', async () => {
  const text = '全文'.repeat(100_010) + '结尾';
  const result = await extractReferenceFile({ filename: '中文.txt', contentType: 'text/plain', data: Buffer.from(text) }, 'unused');
  assert.equal(result.parseStatus, 'ready');
  assert.equal(result.extractedText, text);
  const invalid = await extractReferenceFile({ filename: '损坏.docx', contentType: 'application/octet-stream', data: Buffer.from('bad') }, '/nonexistent-reference.docx');
  assert.equal(invalid.parseStatus, 'failed');
  assert.ok(invalid.parseError);
  const oldDoc = await extractReferenceFile({ filename: '旧格式.doc', contentType: 'application/msword', data: Buffer.alloc(0) }, 'unused');
  // 旧版格式已纳入支持范围；空文件无论是否安装转换工具都会解析失败，而不再是「不支持」
  assert.equal(oldDoc.parseStatus, 'failed');
});

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 90, 0, 160, 1, 1, 0x11, 0]);

test('PDF风格渲染只取前三页并限像素，成功和失败均清理临时目录', async () => {
  let output = '';
  const run = (async (command: string, args: string[]) => {
    assert.equal(command, 'pdftoppm');
    assert.equal(args[args.indexOf('-l') + 1], '3');
    assert.equal(args[args.indexOf('-scale-to') + 1], '1600');
    output = path.dirname(args[args.length - 1]);
    for (const index of [3, 1, 2]) fs.writeFileSync(path.join(output, `page-${index}.jpg`), jpeg);
    return { stdout: '', stderr: '' };
  }) as unknown as NonNullable<Parameters<typeof renderStyleReference>[3]>;
  const images = await renderStyleReference({ filename: '风格.PDF', contentType: 'application/pdf', data: Buffer.from('%PDF-1.7') }, 'sample.pdf', undefined, run);
  assert.equal(images.length, 3);
  assert.match(images[0].name, /第1页/);
  assert.match(images[2].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(fs.existsSync(output), false);
});

test('PPTX渲染先转PDF并隔离Office配置；缺工具与超时区分提示', async () => {
  const file = { filename: 'style.pptx', contentType: 'application/octet-stream', data: Buffer.from([0x50, 0x4b, 3, 4]) };
  const calls: string[] = [];
  let output = '';
  const run = (async (command: string, args: string[]) => {
    calls.push(command);
    if (command === 'soffice') {
      assert.match(args[0], /^-env:UserInstallation=file:/);
      const dir = args[args.indexOf('--outdir') + 1];
      fs.writeFileSync(path.join(dir, 'style.pdf'), '%PDF-1.7');
    } else {
      output = path.dirname(args[args.length - 1]);
      fs.writeFileSync(path.join(output, 'page-1.jpg'), jpeg);
    }
    return { stdout: '', stderr: '' };
  }) as unknown as NonNullable<Parameters<typeof renderStyleReference>[3]>;
  assert.equal((await renderStyleReference(file, 'style.pptx', undefined, run)).length, 1);
  assert.deepEqual(calls, ['soffice', 'pdftoppm']);
  assert.equal(fs.existsSync(output), false);
  const missing = (async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }) as unknown as typeof run;
  await assert.rejects(renderStyleReference(file, 'style.pptx', undefined, missing), /未安装 PPTX 页面渲染器/);
  const timeout = (async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }) as unknown as typeof run;
  await assert.rejects(renderStyleReference(file, 'style.pptx', undefined, timeout), /失败或超时/);
});

test('风格文档非法格式明确失败，不回退为正文解析', async () => {
  for (const filename of ['fake.pdf', 'fake.pptx']) {
    const result = await extractReferenceFile({ filename, contentType: 'application/octet-stream', data: Buffer.from('bad') }, 'unused', undefined, undefined, { style: true });
    assert.equal(result.parseStatus, 'failed');
    assert.match(result.parseError || '', /格式无效/);
  }
  const result = await extractReferenceFile({ filename: 'notes.txt', contentType: 'text/plain', data: Buffer.from('hello') }, 'unused', undefined, undefined, { style: true });
  assert.equal(result.parseStatus, 'unsupported');
});
