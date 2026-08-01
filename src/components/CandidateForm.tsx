import { useRef, useState, type FormEvent } from 'react'
import { validateResumeFile } from '../lib/storage'
import { CANDIDATE_STATUSES, STATUS_LABEL, type CandidateStatus } from '../types/candidate'
import type { NewCandidateInput } from '../hooks/useCandidates'
import { Alert } from './Alert'

interface Props {
  onSubmit: (input: NewCandidateInput) => Promise<unknown>
}

export function CandidateForm({ onSubmit }: Props) {
  const [fullName, setFullName] = useState('')
  const [position, setPosition] = useState('')
  const [status, setStatus] = useState<CandidateStatus>('New')
  const [skillsRaw, setSkillsRaw] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null)
    const picked = e.target.files?.[0] ?? null
    if (!picked) { setFile(null); return }

    // Kiểm tra ngay khi chọn để báo lỗi sớm, thay vì đợi tới lúc bấm Thêm.
    const check = validateResumeFile(picked)
    if (!check.ok) {
      setError(check.reason)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setFile(picked)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      await onSubmit({
        full_name: fullName,
        applied_position: position,
        status,
        skills: skillsRaw.split(',').map((s) => s.trim()).filter(Boolean),
        file,
      })
      // Reset form
      setFullName(''); setPosition(''); setStatus('New'); setSkillsRaw(''); setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setSuccess('Đã thêm hồ sơ ứng viên.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thêm được hồ sơ.')
    } finally {
      setSubmitting(false)
    }
  }

  const inputClass =
    'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">Thêm hồ sơ ứng viên</h2>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-slate-700">
            Họ và tên <span className="text-red-500">*</span>
          </label>
          <input id="full_name" required minLength={2} maxLength={120} value={fullName}
                 onChange={(e) => setFullName(e.target.value)}
                 className={inputClass} placeholder="Nguyễn Văn A" />
        </div>

        <div>
          <label htmlFor="position" className="block text-sm font-medium text-slate-700">
            Vị trí ứng tuyển <span className="text-red-500">*</span>
          </label>
          <input id="position" required minLength={2} maxLength={120} value={position}
                 onChange={(e) => setPosition(e.target.value)}
                 className={inputClass} placeholder="Frontend Developer" />
        </div>

        <div>
          <label htmlFor="status" className="block text-sm font-medium text-slate-700">Trạng thái</label>
          <select id="status" value={status}
                  onChange={(e) => setStatus(e.target.value as CandidateStatus)}
                  className={inputClass}>
            {CANDIDATE_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="skills" className="block text-sm font-medium text-slate-700">
            Kỹ năng <span className="text-slate-400">(phân cách bằng dấu phẩy)</span>
          </label>
          <input id="skills" value={skillsRaw} onChange={(e) => setSkillsRaw(e.target.value)}
                 className={inputClass} placeholder="react, typescript, tailwind" />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="resume" className="block text-sm font-medium text-slate-700">
            File CV <span className="text-slate-400">(PDF, tối đa 5 MB)</span>
          </label>
          <input id="resume" ref={fileInputRef} type="file" accept="application/pdf"
                 onChange={handleFileChange}
                 className="mt-1 w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200" />
          {file && (
            <p className="mt-1 text-xs text-slate-500">
              Đã chọn: {file.name} ({(file.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>
      </div>

      {error && <div className="mt-4"><Alert tone="error">{error}</Alert></div>}
      {success && <div className="mt-4"><Alert tone="success">{success}</Alert></div>}

      <button type="submit" disabled={submitting}
              className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? 'Đang xử lý…' : 'Thêm hồ sơ'}
      </button>
    </form>
  )
}
