import React from 'react';
import { reportClientError } from '../services/telemetry.js';

interface Props {
  children: React.ReactNode;
  /** 出错时的区域名称，用于区分「首页崩了」还是「工作台崩了」。 */
  label?: string;
  /** 点击「重试」时额外执行的回调（例如重新拉取数据）。 */
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * 渲染期错误边界。
 *
 * 为什么必须有：React 在渲染期抛错会卸载整棵树，页面直接变空白。
 * 没有边界时，用户唯一的出路是刷新，而刷新后大概率复现同一个错误 —— 等于被永久锁死。
 * 有边界之后，至少能给出明确的降级界面与自救入口。
 *
 * 注意：错误边界只能捕获渲染 / 生命周期 / 构造阶段的错误，
 * 事件处理器与异步代码里的异常由 services/telemetry.ts 的全局监听负责。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportClientError(error, {
      source: 'render',
      context: { boundary: this.props.label || 'unknown', componentStack: info.componentStack?.slice(0, 2000) },
    });
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="celano-crash" role="alert">
        <div className="celano-crash-card">
          <span className="celano-crash-mark" aria-hidden="true">!</span>
          <h1>这个页面遇到了问题</h1>
          <p>
            界面在渲染时发生了异常。你的作品与点数都已保存在服务器上，不会丢失。
          </p>
          <div className="celano-crash-actions">
            <button type="button" className="celano-crash-primary" onClick={this.handleRetry}>
              重试
            </button>
            <button type="button" className="celano-crash-ghost" onClick={this.handleReload}>
              重新加载页面
            </button>
            <a className="celano-crash-ghost" href="/#/">返回首页</a>
          </div>
          {import.meta.env.DEV && (
            <pre className="celano-crash-detail">{error.stack || error.message}</pre>
          )}
          <p className="celano-crash-hint">
            如果反复出现，请把当前地址与操作步骤反馈给技术支持。
          </p>
        </div>
      </div>
    );
  }
}
