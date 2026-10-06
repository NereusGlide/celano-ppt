export const MAX_REFERENCE_TEXT = 1_200_000;
export type ReferenceParseStatus = 'ready' | 'image' | 'failed' | 'unsupported' | 'pending';

export function referenceContext(files: Array<{ name: string; extractedText?: string }>): string {
  return files.filter(file => file.extractedText?.trim()).map(file => `【参考文件：${file.name.replace(/[\r\n]/g, ' ')}】\n${file.extractedText}`).join('\n\n');
}
