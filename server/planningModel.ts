/** API identifiers differ from the vendor's displayed model version. */
export function normalizePlanningModelName(baseUrl: string, modelName: string): string {
  let hostname = '';
  try { hostname = new URL(baseUrl).hostname; } catch { return modelName.trim(); }
  if (hostname === 'api.deepseek.com' && /^deepseek-v4\.1-flash$/i.test(modelName.trim())) return 'deepseek-flash';
  return modelName.trim();
}
