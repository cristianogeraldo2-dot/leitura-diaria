#!/usr/bin/env node
// Bateria de testes do JARVIS. Uso: npm test   (offline)   |   npm run test:live  (inclui Claude Code real)
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.argv.includes('--live')
const PORT = 18787
let pass = 0, fail = 0, skip = 0
const t = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? ' — ' + extra : ''}`) }
const sk = (name, why) => { skip++; console.log(`  ⏭  ${name} — ${why}`) }

// ---- unidade: analytics -----------------------------------------------------
const { analyze } = await import('../bridge/analytics.mjs')
const ex = JSON.parse(readFileSync(join(ROOT, 'knowledge/operacao.exemplo.json'), 'utf8'))
const a = analyze(ex)
console.log('\n[analytics]')
t('sem dados → "Não tenho esse dado disponível."', analyze(null).reason === 'Não tenho esse dado disponível.')
t('conversão = vendas/Q (2/9 = 22,2%)', a.dados.conversao === 22.2)
t('gap de casais = 20', a.dados.gap.casais === 20)
t('ritmo abaixo → META ABAIXO DO RITMO', a.alertas.some((x) => x.code === 'META_ABAIXO_DO_RITMO'))
t('recuperação detectada', a.alertas.some((x) => x.code === 'OPORTUNIDADE_RECUPERACAO'))
t('produtividade baixa aponta Captador B', a.equipe.atencao.includes('Captador B'))
t('acima da média aponta Captador A', a.equipe.destaque.includes('Captador A'))
const sem = analyze({ realizado: { casais: 5 }, meta: {} })
t('campos ausentes viram null (nunca inventa)', sem.dados.conversao === null && sem.dados.gap.casais === null && sem.alertas.length === 0)
const noPace = analyze({ meta: { casais: 40 }, realizado: { casais: 10 } })
t('sem progressoDia não há alerta de ritmo', !noPace.alertas.some((x) => x.code.startsWith('META_')))

// ---- unidade: importador do snapshot do dashboard (dados FICTÍCIOS, só em memória) ----
const { snapshotToOperacao } = await import('../bridge/dashboard-data.mjs')
const snapFx = { generatedAt: '2000-01-01T10:00:00Z', status: 'ok', buildStatus: 'built', queries: {
  daily_metrics: { rows: [{ metric: 'abc', actual: 1, target: 2, attainment: 50, gap: 1, unit: 'un' }] },
  casais_detail: { rows: [{ presencas: 20, qsRealizados: 8, nqsComPropostas: 2, nqsComVendas: 1, qMaisNqComProposta: 6, qMaisNqComVenda: 3, anoAnterior: 15, mesAnterior: 18 }] },
  cotas_detail: { rows: [{ propostas: 5, compradoresPropostas: 4, cotasVendidas: 3, metaCotas: 6, anoAnterior: 2, mesAnterior: 4, superMeta: 8, megaMeta: 10, metaEsparta: 12 }] },
  vgv_detail: { rows: [{ propostasVgv: 100, vendasVgv: 60, metaVgv: 120, eficienciaGeralPropostas: 1, eficienciaPropostas: 1, eficienciaMeta: 1, eficienciaAnoAnterior: 1, eficienciaMesAnterior: 1 }] } } }
const opFx = snapshotToOperacao(snapFx)
console.log('\n[dashboard → operacao.json]')
t('mapeia casais/Q/vendas/cotas/VGV', opFx.realizado.casais === 20 && opFx.realizado.q === 8 && opFx.realizado.vendas === 3 && opFx.realizado.cotas === 3 && opFx.realizado.vgv === 60)
t('derivados explícitos (NQ e Q com venda)', opFx.realizado.nq === 12 && opFx.realizado.qComVenda === 2 && opFx.derivados.length === 2)
t('não inventa o que o dashboard não traz', opFx.captadores.length === 0 && opFx.meta.casais === null && opFx.progressoDia === null)
const anFx = analyze(opFx)
t('análise do snapshot: atingimento cotas/VGV e conversão Q', anFx.dados.atingimentoCotas === 50 && anFx.dados.atingimentoVgv === 50 && anFx.dados.conversao === 25)
t('dados antigos geram aviso de defasagem', anFx.idadeDias > 1000 && /DEFASADOS/.test(anFx.avisos[0]))
t('avisa que não há dados por captador e cita a data', anFx.avisos.some((x) => /captador/.test(x)) && anFx.avisos.some((x) => /2000-01-01/.test(x)))

// ---- unidade: persona/modos/confirmação -------------------------------------
console.log('\n[persona]')
const P = await import('../bridge/persona.mjs')
t('detecta "modo reunião"', P.detectMode('Jarvis, modo reunião.') === 'reuniao')
t('detecta "modo liderança"', P.detectMode('jarvis modo lideranca') === 'lideranca')
t('detecta "modo análise"', P.detectMode('Jarvis, modo análise') === 'analise')
t('frase comum não muda modo', P.detectMode('como estamos hoje?') === null)
P.setMode('reuniao'); t('tag de modo injeta regras', P.modeTag().includes('MODO REUNIÃO')); P.setMode('padrao')
t('prompt cita "Cris", GAV e Vila Dia', /Cris/.test(P.PERSONA_PT) && /GAV Resorts/.test(P.PERSONA_PT) && /Vila Dia/.test(P.PERSONA_PT))
t('prompt proíbe inventar números', /NUNCA INVENTE NÚMEROS/.test(P.PERSONA_PT))
t('"confirmo" sem pendência não libera nada', !P.confirmPending())
P.notePending('Bash'); t('"confirmo" reconhecido', P.isConfirmation('Confirmo.'))
t('confirmação libera exatamente 1 chamada', P.confirmPending() && P.consumeGrant('Bash') && !P.consumeGrant('Bash'))
P.notePending('Write'); P.confirmPending(); t('grant não vale para outra ferramenta', !P.consumeGrant('Bash'))
t('"talvez" não é confirmação', !P.isConfirmation('talvez depois'))
P.noteAwaiting(); t('confirmação após a pergunta libera 1 chamada de qualquer ferramenta', P.confirmPending() && P.consumeGrant('Write') && !P.consumeGrant('Write'))
t('depois de usada, nova confirmação solta não libera', !P.confirmPending())

// ---- unidade: segredos e dashboard ------------------------------------------
console.log('\n[segurança/dashboard]')
const { redact } = await import('../bridge/home.mjs')
t('redact remove chave sk-…', !redact('usei sk-ant-abcdef1234567890 ok').includes('abcdef'))
t('redact remove api_key=…', !redact('api_key=SEGREDO123').includes('SEGREDO123'))
const { inspectDashboard } = await import('../bridge/ops.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'jv-'))
const fx = join(tmp, 'leao-da-vila-dashboard.html')
writeFileSync(fx, '<html><head><link href="x.css" rel="stylesheet"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><canvas id="g1"></canvas><table></table><script>const dados=[1,2];function render(){fetch("/api/kpis?token=abc")}</script></body></html>')
const insp = inspectDashboard(fx)
t('inspeção acha Chart.js, canvas, função e API', insp.chartLibraries.includes('Chart.js') && insp.htmlTags.canvas === 1 && insp.js.functions.includes('render') && insp.apis.length === 1)
rmSync(tmp, { recursive: true, force: true })
const { operationInsight, DATA_FILE } = await import('../bridge/ops.mjs')
if (!existsSync(DATA_FILE)) {
  writeFileSync(DATA_FILE, readFileSync(join(ROOT, 'knowledge/operacao.exemplo.json')))
  const g = operationInsight(); rmSync(DATA_FILE)
  t('operacao.json com dados de EXEMPLO é recusado', g.available === false && /EXEMPLO/.test(g.hint))
} else sk('guarda de dados fictícios', 'operacao.json real presente')

// ---- integração: bridge ------------------------------------------------------
console.log('\n[bridge]')
const env = { ...process.env, JARVIS_BRIDGE_PORT: String(PORT) }
const child = spawn(process.execPath, ['bridge/server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d))
const base = `http://127.0.0.1:${PORT}`
const get = async (p, o) => { try { const r = await fetch(base + p, o); return { s: r.status, b: await r.text() } } catch (e) { return { s: 0, b: String(e) } } }
let up = false
for (let i = 0; i < 40 && !up; i++) { up = (await get('/health')).s === 200; if (!up) await new Promise((r) => setTimeout(r, 250)) }
t('bridge inicia e responde /health', up)
const listening = /127\.0\.0\.1|listening/.test(out)
t('bridge escuta só em loopback', (await get('/health')).s === 200 && listening)
const st = JSON.parse((await get('/jarvis/status')).b || '{}')
t('/jarvis/status devolve só booleanos', st.bridge === true && typeof st.claude === 'boolean')
const ins = JSON.parse((await get('/jarvis/insight')).b || '{}')
t('/jarvis/insight sem dados reais → não inventa', existsSync(join(ROOT, 'knowledge/operacao.json')) || ins.available === false)
t('origem hostil é recusada (403)', (await get('/health', { headers: { origin: 'https://evil.example' } })).s === 403)
const dg = JSON.parse((await get('/jarvis/diagnostics')).b || '{}')
t('diagnóstico cobre bridge/frontend/claude/mcp/portas/dashboard/memória', ['bridge', 'frontend', 'claudeCode', 'mcp', 'portas', 'dashboard', 'memoria'].every((k) => k in dg))
t('/jarvis-widget.js servido', (await get('/jarvis-widget.js')).b.includes('JARVIS INTELLIGENCE'))

// WebSocket: handshake aceito/recusado
const wsOpen = (origin) => new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: origin ? { Origin: origin } : {} }); w.on('open', () => res({ w, ok: true })); w.on('error', () => res({ ok: false })); w.on('unexpected-response', () => res({ ok: false })) })
const good = await wsOpen('http://localhost:5173'); t('frontend↔bridge: WebSocket aceita origem local', good.ok)
const bad = await wsOpen('https://evil.example'); t('WebSocket recusa origem externa', !bad.ok)

if (LIVE && good.ok) {
  console.log('\n[claude code — ao vivo]')
  const ask = (text) => new Promise((res) => { let acc = ''; const to = setTimeout(() => res(acc || null), 120000)
    good.w.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'text') acc += m.delta; if (m.type === 'turn' && m.done || m.type === 'done' || m.type === 'end') { clearTimeout(to); res(acc) } })
    good.w.send(JSON.stringify({ type: 'ask', id: 'q1', text })) ; setTimeout(() => { clearTimeout(to); res(acc || null) }, 60000) })
  const r = await ask('Responda apenas com a palavra: PRONTO')
  t('Claude Code recebe e responde via bridge', typeof r === 'string' && /pronto/i.test(r), JSON.stringify(r))
} else if (!LIVE) sk('Claude Code ao vivo', 'use npm run test:live')

try { good.w?.close() } catch { /* fecha */ }
child.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 400))
t('STOP: processo da bridge encerra', child.killed || child.exitCode !== null)
console.log(`\nResultado: ${pass} ok · ${fail} falhas · ${skip} ignorados`)
process.exit(fail ? 1 : 0)
