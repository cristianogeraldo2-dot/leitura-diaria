# J.A.R.V.I.S. — PERSONAL INTELLIGENCE SYSTEM (versão da Cris)

Base: [ehteshambuildagents/jarvis](https://github.com/ehteshambuildagents/jarvis) (MIT). Cérebro: **Claude Code** (via Agent SDK, reutiliza o seu login — sem API key).
Esta pasta adiciona: persona em português, contexto Vila Dia/GAV, modos, camada analítica, confirmação por voz, painel JARVIS INTELLIGENCE, integração com dashboard, logs, diagnóstico e launchers Windows em modo seguro.

## Iniciar no Windows
Pré-requisitos: Node 20+, Git, Claude Code (`npm i -g @anthropic-ai/claude-code`, rode `claude` uma vez e faça login), Chrome ou Edge.

| Arquivo | Faz |
|---|---|
| `START-JARVIS.cmd` | Verifica Node/Claude, instala dependências na 1ª vez, sobe bridge + interface e abre o navegador (modo seguro) |
| `START-JARVIS.cmd hidden` | Sem janelas; interface fora da tela, wake word ativa em segundo plano (`show-jarvis.vbs` traz de volta) |
| `STOP-JARVIS.cmd` | Para só o que o JARVIS iniciou |
| `RESTART-JARVIS.cmd` | Stop + Start |

Na interface: clique **INITIALISE**, permita o microfone, diga **"Hey Jarvis"** → *"Sim, Cris. Estou ouvindo."* Também: **Espaço** = falar sem wake word; falar por cima = barge-in; **D** = diagnóstico de áudio; **T** = autoteste de voz.
Wake word, voz e microfone usam o reconhecimento/síntese do navegador (pt-BR). Opcional: `ELEVENLABS_API_KEY` em `jarvis-secrets.cmd` (ignorado pelo Git) para voz/transcrição melhores.

## Dados da operação (nada é inventado)
Copie `knowledge/operacao.exemplo.json` para `knowledge/operacao.json` e preencha com números **reais** (o exemplo é fictício). Campos: `meta`, `realizado` (casais, q, nq, vendas, cotas, vgv), `progressoDia` (0–1, para avaliar ritmo), `historico` (dias anteriores, para tendência de conversão) e `captadores[]`.
Definições (ajustáveis em `bridge/analytics.mjs`): taxa de Q = Q ÷ casais · conversão = vendas ÷ Q · ritmo = atingimento ÷ progressoDia. Sem o dado → **"Não tenho esse dado disponível."**
Alertas gerados só dos dados: ⚠ META ABAIXO DO RITMO · ⚠ CONVERSÃO CAINDO · ⚠ PRODUTIVIDADE BAIXA · ✓ META NO RITMO · ✓ PERFORMANCE ACIMA DA MÉDIA · 🔥 OPORTUNIDADE DE RECUPERAÇÃO.

## Comandos de voz
Status da operação · Faça meu briefing (10 blocos) · Como estamos contra a meta · Quem está performando melhor · Onde está nosso gargalo · Analise os captadores · Me dê três ações para melhorar a captação · Abra meu dashboard · Atualize o dashboard · Faça uma análise executiva · **Modo reunião / liderança (FATO-COMPORTAMENTO-IMPACTO-AÇÃO) / análise / padrão** · Diagnóstico · "Anote isso…" (memória) · "Jarvis, logout / até logo" (standby).

## Dashboard `leao-da-vila-dashboard.html`
Coloque o arquivo em `knowledge/` (ou `JARVIS_DASHBOARD=caminho`). "Abra meu dashboard" faz **backup** em `backups/`, inspeciona HTML/CSS/JS/APIs/gráficos e abre `http://localhost:8787/dashboard`, que serve o dashboard **com o widget JARVIS INTELLIGENCE injetado só na resposta** — o arquivo original nunca é alterado.

## Segurança
- Bridge só em `127.0.0.1`; WebSocket só de origens locais.
- Começa **somente leitura**. Ferramenta que altera algo é negada; o JARVIS explica (ferramenta, o que faz, impacto), pergunta *"Confirma, Cris?"* e só após "confirmo" executa **uma** chamada. Nova ação → nova confirmação.
- `memory/ knowledge/ logs/ config/ backups/` e segredos ficam fora do Git; logs redigem chaves/tokens.
- `npm run setup:mcp` só mostra os MCPs existentes; `-- --apply` faz backup de `~/.claude.json` e adiciona **apenas** o chrome-devtools. Controle do navegador com cliques exige `JARVIS_WRITES=1` (o bridge só monta as ferramentas de ação nesse modo).

## Testes
`npm test` (36 verificações offline: análise, modos, confirmação, redação de segredos, inspeção de dashboard, bridge, origens, diagnóstico) · `npm run test:live` (inclui Claude Code real) · `npm run lint` · `npm run build`.
