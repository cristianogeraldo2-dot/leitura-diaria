#!/usr/bin/env node
// Importa os dados do "Radar Vila Dia" (exportados pelo artefato) para knowledge/operacao.json.
//   npm run radar:import -- --clipboard            lê o JSON copiado (botão "Copiar para o JARVIS" do Radar)
//   npm run radar:import -- "C:\caminho\radar-export.json"
// Faz backup do operacao.json anterior. Não imprime valores de negócio.
import { existsSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
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

/** Procura o arquivo salvo mais recente com "radar" no nome (json ou txt) nas pastas de sempre. */
function procurar() {
  const pastas = ['Downloads', 'Desktop', 'Documents', 'OneDrive/Desktop', 'OneDrive/Documentos', 'OneDrive/Área de Trabalho'].map((d) => join(homedir(), d))
  const achados = []
  for (const dir of pastas) {
    try {
      for (const f of readdirSync(dir)) {
        if (/radar.*\.(json|txt)$/i.test(f)) { const full = join(dir, f); achados.push([full, statSync(full).mtimeMs]) }
      }
    } catch { /* pasta inexistente */ }
  }
  return achados.sort((a, b) => b[1] - a[1]).map(([f]) => f)
}

const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
let raw = ''
if (process.argv.includes('--colar')) {
  // Cola direto no terminal: o JSON do Radar é uma linha só.
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log('Cole o texto copiado do Radar (clique com o botão direito no PowerShell) e tecle Enter.')
  raw = await rl.question('> ')
  rl.close()
} else if (process.argv.includes('--clipboard')) raw = clipboard()
else {
  let alvo = arg
  if (!alvo || !existsSync(alvo)) {
    const cand = procurar()
    if (arg && !existsSync(arg)) console.log(`Não encontrei o arquivo: ${arg}`)
    if (!cand.length) {
      console.log('Também não achei nenhum arquivo com "radar" no nome em Downloads, Desktop ou Documents.')
      console.log('Dica: no Bloco de Notas, em "Salvar como", escolha o tipo "Todos os arquivos" e digite o nome radar-export.json')
      console.log('(se o tipo for "Documentos de texto", ele salva como radar-export.json.txt). Depois rode de novo: npm.cmd run radar:import')
      process.exit(1)
    }
    alvo = cand[0]
    console.log(`Usando o arquivo mais recente encontrado: ${alvo}`)
  }
  raw = readFileSync(alvo, 'utf8')
}
if (!raw.trim()) { console.log('Nada para importar. No Radar, toque em "Copiar para o JARVIS" e rode: npm.cmd run radar:import -- --colar\n(ou --clipboard, ou informe o caminho de um arquivo .json).'); process.exit(1) }
// Tenta o texto inteiro; se falhar, tenta só o trecho entre a primeira "{" e a última "}".
function tentar(txt) { try { return JSON.parse(txt) } catch { return undefined } }
const limpo = raw.replace(/^\uFEFF/, '').trim()
let json = tentar(limpo)
if (json === undefined) {
  const a = limpo.indexOf('{'), b = limpo.lastIndexOf('}')
  if (a >= 0 && b > a) json = tentar(limpo.slice(a, b + 1))
}
if (json === undefined) {
  // Diagnóstico sem expor dados: tamanho, primeiro caractere e se parece um comando/texto comum.
  const inicio = limpo.startsWith('{') ? 'começa com "{" mas está incompleto ou cortado' : `começa com "${limpo.slice(0, 20).replace(/[\r\n]+/g, ' ')}"`
  console.log(`O conteúdo não é um JSON válido (${limpo.length} caracteres; ${inicio}).`)
  console.log('O JSON do Radar começa com {"exportVersion":1 e tem milhares de caracteres.')
  console.log('Alternativa sem área de transferência: no Radar, selecione o texto da caixa embaixo do botão,')
  console.log('cole no Bloco de Notas, salve como radar-export.json e rode: npm run radar:import -- "C:\\caminho\\radar-export.json"')
  process.exit(1)
}
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
