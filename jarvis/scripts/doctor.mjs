#!/usr/bin/env node
// Verificação completa e SEGURA do JARVIS CORE (somente leitura; não instala nada, não liga escrita).
// Uso: npm run doctor
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const rd = (f) => readFileSync(join(ROOT, f), 'utf8')
let bad = 0
const rows = []
const ok = (g, n, v, note = '') => { rows.push([g, v === true ? '✅' : v === 'warn' ? '⚠️' : '❌', n, note]); if (v === false) bad++ }

// Ambiente
const major = Number(process.versions.node.split('.')[0])
ok('Ambiente', `Node ${process.versions.node} (>=20)`, major >= 20)
const cl = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 10000, shell: process.platform === 'win32' })
let li = false; try { li = JSON.parse(cl.stdout).loggedIn === true } catch { /* sem CLI */ }
ok('Ambiente', 'Claude Code instalado e logado', li, li ? '' : 'rode `claude` e faça login')
ok('Ambiente', 'JARVIS_WRITES/JARVIS_ALLOW_WRITES desligados', process.env.JARVIS_WRITES !== '1' && process.env.JARVIS_ALLOW_WRITES !== '1')
ok('Ambiente', 'dependências instaladas (node_modules)', existsSync(join(ROOT, 'node_modules')))
for (const port of [8787, 5173]) {
  const free = await new Promise((r) => { const s = createServer(); s.once('error', () => r(false)); s.once('listening', () => s.close(() => r(true))); s.listen(port, '127.0.0.1') })
  ok('Portas', `${port} livre`, free ? true : 'warn', free ? '' : 'em uso (JARVIS já rodando ou outro app)')
}

// Launchers (validação estática — não executa cmd)
for (const f of ['START-JARVIS.cmd', 'STOP-JARVIS.cmd', 'RESTART-JARVIS.cmd']) {
  if (!existsSync(join(ROOT, f))) { ok('Launchers', f, false, 'ausente'); continue }
  const b = readFileSync(join(ROOT, f))
  const txt = b.toString('latin1')
  ok('Launchers', `${f}: CRLF`, !/[^\r]\n/.test(txt))
  ok('Launchers', `${f}: ASCII puro`, ![...b].some((c) => c > 127))
}
const start = rd('START-JARVIS.cmd')
ok('Launchers', 'START: checa Node 20+ e Claude Code', /where node/.test(start) && /LSS 20/.test(start) && /where claude/.test(start))
ok('Launchers', 'START: modo seguro por padrão (sem --writes fixo)', !/npm start --? ?--writes/.test(start.replace(/%WRITEFLAG%/g, '')) && /JARVIS_WRITES/.test(start))
ok('Launchers', 'STOP: mata só node/chrome do JARVIS', /stop-jarvis\.ps1/.test(rd('STOP-JARVIS.cmd')) && /node\.exe/.test(rd('STOP-JARVIS.cmd')))
ok('Launchers', 'jarvis.ps1 sem --writes incondicional', !/'--writes'\s*\|/.test(rd('jarvis.ps1')) && /JARVIS_WRITES -eq '1'/.test(rd('jarvis.ps1')))
for (const v of ['start-jarvis.vbs', 'stop-jarvis.vbs', 'show-jarvis.vbs']) ok('Launchers', `${v} existe`, existsSync(join(ROOT, v)))
ok('Launchers', 'execução real do .cmd', 'warn', 'só no Windows — rode START-JARVIS.cmd manualmente')

// Voz / wake word (estático: regex e idioma)
const voice = rd('src/lib/voice.ts')
const m = /const WAKE =\s*\/(.+)\/i\r?\n/.exec(voice) // aceita CRLF (arquivos no Windows)
const WAKE = m ? new RegExp(m[1], 'i') : null
ok('Voz', 'regex da wake word encontrada', Boolean(WAKE))
if (WAKE) {
  const yes = ['Hey Jarvis', 'hey jarvis, status da operação', 'Ei Jarvis', 'Oi Jarvis', 'jarvis', 'Járvis', 'e aí jarvis', 'hey travis', 'Hey Jarvas']
  const no = ['bom dia a todos', 'vamos fechar a meta', "jarvis's job"]
  ok('Voz', `wake word reconhece ${yes.length} variações`, yes.every((t) => WAKE.test(t)), yes.filter((t) => !WAKE.test(t)).join(', '))
  ok('Voz', 'wake word não dispara em frases comuns', no.every((t) => !WAKE.test(t)))
}
ok('Voz', 'reconhecimento em pt-BR', /rec\.lang = 'pt-BR'/.test(voice))
ok('Voz', 'síntese prefere vozes pt-BR', /pt\[-_\]br/i.test(rd('src/lib/tts.ts')))
ok('Voz', 'barge-in (VAD local) presente', existsSync(join(ROOT, 'src/lib/vad.ts')) && /onSpeechStart/.test(rd('src/App.tsx')))
ok('Voz', 'microfone / fala real', 'warn', 'só no navegador do Windows: tecle D (diagnóstico) e T (autoteste)')

// Conhecimento / dados / dashboard
const kn = join(ROOT, 'knowledge')
const files = existsSync(kn) ? readdirSync(kn).filter((f) => f !== '.gitkeep') : []
ok('Dados', 'pasta knowledge presente', existsSync(kn), files.join(', '))
const opFile = join(kn, 'operacao.json')
if (!existsSync(opFile)) ok('Dados', 'operacao.json', 'warn', 'AUSENTE — forneça os dados reais (knowledge/DADOS-NECESSARIOS.md)')
else {
  let d = null; try { d = JSON.parse(readFileSync(opFile, 'utf8')) } catch { /* inválido */ }
  if (!d) ok('Dados', 'operacao.json é JSON válido', false)
  else if (d._aviso || /^(1999|2000)-/.test(String(d.data ?? ''))) ok('Dados', 'operacao.json', 'warn', 'ainda é o EXEMPLO fictício — o JARVIS recusa analisá-lo')
  else {
    const miss = ['meta', 'realizado', 'captadores'].filter((k) => !d[k] || (Array.isArray(d[k]) && !d[k].length))
    ok('Dados', 'operacao.json real', miss.length ? 'warn' : true, miss.length ? `faltam: ${miss.join(', ')}` : `${d.captadores.length} captadores`)
  }
}
const { findDashboard } = await import('../bridge/ops.mjs')
const dash = findDashboard()
ok('Dados', 'leao-da-vila-dashboard.html', dash ? true : 'warn', dash ?? 'NÃO ENCONTRADO — coloque em knowledge/ ou defina JARVIS_DASHBOARD')

// Segurança do repositório
const gi = rd('.gitignore')
ok('Segurança', '.gitignore protege memory/logs/knowledge/backups/segredos', ['memory/*', 'knowledge/*', 'logs/*', 'backups/*', 'jarvis-secrets.cmd', '.env'].every((p) => gi.includes(p)))
const tracked = spawnSync('git', ['ls-files', '--', 'logs', 'memory', 'backups', 'config', 'knowledge'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter((f) => f && !/\.gitkeep$|operacao\.(exemplo|template)\.json$|DADOS-NECESSARIOS\.md$/.test(f))
ok('Segurança', 'nenhum dado/segredo versionado', tracked.length === 0, tracked.join(', '))
ok('Segurança', 'bridge só em 127.0.0.1', /listen\(PORT, '127\.0\.0\.1'\)/.test(rd('bridge/server.mjs')))
ok('Segurança', 'camada de confirmação ativa', /consumeGrant/.test(rd('bridge/server.mjs')))

const w = Math.max(...rows.map((r) => r[2].length))
let g = ''
for (const [grp, mark, name, note] of rows) { if (grp !== g) { console.log(`\n${grp}`); g = grp } console.log(`  ${mark} ${name.padEnd(w)}${note ? '  ' + note : ''}`) }
console.log(`\n${bad ? `❌ ${bad} falha(s) real(is)` : '✅ nenhuma falha'} · ⚠️ = pendência que depende de você/Windows`)
process.exit(bad ? 1 : 0)
