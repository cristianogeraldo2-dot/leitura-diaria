#!/usr/bin/env node
// Gera knowledge/operacao.json a partir do snapshot embutido no dashboard (SOMENTE LEITURA no HTML).
//   npm run dashboard:import -- "C:\caminho\leao-da-vila-dashboard.html"
// Não imprime valores de negócio; mostra só o que foi mapeado. Se já existir operacao.json, faz backup antes.
import { existsSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findDashboard, DATA_FILE } from '../bridge/ops.mjs'
import { readSnapshot, snapshotToOperacao } from '../bridge/dashboard-data.mjs'
import { DIRS } from '../bridge/home.mjs'

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? findDashboard()
if (!file) { console.log('Dashboard não encontrado. Informe o caminho como argumento.'); process.exit(1) }
const snap = readSnapshot(file)
if (!snap) { console.log('Não achei o snapshot de dados no dashboard. Rode: npm run dashboard:schema'); process.exit(1) }
const op = snapshotToOperacao(snap)
if (existsSync(DATA_FILE)) {
  const b = join(DIRS.backups, `operacao.json.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`)
  copyFileSync(DATA_FILE, b); console.log(`Backup do operacao.json anterior: ${b}`)
}
writeFileSync(DATA_FILE, JSON.stringify(op, null, 2))
const filled = (o, p = '') => Object.entries(o).flatMap(([k, x]) => x && typeof x === 'object' && !Array.isArray(x) ? filled(x, `${p}${k}.`) : x === null ? [] : [`${p}${k}`])
console.log(`\nGerado: ${DATA_FILE}`)
console.log(`Snapshot gerado em: ${op.geradoEm ?? 'data não informada'} · status: ${op.statusDashboard.status ?? '—'} · build: ${op.statusDashboard.build ?? '—'}`)
console.log(`Métricas diárias: ${op.metricasDiarias.map((m) => m.metric).join(', ') || 'nenhuma'}`)
console.log(`Campos preenchidos: ${filled(op).filter((f) => !f.startsWith('statusDashboard') && f !== 'fonte').length}`)
console.log('Derivados (calculados, não lidos): ' + op.derivados.join(', '))
console.log('NÃO disponíveis neste dashboard: dados por captador, meta de casais, meta de vendas, progresso do dia.')
