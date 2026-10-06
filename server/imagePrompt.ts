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
