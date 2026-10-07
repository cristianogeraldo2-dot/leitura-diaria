# Módulo Instagram do JARVIS

## Etapa 1 (pronta): criar, guardar e ranquear — sem acesso à conta
- `modo conteúdo` / `modo instagram`: o JARVIS passa a criar Reels, posts, carrosséis e stories.
- Perfil de marca (`instagram_perfil`): @, nicho, público, tom, metas, temas, o que evitar. Ele pergunta UMA coisa por vez.
- Rascunhos (`instagram_rascunho_salvar`, `instagram_rascunhos`, `instagram_aprovar`) em `knowledge/instagram/` (fora do Git).
  Aprovar **não publica**.
- Melhores posts: exporte o Insights (CSV/XLSX), salve em `knowledge/instagram/entrada`, e peça
  "Jarvis, importe as métricas do arquivo X" / "quais foram meus melhores posts".
  Taxa = (curtidas + 2×comentários + 3×salvamentos + 3×compartilhamentos) ÷ alcance.
- Sem dado, ele diz "Não tenho esse dado disponível".

## Etapa 2 (futura, só com autorização): publicar pela API oficial
Pré-requisitos que dependem da Cris:
1. Conta do Instagram **Profissional** (Criador ou Comercial) ligada a uma **Página do Facebook**.
2. App no Meta for Developers com permissão de publicação (`instagram_content_publish`).
3. Token de acesso guardado **só** em `jarvis-secrets.cmd` (nunca no chat, nunca no Git).
Limites técnicos: a API publica a partir de **URL pública** de imagem/vídeo (não aceita arquivo local),
e Reels exigem vídeo já pronto. Toda publicação passa pela confirmação por voz ("Confirma, Cris?").
Não será usada automação de navegador no site do Instagram (viola os termos e pode bloquear a conta).
