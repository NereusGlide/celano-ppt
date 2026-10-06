/**
 * PPT 与画板共用的上游生图并发闸门。
 * 六路是产品级上限，避免单页修改绕过 PPT worker 池打满同一套 Image 接口。
 */
export const GLOBAL_IMAGE_SLOTS = 6;

let imageBusy = 0;
const imageWaiters: Array<() => void> = [];

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
export async function withImageSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (imageBusy >= GLOBAL_IMAGE_SLOTS) {
    // 被唤醒即意味着已经拿到移交过来的位置，无需再次检查计数。
    await new Promise<void>(resolve => imageWaiters.push(resolve));
  } else {
    imageBusy += 1;
  }
  try {
    return await fn();
  } finally {
    const next = imageWaiters.shift();
    if (next) next(); // 位置移交给队首，imageBusy 保持不变
    else imageBusy -= 1;
  }
}
