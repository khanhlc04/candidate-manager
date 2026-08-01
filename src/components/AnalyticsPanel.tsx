import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL, type CandidateStatus } from '../types/candidate'
import { Alert } from './Alert'

interface Analytics {
  total: number
  statusBreakdown: { status: CandidateStatus; count: number; percentage: number }[]
  topPositions: { position: string; count: number; percentage: number }[]
  recentCount: number
  distinctPositions: number
}

export function AnalyticsPanel({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Analytics | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data: res, error: err } = await supabase.functions.invoke<{ data: Analytics }>('analytics')
    if (err) { setError('Không tải được thống kê.'); return }
    setError(null)
    setData(res?.data ?? null)
  }, [])

  // refreshKey đổi mỗi khi danh sách thay đổi → thống kê luôn khớp bảng bên dưới.
  useEffect(() => { void load() }, [load, refreshKey])

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return null

  return (
    <section className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Tổng ứng viên</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{data.total}</p>
        <p className="mt-1 text-xs text-slate-500">{data.recentCount} hồ sơ mới trong 7 ngày</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Tỷ lệ trạng thái</p>
        <ul className="mt-2 space-y-1 text-sm">
          {data.statusBreakdown.map((s) => (
            <li key={s.status} className="flex justify-between">
              <span className="text-slate-600">{STATUS_LABEL[s.status]}</span>
              <span className="font-medium text-slate-900">{s.count} ({s.percentage}%)</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Top 3 vị trí <span className="normal-case text-slate-400">({data.distinctPositions} vị trí)</span>
        </p>
        <ol className="mt-2 space-y-1 text-sm">
          {data.topPositions.length === 0 && <li className="text-slate-400">Chưa có dữ liệu</li>}
          {data.topPositions.map((p, i) => (
            <li key={p.position} className="flex justify-between gap-2">
              <span className="truncate text-slate-600">{i + 1}. {p.position}</span>
              <span className="shrink-0 font-medium text-slate-900">{p.count}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
