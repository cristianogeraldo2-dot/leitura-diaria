#!/usr/bin/env node
// Importa os dados do "Radar Vila Dia" (exportados pelo artefato) para knowledge/operacao.json.
//   npm run radar:import -- --clipboard            lê o JSON copiado (botão "Copiar para o JARVIS" do Radar)
//   npm run radar:import -- "C:\caminho\radar-export.json"
// Faz backup do operacao.json anterior. Não imprime valores de negócio.
import { existsSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { DATA_FILE } from '../bridge/ops.mjs'
import { DIRS } from '../bridge/home.mjs'
import { radarToOperacao, validateRadar } from '../bridge/radar-data.mjs'

function clipboard() {
  const tries = process.platform === 'win32'
    ? [['powershell', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw']]]
    : [['pbpaste', []], ['xclip', ['-selection', 'clipboard', '-o']], ['xsel', ['-b', '-o']]]
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, args, { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim()) return r.stdout
  }
  return ''
}

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const raw = process.argv.includes('--clipboard') ? clipboard() : arg ? readFileSync(arg, 'utf8') : ''
if (!raw.trim()) { console.log('Nada para importar. No Radar, clique em "Copiar para o JARVIS" e rode: npm run radar:import -- --clipboard\n(ou informe o caminho de um arquivo .json).'); process.exit(1) }
let json
try { json = JSON.parse(raw.replace(/^\uFEFF/, '')) } catch { console.log('O conteúdo não é um JSON válido (copie de novo pelo botão do Radar).'); process.exit(1) }
const src = json.radar ?? json
if (!validateRadar(src)) { console.log('JSON reconhecido, mas não é uma exportação do Radar Vila Dia (faltam SNAP, REAL ou CAPTADORES).'); process.exit(1) }

const op = radarToOperacao(src)
if (existsSync(DATA_FILE)) {
  const b = join(DIRS.backups, `operacao.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  copyFileSync(DATA_FILE, b); console.log(`Backup do operacao.json anterior: ${b}`)
}
writeFileSync(DATA_FILE, JSON.stringify(op, null, 2))
const ativos = op.captadores.filter((c) => !c.semRegistro).length
console.log(`\nGerado: ${DATA_FILE}`)
console.log(`Carimbo do Radar: ${op.carimbo ?? '—'} · mês: ${op.mes ?? '—'} · data: ${op.data ?? '—'}`)
console.log(`Captadores: ${op.captadores.length} (${ativos} com registro, ${op.captadores.length - ativos} sem registro no mês) · dias lançados: ${op.diario.length} · pontos: ${op.locais.length}`)
console.log('Derivados (calculados, não lidos): ' + op.derivados.join(', '))
for (const a of op.avisosFonte) console.log('Aviso: ' + a)
