import { useCallback, useEffect, useState } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { removeResume, uploadResume } from '../lib/storage'
import { runWithConcurrency, withRetry, type SettledResult } from '../lib/concurrency'
import type { Candidate, CandidateStatus } from '../types/candidate'

export const UPLOAD_CONCURRENCY = 3   // giới hạn N file cùng lúc

export interface BulkProgress { done: number; total: number }

export interface NewCandidateInput {
  full_name: string
  applied_position: string
  status: CandidateStatus
  skills: string[]
  file: File | null
}

/**
 * Bóc thông báo lỗi thật từ Edge Function.
 *
 * Khi function trả 4xx/5xx, supabase-js chỉ đưa message chung chung
 * ("Edge Function returned a non-2xx status code"). Nội dung thật nằm trong
 * error.context và phải đọc bằng .json().
 */
async function readFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string; details?: string[] }
      if (body.details?.length) return body.details.join(' ')
      if (body.error) return body.error
    } catch {
      /* body không phải JSON — rơi xuống dưới */
    }
  }
  return error instanceof Error ? error.message : 'Đã có lỗi xảy ra.'
}

export function useCandidates(userId: string | undefined) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---------------------------------------------------------------- đọc dữ liệu
  const refresh = useCallback(async () => {
    setError(null)
    // Không cần .eq('user_id', ...) — RLS đã lọc sẵn ở phía database.
    const { data, error: err } = await supabase
      .from('candidates')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })   // phá hoà khi created_at trùng nhau

    if (err) setError(`Không tải được danh sách: ${err.message}`)
    else setCandidates(data ?? [])

    setLoading(false)
  }, [])

  useEffect(() => {
    if (!userId) {
      setCandidates([])
      setLoading(false)
      return
    }
    setLoading(true)
    void refresh()
  }, [userId, refresh])

  // ------------------------------------------------- hoà giải state (Realtime dùng ở bước 7)
  /** Thêm-hoặc-thay-thế theo id. Idempotent → gọi nhiều lần vẫn ra một kết quả. */
  const upsertLocal = useCallback((row: Candidate) => {
    setCandidates((prev) => {
      const idx = prev.findIndex((c) => c.id === row.id)
      if (idx === -1) {
        return [row, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at))
      }
      const next = [...prev]
      next[idx] = row
      return next
    })
  }, [])

  const removeLocal = useCallback((id: string) => {
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }, [])

  // ---------------------------------------------------------------- tạo hồ sơ
  /**
   * Luồng 2 bước: upload file lên Storage → gọi Edge Function để ghi bản ghi.
   * Nếu bước 2 hỏng, xoá file vừa upload để không để lại "file mồ côi".
   */
  const createCandidate = useCallback(
    async (input: NewCandidateInput): Promise<Candidate> => {
      if (!userId) throw new Error('Chưa đăng nhập.')

      let uploadedPath: string | null = null
      if (input.file) {
        uploadedPath = await uploadResume(input.file, userId)
      }

      try {
        const { data, error: fnError } = await supabase.functions.invoke<{ data: Candidate }>(
          'create-candidate',
          {
            body: {
              full_name: input.full_name,
              applied_position: input.applied_position,
              status: input.status,
              skills: input.skills,
              resume_url: uploadedPath,
            },
          },
        )

        if (fnError) throw new Error(await readFunctionError(fnError))
        if (!data?.data) throw new Error('Edge Function trả về dữ liệu không hợp lệ.')

        // Cập nhật ngay để UI phản hồi tức thì; nếu Realtime bắn event trùng,
        // upsertLocal ghép theo id nên không bị nhân đôi.
        upsertLocal(data.data)
        return data.data
      } catch (err) {
        if (uploadedPath) await removeResume(uploadedPath).catch(() => {})
        throw err
      }
    },
    [userId, upsertLocal],
  )

  // ------------------------------------------------------- thêm hàng loạt (ý #3)
  /**
   * Thêm nhiều hồ sơ cùng lúc, upload tối đa UPLOAD_CONCURRENCY file song song.
   * Một hồ sơ hỏng không làm hỏng cả lô — trả về kết quả từng phần.
   */
  const createManyCandidates = useCallback(
    async (
      inputs: NewCandidateInput[],
      onProgress?: (p: BulkProgress) => void,
    ): Promise<SettledResult<Candidate>[]> => {
      if (!userId) throw new Error('Chưa đăng nhập.')

      return runWithConcurrency(
        inputs,
        // Mỗi "việc" = upload file + gọi Edge Function, có thử lại 1 lần nếu lỗi.
        (input) => withRetry(() => createCandidate(input), { retries: 1 }),
        {
          limit: UPLOAD_CONCURRENCY,
          onProgress: (done, total) => onProgress?.({ done, total }),
        },
      )
    },
    [userId, createCandidate],
  )

  // ------------------------------------------------------------ đổi trạng thái
  /** Optimistic update: đổi UI ngay, hỏng thì trả về giá trị cũ. */
  const updateStatus = useCallback(
    async (id: string, nextStatus: CandidateStatus) => {
      let previous: CandidateStatus | undefined

      setCandidates((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c
          previous = c.status as CandidateStatus
          return { ...c, status: nextStatus }
        }),
      )

      const { error: err } = await supabase
        .from('candidates')
        .update({ status: nextStatus })
        .eq('id', id)          // RLS tự giới hạn trong phạm vi hồ sơ của mình

      if (err) {
        // Rollback
        if (previous !== undefined) {
          setCandidates((prev) =>
            prev.map((c) => (c.id === id ? { ...c, status: previous! } : c)),
          )
        }
        throw new Error(`Cập nhật trạng thái thất bại: ${err.message}`)
      }
    },
    [],
  )

  // ------------------------------------------------------------------ xoá hồ sơ
  const deleteCandidate = useCallback(
    async (candidate: Candidate) => {
      const snapshot = candidate
      removeLocal(candidate.id)   // optimistic

      const { error: err } = await supabase.from('candidates').delete().eq('id', candidate.id)
      if (err) {
        upsertLocal(snapshot)     // rollback
        throw new Error(`Xoá thất bại: ${err.message}`)
      }

      // Dọn file CV kèm theo. Lỗi ở đây không nên làm hỏng thao tác chính.
      if (candidate.resume_url) await removeResume(candidate.resume_url).catch(() => {})
    },
    [removeLocal, upsertLocal],
  )

  return {
    candidates,
    loading,
    error,
    refresh,
    createCandidate,
    createManyCandidates,   // ý #3 — thêm hàng loạt
    updateStatus,
    deleteCandidate,
    upsertLocal,   // bước 7 (Realtime) dùng
    removeLocal,   // bước 7 (Realtime) dùng
  }
}
