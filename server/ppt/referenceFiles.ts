import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAX_REFERENCE_TEXT, type ReferenceParseStatus } from '../../src/shared/referenceFiles.js';
import { chatVision } from './aiClient.js';
import type { PlanningModelConfig } from '../../src/types.js';

const runFile = promisify(execFile);
const commandOptions = { encoding: 'utf8' as const, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 };
type ReferenceFile = { filename: string; contentType: string; data: Buffer };
type Extraction = { extractedText: string; parseStatus: ReferenceParseStatus; parseError?: string };

/** 扫描版 PDF 无文字层时，转图片后用 tesseract OCR（中英混排）。 */
async function ocrPdf(savedPath: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celano-ocr-'));
  try {
    await runFile('pdftoppm', ['-png', '-r', '150', savedPath, path.join(tmpDir, 'page')], { ...commandOptions, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (!files.length) throw new Error('OCR 图片转换失败');
    if (files.length > 80) throw new Error('参考文件页数过多（超过 80 页），请拆分上传');
    const parts: string[] = [];
    for (const file of files) {
      const out = (await runFile('tesseract', [path.join(tmpDir, file), '-', '-l', 'chi_sim+eng', '--psm', '6'], { ...commandOptions, timeout: 90_000 })).stdout;
      const clean = out.replace(/\f/g, '').replace(/\s+$/gm, '').trim();
      if (clean) parts.push(clean);
      if (parts.join('\n').length > MAX_REFERENCE_TEXT) break;
    }
    return parts.join('\n\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** 扫描版 PDF 转图后，分批交给多模态模型直接「看懂」页面内容。 */
async function visionReadPdf(config: PlanningModelConfig, savedPath: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'celano-vision-'));
  try {
    // 扫描件用 JPEG + 120 DPI，体积远小于 PNG（约 1/5），避免批量请求体超出上游限制
    await runFile('pdftoppm', ['-jpeg', '-r', '120', savedPath, path.join(tmpDir, 'page')], { ...commandOptions, timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    if (!files.length) throw new Error('视觉读取图片转换失败');
    if (files.length > 80) throw new Error('参考文件页数过多（超过 80 页），请拆分上传');
    const parts: string[] = [];
    const BATCH = 3;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const images = batch.map(f => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(tmpDir, f)).toString('base64'));
      const content = [
        { type: 'text' as const, text: `请按顺序完整转录以下 ${batch.length} 张扫描页面的全部文字内容。保留原有结构（标题、正文、要点、表格），逐页输出，不要添加解释、评论或 Markdown 标记；某页无文字则跳过。` },
        ...images.map(url => ({ type: 'image_url' as const, image_url: { url } })),
      ];
      const text = await chatVision(config, [{ role: 'user', content }]);
      if (text.trim()) parts.push(text.trim());
      if (parts.join('\n').length > MAX_REFERENCE_TEXT) break;
    }
    return parts.join('\n\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_all, code: string) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  }).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function officeText(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]*\b(?:tab)\b[^>]*\/>/g, '\t').replace(/<\/(?:w:p|a:p|row)>/g, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

/** Resolve shared-string indices; they are not the spreadsheet's actual values. */
export function spreadsheetText(xml: string, sharedStrings: string[]): string {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row =>
    [...row[1].matchAll(/<c\b([^>]*?)>([\s\S]*?)<\/c>/g)].map(cell => {
      const address = /\br="([^"]+)"/.exec(cell[1])?.[1] || '';
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] || '';
      const value = type === 's' ? sharedStrings[Number(raw)] || '' : type === 'inlineStr' ? officeText(cell[2]) : decodeEntities(raw);
      return value ? `${address}: ${value}` : '';
    }).filter(Boolean).join(' | '),
  ).filter(Boolean).join('\n');
}

export async function extractReferenceFile(file: ReferenceFile, savedPath: string, visionConfig?: PlanningModelConfig): Promise<Extraction> {
  const name = file.filename.toLowerCase();
  if (file.contentType.startsWith('image/') || /\.(png|jpe?g|webp|svg)$/i.test(name)) return { extractedText: '', parseStatus: 'image' };
  const supported = file.contentType.startsWith('text/') || /\.(txt|md|markdown|csv|json|pdf|docx|pptx|xlsx|doc|ppt|xls)$/i.test(name);
  if (!supported) return { extractedText: '', parseStatus: 'unsupported', parseError: '该格式暂不支持正文分析，请使用 PDF、Word、PPT、Excel 或文本文件' };
  try {
    let text = '';
    if (file.contentType.startsWith('text/') || /\.(txt|md|markdown|csv|json)$/i.test(name)) {
      const utf16 = file.data[0] === 0xff && file.data[1] === 0xfe;
      try { text = new TextDecoder(utf16 ? 'utf-16le' : 'utf-8', { fatal: true }).decode(file.data); }
      catch { text = new TextDecoder('gb18030', { fatal: true }).decode(file.data); }
    } else if (/\.pdf$/i.test(name)) {
      let pdfText = '';
      try { pdfText = (await runFile('pdftotext', ['-layout', savedPath, '-'], commandOptions)).stdout; }
      catch {
        try {
          const script = "import sys, fitz; d=fitz.open(sys.argv[1]); print('\\n'.join(p.get_text() for p in d))";
          pdfText = (await runFile('python3', ['-c', script, savedPath], commandOptions)).stdout;
        } catch { /* 保留为空，走 OCR 兜底 */ }
      }
      // 扫描版 PDF 无文字层：优先多模态视觉读取，失败再回退 OCR
      if (pdfText.trim()) text = pdfText;
      else {
        if (visionConfig?.baseUrl && visionConfig?.apiKey && visionConfig?.visionModelName) {
          try { text = await visionReadPdf(visionConfig, savedPath); } catch { /* 视觉读取失败，回退 OCR */ }
        }
        if (!text.trim()) {
          try { text = await ocrPdf(savedPath); }
          catch { throw new Error('扫描版 PDF 未识别到文字，请上传可复制文字的 PDF'); }
        }
      }
    } else if (/\.doc$/i.test(name)) {
      // 旧版 Word 97-2003（OLE 复合文档），用 antiword 提取，缺工具时退回 catdoc
      try { text = (await runFile('antiword', [savedPath], commandOptions)).stdout; }
      catch { text = (await runFile('catdoc', [savedPath], commandOptions)).stdout; }
    } else if (/\.xls$/i.test(name)) {
      // 旧版 Excel 97-2003：xls2csv 或 catdoc -x
      try { text = (await runFile('xls2csv', [savedPath], commandOptions)).stdout; }
      catch { text = (await runFile('catdoc', ['-x', savedPath], commandOptions)).stdout; }
    } else if (/\.ppt$/i.test(name)) {
      // 旧版 PowerPoint 97-2003
      text = (await runFile('catppt', [savedPath], commandOptions)).stdout;
    } else {
      const list = (await runFile('unzip', ['-Z1', savedPath], commandOptions)).stdout.split(/\r?\n/);
      const entries = list.filter(entry => /^(word\/(?:document|header\d+|footer\d+|footnotes|endnotes)|ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+)|xl\/(?:sharedStrings|worksheets\/sheet\d+))\.xml$/i.test(entry))
        .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
      if (entries.length > 250) throw new Error('参考文件内容过多，请拆分上传');
      const parts: string[] = [];
      let sharedStrings: string[] = [];
      // sharedStrings sorts before worksheets. Every selected part is read, or parsing fails explicitly.
      for (const entry of entries) {
        const xml = (await runFile('unzip', ['-p', savedPath, entry], commandOptions)).stdout;
        if (entry === 'xl/sharedStrings.xml') {
          sharedStrings = [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(item => officeText(item[1]));
          continue;
        }
        const content = entry.startsWith('xl/') ? spreadsheetText(xml, sharedStrings) : officeText(xml);
        if (content) parts.push(`【${entry}】\n${content}`);
        if (parts.reduce((sum, part) => sum + part.length, 0) > MAX_REFERENCE_TEXT) throw new Error('参考文件正文超过分析上限，请拆分上传');
      }
      text = parts.join('\n\n');
    }
    text = text.trim();
    if (!text) throw new Error('未读取到正文；扫描版文件请先转成可复制文字的文件');
    if (text.length > MAX_REFERENCE_TEXT) throw new Error('参考文件正文超过分析上限，请拆分上传');
    return { extractedText: text, parseStatus: 'ready' };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { extractedText: '', parseStatus: 'failed', parseError: /请|正文/.test(message) ? message : '文件已保存，但正文解析失败，请重新上传可读取的文件' };
  }
}
