/**
 * Validate dữ liệu tạo hồ sơ ứng viên.
 * Tách riêng khỏi handler HTTP để dễ đọc, dễ tái sử dụng và dễ kiểm thử.
 */

export const CANDIDATE_STATUSES = ['New', 'Interviewing', 'Hired', 'Rejected'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

export interface CreateCandidateInput {
  full_name: string
  applied_position: string
  status: CandidateStatus
  resume_url: string | null
  skills: string[]
}

export type ValidationResult =
  | { ok: true; value: CreateCandidateInput }
  | { ok: false; errors: string[] }

/** Chuẩn hoá: ép về chuỗi, cắt khoảng trắng, gộp khoảng trắng liên tiếp. */
function normalizeText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : ''
}

/**
 * Object path trong Storage phải đúng dạng "<uuid>/<uuid>.pdf" VÀ thư mục cấp 1
 * phải trùng user đang gọi. Nếu không kiểm tra, user A có thể gắn hồ sơ của mình
 * vào file CV của user B (dù RLS của Storage sẽ chặn lúc tải, dữ liệu vẫn bẩn).
 */
const RESUME_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f-]{36}\.pdf$/i

export function validateCreateCandidate(body: unknown, userId: string): ValidationResult {
  const errors: string[] = []

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, errors: ['Body phải là một JSON object.'] }
  }
  const input = body as Record<string, unknown>

  // --- full_name ---
  const fullName = normalizeText(input.full_name)
  if (fullName.length < 2 || fullName.length > 120) {
    errors.push('full_name phải có từ 2 đến 120 ký tự.')
  }

  // --- applied_position ---
  const position = normalizeText(input.applied_position)
  if (position.length < 2 || position.length > 120) {
    errors.push('applied_position phải có từ 2 đến 120 ký tự.')
  }

  // --- status (không truyền thì mặc định 'New') ---
  const rawStatus = input.status === undefined || input.status === null ? 'New' : input.status
  if (!CANDIDATE_STATUSES.includes(rawStatus as CandidateStatus)) {
    errors.push(`status phải là một trong: ${CANDIDATE_STATUSES.join(', ')}.`)
  }

  // --- resume_url (object path, có thể null) ---
  let resumeUrl: string | null = null
  if (input.resume_url !== undefined && input.resume_url !== null && input.resume_url !== '') {
    if (typeof input.resume_url !== 'string' || !RESUME_PATH_RE.test(input.resume_url)) {
      errors.push('resume_url phải là object path dạng "<user_id>/<uuid>.pdf".')
    } else if (!input.resume_url.startsWith(`${userId}/`)) {
      // Chống gắn hồ sơ vào file CV của người khác.
      errors.push('resume_url phải nằm trong thư mục của chính bạn.')
    } else {
      resumeUrl = input.resume_url
    }
  }

  // --- skills ---
  let skills: string[] = []
  if (input.skills !== undefined && input.skills !== null) {
    if (!Array.isArray(input.skills)) {
      errors.push('skills phải là một mảng chuỗi.')
    } else if (input.skills.length > 30) {
      errors.push('Tối đa 30 kỹ năng.')
    } else {
      // Chuẩn hoá: chữ thường, bỏ trùng, bỏ rỗng, giới hạn độ dài từng phần tử.
      skills = [
        ...new Set(
          input.skills
            .map((s) => normalizeText(s).toLowerCase())
            .filter((s) => s.length > 0 && s.length <= 40),
        ),
      ]
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      full_name: fullName,
      applied_position: position,
      status: rawStatus as CandidateStatus,
      resume_url: resumeUrl,
      skills,
    },
  }
}
