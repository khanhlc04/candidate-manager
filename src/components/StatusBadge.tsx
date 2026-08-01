import { STATUS_LABEL, type CandidateStatus } from '../types/candidate'

const TONE: Record<CandidateStatus, string> = {
  New: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  Interviewing: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  Hired: 'bg-green-50 text-green-700 ring-green-600/20',
  Rejected: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export function StatusBadge({ status }: { status: CandidateStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}
