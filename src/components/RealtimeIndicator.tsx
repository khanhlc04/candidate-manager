import type { RealtimeStatus } from '../hooks/useRealtimeCandidates'

const CONFIG: Record<RealtimeStatus, { dot: string; label: string }> = {
  idle:       { dot: 'bg-slate-300',            label: 'Ngoại tuyến' },
  connecting: { dot: 'bg-amber-400 animate-pulse', label: 'Đang kết nối…' },
  live:       { dot: 'bg-green-500',            label: 'Realtime đang bật' },
  error:      { dot: 'bg-red-500',              label: 'Mất kết nối realtime' },
}

export function RealtimeIndicator({ status }: { status: RealtimeStatus }) {
  const { dot, label } = CONFIG[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500" title={label}>
      <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  )
}
