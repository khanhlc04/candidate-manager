import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Alert } from './Alert'

interface Recommendation {
  id: string
  full_name: string
  applied_position: string
  status: string
  score: number
  matched_required: string[]
  missing_required: string[]
}

interface RecommendResponse {
  data: { evaluated: number; recommendations: Recommendation[] }
}

const splitSkills = (raw: string) => raw.split(',').map((s) => s.trim()).filter(Boolean)

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

export function RecommendPanel() {
  const [position, setPosition] = useState('Frontend Developer')
  const [requiredRaw, setRequiredRaw] = useState('react, typescript')
  const [result, setResult] = useState<RecommendResponse['data'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleRun() {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase.functions.invoke<RecommendResponse>('recommend', {
      body: { position, required_skills: splitSkills(requiredRaw), limit: 3 },
    })
    setLoading(false)
    if (err) { setError('Gọi /recommend thất bại.'); return }
    setResult(data?.data ?? null)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Gợi ý top 3 (Edge Function)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Quét <strong>toàn bộ</strong> kho hồ sơ trên server bằng thuật toán top-K, khác với bảng xếp
        hạng phía trên chỉ tính trên dữ liệu đang tải.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rc-position" className="block text-sm font-medium text-slate-700">Vị trí</label>
          <input id="rc-position" value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="rc-required" className="block text-sm font-medium text-slate-700">Kỹ năng bắt buộc</label>
          <input id="rc-required" value={requiredRaw} onChange={(e) => setRequiredRaw(e.target.value)} className={inputClass} />
        </div>
      </div>

      <button onClick={handleRun} disabled={loading || position.trim().length < 2}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60">
        {loading ? 'Đang gợi ý…' : 'Gợi ý 3 ứng viên'}
      </button>

      {error && <div className="mt-3"><Alert tone="error">{error}</Alert></div>}

      {result && (
        <>
          <p className="mt-3 text-xs text-slate-400">Đã quét {result.evaluated} hồ sơ trên server.</p>
          <ol className="mt-2 space-y-2">
            {result.recommendations.length === 0 && (
              <li className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                Không có ứng viên nào phù hợp.
              </li>
            )}
            {result.recommendations.map((r, i) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{i + 1}. {r.full_name}</p>
                  <p className="truncate text-xs text-slate-500">
                    Đủ: {r.matched_required.join(', ') || '—'}
                    {r.missing_required.length > 0 && (
                      <span className="text-red-500"> · Thiếu: {r.missing_required.join(', ')}</span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-700">
                  {r.score.toFixed(1)}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
