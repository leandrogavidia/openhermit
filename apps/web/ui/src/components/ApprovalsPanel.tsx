import { useCallback, useEffect, useState } from 'react';
import { fetchApprovalRequests, reviewApprovalRequest, type ApprovalRequestInfo } from '../api';

const STATUS_BADGE: Record<string, string> = {
  pending: 'approvals-row__status--pending',
  approved: 'approvals-row__status--approved',
  rejected: 'approvals-row__status--rejected',
  expired: 'approvals-row__status--expired',
};

export function ApprovalsPanel() {
  const [requests, setRequests] = useState<ApprovalRequestInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setRequests(await fetchApprovalRequests(filter || undefined));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const handleReview = async (id: string, decision: 'approved' | 'rejected', resolution?: 'once' | 'persistent') => {
    try {
      await reviewApprovalRequest(id, { decision, resolution });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <p className="manage__empty">Loading...</p>;

  return (
    <div className="approvals-panel">
      <div className="approvals-panel__intro">
        <p className="eyebrow">Approval Requests</p>
        <p className="approvals-panel__hint">
          When a tool has <code>require_approval</code> effect, users must request
          access. Approve or reject pending requests below.
        </p>
      </div>

      <div className="manage__toolbar">
        <select
          className="btn btn--sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {requests.length === 0 ? (
        <p className="manage__empty">No approval requests{filter ? ` with status "${filter}"` : ''}.</p>
      ) : (
        <div className="approvals-panel__list">
          {requests.map((r) => (
            <div className="approvals-row" key={r.id}>
              <div className="approvals-row__info">
                <span className="approvals-row__resource">
                  {r.resourceType}/{r.resourceKey}
                </span>
                <span className={`approvals-row__status ${STATUS_BADGE[r.status] ?? ''}`}>
                  {r.status}
                </span>
                <span className="approvals-row__requester">
                  by {r.requesterId}
                </span>
              </div>
              <div className="approvals-row__meta">
                <span className="approvals-row__time">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                {r.resolvedBy && (
                  <span className="approvals-row__resolver">
                    resolved by {r.resolvedBy}
                    {r.resolution ? ` (${r.resolution})` : ''}
                  </span>
                )}
                {r.reason && (
                  <span className="approvals-row__reason">— {r.reason}</span>
                )}
              </div>
              {r.status === 'pending' && (
                <div className="approvals-row__actions">
                  <button
                    className="btn btn--sm btn--primary"
                    onClick={() => void handleReview(r.id, 'approved', 'once')}
                  >
                    Approve (once)
                  </button>
                  <button
                    className="btn btn--sm btn--primary"
                    onClick={() => void handleReview(r.id, 'approved', 'persistent')}
                    title="Approve and create a permanent allow policy"
                  >
                    Approve (persistent)
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => void handleReview(r.id, 'rejected')}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="basic-panel__error">{error}</p>}
    </div>
  );
}
