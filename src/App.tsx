import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

type Health = { ok: boolean; detail: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    // getSession() gọi vào lớp Auth của Supabase — nếu URL/key sai, ta sẽ biết ngay.
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) throw error
        setHealth({
          ok: true,
          detail: data.session ? `Đang đăng nhập: ${data.session.user.email}` : 'Chưa đăng nhập (đúng như mong đợi)',
        })
      })
      .catch((err: unknown) => {
        setHealth({ ok: false, detail: err instanceof Error ? err.message : String(err) })
      })
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-brand-700">Candidate Manager</h1>
        <p className="mt-1 text-sm text-slate-500">Kiểm tra hạ tầng — Bước 1</p>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-slate-600">Tailwind CSS v4</dt>
            <dd className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
              Hoạt động
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-600">Kết nối Supabase</dt>
            <dd
              className={
                health === null
                  ? 'rounded-full bg-slate-100 px-2 py-0.5 text-slate-600'
                  : health.ok
                    ? 'rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700'
                    : 'rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700'
              }
            >
              {health === null ? 'Đang kiểm tra…' : health.ok ? 'Thành công' : 'Thất bại'}
            </dd>
          </div>
        </dl>

        {health && <p className="mt-4 text-xs text-slate-500">{health.detail}</p>}
      </div>
    </main>
  )
}
