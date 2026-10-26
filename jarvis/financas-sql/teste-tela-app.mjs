// Teste da função carregarFinancas() do app (leitura-lider/index.html) com um cliente Supabase simulado.
// Os dados são fabricados só para o teste; servem para provar a lógica, não são seus lançamentos.
// Uso: node financas-sql/teste-tela-app.mjs /caminho/leitura-lider/index.html
import { readFileSync } from 'node:fs'
const html = readFileSync(process.argv[2], 'utf8')
const i = html.indexOf('async function carregarFinancas(){'), j = html.indexOf('async function dispensarAlerta')
const src = html.slice(i, j)
let ok = 0, falha = 0
const t = (n, c) => { console.log((c ? 'OK  ' : 'FALHOU ') + n); c ? ok++ : falha++ }

const log = []
const dados = (tab, f) => {
  if (tab === 'accounts') return [{ balance: 100, account_type: 'checking', is_active: true }, { balance: 5000, account_type: 'credit_card', is_active: true }]
  if (tab !== 'v_transactions_normalized') return []
  if (f.eq.prevista) return [{ valor: 845.19, natureza: 'despesa', data_transacao: '2099-01-28', description: 'parcela futura' }]
  if (/amount:valor_original/.test(f.select)) return [{ amount: 50, date: '2026-10-21', natureza: 'despesa', description: 'compra no cartão', account_type: 'credit_card' }, { amount: -300, date: '2026-10-20', natureza: 'pagamento_fatura', description: 'pagamento de fatura', account_type: 'credit_card' }]
  const mesAtual = !!f.gte.data_transacao && f.gte.data_transacao.endsWith('-01') && !f.lt.data_transacao?.endsWith('undefined')
  return [{ valor: 100, natureza: 'despesa', categoria: 'Lazer' }, { valor: 30, natureza: 'estorno', categoria: 'Lazer' }, { valor: 70, natureza: 'despesa', categoria: null }]
}
const sb = { from(tab) {
  const f = { tab, eq: {}, gte: {}, lt: {}, select: '' }; log.push(f)
  const o = {}
  for (const m of ['order', 'limit', 'is', 'in', 'maybeSingle']) o[m] = () => o
  o.select = (c) => { f.select = c; return o }
  o.eq = (k, v) => { f.eq[k] = v; return o }
  o.gte = (k, v) => { f.gte[k] = v; return o }
  o.lt = (k, v) => { f.lt[k] = v; return o }
  o.then = (res) => res({ data: dados(tab, f) })
  return o } }
let dadosFinancas = null, financasCarregando = false
const abaAtual = 'x', renderContent = () => {}
const fn = new Function('sb', 'abaAtual', 'renderContent', `let dadosFinancas=null, financasCarregando=false; ${src}; return carregarFinancas().then(()=>dadosFinancas)`)
const r = await fn(sb, abaAtual, renderContent)

t('não lê mais a tabela transactions diretamente', !log.some((f) => f.tab === 'transactions'))
t('lê pela visão normalizada', log.filter((f) => f.tab === 'v_transactions_normalized').length === 4)
t('lista recente só traz o que já aconteceu', log.some((f) => /amount:valor_original/.test(f.select) && f.eq.realizada === true))
t('previstos vêm de consulta separada', log.some((f) => f.eq.prevista === true) && r.previstas.length === 1)
t('gasto do mês = despesas − estornos', Math.round(r.totalGastoMes) === 140)
t('estorno abate na categoria', Math.round(r.categorias.find((c) => c.nome === 'Lazer').total) === 70)
t('sem categoria conta como despesa', Math.round(r.categorias.find((c) => c.nome === 'Sem categoria').total) === 70)
t('pagamento de fatura aparece na lista com a natureza, sem entrar no gasto', r.txs.some((x) => x.natureza === 'pagamento_fatura') && r.totalGastoMes === 140)
console.log(`\n${ok} ok, ${falha} falhas`); process.exit(falha ? 1 : 0)
