import { useEffect, useState } from 'react'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Candidate } from '../types/candidate'

export type RealtimeStatus = 'connecting' | 'live' | 'error' | 'idle'

interface Options {
  userId: string | undefined
  /** Thêm-hoặc-thay-thế theo id (idempotent) — dùng cho INSERT và UPDATE. */
  onUpsert: (row: Candidate) => void
  /** Gỡ khỏi danh sách theo id — dùng cho DELETE. */
  onRemove: (id: string) => void
}

/**
 * Đồng bộ danh sách ứng viên theo thời gian thực.
 *
 * RLS được Realtime áp dụng tự động: mỗi event được kiểm tra với policy của
 * chính người đang subscribe, nên user chỉ nhận thay đổi trên dữ liệu của mình.
 * Không cần lọc thêm ở client.
 */
export function useRealtimeCandidates({ userId, onUpsert, onRemove }: Options): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('idle')

  useEffect(() => {
    if (!userId) {
      setStatus('idle')
      return
    }

    setStatus('connecting')

    // Tên channel gắn userId: đổi tài khoản sẽ tạo channel mới thay vì
    // dùng lại channel cũ mang token cũ.
    const channel = supabase
      .channel(`candidates:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'candidates' },
        (payload: RealtimePostgresChangesPayload<Candidate>) => {
          switch (payload.eventType) {
            case 'INSERT':
            case 'UPDATE':
              // onUpsert hợp nhất theo id nên gọi lại với dòng đã có
              // cũng không tạo bản trùng.
              onUpsert(payload.new as Candidate)
              break

            case 'DELETE': {
              // Khi RLS bật, payload.old của DELETE chỉ chứa khoá chính.
              // Như vậy là đủ để gỡ dòng khỏi danh sách.
              const removedId = (payload.old as Partial<Candidate>)?.id
              if (removedId) onRemove(removedId)
              break
            }
          }
        },
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === 'SUBSCRIBED') setStatus('live')
        else if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT') {
          setStatus('error')
        }
      })

    // Dọn dẹp: bắt buộc, nếu không StrictMode sẽ để lại 2 subscription
    // và mỗi event bị xử lý 2 lần.
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, onUpsert, onRemove])

  return status
}
