import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useCandidates } from '../hooks/useCandidates'
import { CandidateForm } from '../components/CandidateForm'
import { CandidateTable } from '../components/CandidateTable'
import { Alert } from '../components/Alert'
import { Spinner } from '../components/Spinner'

export default function DashboardPage() {
  const { user } = useAuth()
  const { candidates, loading, error, createCandidate, updateStatus, deleteCandidate } =
    useCandidates(user?.id)
  const [pageError, setPageError] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <CandidateForm onSubmit={createCandidate} />

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-slate-900">Danh sách ứng viên</h2>
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
