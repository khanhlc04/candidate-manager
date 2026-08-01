import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useCandidates } from '../hooks/useCandidates'
import { useRealtimeCandidates } from '../hooks/useRealtimeCandidates'
import { AnalyticsPanel } from '../components/AnalyticsPanel'
import { BulkUploadPanel } from '../components/BulkUploadPanel'
import { CandidateForm } from '../components/CandidateForm'
import { CandidateTable } from '../components/CandidateTable'
import { SearchPanel } from '../components/SearchPanel'
import { RealtimeIndicator } from '../components/RealtimeIndicator'
import { Alert } from '../components/Alert'
import { Spinner } from '../components/Spinner'

export default function DashboardPage() {
  const { user } = useAuth()
  const {
    candidates, loading, error,
    createCandidate, createManyCandidates,
    updateStatus, deleteCandidate,
    upsertLocal, removeLocal,
  } = useCandidates(user?.id)
  const [pageError, setPageError] = useState<string | null>(null)

  // Đăng ký nhận thay đổi realtime.
  // upsertLocal / removeLocal đều được bọc useCallback ở useCandidates
  // nên tham chiếu ổn định → effect không subscribe lại mỗi lần render.
  const realtimeStatus = useRealtimeCandidates({
    userId: user?.id,
    onUpsert: upsertLocal,
    onRemove: removeLocal,
  })

  return (
    <div className="space-y-6">
      {/* candidates.length đổi mỗi khi thêm/xoá hồ sơ (kể cả qua Realtime)
          → thống kê tự tải lại, luôn khớp với bảng bên dưới. */}
      <AnalyticsPanel refreshKey={candidates.length} />
      <CandidateForm onSubmit={createCandidate} />
      <BulkUploadPanel onSubmit={createManyCandidates} />
      <SearchPanel />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">Danh sách ứng viên</h2>
            <RealtimeIndicator status={realtimeStatus} />
          </div>
          <span className="text-sm text-slate-500">{candidates.length} hồ sơ</span>
        </div>

        {error && <Alert tone="error">{error}</Alert>}
        {pageError && <Alert tone="error">{pageError}</Alert>}

        {loading ? (
          <Spinner label="Đang tải danh sách…" />
        ) : (
          <CandidateTable
            candidates={candidates}
            onUpdateStatus={updateStatus}
            onDelete={deleteCandidate}
            onError={setPageError}
          />
        )}
      </section>
    </div>
  )
}
