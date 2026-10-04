# Dados que o JARVIS precisa (fornecidos por você — nunca inventados)

Copie `operacao.template.json` para `operacao.json` e preencha. Campo `null`/ausente = "Não tenho esse dado disponível."

| Campo | O que é | Para que serve |
|---|---|---|
| `data` | data do levantamento (AAAA-MM-DD) | contexto do briefing |
| `progressoDia` | fração do turno decorrida (0 a 1; ex.: 0.6) | alerta de ritmo e recuperação |
| `meta.casais / vendas / vgv / cotas` | metas do dia | gap e atingimento |
| `realizado.casais / q / nq / vendas / cotas / vgv` | números até agora | status, conversão, VGV |
| `historico[]` | dias anteriores: `data, casais, q, vendas` | alerta CONVERSÃO CAINDO |
| `captadores[]` | `nome, casais, q, nq, vendas, vgv` (~20) | ranking, produtividade, atenção |

Também: `leao-da-vila-dashboard.html` nesta pasta (ou `JARVIS_DASHBOARD=caminho`).
Arquivos reais aqui ficam fora do Git.
