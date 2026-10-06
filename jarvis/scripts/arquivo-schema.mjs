#!/usr/bin/env node
// Mostra a ESTRUTURA de uma planilha exportada (CSV ou XLSX): colunas, tipo provável, preenchimento. SEM valores.
//   npm run arquivo:schema -- "C:\caminho\exportacao.xlsx"
import { readTable, describeTable } from '../bridge/tabular.mjs'
const file = process.argv.slice(2).find((a) => !a.startsWith('--'))
if (!file) { console.log('Informe o arquivo: npm run arquivo:schema -- "C:\\caminho\\exportacao.xlsx"'); process.exit(1) }
let t
try { t = readTable(file) } catch (e) { console.log(`Não consegui ler o arquivo: ${e.message}`); process.exit(1) }
const d = describeTable(t)
console.log(`Arquivo: ${file}\nLinhas de dados: ${d.linhas}\nColunas: ${d.colunas.length}\n`)
for (const c of d.colunas) console.log(`  - "${c.nome}"  tipo: ${c.tipo}  preenchidas: ${c.preenchidas}/${d.linhas}  valores distintos: ${c.distintos}`)
