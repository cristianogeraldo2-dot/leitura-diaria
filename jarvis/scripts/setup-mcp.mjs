#!/usr/bin/env node
// Chrome DevTools MCP para o JARVIS — SEGURO: por padrão só mostra o que faria.
//   node scripts/setup-mcp.mjs            lista MCPs existentes e diz se falta o chrome-devtools
//   node scripts/setup-mcp.mjs --apply    faz backup de ~/.claude.json e adiciona SOMENTE o chrome-devtools
// Nunca altera nem remove MCPs existentes.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const cfgPath = join(homedir(), '.claude.json')
const apply = process.argv.includes('--apply')
let servers = {}
try { servers = JSON.parse(readFileSync(cfgPath, 'utf8')).mcpServers ?? {} } catch { /* sem config ainda */ }
const names = Object.keys(servers)
console.log(`MCPs já configurados (${names.length}): ${names.join(', ') || 'nenhum'}`)
if (names.includes('chrome-devtools')) { console.log('chrome-devtools já presente — nada a fazer.'); process.exit(0) }
if (!apply) {
  console.log('\nFalta o chrome-devtools. Rode com --apply para adicioná-lo (backup automático):')
  console.log('  claude mcp add --scope user chrome-devtools -- npx chrome-devtools-mcp@latest')
  process.exit(0)
}
const back = join(dirname(fileURLToPath(import.meta.url)), '..', 'backups')
mkdirSync(back, { recursive: true })
if (existsSync(cfgPath)) {
  const dest = join(back, `claude.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  copyFileSync(cfgPath, dest)
  console.log(`Backup: ${dest}  (contém suas credenciais — pasta backups/ é ignorada pelo Git)`)
}
const r = spawnSync('claude', ['mcp', 'add', '--scope', 'user', 'chrome-devtools', '--', 'npx', 'chrome-devtools-mcp@latest'], { stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(r.status ?? 1)
