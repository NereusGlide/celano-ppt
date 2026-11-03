/**
 * 画布 / 文生图的服务端任务。
 * 浏览器切后台、关标签或网络中断只断开 HTTP 响应，不取消上游生成。
 * 扣费在任务创建时发生一次；同一任务编号的重试只附着到原任务，不再扣费。
 * 退款只在上游失败或用户显式取消时发生。结果留在内存里供回来领取，不写入 store.json。
 */

export type ImageJobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type ImageJobView = {
  id: string;
  userId: string;
  status: ImageJobStatus;
  error?: string;
  result?: unknown;
  httpStatus: number;
};

export type ImageJob = ImageJobView & {
  abort: AbortController;
  createdAt: number;
  expiresAt: number;
  done: Promise<ImageJobView>;
  resolve: (view: ImageJobView) => void;
};

const jobs = new Map<string, ImageJob>();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_FINISHED_PER_USER = 32;
const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export function readClientJobId(value: unknown): string | undefined {
  if (value == null || value === '') return undefined;
  const id = String(value).trim();
  if (!JOB_ID_PATTERN.test(id)) {
    const error = new Error('生成任务编号无效') as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  return id;
}

function viewOf(job: ImageJob): ImageJobView {
  return { id: job.id, userId: job.userId, status: job.status, error: job.error, result: job.result, httpStatus: job.httpStatus };
}

function sweep(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && job.expiresAt <= now) jobs.delete(id);
  }
}

function evictFinished(userId: string) {
  const finished = [...jobs.values()].filter(job => job.userId === userId && job.status !== 'running').sort((a, b) => a.createdAt - b.createdAt);
  while (finished.length > MAX_FINISHED_PER_USER) {
    const oldest = finished.shift();
    if (oldest) jobs.delete(oldest.id);
  }
}

export function reserveImageJob(id: string, userId: string): { conflict: true } | { created: boolean; job: ImageJob } {
  sweep();
  const existing = jobs.get(id);
  if (existing) {
    if (existing.userId !== userId) return { conflict: true };
    return { created: false, job: existing };
  }
  let resolve!: (view: ImageJobView) => void;
  const done = new Promise<ImageJobView>(resolver => { resolve = resolver; });
  const job: ImageJob = {
    id,
    userId,
    status: 'running',
    httpStatus: 200,
    abort: new AbortController(),
    createdAt: Date.now(),
    expiresAt: Date.now() + JOB_TTL_MS,
    done,
    resolve,
  };
  jobs.set(id, job);
  return { created: true, job };
}

export function finishImageJob(job: ImageJob, patch: { status: Exclude<ImageJobStatus, 'running'>; error?: string; result?: unknown; httpStatus: number }) {
  if (job.status !== 'running') return;
  job.status = patch.status;
  job.error = patch.error;
  job.result = patch.result;
  job.httpStatus = patch.httpStatus;
  job.expiresAt = Date.now() + JOB_TTL_MS;
  if (patch.status === 'succeeded') evictFinished(job.userId);
  job.resolve(viewOf(job));
}

export function getImageJob(id: string, userId: string): ImageJobView | undefined {
  sweep();
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return undefined;
  return viewOf(job);
}

/** 只中止仍在跑的任务。结算与退款由执行该任务的请求负责，避免这里再退一次。 */
export function cancelImageJob(id: string, userId: string): 'missing' | 'finished' | 'cancelling' {
  sweep();
  const job = jobs.get(id);
  if (!job || job.userId !== userId) return 'missing';
  if (job.status !== 'running') return 'finished';
  job.abort.abort();
  return 'cancelling';
}
