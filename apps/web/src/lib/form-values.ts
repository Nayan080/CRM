/**
 * HTML inputs give strings. Before sending to the API: empty optional fields become null
 * (= "clear") on edit, or are left out on create. The API validates everything again.
 */
export function cleanBody<T extends Record<string, unknown>>(values: T, mode: 'create' | 'update') {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === '' || value === undefined) {
      if (mode === 'update') out[key] = null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** <input type="datetime-local"> value → ISO timestamp (in the browser's time zone). */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { dateStyle: 'medium' });
}
