import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Detector de segredos (somente padrões; sem dependências). Nunca imprime o valor encontrado:
 * só o tipo, o arquivo e (no histórico) o commit. Uso: npm run scan:segredos [-- --historico]
 */
export const PADROES = [
  ['token Meta', /EAA[A-Za-z0-9]{20,}/],
  ['chave Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['chave sk-', /sk-[A-Za-z0-9]{32,}/],
  ['JWT / chave de serviço', /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/],
  ['chave secreta Supabase', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['atribuição de segredo', /(?:access_token|api[_-]?key|secret|password|senha)["']?\s*[:=]\s*["']?[A-Za-z0-9_/+.-]{24,}/i],
]

export function detectarSegredos(texto) {
  return PADROES.filter(([, re]) => re.test(texto)).map(([tipo]) => tipo)
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })

/** Arquivos versionados no estado atual. Ignora binários e este arquivo (que contém os padrões). */
export function varrerRepositorio({ ignorar = ['scripts/scan-secrets.mjs', 'package-lock.json'] } = {}) {
  const achados = []
  for (const f of git(['ls-files']).split('\n').filter(Boolean)) {
    if (ignorar.includes(f) || /\.(png|jpe?g|gif|mp4|webp|ico|woff2?|ttf|zip)$/i.test(f)) continue
    let txt
    try { txt = readFileSync(f, 'utf8') } catch { continue }
    for (const tipo of detectarSegredos(txt)) achados.push({ arquivo: f, tipo })
  }
  return achados
}

/** Todos os commits (somente nomes de arquivo e tipo; sem valores). */
export function varrerHistorico({ ignorar = ['scripts/scan-secrets.mjs', 'package-lock.json'] } = {}) {
  const achados = []
  for (const rev of git(['rev-list', '--all']).split('\n').filter(Boolean)) {
    for (const f of git(['ls-tree', '-r', '--name-only', rev, '--', '.']).split('\n').filter(Boolean)) {
      if (ignorar.includes(f) || /\.(png|jpe?g|gif|mp4|webp|ico|woff2?|ttf|zip)$/i.test(f)) continue
      let txt
      try { txt = git(['show', `${rev}:./${f}`]) } catch { continue }
      for (const tipo of detectarSegredos(txt)) achados.push({ commit: rev.slice(0, 7), arquivo: f, tipo })
    }
  }
  return [...new Map(achados.map((a) => [`${a.commit}${a.arquivo}${a.tipo}`, a])).values()]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hist = process.argv.includes('--historico')
  const r = hist ? varrerHistorico() : varrerRepositorio()
  for (const a of r) console.log(`${a.commit ? a.commit + ' ' : ''}${a.arquivo}: ${a.tipo}`)
  console.log(`${r.length} indício(s) ${hist ? 'no histórico' : 'nos arquivos versionados'}. Valores nunca são exibidos.`)
  process.exit(r.length ? 1 : 0)
}
