import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { CandidateStatus } from '../types/candidate'

export interface SearchFilters {
  /** Từ khoá tự do — chạy qua full-text search + tìm gần đúng. */
  query: string
  // Bốn tiêu chí lọc đề liệt kê, kết hợp được cùng lúc:
  name: string
  position: string
  statuses: CandidateStatus[]
  fromDate: string   // 'YYYY-MM-DD' từ <input type="date">
  toDate: string
}

export const EMPTY_FILTERS: SearchFilters = {
  query: '', name: '', position: '', statuses: [], fromDate: '', toDate: '',
}

/** Một dòng kết quả — đúng bằng RETURNS TABLE của hàm SQL. */
export interface SearchRow {
  id: string
  full_name: string
  applied_position: string
  status: string
  resume_url: string | null
  skills: string[]
  created_at: string
  score: number
}

const PAGE_SIZE = 10

export function useCandidateSearch(filters: SearchFilters) {
  const [rows, setRows] = useState<SearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Bỏ kết quả của request cũ khi người dùng gõ nhanh (chống race condition). */
  const requestIdRef = useRef(0)

  const fetchPage = useCallback(async () => {
    const myRequestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase.rpc('search_candidates', {
      p_query: filters.query.trim() || undefined,
      p_name: filters.name.trim() || undefined,
      p_position: filters.position.trim() || undefined,
      p_statuses: filters.statuses.length > 0 ? filters.statuses : undefined,
      p_from_date: filters.fromDate ? new Date(filters.fromDate).toISOString() : undefined,
      // Nửa mở [from, to): cộng 1 ngày để bao trọn cả ngày kết thúc.
      p_to_date: filters.toDate
        ? new Date(new Date(filters.toDate).getTime() + 86_400_000).toISOString()
        : undefined,
      p_limit: PAGE_SIZE,
    })

    // Đã có request mới hơn → kết quả này đã lỗi thời, bỏ đi.
    if (myRequestId !== requestIdRef.current) return

    if (err) {
      setError(`Tìm kiếm thất bại: ${err.message}`)
      setLoading(false)
      return
    }

    setRows((data ?? []) as SearchRow[])
    setLoading(false)
  }, [filters])

  /**
   * Khoá ổn định sinh từ NỘI DUNG bộ lọc, không phải định danh object.
   *
   * ⚠️ Nếu effect phụ thuộc thẳng vào `filters` mà component cha tạo object mới
   * mỗi lần render (rất dễ xảy ra: `const filters = { query, statuses, ... }`),
   * effect sẽ chạy lại liên tục → timer debounce bị reset mỗi render →
   * request KHÔNG BAO GIỜ được gửi đi. Đây là lỗi cực khó nhìn ra.
   */
  const filterKey = JSON.stringify([
    filters.query.trim(),
    filters.name.trim(),
    filters.position.trim(),
    [...filters.statuses].sort(),
    filters.fromDate,
    filters.toDate,
  ])

  // Bộ lọc đổi → tải lại, debounce 300ms để không bắn request mỗi phím gõ.
  useEffect(() => {
    const timer = setTimeout(() => { void fetchPage() }, 300)
    return () => clearTimeout(timer)
    // Cố ý chỉ phụ thuộc filterKey — xem giải thích ở trên.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  return { rows, loading, error, reload: fetchPage }
}
