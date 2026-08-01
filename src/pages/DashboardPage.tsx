import { useAuth } from '../contexts/AuthContext'

export default function DashboardPage() {
  const { user } = useAuth()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">Danh sách ứng viên</h2>
      <p className="mt-2 text-sm text-slate-500">
        Đã đăng nhập với <strong>{user?.email}</strong>
      </p>
      <p className="mt-1 font-mono text-xs text-slate-400">user id: {user?.id}</p>
      <p className="mt-4 text-sm text-slate-400">Bảng dữ liệu sẽ được thêm ở bước 6.</p>
    </div>
  )
}
