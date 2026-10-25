// Prepara a semana: importa os rascunhos, cria as artes (JPEG) e, com --aprovar-automatico, aprova os que passam na revisão.
// NÃO publica: quem publica é o piloto (JARVIS_IG_AUTOPOST=1) no horário de cada peça.
//   cmd /c "call jarvis-secrets.cmd && npm.cmd run ig:semana -- conteudo/semana-02.json --aprovar-automatico"
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { importarRascunhos, revisarRascunho } from '../bridge/marketing.mjs'
import { createStore } from '../bridge/instagram.mjs'
import { produzirImagens } from '../bridge/video-factory.mjs'

const args = process.argv.slice(2)
const arquivo = resolve(args.find((a) => !a.startsWith('--')) ?? 'conteudo/semana-02.json')
const aprovar = args.includes('--aprovar-automatico')
const lista = JSON.parse(readFileSync(arquivo, 'utf8'))
const store = createStore()
importarRascunhos(lista, store)
let ok = 0, falhas = 0, aprovados = 0, bloqueados = 0
for (const d of lista) {
  const x = store.listar().find((r) => r.titulo === d.titulo && (r.campanha ?? '') === (d.campanha ?? ''))
  if (!x || x.status === 'publicado') continue
  if (!(x.midiaLocal ?? []).length && (d.tipo === 'post' || d.tipo === 'story')) {
    const r = await produzirImagens({ titulo: x.titulo, campanha: x.campanha, slides: [{ texto: d.textoNaArte }], formato: d.tipo === 'story' ? '9:16' : '4:5' })
    const jpg = r.arquivosJpeg?.[0]
    if (!r.ok || !jpg) { falhas++; console.log(`-- sem arte: ${x.titulo} (${r.motivo ?? r.avisosJpeg?.join('; ')})`); continue }
    store.anexar(x.id, { midiaLocal: [jpg] })
  }
  ok++
  if (aprovar) {
    const rev = revisarRascunho(store.obter(x.id))
    if (rev.aprovadoParaPublicar) { store.aprovar(x.id); aprovados++ } else { bloqueados++; console.log(`!! NÃO aprovado (${x.titulo}): ${rev.avisos.join(' | ')}`) }
  }
}
console.log(`\nArtes prontas: ${ok} | sem arte: ${falhas} | aprovadas: ${aprovados} | bloqueadas pela revisão: ${bloqueados}. Nada foi publicado agora.`)
