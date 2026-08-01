import type { Database } from './database.types'

/** Kiểu một dòng trong bảng candidates, suy ra trực tiếp từ schema database. */
export type Candidate = Database['public']['Tables']['candidates']['Row']

export const CANDIDATE_STATUSES = ['New', 'Interviewing', 'Hired', 'Rejected'] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

/** Thứ tự chuyển trạng thái mặc định khi bấm nút "chuyển tiếp". */
export const NEXT_STATUS: Record<CandidateStatus, CandidateStatus> = {
  New: 'Interviewing',
  Interviewing: 'Hired',
  Hired: 'Hired',
  Rejected: 'Rejected',
}

export const STATUS_LABEL: Record<CandidateStatus, string> = {
  New: 'Mới',
  Interviewing: 'Đang phỏng vấn',
  Hired: 'Đã tuyển',
  Rejected: 'Từ chối',
}
