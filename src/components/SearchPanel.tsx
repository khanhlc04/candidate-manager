import { useState } from 'react'
import { EMPTY_FILTERS, useCandidateSearch, type SearchFilters } from '../hooks/useCandidateSearch'
import { CANDIDATE_STATUSES, STATUS_LABEL, type CandidateStatus } from '../types/candidate'
import { StatusBadge } from './StatusBadge'
import { Alert } from './Alert'

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

export function SearchPanel() {
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS)
  const { rows, loading, error } = useCandidateSearch(filters)

  const patch = (next: Partial<SearchFilters>) => setFilters((prev) => ({ ...prev, ...next }))

  const toggleStatus = (status: CandidateStatus) =>
    patch({
      statuses: filters.statuses.includes(status)
        ? filters.statuses.filter((s) => s !== status)
        : [...filters.statuses, status],
    })

  const isFiltered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-900">Tìm kiếm nâng cao</h2>
        {isFiltered && (
          <button onClick={() => setFilters(EMPTY_FILTERS)}
                  className="text-xs text-slate-500 underline hover:text-slate-700">
            Xoá bộ lọc
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Full-text (<code>tsvector</code>) + tìm gần đúng (<code>pg_trgm</code>), xếp theo điểm liên quan.
        Gõ sai chính tả vẫn ra kết quả.
      </p>

      {/* --- từ khoá tự do --- */}
      <div className="mt-4">
        <label htmlFor="s-query" className="block text-sm font-medium text-slate-700">
          Từ khoá (tên · vị trí · kỹ năng)
        </label>
        <input id="s-query" value={filters.query} onChange={(e) => patch({ query: e.target.value })}
               placeholder="frontend, react, Nguyễn…" className={inputClass} />
      </div>

      {/* --- 4 tiêu chí lọc --- */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="s-name" className="block text-sm font-medium text-slate-700">Tên</label>
          <input id="s-name" value={filters.name} onChange={(e) => patch({ name: e.target.value })}
                 className={inputClass} />
        </div>
        <div>
          <label htmlFor="s-position" className="block text-sm font-medium text-slate-700">Vị trí</label>
          <input id="s-position" value={filters.position} onChange={(e) => patch({ position: e.target.value })}
                 className={inputClass} />
        </div>
        <div>
          <label htmlFor="s-from" className="block text-sm font-medium text-slate-700">Nộp từ ngày</label>
          <input id="s-from" type="date" value={filters.fromDate}
                 onChange={(e) => patch({ fromDate: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor="s-to" className="block text-sm font-medium text-slate-700">Đến ngày</label>
          <input id="s-to" type="date" value={filters.toDate}
                 onChange={(e) => patch({ toDate: e.target.value })} className={inputClass} />
        </div>
      </div>

      {/* --- trạng thái: chọn nhiều --- */}
      <div className="mt-3">
        <span className="block text-sm font-medium text-slate-700">Trạng thái</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {CANDIDATE_STATUSES.map((status) => {
            const active = filters.statuses.includes(status)
            return (
              <button key={status} type="button" onClick={() => toggleStatus(status)}
                      aria-pressed={active}
                      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition ${
                        active
                          ? 'bg-brand-600 text-white ring-brand-600'
                          : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                      }`}>
                {STATUS_LABEL[status]}
              </button>
            )
          })}
        </div>
      </div>

      {/* --- kết quả --- */}
      {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}

      <ol className="mt-4 space-y-2">
        {!loading && rows.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            Không có hồ sơ nào khớp.
          </li>
        )}
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{row.full_name}</p>
              <p className="truncate text-xs text-slate-500">
                {row.applied_position}
                {row.skills.length > 0 && <> · {row.skills.join(', ')}</>}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge status={row.status as CandidateStatus} />
              {/* Điểm liên quan — hiện ra để chứng minh có xếp hạng thật, không phải sắp theo ngày */}
              <span className="w-14 text-right text-xs tabular-nums text-slate-500" title="Điểm liên quan">
                {row.score.toFixed(4)}
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-xs text-slate-400">
        {loading ? 'Đang tìm…' : `${rows.length} kết quả`}
      </p>
    </section>
  )
}
