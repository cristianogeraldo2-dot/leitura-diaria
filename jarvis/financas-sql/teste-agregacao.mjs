// Testa a regra de soma usada na tela do app: despesa soma, estorno abate, o resto não entra no gasto.
// Roda com: node financas-sql/teste-agregacao.mjs
const efeito = (t) => (t.natureza === 'estorno' ? -Number(t.valor || 0) : Number(t.valor || 0))
const agrega = (l) => { const m = {}; for (const t of l) { const n = t.categoria || 'Sem categoria'; m[n] = (m[n] || 0) + efeito(t) } return m }
const ok = (n, c) => { console.log((c ? 'OK  ' : 'FALHOU ') + n); if (!c) process.exitCode = 1 }
const r = agrega([{ natureza: 'despesa', valor: 100, categoria: 'Lazer' }, { natureza: 'estorno', valor: 30, categoria: 'Lazer' }, { natureza: 'despesa', valor: 50 }])
ok('estorno abate a mesma categoria', r.Lazer === 70)
ok('sem categoria conta como despesa', r['Sem categoria'] === 50)
