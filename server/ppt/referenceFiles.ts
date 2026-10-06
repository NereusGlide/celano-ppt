import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { MAX_REFERENCE_TEXT, type ReferenceParseStatus } from '../../src/shared/referenceFiles.js';

const runFile = promisify(execFile);
const commandOptions = { encoding: 'utf8' as const, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 };
type ReferenceFile = { filename: string; contentType: string; data: Buffer };
type Extraction = { extractedText: string; parseStatus: ReferenceParseStatus; parseError?: string };

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

export async function extractReferenceFile(file: ReferenceFile, savedPath: string): Promise<Extraction> {
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
      try { text = (await runFile('pdftotext', ['-layout', savedPath, '-'], commandOptions)).stdout; }
      catch {
        const script = "import sys, fitz; d=fitz.open(sys.argv[1]); print('\\n'.join(p.get_text() for p in d))";
        text = (await runFile('python3', ['-c', script, savedPath], commandOptions)).stdout;
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
