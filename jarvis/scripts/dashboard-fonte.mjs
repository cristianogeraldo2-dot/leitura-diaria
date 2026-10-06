#!/usr/bin/env node
// Mostra DE ONDE o dashboard tira os números (provedor, consulta, filtros, definições) — SEM valores de negócio.
//   npm run dashboard:fonte -- "C:\caminho\leao-da-vila-dashboard.html"
import { findDashboard } from '../bridge/ops.mjs'
import { readSnapshot } from '../bridge/dashboard-data.mjs'
import { redact } from '../bridge/home.mjs'

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? findDashboard()
if (!file) { console.log('Dashboard não encontrado. Informe o caminho como argumento.'); process.exit(1) }
const snap = readSnapshot(file)
if (!snap) { console.log('Snapshot não encontrado. Rode: npm run dashboard:schema'); process.exit(1) }
const keep = (o) => JSON.parse(redact(JSON.stringify(o)))
console.log(`Gerado em: ${snap.generatedAt ?? '—'} · título: ${snap.title ?? '—'} · status: ${snap.status ?? '—'} · build: ${snap.buildStatus ?? '—'}\n`)
for (const [nome, q] of Object.entries(snap.queries ?? {})) {
  const s = q.source ?? {}
  console.log(`## ${nome}`)
  console.log(JSON.stringify(keep({
    label: s.label, provider: s.provider, executedAt: s.executedAt, filters: s.filters,
    evidenceFlow: s.evidenceFlow, metricDefinitions: s.metricDefinitions,
  }), null, 2))
}
