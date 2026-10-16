import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importarRascunhos } from '../bridge/marketing.mjs'

/** Importa rascunhos de conteudo/*.json para knowledge/instagram/rascunhos. Nada é publicado. */
const arquivo = resolve(process.argv[2] ?? 'conteudo/semana-01.json')
const lista = JSON.parse(readFileSync(arquivo, 'utf8'))
const r = importarRascunhos(lista)
for (const x of r) {
  console.log(`${x.ok ? 'OK ' : '-- '} ${x.titulo}${x.ok ? `  [${x.tipo}] ${x.agendadoPara ?? 'sem horário'}  id=${x.id}` : `  (${x.motivo})`}`)
  for (const a of x.revisao ?? []) console.log(`     aviso: ${a}`)
}
console.log(`\n${r.filter((x) => x.ok).length} rascunho(s) salvo(s) em knowledge/instagram/rascunhos. Nada foi publicado.`)
