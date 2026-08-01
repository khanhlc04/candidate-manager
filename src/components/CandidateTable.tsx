import { useState } from 'react'
import { getResumeSignedUrl } from '../lib/storage'
import { NEXT_STATUS, STATUS_LABEL, type Candidate, type CandidateStatus } from '../types/candidate'
import { StatusBadge } from './StatusBadge'

interface Props {
  candidates: Candidate[]
  onUpdateStatus: (id: string, next: CandidateStatus) => Promise<void>
  onDelete: (candidate: Candidate) => Promise<void>
  onError: (message: string) => void
}

export function CandidateTable({ candidates, onUpdateStatus, onDelete, onError }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null)

  /**
   * Bucket là private nên không có URL cố định — phải xin signed URL lúc bấm.
   * Mở tab TRƯỚC khi await: nhiều trình duyệt chặn window.open gọi sau await
   * vì đã mất "user gesture".
   */
  async function openResume(path: string) {
    const tab = window.open('', '_blank', 'noopener,noreferrer')
    try {
      const url = await getResumeSignedUrl(path, 60)
      if (tab) tab.location.href = url
      else window.location.href = url
    } catch (err) {
      tab?.close()
      onError(err instanceof Error ? err.message : 'Không mở được CV.')
    }
  }

  async function handleAdvance(c: Candidate) {
    const next = NEXT_STATUS[c.status as CandidateStatus]
    if (next === c.status) return
    setBusyId(c.id)
    try {
      await onUpdateStatus(c.id, next)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Cập nhật thất bại.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(c: Candidate) {
    if (!window.confirm(`Xoá hồ sơ "${c.full_name}"?`)) return
    setBusyId(c.id)
    try {
      await onDelete(c)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Xoá thất bại.')
    } finally {
      setBusyId(null)
    }
  }

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-500">Chưa có hồ sơ nào. Dùng form phía trên để thêm.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-medium">Họ và tên</th>
            <th className="px-4 py-3 font-medium">Vị trí ứng tuyển</th>
            <th className="px-4 py-3 font-medium">Trạng thái</th>
            <th className="px-4 py-3 font-medium">CV</th>
            <th className="px-4 py-3 font-medium">Ngày nộp</th>
            <th className="px-4 py-3 font-medium text-right">Thao tác</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {candidates.map((c) => {
            const status = c.status as CandidateStatus
            const next = NEXT_STATUS[status]
            const busy = busyId === c.id
            return (
              <tr key={c.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3 font-medium text-slate-900">
                  {c.full_name}
                  {c.skills.length > 0 && (
                    <div className="mt-0.5 text-xs text-slate-400">{c.skills.join(' · ')}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-700">{c.applied_position}</td>
                <td className="px-4 py-3"><StatusBadge status={status} /></td>
                <td className="px-4 py-3">
                  {c.resume_url ? (
                    <button onClick={() => openResume(c.resume_url!)}
                            className="text-brand-600 underline underline-offset-2 hover:text-brand-700">
                      Xem CV
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(c.created_at).toLocaleDateString('vi-VN', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    {next !== status && (
                      <button onClick={() => handleAdvance(c)} disabled={busy}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50">
                        {busy ? '…' : `→ ${STATUS_LABEL[next]}`}
                      </button>
                    )}
                    <button onClick={() => handleDelete(c)} disabled={busy}
                            className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50">
                      Xoá
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
