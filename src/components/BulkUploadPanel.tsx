import { useState } from 'react'
import { validateResumeFile } from '../lib/storage'
import { UPLOAD_CONCURRENCY, type BulkProgress, type NewCandidateInput } from '../hooks/useCandidates'
import type { SettledResult } from '../lib/concurrency'
import type { Candidate } from '../types/candidate'
import { Alert } from './Alert'

interface Props {
  onSubmit: (
    inputs: NewCandidateInput[],
    onProgress?: (p: BulkProgress) => void,
  ) => Promise<SettledResult<Candidate>[]>
}

export function BulkUploadPanel({ onSubmit }: Props) {
  const [files, setFiles] = useState<File[]>([])
  const [position, setPosition] = useState('')
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  /** Lọc file hợp lệ NGAY khi chọn — báo lỗi sớm, không tốn một request nào. */
  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    const bad: string[] = []
    const good = picked.filter((f) => {
      const check = validateResumeFile(f)
      if (!check.ok) { bad.push(check.reason); return false }
      return true
    })
    setFiles(good)
    setErrors(bad)
    setSummary(null)
  }

  async function handleRun() {
    if (files.length === 0 || !position.trim()) return
    setRunning(true); setSummary(null); setErrors([])
    const startedAt = performance.now()

    try {
      // Tên ứng viên tạm lấy từ tên file — thực tế sẽ đọc từ CV hoặc cho HR sửa sau.
      const inputs: NewCandidateInput[] = files.map((file) => ({
        full_name: file.name.replace(/\.pdf$/i, '').slice(0, 120) || 'Ứng viên chưa đặt tên',
        applied_position: position.trim(),
        status: 'New',
        skills: [],
        file,
      }))

      const results = await onSubmit(inputs, setProgress)
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.length - ok
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)

      setSummary(`Hoàn tất trong ${seconds}s — thành công ${ok}/${results.length}` +
                 (failed ? `, thất bại ${failed}` : ''))

      // results[i] tương ứng files[i] vì worker pool giữ nguyên thứ tự đầu vào.
      setErrors(
        results
          .map((r, i) => (r.status === 'rejected' ? `${files[i].name}: ${r.reason.message}` : null))
          .filter((x): x is string => x !== null),
      )
      if (failed === 0) setFiles([])
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Thêm hàng loạt</h2>
      <p className="mt-1 text-xs text-slate-500">
        Upload song song tối đa <strong>{UPLOAD_CONCURRENCY}</strong> file cùng lúc (worker pool),
        giao diện không bị treo.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bulk-position" className="block text-sm font-medium text-slate-700">
            Vị trí ứng tuyển (áp dụng cho tất cả)
          </label>
          <input id="bulk-position" value={position} onChange={(e) => setPosition(e.target.value)}
                 placeholder="Backend Developer"
                 className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20" />
        </div>
        <div>
          <label htmlFor="bulk-files" className="block text-sm font-medium text-slate-700">
            Chọn nhiều CV (PDF)
          </label>
          <input id="bulk-files" type="file" accept="application/pdf" multiple onChange={handlePick}
                 className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
        </div>
      </div>

      {files.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Đã chọn {files.length} file.</p>
      )}

      {progress && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">{progress.done}/{progress.total} — {pct}%</p>
        </div>
      )}

      {summary && <div className="mt-4"><Alert tone="success">{summary}</Alert></div>}
      {errors.length > 0 && (
        <div className="mt-3"><Alert tone="error">
          <ul className="list-inside list-disc space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </Alert></div>
      )}

      <button onClick={handleRun} disabled={running || files.length === 0 || !position.trim()}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
        {running ? `Đang tải lên… ${pct}%` : `Tải lên ${files.length || ''} hồ sơ`}
      </button>
    </section>
  )
}
