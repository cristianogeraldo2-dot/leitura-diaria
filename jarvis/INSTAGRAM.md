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

## Etapa 2 (código pronto; falta a credencial da Cris): publicar pela API oficial
Pré-requisitos que dependem da Cris:
1. Conta do Instagram **Profissional** (Criador ou Comercial) ligada a uma **Página do Facebook**.
2. App no Meta for Developers com permissão de publicação (`instagram_content_publish`).
3. Token de acesso guardado **só** em `jarvis-secrets.cmd` (nunca no chat, nunca no Git).
Limites técnicos: a API publica a partir de **URL pública** de imagem/vídeo (não aceita arquivo local),
e Reels exigem vídeo já pronto. Toda publicação passa pela confirmação por voz ("Confirma, Cris?").
Não será usada automação de navegador no site do Instagram (viola os termos e pode bloquear a conta).

### Passo a passo (a interface da Meta muda; confira em developers.facebook.com)
1. Conta Profissional ligada a uma Página do Facebook (feito).
2. developers.facebook.com → **Meus apps → Criar app** (tipo Empresa) → adicione o produto de Instagram.
3. **Explorador da Graph API**: escolha o app, **Gerar token de acesso de usuário** com as permissões
   `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`.
   (Em modo de desenvolvimento, sendo administradora do app, não precisa de revisão da Meta para a própria conta.)
4. No PowerShell (o token fica só nesta janela): `$env:IG_ACCESS_TOKEN = Read-Host "Cole o token"` e `npm.cmd run ig:descobrir`.
   Ele mostra o **IG_USER_ID** da sua conta.
5. Copie `jarvis-secrets.example.cmd` para `jarvis-secrets.cmd` e preencha `IG_ACCESS_TOKEN` e `IG_USER_ID`. Reinicie.
6. Peça "Jarvis, verifique a conexão do Instagram" (só leitura).
Tokens de usuário expiram (curtos em minutos/horas; os de longa duração em ~60 dias): será preciso renová-los.
Publicar: só rascunho **aprovado** com `midiaUrls` https públicas; sempre com "Confirma, Cris?".
