import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Windows 上 npm 由 npm.cmd 提供，未启用 shell 时 execFileSync('npm') 会抛 ENOENT。
// 启用 shell 后由 cmd.exe 解析 npm.cmd，Unix 侧行为保持不变。
if (!existsSync('public/infinite-canvas/index.html')) {
  execFileSync('npm', ['run', 'build:canvas'], { stdio: 'inherit', shell: true });
}
