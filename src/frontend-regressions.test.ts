import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const root = new URL('../', import.meta.url);
const canvas = 'integrations/infinite-canvas/web/src/';
const read = (file: string) => fs.readFileSync(new URL(file, root), 'utf8');
function evaluate(source: string, globals: Record<string, unknown> = {}) {
  const context = vm.createContext({ console, URL, Blob, DOMException, AbortController, setTimeout, clearTimeout, ...globals });
  const code = transformSync(source.replace(/^import[\s\S]*?;\s*$/gm, ''), { loader: 'tsx', format: 'cjs' }).code;
  context.module = { exports: {} }; context.exports = (context.module as any).exports;
  vm.runInContext(code, context);
  return context;
}
function storageHarness(file: string) {
  const stores = new Map<string, Map<string, unknown>>();
  const live = new Set<string>();
  let created = 0;
  let thumbnails = 0;
  const context = evaluate(read(canvas + file), {
    canvasDatabase: 'test', nanoid: () => String(++created),
    localforage: { createInstance: ({ storeName }: any) => {
      const data = new Map<string, unknown>(); stores.set(storeName, data);
      return { getItem: async (key: string) => data.get(key), setItem: async (key: string, value: unknown) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); }, iterate: async (fn: any) => { for (const [key, value] of data) fn(value, key); } };
    } },
    URL: { createObjectURL: () => { const url = 'blob:' + ++created; live.add(url); return url; }, revokeObjectURL: (url: string) => live.delete(url) },
    createImageThumbnail: async () => { thumbnails++; return new Blob(['preview']); }, withLocalProxy: (url: string) => url, i18n: { t: (key: string) => key }, window: { setTimeout, clearTimeout },
  });
  return { api: (context.module as any).exports, stores, live, thumbnailCount: () => thumbnails };
}

test('图片结果和PPT工作台复用首页唯一导航且保持作品交接入口', () => {
  const main = read('src/main.tsx');
  const shell = read('src/kimi/KimiShellApp.tsx');
  const image = read('src/image/ImageResultsApp.tsx');
  const workspace = read('src/workspace/WorkspaceApp.tsx');
  const assets = read('src/account/CanvasAssetsPanel.tsx');
  assert.match(main, /KimiShellApp initialPage="workspace"/);
  assert.match(main, /KimiShellApp initialPage="image-results"/);
  assert.equal((shell.match(/<header className="kimi-topbar kimi-topnav"/g) || []).length, 1);
  assert.match(shell, /page === 'workspace' && item.key === 'ppt'/);
  assert.doesNotMatch(image, /PrimaryNav|YOUR IMAGE COLLECTION/);
  assert.doesNotMatch(workspace, /ws-brand-wordmark/);
  assert.match(workspace, /celano_open_deck/);
  assert.match(workspace, /celano_active_deck/);
  assert.match(assets, /useFocusTrap<HTMLDivElement>/);
});

test('文生图优化完成不等待余额刷新，账户切换时不回填旧结果', async () => {
  const source = read('src/image/ImageApp.tsx');
  const body = source.slice(source.indexOf('  const optimize = async'), source.indexOf('  return <div'));
  const state: boolean[] = [];
  const patches: unknown[] = [];
  const timers = new Map<number, () => void>();
  const ownerRef = { current: 'owner-A' };
  const context = evaluate(`${body}\nmodule.exports = { optimize };`, {
    currentUser: { id: 'owner-A' }, locked: false, prompt: '海报', owner: 'owner-A', ownerRef,
    setConfirm: () => {}, setOptimizing: (value: boolean) => state.push(value), setNotice: () => {}, set: (value: unknown) => patches.push(value),
    optimizeImagePrompt: async () => ({ prompt: '优化结果' }), fetchCurrentUser: () => new Promise(() => {}), syncUser: () => {},
    window: { setTimeout: (fn: () => void) => { timers.set(1, fn); return 1; }, clearTimeout: (id: number) => timers.delete(id) },
  });
  await (context.module as any).exports.optimize();
  assert.deepEqual(state, [true, false]);
  assert.equal(patches.length, 1);
  ownerRef.current = 'owner-B';
  await (context.module as any).exports.optimize();
  assert.equal(patches.length, 1);
});

test('显式hash深链接优先于pathname，根hash可从深链接返回首页', () => {
  const source = read('src/main.tsx').match(/function currentRoute\(\) \{[\s\S]*?\n\}/)![0];
  const context = evaluate(source, { window: { location: { pathname: '/image', hash: '#/prompts' } } });
  assert.equal(vm.runInContext('currentRoute()', context), 'prompts');
  (context.window as any).location.hash = '#/';
  assert.equal(vm.runInContext('currentRoute()', context), 'app-shell');
  (context.window as any).location.hash = '';
  assert.equal(vm.runInContext('currentRoute()', context), 'image');
});

test('壳内切页同步main缓存，返回初始页面触发重新挂载', () => {
  const location = { pathname: '/', hash: '#/' };
  const listeners = new Map<string, () => void>();
  const source = read('src/main.tsx');
  const route = source.match(/function currentRoute\(\) \{[\s\S]*?\n\}/)![0];
  const sync = source.match(/window.addEventListener\('celano-shell-route',[\s\S]*?\n\}\);/)![0];
  const shell = read('src/kimi/KimiShellApp.tsx');
  const paths = shell.match(/const PAGE_PATH:[\s\S]*?\n\};/)![0];
  const change = shell.match(/const switchPage = [\s\S]*?\n  \};/)![0];
  const context = evaluate(`let mountedRoute = 'app-shell'; ${route}\n${sync}\n${paths}\n${change}`, {
    window: { location, addEventListener: (event: string, fn: () => void) => listeners.set(event, fn), dispatchEvent: (event: Event) => listeners.get(event.type)?.(), history: { pushState: (_state: any, _unused: any, hash: string) => { location.hash = hash; } } },
    document: { body: { dataset: {} } }, Event, setPage: () => {},
  });
  vm.runInContext("switchPage('image')", context);
  assert.equal(vm.runInContext('mountedRoute', context), 'image');
  location.hash = '#/';
  assert.notEqual(vm.runInContext('currentRoute()', context), vm.runInContext('mountedRoute', context));
});

test('提示词页卸载取消延迟导航，复制Promise稍后完成不会创建计时器', async () => {
  const source = read('src/prompts/PromptLibraryApp.tsx');
  const body = source.slice(source.indexOf('  const { currentUser }'), source.indexOf('  const total ='));
  const effects: (() => void)[] = [];
  const timers = new Map<number, () => void>();
  let sequence = 0; let releaseCopy: () => void = () => {};
  const clipboard = new Promise<void>(resolve => { releaseCopy = resolve; });
  const location = { hash: '#/prompts' };
  const context = evaluate(`${body}\nmodule.exports = { makeSame, copyPrompt };`, {
    useAuth: () => ({ currentUser: null }), useState: (value: any) => [value, () => {}], useRef: (value: any) => ({ current: value }), useMemo: () => [],
    useEffect: (fn: () => () => void) => effects.push(fn()), setImageDraft: () => {},
    window: { location, setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; }, clearTimeout: (id: number) => timers.delete(id) }, navigator: { clipboard: { writeText: () => clipboard } },
  });
  const { makeSame, copyPrompt } = (context.module as any).exports;
  const card = { id: 'one', title: '测试', ratio: '1:1', prompt: '测试' };
  makeSame(card); makeSame(card); assert.equal(timers.size, 1);
  const copying = copyPrompt(card);
  effects.forEach(cleanup => cleanup());
  assert.equal(timers.size, 0);
  releaseCopy(); await copying;
  assert.equal(timers.size, 0); assert.equal(location.hash, '#/prompts');
});

test('画布卸载或切换项目取消全部生成请求并清空登记', () => {
  const source = read(canvas + 'pages/canvas/project.tsx');
  const cleanup = source.match(/useEffect\(\(\) => \(\) => \{\s*generationRequestsRef[\s\S]*?\}, \[projectId\]\);/);
  assert.ok(cleanup, '生成请求必须在项目生命周期结束时取消');
  const controllers = [new AbortController(), new AbortController()];
  const requests = new Map(controllers.map((controller, id) => [String(id), { controller }]));
  const pollIds = new Set(['one']);
  let unmount: () => void = () => {};
  evaluate(cleanup[0], { projectId: 'test', generationRequestsRef: { current: requests }, videoPollIdsRef: { current: pollIds }, useEffect: (fn: () => () => void) => { unmount = fn(); } });
  unmount(); assert.ok(controllers.every(controller => controller.signal.aborted)); assert.equal(requests.size, 0); assert.equal(pollIds.size, 0);
});

test('4K和参考图不展示2K文生图免费额度', () => {
  const expression = read('src/image/ImageApp.tsx').match(/const freeLeft = ([^;]+);/)![1];
  for (const [resolution, reference, expected] of [['2K', null, 3], ['4K', null, 0], ['2K', {}, 0]]) {
    assert.equal(vm.runInNewContext(expression, { resolution, reference, currentUser: {}, remainingFreeDaily: () => 3 }), expected);
  }
});

for (const [file, resolve, replace, cleanup, storeName] of [
  ['services/image-storage.ts', 'resolveImageUrl', 'setImageBlob', 'deleteStoredImages', 'image_files'],
  ['services/file-storage.ts', 'resolveMediaUrl', 'setMediaBlob', 'cleanupUnusedMedia', 'media_files'],
]) {
  test(`${file}并发读取只保留一个URL，覆盖与清理释放旧URL`, async () => {
    const { api, stores, live } = storageHarness(file);
    const key = 'image:test'; stores.get(storeName)!.set(key, new Blob(['original']));
    const urls = await Promise.all([api[resolve](key), api[resolve](key)]);
    assert.equal(urls[0], urls[1]); assert.equal(live.size, 1);
    await api[replace](key, new Blob(['replacement']));
    assert.equal(live.has(urls[0]), false);
    if (cleanup === 'cleanupUnusedMedia') await api[cleanup]({}); else await api[cleanup]([key]);
    assert.equal(live.size, 0);
  });
}

test('重复缩略图读取不重复分配URL，重复生成入队去重', async () => {
  const { api, stores, live, thumbnailCount } = storageHarness('services/image-storage.ts');
  stores.get('image_previews')!.set('image:test', { version: 1, blob: new Blob(['preview']) });
  const urls = await Promise.all([api.ensureImagePreview('image:test'), api.ensureImagePreview('image:test')]);
  assert.equal(urls[0], urls[1]); assert.equal(live.size, 1);
  await api.deleteStoredImages(['image:test']); assert.equal(live.size, 0);
  stores.get('image_files')!.set('image:queued', new Blob(['original']));
  await Promise.all([api.ensureImagePreview('image:queued'), api.ensureImagePreview('image:queued'), api.ensureImagePreview('image:queued')]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(thumbnailCount(), 1, '同一缩略图不能重复进入解码队列');
  assert.equal(live.size, 1);
});

for (const [file, declaration, collection] of [
  ['stores/use-asset-store.ts', 'assetStorage', 'assets'],
  ['stores/canvas/use-canvas-store.ts', 'canvasStorage', 'projects'],
]) {
  test(`${file}损坏缓存返回null并保留原文，兼容旧缓存缺省集合`, async () => {
    let value = '{broken'; let writes = 0; let warnings = 0;
    const source = read(canvas + file).split('export const use')[0] + `\nmodule.exports = ${declaration};`;
    const context = evaluate(source, { localForageStorage: { getItem: async () => value, setItem: async () => { writes++; }, removeItem: () => { throw new Error('不应删除损坏缓存'); } }, console: { warn: () => { warnings++; } } });
    const api = (context.module as any).exports;
    assert.equal(await api.getItem('test'), null); assert.equal(value, '{broken'); assert.equal(warnings, 1);
    await api.setItem('test', { state: { assets: [], projects: [], deletedProjects: [] } });
    assert.equal(writes, 0, 'hydrated状态更新不得覆盖损坏原文');
    value = JSON.stringify({ state: { [collection]: [] } });
    const parsed = await api.getItem('test'); assert.ok(Array.isArray(parsed.state[collection]));
    if (collection === 'projects') assert.ok(Array.isArray(parsed.state.deletedProjects));
    value = JSON.stringify({ state: { [collection]: [null] } });
    assert.equal(await api.getItem('test'), null, '集合中的null元素必须拒绝');
    await api.setItem('test', { state: { assets: [], projects: [], deletedProjects: [] } });
    assert.equal(writes, 0, '非法集合导致的hydrated更新不得覆盖原文');
    value = JSON.stringify({ state: { [collection]: [42] } });
    assert.equal(await api.getItem('test'), null, '集合中的非对象元素必须拒绝');
    value = JSON.stringify({ state: { [collection]: [{}] } });
    assert.equal(await api.getItem('test'), null, '缺少关键字段的元素必须拒绝');
    value = 'null'; assert.equal(await api.getItem('test'), null);
  });
}

test('合法非空素材缓存保留文本、图片和视频，画布保留当前及旧缺省集合结构', async () => {
  const timestamp = '2026-10-08T00:00:00.000Z';
  const base = { title: '示例', coverUrl: '', tags: [], createdAt: timestamp, updatedAt: timestamp };
  const assets = [
    { ...base, id: 'text', kind: 'text', data: { content: '正文' } },
    { ...base, id: 'image', kind: 'image', data: { dataUrl: 'https://example.invalid/a.png', width: 1, height: 1, bytes: 1, mimeType: 'image/png' } },
    { ...base, id: 'video', kind: 'video', data: { url: 'https://example.invalid/a.mp4', width: 1, height: 1, bytes: 1, mimeType: 'video/mp4' } },
  ];
  const project = {
    id: 'project', title: '示例', createdAt: timestamp, updatedAt: timestamp,
    nodes: [{ id: 'node', type: 'image', title: '图片', position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: 'https://example.invalid/a.png', references: ['image:key'], images: [{ id: 'image', status: 'success', content: 'https://example.invalid/a.png', naturalWidth: 1, naturalHeight: 1, bytes: 1, mimeType: 'image/png' }] } }],
    connections: [], chatSessions: [{ id: 'chat', title: '对话', createdAt: timestamp, updatedAt: timestamp, messages: [{ id: 'message', role: 'user', text: '正文', references: [{ id: 'reference', type: 'text', title: '正文', text: '参考内容' }] }] }],
    activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
  };
  for (const [file, declaration, state] of [
    ['stores/use-asset-store.ts', 'assetStorage', { assets }],
    ['stores/canvas/use-canvas-store.ts', 'canvasStorage', { projects: [project] }],
  ] as const) {
    const source = read(canvas + file).split('export const use')[0] + `\nmodule.exports = ${declaration};`;
    const value = JSON.stringify({ state });
    const context = evaluate(source, { localForageStorage: { getItem: async () => value }, console: { warn: () => assert.fail('合法缓存不应被拒绝') } });
    const parsed = await (context.module as any).exports.getItem('test');
    assert.ok(parsed);
    assert.equal(JSON.stringify(parsed.state.assets || parsed.state.projects), JSON.stringify('assets' in state ? state.assets : state.projects));
    if ('projects' in state) assert.equal(JSON.stringify(parsed.state.deletedProjects), '[]');
  }
});

test('画布拒绝会在hydrate或生成时抛错的嵌套字符串和集合元素', async () => {
  const project = { id: 'project', title: '示例', createdAt: '2026-10-08', updatedAt: '2026-10-08', nodes: [], connections: [], chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
  let value = '';
  const source = read(canvas + 'stores/canvas/use-canvas-store.ts').split('export const use')[0] + '\nmodule.exports = canvasStorage;';
  const context = evaluate(source, { localForageStorage: { getItem: async () => value }, console: { warn: () => undefined } });
  const api = (context.module as any).exports;
  for (const metadata of [{ content: 42 }, { references: [42] }, { images: [{ content: 42 }] }, { images: [null] }, { texts: [null] }]) {
    value = JSON.stringify({ state: { projects: [{ ...project, nodes: [{ id: 'node', type: 'image', title: '图片', position: { x: 0, y: 0 }, width: 100, height: 100, metadata }] }] } });
    assert.equal(await api.getItem('test'), null, JSON.stringify(metadata));
  }
  value = JSON.stringify({ state: { projects: [{ ...project, chatSessions: [{ id: 'chat', title: '对话', createdAt: '2026-10-08', updatedAt: '2026-10-08', messages: [{ id: 'message', role: 'user', text: 'text', references: [{ id: 'ref', type: 'image', title: 'ref', dataUrl: 42 }] }] }] }] } });
  assert.equal(await api.getItem('test'), null, '非字符串dataUrl会在hydrateAssistantImages中调用startsWith而崩溃');
});

test('移动端忽略桌面展开偏好，抽屉初始关闭且不改存储', () => {
  const source = read(canvas + 'stores/use-canvas-side-panel-store.ts').split('type CanvasSidePanelStore')[0];
  const context = evaluate(source, { window: { innerWidth: 320 }, localStorage: { getItem: () => '1' } });
  assert.equal(vm.runInContext('initialOpen()', context), false);
  assert.equal(vm.runInContext('initialWidth()', context), 262);
  (context.window as any).innerWidth = 1440;
  assert.equal(vm.runInContext('initialOpen()', context), true);
});

test('生产源码映射在主站和画布静态资源之前拒绝，正常JS仍可访问', async () => {
  const { default: express } = await import('express');
  const { default: path } = await import('node:path');
  const directory = fs.mkdtempSync(path.join(process.cwd(), 'map-guard-'));
  const assets = path.join(directory, 'public/infinite-canvas/assets');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(path.join(assets, 'entry.js.map'), 'private-source');
  fs.writeFileSync(path.join(assets, 'entry.js'), 'window.example = true;');
  const source = read('server.ts');
  const start = source.indexOf('// 在两套静态资源路由之前拦截');
  const end = source.indexOf('async function startServer()', start);
  assert.ok(start >= 0 && end > start);
  const app = express();
  evaluate(source.slice(start, end), { app, express, path, __dirname: directory, isProduction: true });
  app.get('/assets/entry.js.map', (_req, res) => res.send('private-source'));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = 'http://127.0.0.1:' + address.port;
    for (const route of ['/assets/entry.js.map', '/infinite-canvas/assets/entry.js.map', '/infinite-canvas/assets/entry.js.MAP']) {
      const response = await fetch(base + route);
      assert.equal(response.status, 404, route);
      assert.equal(await response.text(), 'Not Found');
    }
    const response = await fetch(base + '/infinite-canvas/assets/entry.js');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'window.example = true;');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('画布移动编辑在缩放层外，拖动与缩放监听统一Pointer事件', () => {
  const source = read(canvas + 'pages/canvas/project.tsx');
  assert.match(source, /showPanel=\{!mobileLayout/);
  assert.match(source, /<Drawer className="canvas-mobile-editor"/);
  assert.match(source, /window\.addEventListener\("pointermove", move\)/);
  assert.match(source, /window\.addEventListener\("pointercancel", cancel\)/);
  const node = read(canvas + 'components/canvas/canvas-node.tsx');
  assert.match(node, /onPointerDownCapture=/);
  assert.match(node, /window\.addEventListener\("pointercancel", handleResizeUp\)/);
});
