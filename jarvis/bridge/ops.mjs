import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { appendFileSync, copyFileSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { execFile } from 'node:child_process'
import { DIRS, ROOT, log, readJson, redact } from './home.mjs'
import { analyze } from './analytics.mjs'
import { MODES, getMode, setMode } from './persona.mjs'
import { instagramTools } from './instagram.mjs'
import { marketingTools } from './marketing.mjs'
import { videoTools } from './video-factory.mjs'
import { verificarConexao } from './instagram-publish.mjs'

const text = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] })
export const NO_DATA = 'Não tenho esse dado disponível.'

export const DATA_FILE = join(DIRS.knowledge, 'operacao.json')
export const DASHBOARD_NAME = 'leao-da-vila-dashboard.html'

export function loadOperation() {
  if (!existsSync(DATA_FILE)) return null
  return readJson(DATA_FILE, null)
}
export function operationInsight() {
  const d = loadOperation()
  if (!d) return { available: false, reason: NO_DATA, hint: 'Crie knowledge/operacao.json (modelo: knowledge/operacao.exemplo.json).' }
  // Arquivo de exemplo copiado sem edição: recusa em vez de analisar números fictícios.
  if (d._aviso || /^(1999|2000)-/.test(String(d.data ?? ''))) {
    return { available: false, reason: NO_DATA, hint: 'operacao.json ainda contém o EXEMPLO fictício. Substitua por números reais (ver knowledge/DADOS-NECESSARIOS.md).' }
  }
  return analyze(d)
}

/** Look for the dashboard in the project and the usual user folders. Never writes. */
export function findDashboard() {
  const home = homedir()
  const roots = [process.env.JARVIS_DASHBOARD, DIRS.knowledge, ROOT, join(ROOT, '..')]
  for (const d of ['Downloads', 'Desktop', 'Documents', 'OneDrive', 'OneDrive/Desktop', 'OneDrive/Documentos']) roots.push(join(home, d))
  for (const r of roots) {
    if (!r) continue
    try {
      if (r.endsWith('.html') && existsSync(r)) return r
      const f = join(r, DASHBOARD_NAME)
      if (existsSync(f)) return f
    } catch { /* keep looking */ }
  }
  return null
}

/** Timestamped backup, once per distinct content. */
export function backupDashboard(file) {
  const buf = readFileSync(file)
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 10)
  const dest = join(DIRS.backups, `${DASHBOARD_NAME}.${hash}.bak`)
  if (!existsSync(dest)) copyFileSync(file, dest)
  return dest
}

/** Read-only structural inspection of the dashboard HTML. */
export function inspectDashboard(file) {
  const html = readFileSync(file, 'utf8')
  const uniq = (a) => [...new Set(a)]
  const short = (u) => (u.length > 160 ? `${u.slice(0, 40)}… (${u.length} caracteres)` : u)
  const scriptSrc = uniq([...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => short(m[1])))
  const linkHref = uniq([...html.matchAll(/<link[^>]+href=["']([^"']+)["']/gi)].map((m) => short(m[1])))
  const inline = [...html.matchAll(/<script(?![^>]+src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
  const js = inline.join('\n')
  const libs = [['Chart.js', /chart(\.umd)?(\.min)?\.js|new Chart\(/i], ['Plotly', /plotly/i], ['ApexCharts', /apexcharts/i], ['ECharts', /echarts/i], ['D3', /d3(\.min)?\.js|d3\./i], ['Google Charts', /gstatic\.com\/charts/i], ['Supabase', /supabase/i], ['Firebase', /firebase/i]]
    .filter(([, re]) => re.test(html)).map(([n]) => n)
  return {
    file,
    bytes: statSync(file).size,
    htmlTags: { canvas: (html.match(/<canvas/gi) ?? []).length, table: (html.match(/<table/gi) ?? []).length, svg: (html.match(/<svg/gi) ?? []).length },
    css: { inlineBlocks: (html.match(/<style/gi) ?? []).length, external: linkHref.filter((h) => /\.css|fonts\./i.test(h)) },
    js: { inlineBlocks: inline.length, external: scriptSrc, functions: uniq([...js.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])).slice(0, 80), dataVariables: uniq([...js.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[[{]/g)].map((m) => m[1])).slice(0, 40) },
    apis: uniq([...js.matchAll(/(?:fetch|axios\.\w+|\.open)\(\s*[`'"]([^`'"]+)/g)].map((m) => redact(m[1]))).slice(0, 30),
    chartLibraries: libs,
    elementIds: uniq([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1])).slice(0, 80),
  }
}

function probeOne(port, host, ms) {
  return new Promise((res) => {
    const s = createConnection({ port, host })
    const done = (v) => { s.destroy(); res(v) }
    s.setTimeout(ms, () => done(false))
    s.on('connect', () => done(true))
    s.on('error', () => done(false))
  })
}
// Vite no Windows costuma escutar só em [::1]; testa IPv4 e IPv6.
async function probePort(port, ms = 1500) {
  for (const host of ['127.0.0.1', '::1']) if (await probeOne(port, host, ms)) return true
  return false
}

function mcpFromClaudeConfig() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8'))
    return Object.keys(cfg.mcpServers ?? {})
  } catch { return [] }
}

let claudeCache = { at: 0, v: null, bomEm: 0, bom: null }
let claudeEmVoo = null
/**
 * Verifica o Claude Code (instalado e logado) com `claude auth status`.
 * No Windows o comando pode levar mais de 8s, então o limite é maior e uma falha por TEMPO ESGOTADO
 * não derruba o painel se houve resposta boa há menos de 30 min. Uma checagem por vez.
 */
export function claudeStatus() {
  if (Date.now() - claudeCache.at < 60_000 && claudeCache.v) return Promise.resolve(claudeCache.v)
  if (claudeEmVoo) return claudeEmVoo
  claudeEmVoo = new Promise((res) => {
    execFile('claude', ['auth', 'status'], { timeout: 25_000, shell: process.platform === 'win32', windowsHide: true }, (err, out) => {
      let v
      const tempoEsgotado = Boolean(err && (err.killed || err.signal === 'SIGTERM'))
      if (err && !out) {
        v = { ok: false, installed: err.code !== 'ENOENT', loggedIn: false, tempoEsgotado, note: err.code === 'ENOENT' ? 'CLI do Claude Code não encontrada no PATH do processo da bridge' : tempoEsgotado ? 'a verificação demorou mais de 25s' : `falha ao consultar (código ${err.code ?? '?'})` }
      } else {
        let j = {}
        try { j = JSON.parse(out) } catch { /* texto livre */ }
        v = { ok: j.loggedIn === true, installed: true, loggedIn: j.loggedIn === true, method: j.authMethod ?? null, ...(j.loggedIn === true ? {} : { note: 'o Claude Code respondeu, mas não está logado — rode `claude` e faça login' }) }
      }
      if (v.ok) { claudeCache.bom = v; claudeCache.bomEm = Date.now() }
      // timeout sem resposta ruim confirmada: mantém o último estado bom recente
      if (!v.ok && v.tempoEsgotado && claudeCache.bom && Date.now() - claudeCache.bomEm < 30 * 60_000) v = { ...claudeCache.bom, note: 'verificação lenta; usando o último resultado bom' }
      claudeCache.at = Date.now(); claudeCache.v = v
      claudeEmVoo = null
      res(v)
    })
  })
  return claudeEmVoo
}

/** Compact status for the dashboard widget. Booleans only — no secrets, no data. */
export async function statusSummary() {
  const c = await claudeStatus()
  const mcp = mcpFromClaudeConfig()
  return { claude: c.ok, bridge: true, dashboard: Boolean(findDashboard()), mcp: true, mcpExternal: mcp.length, modo: getMode() }
}

export async function diagnostics(extra = {}) {
  const bridgePort = Number(process.env.JARVIS_BRIDGE_PORT ?? 8787)
  const dash = findDashboard()
  const op = loadOperation()
  const mcp = mcpFromClaudeConfig()
  const out = {
    bridge: { ok: true, port: bridgePort, pid: process.pid, uptimeSeg: Math.round(process.uptime()) },
    frontend: { ok: (await probePort(5173)) || (await probePort(4173)), note: 'servidor Vite local em 5173 (ou preview 4173)' },
    claudeCode: await claudeStatus(),
    voz: { note: 'Verificado no navegador: pressione D (painel) ou T (autoteste). O bridge não enxerga o microfone.', engine: extra.voice ?? 'navegador (speechSynthesis)' },
    mcp: { ok: mcp.length > 0, servidoresNoClaudeJson: mcp, chromeDevtools: mcp.includes('chrome-devtools') },
    portas: { 8787: await probePort(bridgePort), 5173: await probePort(5173), 4173: await probePort(4173) },
    dashboard: { ok: Boolean(dash), caminho: dash, backups: existsSync(DIRS.backups) ? readdirSync(DIRS.backups).filter((f) => f.endsWith('.bak')).length : 0 },
    dadosOperacao: { ok: Boolean(op), arquivo: 'knowledge/operacao.json' },
    memoria: { ok: Object.values(DIRS).every(existsSync), modo: getMode(), escritaLiberada: process.env.JARVIS_ALLOW_WRITES === '1', confirmacaoPorVoz: true },
  }
  log('diagnostics', JSON.stringify({ bridge: out.bridge.ok, frontend: out.frontend.ok, dashboard: out.dashboard.ok, mcp: out.mcp.ok }))
  return out
}

export function opsServer() {
  return createSdkMcpServer({
    name: 'jarvis_ops',
    version: '1.0.0',
    instructions: 'Análise da operação Vila Dia, dashboard, modos, diagnóstico e memória local da Cris.',
    alwaysLoad: true,
    tools: [
      ...instagramTools(),
      ...marketingTools(),
      ...videoTools(),
      tool('instagram_conexao', 'Verifica (só leitura) se a conta do Instagram está conectada pela API oficial. Nunca mostra o token.', {}, async () => text(await verificarConexao())),
      tool('operacao_analise', 'Analisa a operação (meta, realizado, gap, casais, Q, NQ, vendas, conversão, VGV, ranking de captadores, gargalo e alertas) a partir de knowledge/operacao.json. Se devolver available=false, diga "Não tenho esse dado disponível." e peça o arquivo. Jamais invente números fora do retorno.', {}, async () => {
        log('tool', 'operacao_analise')
        return text(operationInsight())
      }),
      tool('dashboard_localizar', 'Localiza leao-da-vila-dashboard.html, faz backup (nunca altera o original), inspeciona a arquitetura (HTML/CSS/JS/APIs/gráficos) e devolve também a URL servida pela bridge para abrir em um blade.', {}, async () => {
        const f = findDashboard()
        if (!f) return text({ encontrado: false, aviso: 'Dashboard não encontrado. Coloque leao-da-vila-dashboard.html em knowledge/ ou defina JARVIS_DASHBOARD.' })
        const backup = backupDashboard(f)
        log('dashboard', `inspect ${f}`)
        return text({ encontrado: true, backup, url: `http://localhost:${process.env.JARVIS_BRIDGE_PORT ?? 8787}/dashboard`, arquitetura: inspectDashboard(f) })
      }),
      tool('jarvis_modo', 'Define o modo de operação: padrao, reuniao, lideranca ou analise. O modo vale até ser trocado.', { modo: z.enum(['padrao', 'reuniao', 'lideranca', 'analise', 'conteudo']) }, async ({ modo }) => {
        setMode(modo)
        return text(`${MODES[modo].ack} (modo=${modo})`)
      }),
      tool('jarvis_diagnostico', 'Diagnóstico do sistema: frontend, bridge, Claude Code, voz, microfone, MCP, portas, dashboard e memória.', {}, async () => text(await diagnostics())),
      tool('memoria_registrar', 'Grava uma nota curta na memória local (memory/notas.md). NUNCA grave senhas, tokens ou chaves.', { nota: z.string().min(3).max(600) }, async ({ nota }) => {
        appendFileSync(join(DIRS.memory, 'notas.md'), `- ${new Date().toISOString().slice(0, 16)} ${redact(nota)}\n`)
        log('memory.write')
        return text('Registrado.')
      }),
      tool('memoria_ler', 'Lê as notas da memória local.', {}, async () => {
        const f = join(DIRS.memory, 'notas.md')
        return text(existsSync(f) ? readFileSync(f, 'utf8').slice(-4000) : 'Memória vazia.')
      }),
    ],
  })
}
