// Reads app-config.txt — a plain "key: value" text file living at the
// repo root (next to README.md), editable by hand. See that file's own
// comments for what each key does. The backend serves its raw contents at
// /api/app-config (reading fresh from disk every time), since a file at
// the true repo root isn't something the frontend's dev server can serve
// directly. Returns {} on any error so the app just falls back to its
// normal defaults if the file is missing, unreachable, or malformed.
import { fetchAppConfigText } from '../api.js'

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function loadAppConfig() {
  try {
    const text = await fetchAppConfigText()
    const config = {}
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim()
      if (value) config[key] = value
    }
    return config
  } catch {
    return {}
  }
}

// YYYY-MM-DD only; anything else (wrong format, typo, empty) is ignored.
export function parseConfigDate(value) {
  return value && ISO_DATE_RE.test(value) ? value : null
}

// Comma-separated list -> trimmed, non-empty array (or [] if blank).
export function parseConfigList(value) {
  if (!value) return []
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}
