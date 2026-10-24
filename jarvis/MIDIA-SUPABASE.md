# Mídia para publicação: Supabase Storage (Etapa 1) e segurança (Etapa 0)

A API da Meta exige que imagens e vídeos estejam em uma **URL https acessível**. Este módulo prepara a mídia no seu computador e a hospeda no seu **Supabase Storage**. **Nada aqui publica na Meta**: a publicação é outra etapa, ainda não autorizada.

## O que existe (e o que foi testado)

| Peça | Arquivo | Estado |
|---|---|---|
| Validação real de tipo (por bytes, não pela extensão), tamanho, dimensões; PNG para JPEG | `bridge/media-prep.mjs` | Testado com arquivos reais locais |
| Envio, URL assinada, limpeza, validação de URL | `bridge/media-storage.mjs` | **Testado só com simulação** (sem chamada real ao Supabase) |
| Comando de uso | `scripts/midia.mjs` (`npm run midia -- ...`) | Local testado; envio real **depende das suas credenciais** |
| Detector de segredos | `scripts/scan-secrets.mjs` (`npm run scan:segredos`) | Testado |
| Cópia JPEG ao lado do PNG nas artes | `imagem_produzir` | Testado |

Não foi feito: nenhum upload real, nenhuma conta ou bucket criado, nenhuma chamada à Meta.

## Variáveis de ambiente (somente nomes)

Ficam em `jarvis-secrets.cmd` (o Git ignora). **Nunca cole valores no chat nem no Git.**

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | Endereço do projeto (`https://<projeto>.supabase.co`) |
| `SUPABASE_SECRET_KEY` | Chave de **servidor** do projeto. Só a ponte usa. **Nunca** vai para o navegador |
| `SUPABASE_BUCKET` | Nome do bucket (padrão `jarvis-midia`) |
| `SUPABASE_MEDIA_ACCESS` | `assinada` (padrão) ou `publica` |
| `SUPABASE_MEDIA_TTL_HORAS` | Validade da URL assinada (padrão 24, de 1 a 168) |

Não usamos a chave "publicável" do Supabase, porque nada acontece no navegador.

## Como configurar pelo painel oficial do Supabase

1. Entre em supabase.com e crie (ou escolha) um projeto. Os nomes exatos dos menus podem mudar; confira na documentação atual.
2. Em **Storage**, crie o bucket `jarvis-midia` com **Public bucket DESLIGADO** (privado).
3. Em **Project Settings → API / API Keys**, copie a **URL do projeto** e a **chave de servidor (secret)**.
4. Cole os dois valores **somente** no `jarvis-secrets.cmd`, nas linhas `SUPABASE_URL` e `SUPABASE_SECRET_KEY`. Reinicie o terminal.
5. Rode `npm run midia -- verificar`. Ele mostra só quais variáveis faltam, sem rede e sem exibir valores.

## Acesso: público ou assinado?

- **Padrão: bucket privado + URL assinada temporária.** A Meta só precisa baixar o arquivo na hora de criar a publicação, então a URL pode expirar. Validade padrão de **24 h** (configurável de 1 a 168 h). Na etapa de publicação, a URL será gerada **imediatamente antes** de publicar, com validade menor.
- A URL assinada contém um `token` temporário: é uma credencial de leitura. Por isso **não vai para logs** e é mascarada na tela (`--mostrar-url` só se você precisar vê-la).
- `publica` existe como alternativa (bucket público), mas deixa links permanentes. Não recomendado.
- Nomes de objeto são imprevisíveis (`AAAA-MM/uuid.ext`), nunca o nome original do arquivo.
- Só aceita **JPEG** (até 8 MB), **PNG convertido para JPEG** e **MP4** (até 300 MB no código). Nenhum documento ou arquivo interno é enviado: o envio exige a mídia ter passado pela validação.

## Comandos

```
npm run midia -- verificar                    # confere as variáveis (sem rede)
npm run midia -- preparar <arquivo> [--formato feed|story]   # valida/converte localmente
npm run midia -- enviar <arquivo> [--mostrar-url]            # ENVIO REAL ao SEU Supabase
npm run midia -- limpar [--dias 2] [--apagar]  # lista antigos; só apaga com --apagar
npm run midia -- remover <bucket/AAAA-MM/uuid.ext>
npm run scan:segredos [-- --historico]         # detector de segredos (arquivos / todo o histórico)
npm test
```

O comando `enviar` termina com uma **verificação sem credenciais**: ele baixa 1 byte da URL como a Meta faria, e confirma status 200/206 e o tipo do arquivo. Se `ok: true`, o acesso funciona.

## Limpeza

- Arquivos temporários da conversão ficam em uma pasta temporária removida ao fim (testado).
- Na nuvem: `npm run midia -- limpar` **lista** objetos criados por este módulo com mais de N dias; só apaga com `--apagar`. Não apaga arquivos que não foram criados por ele.
- Na etapa de publicação, o plano é **remover a mídia depois de publicar** (ainda não implementado).
- O Supabase não limpa sozinho: sem rotina, os arquivos ficam até alguém apagar.

## Custos e limites que ainda precisam ser confirmados

- Cota de armazenamento e de tráfego do plano gratuito do Supabase.
- Limite de tamanho por arquivo do plano (o código aceita até 300 MB; o plano pode aceitar menos).
- Pausa de projetos gratuitos por inatividade.
- Limites da Meta: proporção, tamanho, duração dos vídeos e quantidade de publicações por dia pela API.
- Comportamento do cabeçalho de autenticação com chaves novas (`sb_...`) e legadas (JWT): o código usa `apikey` (e `Authorization` só nas chaves JWT). **Confirmar no primeiro envio real.**
- Rotas usadas (upload, assinatura, listagem e remoção) seguem a documentação oficial da API de Storage, mas **só foram testadas por simulação**.

## Etapa 0: segurança

- Segredos: `jarvis-secrets.cmd`, `.env*`, `*.pem` e `*.key` estão no `.gitignore`. Os exemplos versionados não trazem segredos.
- `npm run scan:segredos` examina os arquivos versionados e (com `--historico`) todos os commits, sem imprimir valores. Limitação: detecta **padrões** conhecidos (token Meta, chaves `sk-`, JWT, chave Supabase, chave privada, atribuições longas). Não garante ausência de qualquer segredo.
- A máscara de logs (`redact`) agora cobre também tokens Meta (`EAA...`), JWT e chaves `sb_secret_...`.
- **Token do Instagram que foi colado em um chat:** mesmo expirado, revogue. No Facebook, abra **Configurações → Segurança e login → Apps e sites** (ou **Integrações comerciais**), remova o app que você criou para o JARVIS e, no developers.facebook.com, gere credenciais novas quando for configurar. Faça isso você mesmo, pelo canal oficial da Meta.
- Nunca cole tokens, senhas ou chaves no chat.

## Como reverter

Nada externo é criado por este código. Para desfazer: `git revert <commit>` (ou apague `bridge/media-prep.mjs`, `bridge/media-storage.mjs`, `scripts/midia.mjs`, `scripts/scan-secrets.mjs` e as linhas `SUPABASE_*` do seu `jarvis-secrets.cmd`). Se você enviou arquivos de teste ao Supabase, use `npm run midia -- limpar` ou apague o bucket no painel.
