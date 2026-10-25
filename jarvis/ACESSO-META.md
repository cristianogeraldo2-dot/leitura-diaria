# Acesso oficial da Meta (você faz; eu não tenho acesso à sua conta)

Tudo em **developers.facebook.com**. Valores secretos ficam só no `jarvis-secrets.cmd`. Nunca no chat.

1. Instagram **Profissional** (Criador/Comercial) ligado à Página "Cristiano geraldo".
2. developers.facebook.com → **Meus apps → Criar app** (tipo Empresa/Business).
3. Adicione o produto **Instagram** (API com login do Facebook) e permissões: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
4. Gere um **token de acesso de longa duração** da Página (Graph API Explorer → token de usuário → trocar por longa duração → `/me/accounts` para o token da Página).
5. Preencha no `jarvis-secrets.cmd`: `IG_ACCESS_TOKEN`, `IG_USER_ID`, `FB_PAGE_TOKEN`, `FB_PAGE_ID`.
6. Rode a verificação (só leitura): o JARVIS confere se o @ é `cristianogeraldo.ofc`.
7. Só depois, com sua autorização, um teste real de publicação; piloto automático com `JARVIS_IG_AUTOPOST=1`.

Obs.: permissões de publicação podem exigir **Revisão do app** da Meta; sem ela, só contas com função no app conseguem publicar (suficiente para a sua própria conta). Confira na documentação atual, os nomes mudam.
