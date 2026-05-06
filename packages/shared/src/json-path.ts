/**
 * Walk a dot-path into a record. Returns undefined if any segment
 * is missing or the parent is not an object.
 */
export const readPath = (doc: Record<string, unknown> | null | undefined, dotPath: string): unknown => {
  if (!doc) return undefined;
  const segments = dotPath.split('.').filter(Boolean);
  let cursor: unknown = doc;
  for (const seg of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor;
};

/**
 * Write a value at a dot-path inside a record, returning a new
 * top-level object. Creates missing intermediate objects.
 *
 * Empty path replaces the whole document; the value must be a plain object.
 */
export const writePath = (
  doc: Record<string, unknown> | null | undefined,
  dotPath: string,
  value: unknown,
): Record<string, unknown> => {
  const root: Record<string, unknown> = doc ? { ...doc } : {};
  const segments = dotPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Cannot replace the root document with a non-object value.');
    }
    return value as Record<string, unknown>;
  }
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = cursor[seg];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      cursor[seg] = created;
      cursor = created;
    } else {
      const cloned = { ...(next as Record<string, unknown>) };
      cursor[seg] = cloned;
      cursor = cloned;
    }
  }
  cursor[segments[segments.length - 1]!] = value;
  return root;
};

/**
 * Best-effort parse a CLI string argument: booleans, null, numbers, and
 * JSON object/array literals are recognised; everything else stays as
 * the original string.
 */
export const parseScalar = (raw: string): unknown => {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;

  const trimmed = raw.trim();
  if (trimmed !== '') {
    const num = Number(trimmed);
    if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(trimmed)) return num;
  }

  if ((raw.startsWith('{') && raw.endsWith('}')) ||
      (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }

  return raw;
};

export const formatScalar = (value: unknown): string => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};
