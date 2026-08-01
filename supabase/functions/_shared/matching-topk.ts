/**
 * Ý #6 — Chọn K ứng viên phù hợp nhất, dùng lại engine chấm điểm của ý #5.
 *
 * File TÁCH RIÊNG khỏi matching.ts có lý do: matching.ts cố ý không import gì để
 * frontend (Vite) tái xuất được. File này import './stats.ts' với đuôi .ts theo
 * quy ước Deno, nên chỉ Edge Function dùng.
 */
import { topK } from './stats.ts'
import {
  scoreCandidate,
  type JobRequirement,
  type MatchableCandidate,
  type MatchResult,
} from './matching.ts'

/**
 * Lấy K ứng viên phù hợp nhất mà KHÔNG sort toàn bộ: O(n·K) thay vì O(n log n).
 *
 * `topK` chỉ đẩy phần tử lên khi điểm LỚN HƠN HẲN, nên phần tử bằng điểm giữ
 * nguyên thứ tự đầu vào. Do đó chỉ cần sắp đầu vào cho tất định TRƯỚC là kết quả
 * cũng tất định — kể cả khi người thứ K và K+1 bằng điểm nhau.
 */
export function topMatches<T extends MatchableCandidate>(
  candidates: readonly T[],
  job: JobRequirement,
  k: number,
  { now = Date.now() }: { now?: number } = {},
): MatchResult<T>[] {
  // Sắp đầu vào tất định: created_at giảm dần → id tăng dần.
  // Postgres KHÔNG cam kết thứ tự khi không có order by, nên không thể tin
  // thứ tự trả về từ .select().
  const ordered = [...candidates].sort((a, b) => {
    const aTime = Date.parse(a.created_at)
    const bTime = Date.parse(b.created_at)
    if (bTime !== aTime) return bTime - aTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const scored = ordered
    .map((candidate) => scoreCandidate(candidate, job, now))
    .filter((result) => result.score > 0) // Rejected có trọng số 0 → tự rơi ra

  return topK(scored, k, (result) => result.score)
}
