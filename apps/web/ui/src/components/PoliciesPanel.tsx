import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPolicies, upsertPolicy, deletePolicy, type PolicyInfo } from '../api';

const GRANT_PRESETS: { label: string; grants: Array<{ type: 'any' | 'role'; value?: string }> }[] = [
  { label: 'Everyone', grants: [{ type: 'any' }] },
  { label: 'Owner only', grants: [{ type: 'role', value: 'owner' }] },
  { label: 'Owner + User', grants: [{ type: 'role', value: 'owner' }, { type: 'role', value: 'user' }] },
];

function grantsLabel(grants: PolicyInfo['grants']): string {
  if (grants.length === 0) return 'None (blocked)';
  if (grants.some((g) => g.type === 'any')) return 'Everyone';
  const roles = grants.filter((g) => g.type === 'role').map((g) => g.value);
  const users = grants.filter((g) => g.type === 'user').map((g) => g.value);
  const parts: string[] = [];
  if (roles.length) parts.push(roles.join(', '));
  if (users.length) parts.push(`user:${users.join(',')}`);
  return parts.join(' + ');
}

export function PoliciesPanel() {
  const [policies, setPolicies] = useState<PolicyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      setPolicies(await fetchPolicies());
      setError('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (p: PolicyInfo) => {
    if (!window.confirm(`Delete policy for ${p.resourceType}/${p.resourceKey}?`)) return;
    try {
      await deletePolicy(p.resourceType, p.resourceKey, {
        ...(p.sandboxAlias ? { sandboxAlias: p.sandboxAlias } : {}),
        ...(p.mode ? { mode: p.mode } : {}),
      });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (loading) return <p className="manage__empty">Loading...</p>;

  return (
    <div className="policies-panel">
      <div className="policies-panel__intro">
        <p className="eyebrow">Access Policies</p>
        <p className="policies-panel__hint">
          Override the default access level for tools. Each policy maps a tool
          name to a set of grants that control who can use it. Use <code>*</code> suffix
          for prefix matching (e.g. <code>mcp__weather__*</code> covers all tools
          from that MCP server). Tools without a custom policy use their built-in defaults.
        </p>
      </div>

      <div className="manage__toolbar">
        <button className="btn btn--sm btn--primary" onClick={() => setShowCreate(true)}>
          Add Policy
        </button>
      </div>

      {policies.length === 0 ? (
        <p className="manage__empty">No custom policies. All tools use built-in defaults.</p>
      ) : (
        <div className="policies-panel__list">
          {policies.map((p) => (
            <div className="policies-row" key={p.id}>
              <div className="policies-row__info">
                <span className="policies-row__key">{p.resourceKey}</span>
                <span className="policies-row__type">{p.resourceType}</span>
                {p.sandboxAlias && <span className="policies-row__scope">sandbox={p.sandboxAlias}</span>}
                {p.mode && <span className="policies-row__scope">mode={p.mode}</span>}
              </div>
              <div className="policies-row__grants">{grantsLabel(p.grants)}</div>
              <div className="policies-row__actions">
                <button
                  className="btn btn--ghost btn--sm policies-row__delete"
                  onClick={() => void handleDelete(p)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="basic-panel__error">{error}</p>}

      {showCreate && (
        <CreatePolicyDialog onClose={() => setShowCreate(false)} onCreated={load} />
      )}
    </div>
  );
}

function CreatePolicyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [resourceKey, setResourceKey] = useState('');
  const [preset, setPreset] = useState(2); // default: Owner + User
  const [customGrants, setCustomGrants] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = resourceKey.trim();
    if (!key) return;

    let grants: Array<{ type: string; value?: string }>;
    if (useCustom) {
      try {
        grants = JSON.parse(customGrants);
        if (!Array.isArray(grants)) throw new Error();
      } catch {
        setErr('Grants must be a valid JSON array');
        return;
      }
    } else {
      grants = GRANT_PRESETS[preset]!.grants;
    }

    setBusy(true);
    setErr('');
    try {
      await upsertPolicy({ resourceType: 'tool', resourceKey: key, grants });
      onClose();
      onCreated();
    } catch (error) {
      setErr((error as Error).message);
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="manage__dialog" onClose={onClose}>
      <form className="manage__dialog-form" onSubmit={handleSubmit}>
        <h3>Add Tool Policy</h3>
        <label className="manage__field">
          <span className="manage__field-label">Tool name</span>
          <input
            className="manage__field-input"
            required
            value={resourceKey}
            onChange={(e) => setResourceKey(e.target.value)}
            placeholder="e.g. exec, file_write, mcp__server__*"
            disabled={busy}
          />
        </label>

        <fieldset className="manage__field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <span className="manage__field-label">Grants</span>
          <div className="manage__radio-group">
            {GRANT_PRESETS.map((p, i) => (
              <label key={i}>
                <input
                  type="radio"
                  name="preset"
                  checked={!useCustom && preset === i}
                  onChange={() => { setPreset(i); setUseCustom(false); }}
                  disabled={busy}
                />
                {p.label}
              </label>
            ))}
            <label>
              <input
                type="radio"
                name="preset"
                checked={useCustom}
                onChange={() => setUseCustom(true)}
                disabled={busy}
              />
              Custom JSON
            </label>
          </div>
        </fieldset>

        {useCustom && (
          <label className="manage__field">
            <span className="manage__field-label">Custom grants JSON</span>
            <textarea
              className="manage__field-input manage__field-textarea"
              rows={3}
              value={customGrants}
              onChange={(e) => setCustomGrants(e.target.value)}
              placeholder='[{"type":"role","value":"owner"},{"type":"user","value":"u-123"}]'
              disabled={busy}
            />
          </label>
        )}

        {err && <p className="basic-panel__error">{err}</p>}

        <div className="manage__dialog-actions">
          <button className="btn btn--ghost" type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
