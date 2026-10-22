#!/usr/bin/env node
// Mostra a ESTRUTURA (chaves, tipos, tamanhos) dos dados embutidos no dashboard — SEM imprimir valores.
//   npm run dashboard:schema                      procura o arquivo nos locais de sempre
//   npm run dashboard:schema -- "C:\caminho\leao-da-vila-dashboard.html"
// Somente leitura. Se o snapshot estiver em base64/JSON, ele é decodificado em memória.
import { readFileSync } from 'node:fs'
import { findDashboard } from '../bridge/ops.mjs'

const file = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? findDashboard()
if (!file) { console.log('Dashboard não encontrado. Informe o caminho como argumento.'); process.exit(1) }
const html = readFileSync(file, 'utf8')

function tryParse(txt) {
  const t = txt.trim()
  for (const cand of [t, safeB64(t)]) {
    if (!cand) continue
    try { return JSON.parse(cand) } catch { /* próximo */ }
  }
  return undefined
}
function safeB64(t) {
  if (!/^[A-Za-z0-9+/=\s]{40,}$/.test(t)) return null
  try { return Buffer.from(t.replace(/\s/g, ''), 'base64').toString('utf8') } catch { return null }
}

// 1) elemento com id data-app-reviewed-snapshot (script/div/template) ou atributo equivalente
const candidates = []
const idRe = /<([a-z0-9]+)[^>]*\bid=["']data-app-reviewed-snapshot["'][^>]*>([\s\S]*?)<\/\1>/i.exec(html)
if (idRe) candidates.push(['elemento #data-app-reviewed-snapshot', idRe[2]])
const attr = /data-app-reviewed-snapshot=["']([^"']+)["']/i.exec(html)
if (attr) candidates.push(['atributo data-app-reviewed-snapshot', attr[1].replace(/&quot;/g, '"')])
// 2) qualquer <script type="application/json"> ou id com "snapshot"/"data"
for (const m of html.matchAll(/<script[^>]*type=["']application\/(?:json|ld\+json)["'][^>]*>([\s\S]*?)<\/script>/gi)) candidates.push(['script JSON', m[1]])

function shape(v, depth = 0) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return depth > 4 ? `array(${v.length})` : { _array: v.length, _item: v.length ? shape(v[0], depth + 1) : 'vazio' }
  if (typeof v === 'object') {
    if (depth > 4) return 'objeto'
    return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, shape(x, depth + 1)]))
  }
  return typeof v === 'string' ? `string(${Math.min(v.length, 999)})` : typeof v
}

let found = false
for (const [origem, txt] of candidates) {
  const data = tryParse(txt)
  if (data === undefined) { console.log(`• ${origem}: conteúdo não é JSON direto (${txt.length} caracteres)`); continue }
  found = true
  console.log(`\n• ${origem}: estrutura dos dados (valores omitidos)`)
  console.log(JSON.stringify(shape(data), null, 2))
}
if (!found) {
  console.log('\nNenhum JSON legível encontrado nos pontos usuais.')
  console.log('Ids/atributos "data-" presentes no HTML:')
  console.log([...new Set([...html.matchAll(/\b(data-[a-z0-9-]+)=/gi)].map((m) => m[1]))].slice(0, 30).join(', ') || '(nenhum)')
  console.log('Os dados podem estar dentro do código embutido (base64). Me diga e eu extraio com um passo a mais.')
}
