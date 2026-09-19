/** Best-effort human label for a record -- tries common display fields before falling back to nothing. */
function extractLabel(obj: unknown): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  const candidates = ['name', 'title', 'subject', 'tokenNumber', 'code', 'identifier'];
  for (const key of candidates) {
    const value = rec[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

/** Field names whose old/new values differ between a PATCH/PUT body and the resulting record. Ignores fields the body never touched. */
export function diffChangedFields(before: unknown, after: unknown): string[] {
  if (!before || typeof before !== 'object' || !after || typeof after !== 'object') return [];
  const beforeRec = before as Record<string, unknown>;
  const afterRec = after as Record<string, unknown>;
  return Object.keys(beforeRec).filter((key) => {
    if (key === 'id') return false;
    return JSON.stringify(beforeRec[key]) !== JSON.stringify(afterRec[key]);
  });
}

const VERB_BY_METHOD: Record<string, string> = {
  POST: 'Created',
  PUT: 'Updated',
  PATCH: 'Updated',
  DELETE: 'Deleted',
};

export function buildDescription(params: {
  method: string;
  entityType: string;
  entityId: string;
  requestBody: unknown;
  responseBody: unknown;
  changedFields: string[];
}): string {
  const verb = VERB_BY_METHOD[params.method] ?? 'Modified';
  const label = extractLabel(params.responseBody) ?? extractLabel(params.requestBody);
  const subject = label ? `${params.entityType.toLowerCase()} "${label}"` : `${params.entityType.toLowerCase()} #${params.entityId.slice(0, 8)}`;

  if (params.changedFields.length > 0) {
    return `${verb} ${subject} (${params.changedFields.length} field${params.changedFields.length === 1 ? '' : 's'} changed: ${params.changedFields.join(', ')})`;
  }
  return `${verb} ${subject}`;
}
