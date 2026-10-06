import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

/**
 * 站点根地址。用于 canonical / og:url / sitemap 等必须绝对路径的元信息。
 * 部署时通过 VITE_APP_URL 环境变量注入；未配置时回落到默认值。
 */
const SITE_URL = (process.env.VITE_APP_URL || 'https://celanoppt.com').replace(/\/+$/, '');

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        // 把构建期环境变量注入 index.html，避免在静态 HTML 里硬编码域名。
        name: 'celano-html-env',
        transformIndexHtml(html: string) {
          return html.replace(/%SITE_URL%/g, SITE_URL);
        },
      } satisfies Plugin,
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // 线上报错需要能定位到源码，但 sourcemap 不应随产物公开分发：
      // 用 'hidden' 生成后上传到错误监控平台即可。
      sourcemap: 'hidden' as const,
      // 单个 chunk 超过该体积（KB）时构建告警，用于防止体积静默膨胀。
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // 体积大且极少变动的三方库单独成 chunk，提升浏览器缓存命中率：
          // 业务代码发版时，vendor 命中缓存不会被重新下载。
          manualChunks(id: string) {
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) {
              return 'vendor-react';
            }
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR 仍可通过 DISABLE_HMR=true 关闭（AI Studio 场景）。
      hmr: process.env.DISABLE_HMR !== 'true',
      // 文件监听策略：
      //  · 忽略写入工具产生的临时目录（不忽略会导致 EBUSY 崩溃）
      //  · 启用轮询，规避 Windows 上 fs.watch 对「临时文件 → 重命名」原子写入漏事件的问题，
      //    这样保存后直接刷新浏览器即可看到最新代码，无需重启 dev server。
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        // 忽略写入工具/浏览器测试产生的临时目录（否则 Chrome 配置缓存会刷屏并拖垮服务）
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/.tmp-pippit/**',
          '**/*.tmpdir/**',
          '**/.tmp-*/**',
          '**/.account-browser/**',
          '**/.account-test-runtime/**',
          '**/data/**',
          '**/2026-10-*/**',
          '**/screenshots/**'
        ],
        usePolling: true,
        interval: 400,
      },
    },
  };
});
