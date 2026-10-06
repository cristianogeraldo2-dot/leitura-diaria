import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

/**
 * Leitor de planilhas sem dependências: CSV/TSV (; , ou tab, UTF-8 ou Latin-1) e XLSX (primeira aba).
 * Devolve { headers, rows } com rows = arrays de strings. Somente leitura.
 */
function decode(buf) {
  let t = buf.toString('utf8')
  if (t.includes('\uFFFD')) t = buf.toString('latin1') // Excel antigo em português
  return t.replace(/^\uFEFF/, '')
}

export function parseCsv(text) {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (c) => first.split(c).length - 1
  const delim = [';', '\t', ','].sort((a, b) => count(b) - count(a))[0]
  const rows = []
  let row = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch
    } else if (ch === '"' && cur === '') q = true // aspas só abrem no início do campo
    else if (ch === delim) { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((c) => c !== '')) rows.push(row)
  const [headers = [], ...body] = rows
  return { headers: headers.map((h) => h.trim()), rows: body }
}

function unzip(buf) {
  // Diretório central do ZIP → { nome: Buffer }
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('Arquivo XLSX inválido (não é um ZIP).')
  const n = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = {}
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    const lnlen = buf.readUInt16LE(lho + 26), lelen = buf.readUInt16LE(lho + 28)
    const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize)
    out[name] = method === 0 ? data : inflateRawSync(data)
    p += 46 + nlen + elen + clen
  }
  return out
}
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')
const colIdx = (ref) => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1

export function parseXlsx(buf) {
  const z = unzip(buf)
  const shared = z['xl/sharedStrings.xml']
    ? [...z['xl/sharedStrings.xml'].toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : []
  const sheet = Object.keys(z).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0]
  if (!sheet) throw new Error('Nenhuma aba encontrada no XLSX.')
  const xml = z[sheet].toString('utf8')
  const rows = []
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = []
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] ?? ''
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1]
      const type = /t="(\w+)"/.exec(attrs)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let val = ''
      if (type === 's') val = shared[+v] ?? ''
      else if (type === 'inlineStr') val = unxml([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''))
      else if (v !== undefined) val = unxml(v)
      r[ref ? colIdx(ref) : r.length] = val
    }
    if (r.some((c) => c !== undefined && c !== '')) rows.push(Array.from(r, (c) => c ?? ''))
  }
  const [headers = [], ...body] = rows
  return { headers: headers.map((h) => String(h).trim()), rows: body }
}

export function readTable(file) {
  const buf = readFileSync(file)
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return parseXlsx(buf)
  return parseCsv(decode(buf))
}

/** Número em formato brasileiro ou internacional → number | null. */
export function toNumber(s) {
  if (typeof s === 'number') return s
  let t = String(s ?? '').trim().replace(/[R$\s%]/g, '')
  if (!t || !/\d/.test(t)) return null
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (t.includes(',')) t = t.replace(',', '.')
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Descrição da estrutura: colunas, tipo provável e preenchimento. Nenhum valor é devolvido. */
export function describeTable({ headers, rows }) {
  return {
    linhas: rows.length,
    colunas: headers.map((h, i) => {
      const vals = rows.map((r) => r[i]).filter((v) => v !== undefined && v !== '')
      const nums = vals.filter((v) => toNumber(v) !== null).length
      const datas = vals.filter((v) => /^\d{1,2}\/\d{1,2}\/\d{2,4}|^\d{4}-\d{2}-\d{2}/.test(String(v))).length
      const tipo = !vals.length ? 'vazia' : datas / vals.length > 0.8 ? 'data' : nums / vals.length > 0.8 ? 'número' : 'texto'
      return { nome: h, tipo, preenchidas: vals.length, distintos: new Set(vals).size }
    }),
  }
}
