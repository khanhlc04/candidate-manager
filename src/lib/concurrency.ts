/**
 * Ý #3 — Chạy `worker` trên từng phần tử của `items`, tối đa `limit` việc cùng lúc.
 *
 * Cơ chế: tạo đúng `limit` "công nhân" chạy song song; mỗi công nhân lặp lấy chỉ
 * số việc tiếp theo từ một con trỏ dùng chung cho tới khi hết việc. Khác với cách
 * chia lô, worker nào rảnh là nhận việc mới ngay — không có rào chắn giữa các lô.
 *
 * Con trỏ `next++` không cần khoá vì JavaScript chạy đơn luồng: giữa lúc đọc và
 * lúc tăng không có `await` nào nên không worker nào chen vào được.
 *
 * Không bao giờ ném lỗi — trả về mảng kết quả CÙNG THỨ TỰ với `items`, mỗi phần
 * tử cho biết thành công hay thất bại (giống Promise.allSettled). Nhờ vậy một
 * file hỏng không làm hỏng cả lô, khác hẳn Promise.all vốn fail-fast.
 *
 * Thời gian ≈ ⌈n/limit⌉ × thời gian mỗi việc. Số việc chạy đồng thời luôn ≤ limit.
 */
export type SettledResult<R> =
  | { status: 'fulfilled'; value: R }
  | { status: 'rejected'; reason: Error }

export interface PoolOptions {
  /** Số việc tối đa chạy cùng lúc. Mặc định 3. */
  limit?: number
  /** Gọi mỗi khi một việc kết thúc (dù thành công hay thất bại). */
  onProgress?: (done: number, total: number) => void
  /** Huỷ các việc CHƯA bắt đầu. Việc đang chạy vẫn chạy tới khi xong. */
  signal?: AbortSignal
}

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  { limit = 3, onProgress, signal }: PoolOptions = {},
): Promise<SettledResult<R>[]> {
  const results: SettledResult<R>[] = new Array(items.length)
  // Không tạo nhiều worker hơn số việc (5 file mà 10 worker là thừa 5 worker rỗng).
  const workerCount = Math.max(1, Math.min(limit, items.length))

  let next = 0     // con trỏ việc tiếp theo, DÙNG CHUNG cho mọi worker
  let done = 0

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = next++                 // đọc-và-tăng nguyên tử (đơn luồng)
      if (index >= items.length) return    // hết việc → worker nghỉ

      if (signal?.aborted) {
        results[index] = { status: 'rejected', reason: new Error('Đã huỷ.') }
      } else {
        try {
          results[index] = { status: 'fulfilled', value: await worker(items[index], index) }
        } catch (err) {
          results[index] = {
            status: 'rejected',
            reason: err instanceof Error ? err : new Error(String(err)),
          }
        }
      }

      done += 1
      onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker))
  return results
}

/**
 * Thử lại với backoff luỹ thừa + jitter.
 *
 * Vì sao cần jitter (nhiễu ngẫu nhiên): nếu 5 file cùng hỏng một lúc và cùng thử
 * lại sau ĐÚNG 400ms, chúng lại đâm vào nhau lần nữa (thundering herd). Cộng thêm
 * một lượng ngẫu nhiên sẽ dàn đều các lần thử lại.
 *
 * retries = 2 nghĩa là tối đa 3 lần chạy (1 lần đầu + 2 lần thử lại).
 */
export async function withRetry<R>(
  task: () => Promise<R>,
  { retries = 2, baseDelayMs = 400 }: { retries?: number; baseDelayMs?: number } = {},
): Promise<R> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task()
    } catch (err) {
      lastError = err
      if (attempt === retries) break
      const delay = baseDelayMs * 2 ** attempt + Math.random() * 100
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
