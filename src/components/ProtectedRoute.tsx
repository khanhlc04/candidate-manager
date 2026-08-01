import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Spinner } from './Spinner'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  // Trạng thái "chưa biết": tuyệt đối KHÔNG điều hướng, nếu không sẽ đá user
  // ra khỏi trang mỗi lần F5.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Đang kiểm tra phiên đăng nhập…" />
      </div>
    )
  }

  if (!session) {
    // replace: không để trang bị chặn nằm trong lịch sử trình duyệt
    // state.from: để sau khi đăng nhập quay lại đúng chỗ đang muốn vào
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <>{children}</>
}
