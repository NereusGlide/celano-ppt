/**
 * 前端异常采集与全局兜底。
 *
 * 设计目标：
 *  1. 任何未捕获异常都必须留下痕迹（当前默认落到控制台 + 内存环形缓冲）。
 *  2. 接入真实监控平台时，只需填写 REPORT_ENDPOINT 或替换 send()，无需改动调用点。
 *  3. 绝不因为上报本身失败而影响主流程（全部吞掉异常）。
 */

/** 上报地址。留空表示只做本地记录；接入 Sentry / 自建采集时填入即可。 */
const REPORT_ENDPOINT = '';

/** 内存环形缓冲：方便在控制台执行 __celanoErrors() 查看最近异常。 */
const MAX_BUFFER = 30;
const buffer: ClientErrorRecord[] = [];

export interface ClientErrorRecord {
  message: string;
  stack?: string;
  source: 'render' | 'window' | 'rejection' | 'manual';
  route: string;
  at: number;
  context?: Record<string, unknown>;
}

function currentRoute(): string {
  try {
    return (window.location.hash || window.location.pathname || '/').slice(0, 120);
  } catch {
    return 'unknown';
  }
}

function send(record: ClientErrorRecord): void {
  if (!REPORT_ENDPOINT) return;
  try {
    // keepalive 保证页面卸载时也能发出去；不等待响应，避免阻塞主流程。
    void fetch(REPORT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* 上报失败不影响主流程 */
  }
}

/** 记录一条客户端异常。所有参数都会被序列化成可上报的形态。 */
export function reportClientError(
  error: unknown,
  options: { source?: ClientErrorRecord['source']; context?: Record<string, unknown> } = {},
): ClientErrorRecord {
  const err = error instanceof Error ? error : new Error(String(error ?? '未知错误'));
  const record: ClientErrorRecord = {
    message: err.message.slice(0, 500),
    stack: err.stack?.slice(0, 4000),
    source: options.source || 'manual',
    route: currentRoute(),
    at: Date.now(),
    context: options.context,
  };

  buffer.push(record);
  if (buffer.length > MAX_BUFFER) buffer.shift();

  if (import.meta.env.DEV) {
    // 开发环境保留完整堆栈，方便定位
    console.error('[celano]', record.source, err, options.context || '');
  }
  send(record);
  return record;
}

/** 读取最近的异常记录（调试用）。 */
export function recentClientErrors(): ClientErrorRecord[] {
  return buffer.slice();
}

let installed = false;

/**
 * 安装全局兜底监听。
 * 必须在应用挂载前调用一次；重复调用是安全的（幂等）。
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // 同步运行时错误（事件处理器、定时器、跨域脚本等）
  window.addEventListener('error', (event: ErrorEvent) => {
    // 资源加载失败（img/script/link）也会触发 error，但没有 error 对象，单独归类。
    const target = event.target as HTMLElement | null;
    const isResource = !!target && target !== (window as unknown as EventTarget);
    if (isResource) {
      const tag = target?.tagName?.toLowerCase() || 'resource';
      const src = (target as HTMLImageElement)?.src || (target as HTMLLinkElement)?.href || '';
      reportClientError(new Error(`${tag} 资源加载失败`), {
        source: 'window',
        context: { tag, src: String(src).slice(0, 300) },
      });
      return;
    }
    reportClientError(event.error || new Error(event.message), {
      source: 'window',
      context: { file: event.filename, line: event.lineno, column: event.colno },
    });
  }, true);

  // 未处理的 Promise 拒绝 —— 这类失败在界面上往往表现为「点了没反应」
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportClientError(event.reason, { source: 'rejection' });
  });

  // 暴露到控制台，便于线上问题排查
  try {
    Object.defineProperty(window, '__celanoErrors', {
      value: recentClientErrors,
      writable: false,
      configurable: true,
    });
  } catch {
    /* 某些严格环境不允许扩展 window，忽略 */
  }
}
