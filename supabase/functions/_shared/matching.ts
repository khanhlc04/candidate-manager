/**
 * Ý #5 — Thuật toán chấm điểm & sắp xếp theo MỨC ĐỘ PHÙ HỢP với một yêu cầu tuyển dụng.
 *
 * Khác với điểm liên quan của tìm kiếm (ý #1, chạy trong SQL bằng ts_rank + trigram),
 * engine này nhận một JD CÓ CẤU TRÚC và trả về điểm 0–100 kèm giải trình.
 *
 * Không import gì → dùng được ở cả Edge Function (Deno) lẫn frontend (Vite).
 */

// ---------------------------------------------------------------- kiểu dữ liệu

export interface JobRequirement {
  /** Tên vị trí cần tuyển, ví dụ "Frontend Developer". */
  position: string
  /** Kỹ năng bắt buộc — trọng số gấp đôi kỹ năng ưu tiên. */
  requiredSkills: string[]
  /** Kỹ năng ưu tiên (nice to have). */
  preferredSkills?: string[]
  /** Nửa đời của độ mới, tính bằng ngày. Mặc định 30. */
  recencyHalfLifeDays?: number
}

/** Phần dữ liệu tối thiểu engine cần — khớp với cả row DB lẫn kết quả tìm kiếm. */
export interface MatchableCandidate {
  id: string
  full_name: string
  applied_position: string
  status: string
  skills: string[] | null
  created_at: string
}

export interface MatchBreakdown {
  /** Bao phủ kỹ năng có trọng số — thành phần chính. */
  skillCoverage: number
  positionSimilarity: number
  pipelineStage: number
  recency: number
  /**
   * Jaccard giữa kỹ năng ứng viên và kỹ năng JD — CHỈ SỐ PHỤ để đối chiếu.
   * Cố ý không dùng làm điểm chính: Jaccard đối xứng nên phạt oan ứng viên có
   * nhiều kỹ năng ngoài JD. Xem README.
   */
  jaccard: number
}

export interface MatchResult<T> {
  candidate: T
  /** Thang 0–100, làm tròn 1 chữ số thập phân. */
  score: number
  breakdown: MatchBreakdown
  matchedRequired: string[]
  missingRequired: string[]
  matchedPreferred: string[]
}

// ------------------------------------------------------------------ hằng số

const WEIGHTS = {
  skills: 0.45,
  position: 0.25,
  pipeline: 0.15,
  recency: 0.15,
} as const

/**
 * Trọng số theo giai đoạn tuyển dụng — heuristic nghiệp vụ, gom MỘT chỗ để dễ chỉnh.
 * Rejected = 0 khiến ứng viên đã loại tự rơi khỏi kết quả mà không cần lọc riêng.
 */
const PIPELINE_WEIGHT: Record<string, number> = {
  Interviewing: 1.0,
  New: 0.7,
  Hired: 0.15,
  Rejected: 0,
}

const DEFAULT_HALF_LIFE_DAYS = 30
const MS_PER_DAY = 86_400_000

// ------------------------------------------------------------- hàm phụ trợ

const normalize = (value: string): string => value.trim().toLowerCase()

const toSkillSet = (skills: readonly string[] | null | undefined): Set<string> =>
  new Set((skills ?? []).map(normalize).filter(Boolean))

/** Đếm phần giao, luôn duyệt tập NHỎ hơn để giảm số lần tra cứu. */
function intersectionSize(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let count = 0
  for (const item of small) if (large.has(item)) count += 1
  return count
}

/**
 * Bao phủ có trọng số: "ứng viên đáp ứng được bao nhiêu phần của YÊU CẦU".
 *
 *   coverage = (2·|bắt_buộc ∩ cand| + 1·|ưu_tiên ∩ cand|)
 *            / (2·|bắt_buộc|        + 1·|ưu_tiên|)
 *
 * Bất đối xứng theo phía yêu cầu — cố ý khác Jaccard, vốn chia cho HỢP và do đó
 * phạt oan ứng viên có thêm kỹ năng ngoài JD.
 */
function weightedCoverage(
  candidateSkills: Set<string>,
  required: Set<string>,
  preferred: Set<string>,
): number {
  const denominator = 2 * required.size + preferred.size
  if (denominator === 0) return 0
  const numerator =
    2 * intersectionSize(candidateSkills, required) +
    intersectionSize(candidateSkills, preferred)
  return numerator / denominator
}

/** Jaccard |A∩B| / |A∪B| — chỉ số phụ, chỉ để hiển thị trong breakdown. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const inter = intersectionSize(a, b)
  return inter / (a.size + b.size - inter)
}

/**
 * Hệ số Dice trên tập từ của tên vị trí: 2·|A∩B| / (|A|+|B|).
 *
 * Dice = 2J/(1+J) nên nhấn phần giao mạnh hơn Jaccard — hợp lý khi so hai cụm từ
 * ngắn 2–3 chữ, nơi một từ chung ("Frontend") đã là tín hiệu đáng kể.
 */
function positionSimilarity(candidatePosition: string, wanted: string): number {
  const a = normalize(candidatePosition)
  const b = normalize(wanted)
  if (!a || !b) return 0
  if (a === b) return 1                     // đường tắt cho trường hợp trùng khít

  const wordsA = new Set(a.split(/\s+/).filter(Boolean))
  const wordsB = new Set(b.split(/\s+/).filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  return (2 * intersectionSize(wordsA, wordsB)) / (wordsA.size + wordsB.size)
}

/** Phân rã mũ theo nửa đời: sau `halfLifeDays` ngày, điểm còn đúng một nửa. */
function recencyScore(createdAt: string, halfLifeDays: number, now: number): number {
  const created = Date.parse(createdAt)
  if (Number.isNaN(created)) return 0
  const ageDays = Math.max(0, (now - created) / MS_PER_DAY)
  return 0.5 ** (ageDays / Math.max(1, halfLifeDays))
}

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

// ------------------------------------------------------------- chấm điểm

/** Chấm điểm phù hợp của MỘT ứng viên với MỘT yêu cầu tuyển dụng. O(k). */
export function scoreCandidate<T extends MatchableCandidate>(
  candidate: T,
  job: JobRequirement,
  now: number = Date.now(),
): MatchResult<T> {
  const candidateSkills = toSkillSet(candidate.skills)
  const required = toSkillSet(job.requiredSkills)
  const preferred = toSkillSet(job.preferredSkills)

  const coverage = weightedCoverage(candidateSkills, required, preferred)
  const position = positionSimilarity(candidate.applied_position, job.position)
  // Trạng thái lạ (dữ liệu bẩn) → 0.5, không thưởng cũng không phạt.
  const pipeline = PIPELINE_WEIGHT[candidate.status] ?? 0.5
  const recency = recencyScore(
    candidate.created_at,
    job.recencyHalfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
    now,
  )

  // Chuẩn hoá lại trọng số: nếu JD không nêu kỹ năng nào thì thành phần bao phủ
  // vô nghĩa — bỏ nó ra và chia cho tổng trọng số CÒN LẠI, thay vì để mọi ứng
  // viên mất 45% điểm một cách vô lý. Nhờ vậy điểm luôn thuộc [0,1] và so sánh
  // được giữa các JD khác nhau.
  const parts: Array<readonly [number, number]> = [
    [WEIGHTS.position, position],
    [WEIGHTS.pipeline, pipeline],
    [WEIGHTS.recency, recency],
  ]
  if (required.size + preferred.size > 0) parts.push([WEIGHTS.skills, coverage])

  const totalWeight = parts.reduce((sum, [weight]) => sum + weight, 0)
  const weighted = parts.reduce((sum, [weight, value]) => sum + weight * value, 0) / totalWeight

  // Trọng số giai đoạn bằng 0 là tín hiệu LOẠI THẲNG, không phải "chỉ mất 15% điểm".
  // Điểm là TỔNG CÓ TRỌNG SỐ, nên nếu không chặn ở đây thì một ứng viên Rejected
  // hồ sơ đẹp vẫn được 0.45 + 0.25 + 0.15 = 85 điểm và vẫn lọt vào bảng xếp hạng.
  // Nhân "cổng" này vào giữ đúng thiết kế đã nêu — chính sách vẫn nằm gọn trong
  // PIPELINE_WEIGHT: đổi Rejected thành 0.1 là chuyển từ loại thẳng sang chỉ bị phạt.
  const raw = pipeline === 0 ? 0 : weighted

  return {
    candidate,
    score: round(raw * 100, 1),
    breakdown: {
      skillCoverage: round(coverage, 3),
      positionSimilarity: round(position, 3),
      pipelineStage: round(pipeline, 3),
      recency: round(recency, 3),
      jaccard: round(jaccard(candidateSkills, new Set([...required, ...preferred])), 3),
    },
    matchedRequired: [...required].filter((s) => candidateSkills.has(s)),
    missingRequired: [...required].filter((s) => !candidateSkills.has(s)),
    matchedPreferred: [...preferred].filter((s) => candidateSkills.has(s)),
  }
}

// ------------------------------------------------------------- sắp xếp

/**
 * So sánh tất định: score giảm dần → created_at giảm dần → id tăng dần.
 * Bộ ba này là TOTAL ORDERING (id là khoá chính) nên cùng đầu vào luôn cho cùng
 * thứ tự, không phụ thuộc việc engine sort của JS có ổn định hay không.
 */
export function compareMatch<T extends MatchableCandidate>(
  a: MatchResult<T>,
  b: MatchResult<T>,
): number {
  if (b.score !== a.score) return b.score - a.score

  const aTime = Date.parse(a.candidate.created_at)
  const bTime = Date.parse(b.candidate.created_at)
  if (bTime !== aTime) return bTime - aTime

  return a.candidate.id < b.candidate.id ? -1 : a.candidate.id > b.candidate.id ? 1 : 0
}

export interface RankOptions {
  /** Giữ cả ứng viên 0 điểm (mặc định loại bỏ). */
  includeZero?: boolean
  /** Mốc thời gian dùng để tính độ mới — truyền vào để test tất định. */
  now?: number
}

/**
 * Xếp hạng TOÀN BỘ danh sách theo mức độ phù hợp.
 * O(n·k) chấm điểm + O(n log n) sắp xếp.
 */
export function rankByMatch<T extends MatchableCandidate>(
  candidates: readonly T[],
  job: JobRequirement,
  { includeZero = false, now = Date.now() }: RankOptions = {},
): MatchResult<T>[] {
  const scored = candidates.map((candidate) => scoreCandidate(candidate, job, now))
  const kept = includeZero ? scored : scored.filter((result) => result.score > 0)
  return kept.sort(compareMatch)
}
