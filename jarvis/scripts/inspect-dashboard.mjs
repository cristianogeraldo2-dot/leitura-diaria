#!/usr/bin/env node
// Inspeciona o leao-da-vila-dashboard.html (SOMENTE LEITURA; o arquivo nunca é alterado).
//   npm run inspect:dashboard                 procura o arquivo nos locais de sempre
//   npm run inspect:dashboard -- "C:\caminho\arquivo.html"
//   adicione --backup para copiar o original para backups/ (cópia, não move)
// Não imprime o conteúdo do HTML nem valores de dados; só a estrutura.
import { findDashboard, inspectDashboard, backupDashboard } from '../bridge/ops.mjs'
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'))
const file = arg ?? findDashboard()
if (!file) { console.log('Dashboard não encontrado. Informe o caminho: npm run inspect:dashboard -- "C:\\...\\leao-da-vila-dashboard.html"'); process.exit(1) }
const info = inspectDashboard(file)
if (process.argv.includes('--backup')) info.backup = backupDashboard(file)
console.log(JSON.stringify(info, null, 2))
