@echo off
rem ===================================================================
rem  Your private keys. This file is ignored by git and never uploaded.
rem ===================================================================
rem
rem  ELEVENLABS_API_KEY — needed for the voice you chose
rem  (IRHApOXLvnW57QJPQH2P). Without a key that voice ID does nothing and
rem  JARVIS speaks with the built-in browser voice instead.
rem
rem  Get a key: https://elevenlabs.io -> your profile -> API keys.
rem  Paste it between the = and the closing quote, with no spaces, then save.
rem
set "ELEVENLABS_API_KEY="
rem
rem  Instagram (publicacao pela API oficial). Preencha SO no seu computador; nunca cole no chat nem no Git.
rem  IG_ACCESS_TOKEN: token de acesso do app Meta. IG_USER_ID: id da conta profissional do Instagram.
set "IG_ACCESS_TOKEN="
set "IG_USER_ID="
rem  Conta oficial: o JARVIS só publica nesta conta (confere o @ do token antes de qualquer envio).
set "IG_EXPECTED_USERNAME=cristianogeraldo.ofc"
rem  Diretor de marketing (opcional). Publicar SEMPRE exige o seu 'confirmo'.
set "MARKETING_DIRECTOR_MODE=true"
rem  Fonte para o texto na tela dos vídeos (opcional): set "JARVIS_FONT=C:\Windows\Fonts\arialbd.ttf"
