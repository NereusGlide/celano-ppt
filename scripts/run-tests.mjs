import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// db 初始化会迁移并保存 store。每个测试进程必须拥有独立数据目录。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const discover = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const target = path.join(directory, entry.name);
  return entry.isDirectory() ? discover(target) : target.endsWith('.test.ts') ? [target] : [];
});
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map(file => path.resolve(root, file))
  : [...discover(path.join(root, 'server')), ...discover(path.join(root, 'src'))];
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'celano-test-run-'));
const preload = `import fs from 'node:fs'; import path from 'node:path';
process.chdir(fs.mkdtempSync(path.join(process.env.CELANO_TEST_ROOT, 'worker-')));`;
const result = spawnSync(process.execPath, [
  '--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href,
  '--import', 'data:text/javascript,' + encodeURIComponent(preload),
  '--test', ...files,
], { cwd: root, stdio: 'inherit', env: { ...process.env, CELANO_TEST_ROOT: testRoot } });
if (result.error) console.error(result.error.message);
// 所有子进程退出后再由父进程清理，规避 Windows/TS 加载器持有 cwd 的 EBUSY。
try { fs.rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
catch (error) { console.warn('测试临时目录清理失败：', error.message); }
process.exit(result.status ?? 1);
