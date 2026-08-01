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

/**
 * Con trỏ trỏ tới dòng CUỐI của trang vừa tải — bộ ba khớp đúng thứ tự sắp xếp
 * của hàm SQL. `id` là khoá chính nên bộ ba là total ordering: kể cả hai hồ sơ
 * trùng cả điểm lẫn thời điểm tạo vẫn cắt được đúng một chỗ.
 */
interface Cursor { score: number; created_at: string; id: string }

export function useCandidateSearch(filters: SearchFilters) {
  const [rows, setRows] = useState<SearchRow[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** useRef chứ không useState: đổi con trỏ không cần render lại. */
  const cursorRef = useRef<Cursor | null>(null)

  /** Bỏ kết quả của request cũ khi người dùng gõ nhanh (chống race condition). */
  const requestIdRef = useRef(0)

  const fetchPage = useCallback(async (reset: boolean) => {
    const myRequestId = ++requestIdRef.current
    setLoading(true)
    setError(null)

    // reset = true → trang đầu (bỏ con trỏ); false → trang tiếp theo.
    const cursor = reset ? null : cursorRef.current

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
      // Bỏ trống cả ba = trang đầu tiên. Hàm SQL nhận default null cho tham số
      // vắng mặt, nên `undefined` (bị JSON.stringify loại bỏ) là đúng ý.
      p_cursor_score: cursor?.score,
      p_cursor_created_at: cursor?.created_at,
      p_cursor_id: cursor?.id,
      p_limit: PAGE_SIZE,
    })

    // Đã có request mới hơn → kết quả này đã lỗi thời, bỏ đi.
    if (myRequestId !== requestIdRef.current) return

    if (err) {
      setError(`Tìm kiếm thất bại: ${err.message}`)
      setLoading(false)
      return
    }

    const page = (data ?? []) as SearchRow[]

    // Trả về ít hơn PAGE_SIZE nghĩa là đã hết dữ liệu — rẻ hơn đếm tổng số dòng,
    // vì `count` tốn thêm một lượt quét bảng.
    setHasMore(page.length === PAGE_SIZE)

    // Ghi lại con trỏ = dòng CUỐI của trang này.
    if (page.length > 0) {
      const last = page[page.length - 1]
      cursorRef.current = { score: last.score, created_at: last.created_at, id: last.id }
    }

    setRows((prev) => {
      if (reset) return page
      // Chống trùng: con trỏ đã đảm bảo không lặp, nhưng vẫn lọc theo id cho chắc
      // — Realtime có thể đã chèn sẵn một dòng vào danh sách.
      const seen = new Set(prev.map((r) => r.id))
      return [...prev, ...page.filter((r) => !seen.has(r.id))]
    })

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

  // Bộ lọc đổi → về trang đầu, XOÁ con trỏ, debounce 300ms để không bắn request
  // mỗi phím gõ. Quên xoá con trỏ ở đây là kết quả mới bị nối vào danh sách cũ.
  useEffect(() => {
    const timer = setTimeout(() => {
      cursorRef.current = null
      setHasMore(true)
      void fetchPage(true)
    }, 300)
    return () => clearTimeout(timer)
    // Cố ý chỉ phụ thuộc filterKey — xem giải thích ở trên.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey])

  const loadMore = useCallback(() => {
    if (!loading && hasMore) void fetchPage(false)
  }, [loading, hasMore, fetchPage])

  return { rows, loading, hasMore, error, loadMore, reload: () => fetchPage(true) }
}
