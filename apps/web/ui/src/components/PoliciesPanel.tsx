import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchPolicies, upsertPolicy, deletePolicy, type PolicyInfo } from '../api';

const RESOURCE_TYPES = [
  { value: 'tool', label: 'Tool', placeholder: 'e.g. exec, file_write, memory_add' },
  { value: 'mcp', label: 'MCP Server', placeholder: 'e.g. weather, github, *' },
  { value: 'file', label: 'File', placeholder: 'e.g. /etc/*, /home/user/.env' },
] as const;

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
    if (!window.confirm(`Delete policy for ${p.resourceType}/${p.resourceKey} [${p.effect}]?`)) return;
    try {
      await deletePolicy(p.resourceType, p.resourceKey, p.effect);
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
          Control access to tools, MCP servers, and file paths. Each policy maps a
          resource to grants (who it applies to) and an effect (allow, deny, or require
          approval). Use <code>*</code> suffix for prefix matching.
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
                <span className={`policies-row__effect policies-row__effect--${p.effect}`}>{p.effect}</span>
                {p.scope && Object.keys(p.scope).length > 0 && (
                  <span className="policies-row__scope">{JSON.stringify(p.scope)}</span>
                )}
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
  const [resourceType, setResourceType] = useState('tool');
  const [resourceKey, setResourceKey] = useState('');
  const [effect, setEffect] = useState<'allow' | 'deny' | 'require_approval'>('allow');
  const [preset, setPreset] = useState(2); // default: Owner + User
  const [customGrants, setCustomGrants] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fileMode, setFileMode] = useState<'*' | 'read' | 'write'>('*');
  const [filePath, setFilePath] = useState('');

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  const currentType = RESOURCE_TYPES.find((t) => t.value === resourceType) ?? RESOURCE_TYPES[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const isFile = resourceType === 'file';
    const key = isFile ? filePath.trim() : resourceKey.trim();
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

    const scope = isFile
      ? { sandbox: '*', mode: fileMode, path: key }
      : undefined;

    setBusy(true);
    setErr('');
    try {
      await upsertPolicy({ resourceType, resourceKey: key, effect, grants, scope });
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
        <h3>Add Policy</h3>
        <label className="manage__field">
          <span className="manage__field-label">Resource type</span>
          <select
            className="manage__field-input"
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
            disabled={busy}
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {resourceType === 'file' ? (
          <>
            <label className="manage__field">
              <span className="manage__field-label">File path (prefix)</span>
              <input
                className="manage__field-input"
                required
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="e.g. /root/notes.md, /home/user/"
                disabled={busy}
              />
            </label>
            <label className="manage__field">
              <span className="manage__field-label">Mode</span>
              <select
                className="manage__field-input"
                value={fileMode}
                onChange={(e) => setFileMode(e.target.value as '*' | 'read' | 'write')}
                disabled={busy}
              >
                <option value="*">Any (read + write)</option>
                <option value="read">Read only</option>
                <option value="write">Write only</option>
              </select>
            </label>
          </>
        ) : (
          <label className="manage__field">
            <span className="manage__field-label">Resource key</span>
            <input
              className="manage__field-input"
              required
              value={resourceKey}
              onChange={(e) => setResourceKey(e.target.value)}
              placeholder={currentType.placeholder}
              disabled={busy}
            />
          </label>
        )}

        <label className="manage__field">
          <span className="manage__field-label">Effect</span>
          <select
            className="manage__field-input"
            value={effect}
            onChange={(e) => setEffect(e.target.value as 'allow' | 'deny' | 'require_approval')}
            disabled={busy}
          >
            <option value="allow">Allow</option>
            <option value="deny">Deny</option>
            <option value="require_approval">Require Approval</option>
          </select>
        </label>

        <fieldset className="manage__field" style={{ border: 'none', padding: 0, margin: 0 }}>
          <span className="manage__field-label">Grants (who this rule targets)</span>
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
