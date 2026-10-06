import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReferenceFile, officeText, spreadsheetText } from './referenceFiles.js';
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
  assert.equal(oldDoc.parseStatus, 'unsupported');
});
