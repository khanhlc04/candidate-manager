import type { ReactNode } from 'react'

type Tone = 'error' | 'success' | 'info'

const TONE_CLASS: Record<Tone, string> = {
  error: 'border-red-200 bg-red-50 text-red-700',
  success: 'border-green-200 bg-green-50 text-green-700',
  info: 'border-slate-200 bg-slate-50 text-slate-600',
}

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${TONE_CLASS[tone]}`} role="alert">
      {children}
    </div>
  )
}
