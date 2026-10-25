# Etapa 2: Diretor de Marketing (projeto dos 7 módulos)

Escopo autorizado: **projetar** os módulos e mapear o que já existe no JARVIS. Este documento não publica nada, não cria campanhas, não gasta dinheiro e não liga piloto automático. Publicar (Etapa 3 em diante) continua exigindo nova autorização expressa.

Regra de ouro de todos os módulos: o JARVIS **propõe**, a Cris **confirma** ("Confirma, Cris?" → "confirmo"). Nunca inventar número: sem dado, responder "Não tenho esse dado disponível".

## Estado por módulo

| # | Módulo | O que já existe (código) | Lacuna | Próximo incremento proposto |
|---|---|---|---|---|
| 1 | Estratégia, posicionamento, público | `MARCA` em `bridge/marketing.mjs` (Liderança, Performance, Legado; regras de conteúdo); `marketing_campanha_definir` | Estratégia só em código, sem documento editável por você | Arquivo `config/estrategia.json` (pilares, tom, proibições, metas) lido por `MARCA`; você edita, o JARVIS respeita |
| 2 | Planejamento editorial semanal | `conteudo/semana-01.json`, `scripts/ig-rascunhos-importar.mjs`, `instagram_rascunho_salvar` | Semana criada à mão; sem proposta automática da semana seguinte | Tool `marketing_semana_propor`: gera a semana (mix post/carrossel/Reels/Story por pilar) como **rascunho**, sem agendar |
| 3 | Legendas, carrosséis, roteiros | Rascunhos com `legenda`, `textoNaArte`, `marketing_revisar` (checa regras da marca) | Roteiros de Reels/Story sem formato padrão | Modelo de roteiro (gancho 3 s, desenvolvimento, CTA) validado por `marketing_revisar` |
| 4 | Imagens e vídeos | `imagem_produzir`, `video_produzir`, `video_validar`, `bridge/media-prep.mjs`, Supabase (Etapa 1, validado) | Organização por campanha/semana na pasta | Pasta `saida/AAAA-Sww/` com nome padronizado e índice; sem apagar originais |
| 5 | Calendário IG e Facebook | `agendadoPara` nos rascunhos, `agenda()`/`proximaAcao`, painel `Marketing.tsx` | Facebook não existe; calendário não é visual | Campo `canais: [instagram, facebook]` no rascunho (só planejamento) e visão semanal no painel |
| 6 | Métricas e conversões | `instagram_metricas_importar`, `instagram_melhores`, `marketing_aprendizado_registrar`; leitura via Windsor | Importação manual; conversão (cliques no link) hoje 0 e sem rastreio | Importar métricas por arquivo/Windsor (somente leitura) e registrar o que funcionou; links com UTM quando houver link |
| 7 | Relatório executivo | `marketing_painel` | Sem relatório semanal fechado | Tool `marketing_relatorio_semanal`: resultados reais, problemas, 3 próximas ações; campos sem dado ficam "Não tenho esse dado disponível" |

## Ordem sugerida (cada item pequeno e reversível)

1. Relatório semanal (módulo 7), somente leitura: menor risco, maior valor.
2. Estratégia em arquivo editável (módulo 1).
3. Proposta de semana como rascunho (módulos 2 e 3).
4. Organização de mídia por semana (módulo 4).
5. Campo de canal e calendário visual (módulo 5).
6. Importação de métricas e UTM (módulo 6).

## Riscos e pontos de atenção

- **Desempenho real** (dados já vistos): retenção baixa em Reels (abandono de 66 a 81%), poucos salvamentos, 0 cliques no link e audiência majoritariamente estrangeira. O relatório deve mostrar isso sem maquiar.
- **Facebook**: ainda não há integração nem credencial; hoje é só planejamento.
- **Windsor**: plano gratuito com 1 fonte de dados; ações de escrita exigem confirmação sua a cada uso.
- **Meta ainda não validada** com a URL assinada do Supabase (só uma publicação de teste mostraria; não autorizada).

## Fora do escopo desta autorização

Publicar, agendar na Meta, anúncios, n8n, piloto automático (`JARVIS_IG_AUTOPOST` permanece 0) e alterar permissões de contas sociais.

## Como reverter

Este documento é só texto. Para desfazer: `git revert` do commit que o criou.
