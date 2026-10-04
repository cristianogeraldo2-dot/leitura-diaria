import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where JARVIS keeps its own state: memory/, knowledge/, logs/, config/,
 * backups/ beside the repo. Nothing in here is committed except .gitkeep.
 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const DIRS = {
  memory: join(ROOT, 'memory'),
  knowledge: join(ROOT, 'knowledge'),
  logs: join(ROOT, 'logs'),
  config: join(ROOT, 'config'),
  backups: join(ROOT, 'backups'),
}
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true })

// Never let a secret reach a log line: API keys, bearer tokens, key=value pairs.
const SECRET =
  /(sk-[A-Za-z0-9_-]{8,}|xi-api-key["':=\s]+\S+|bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|token|secret|password|senha)["']?\s*[:=]\s*["']?[^\s"',]+)/gi
export const redact = (s) => String(s).replace(SECRET, '[REDACTED]')

export function log(event, detail = '') {
  const line = `${new Date().toISOString()} ${event}${detail ? ' ' + redact(detail).slice(0, 400) : ''}\n`
  try {
    appendFileSync(join(DIRS.logs, `jarvis-${new Date().toISOString().slice(0, 10)}.log`), line)
  } catch {
    /* logging must never break a turn */
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
export function writeJson(file, value) {
  writeFileSync(file, JSON.stringify(value, null, 2))
}
export const exists = existsSync
