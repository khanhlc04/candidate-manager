import { useMemo, useState } from 'react'
import { rankByMatch, type JobRequirement } from '../lib/matching'
import type { Candidate, CandidateStatus } from '../types/candidate'
import { StatusBadge } from './StatusBadge'

const splitSkills = (raw: string): string[] =>
  raw.split(',').map((s) => s.trim()).filter(Boolean)

const inputClass =
  'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

export function JobMatchPanel({ candidates }: { candidates: Candidate[] }) {
  const [position, setPosition] = useState('Frontend Developer')
  const [requiredRaw, setRequiredRaw] = useState('react, typescript')
  const [preferredRaw, setPreferredRaw] = useState('tailwind, vite')

  const job: JobRequirement = useMemo(
    () => ({
      position,
      requiredSkills: splitSkills(requiredRaw),
      preferredSkills: splitSkills(preferredRaw),
    }),
    [position, requiredRaw, preferredRaw],
  )

  // Chấm điểm chạy hoàn toàn ở client trên dữ liệu đã tải sẵn → phản hồi tức thì,
  // không tốn một request nào. useMemo tránh tính lại khi component render vì lý do khác.
  const ranked = useMemo(() => rankByMatch(candidates, job), [candidates, job])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Xếp hạng theo mức độ phù hợp</h2>
      <p className="mt-1 text-xs text-slate-500">
        Điểm = 45% bao phủ kỹ năng + 25% khớp vị trí + 15% giai đoạn tuyển dụng + 15% độ mới.
        Tính tại chỗ, không gọi server.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="jd-position" className="block text-sm font-medium text-slate-700">Vị trí</label>
          <input id="jd-position" value={position} onChange={(e) => setPosition(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="jd-required" className="block text-sm font-medium text-slate-700">
            Kỹ năng bắt buộc <span className="text-slate-400">(×2)</span>
          </label>
          <input id="jd-required" value={requiredRaw} onChange={(e) => setRequiredRaw(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="jd-preferred" className="block text-sm font-medium text-slate-700">Kỹ năng ưu tiên</label>
          <input id="jd-preferred" value={preferredRaw} onChange={(e) => setPreferredRaw(e.target.value)} className={inputClass} />
        </div>
      </div>

      <ol className="mt-4 space-y-2">
        {ranked.length === 0 && (
          <li className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
            Không có ứng viên nào phù hợp với yêu cầu này.
          </li>
        )}
        {ranked.map((result, index) => (
          <li key={result.candidate.id} className="rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {index + 1}. {result.candidate.full_name}
                </p>
                <p className="truncate text-xs text-slate-500">{result.candidate.applied_position}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={result.candidate.status as CandidateStatus} />
                <span className="w-14 text-right text-sm font-semibold tabular-nums text-brand-700">
                  {result.score.toFixed(1)}
                </span>
              </div>
            </div>

            {/* Thanh giải trình: mỗi màu là một thành phần, bề rộng = đóng góp thực tế
                vào điểm cuối. Di chuột lên để xem tên thành phần. */}
            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-brand-600" style={{ width: `${result.breakdown.skillCoverage * 45}%` }} title="Kỹ năng" />
              <div className="bg-brand-500" style={{ width: `${result.breakdown.positionSimilarity * 25}%` }} title="Vị trí" />
              <div className="bg-amber-400" style={{ width: `${result.breakdown.pipelineStage * 15}%` }} title="Giai đoạn" />
              <div className="bg-slate-400" style={{ width: `${result.breakdown.recency * 15}%` }} title="Độ mới" />
            </div>

            <p className="mt-1.5 text-xs text-slate-500">
              Đủ: {result.matchedRequired.join(', ') || '—'}
              {result.missingRequired.length > 0 && (
                <span className="text-red-500"> · Thiếu: {result.missingRequired.join(', ')}</span>
              )}
              <span className="text-slate-400"> · Jaccard {result.breakdown.jaccard}</span>
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
