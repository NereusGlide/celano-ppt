export const pptTemplateSeries = [
  { id: 'black-white', name: '黑白系列', count: 8 },
  { id: 'chanel', name: '香奈儿', count: 6 },
  { id: 'pop-mart', name: '泡泡玛特', count: 9 },
  { id: 'streetwear', name: '服装潮牌', count: 9 },
  { id: 'ideal', name: '理想', count: 8 },
  { id: 'french', name: '法式', count: 8 },
];

export const pptStyleTemplates = pptTemplateSeries.flatMap(series =>
  Array.from({ length: series.count }, (_, index) => {
    const number = String(index + 1).padStart(2, '0');
    return { id: `${series.id}-${number}`, seriesId: series.id, name: `${series.name} ${number}`, url: `/templates/${series.id}/${number}.jpg`, description: `${series.name} · PPT 风格参考` };
  })
);

export const TEMPLATE_SELECTION_KEY = 'celano_ppt_style_template';

export function selectedTemplateReferences() {
  const id = sessionStorage.getItem(TEMPLATE_SELECTION_KEY);
  const selected = pptTemplateSeries.find(item => item.id === id);
  sessionStorage.removeItem(TEMPLATE_SELECTION_KEY);
  return selected ? pptStyleTemplates.filter(item => item.seriesId === selected.id).map(item => ({ id: item.id, name: item.name, url: item.url, type: 'image/jpeg', size: 0 })) : [];
}
