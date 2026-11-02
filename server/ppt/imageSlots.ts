/**
 * PPT 与画板共用的上游生图并发闸门。
 * 六路是产品级上限，避免单页修改绕过 PPT worker 池打满同一套 Image 接口。
 */
export const GLOBAL_IMAGE_SLOTS = 6;

let imageBusy = 0;
type ImageWaiter = { resolve: () => void; background: boolean };
const imageWaiters: ImageWaiter[] = [];

function enqueueImageWaiter(background: boolean): Promise<void> {
  return new Promise(resolve => {
    const waiter = { resolve, background };
    if (!background) {
      const firstBackground = imageWaiters.findIndex(item => item.background);
      if (firstBackground >= 0) { imageWaiters.splice(firstBackground, 0, waiter); return; }
    }
    imageWaiters.push(waiter);
  });
}

/** 当前占用与排队。队列指标用它，不再返回写死的 concurrency。 */
export function imageSlotSnapshot() {
  return { busy: imageBusy, waiting: imageWaiters.length, slots: GLOBAL_IMAGE_SLOTS };
}

/**
 * 占用一个上游并发位。
 *
 * 为什么改成「令牌直传」而不是「释放后大家重新抢」：
 * 旧实现在 finally 里先把计数减一、再唤醒队首等待者，两者之间存在微任务间隙，
 * 期间任何新到的请求都能先抢到刚释放的位置。排队越久的请求反而最容易被插队，
 * 在高负载下会表现为某些页面长时间拿不到并发位（饥饿）。
 * 现在释放时若有等待者，计数保持不变、把位置直接移交给队首，
 * 队列严格 FIFO，新请求只能排在队尾。
 */
export async function withImageSlot<T>(fn: () => Promise<T>, options?: { priority?: 'user' | 'background' }): Promise<T> {
  const background = options?.priority === 'background';
  // 管理端真实出图测试走 background：留出最后一路给用户，并排在用户等待者后面。
  const blocked = imageBusy >= GLOBAL_IMAGE_SLOTS - (background ? 1 : 0)
    || (background && imageWaiters.some(item => !item.background));
  if (blocked) {
    // 被唤醒即意味着已经拿到移交过来的位置，无需再次检查计数。
    await enqueueImageWaiter(background);
  } else {
    imageBusy += 1;
  }
  try {
    return await fn();
  } finally {
    const next = imageWaiters.shift();
    if (next) next.resolve(); // 位置移交给队首，imageBusy 保持不变
    else imageBusy -= 1;
  }
}
