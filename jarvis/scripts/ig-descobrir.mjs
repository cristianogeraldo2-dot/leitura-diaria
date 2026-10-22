#!/usr/bin/env node
// Descobre o IG_USER_ID da sua conta (somente leitura). O token vem do ambiente, nunca de argumento.
//   PowerShell:  $env:IG_ACCESS_TOKEN = Read-Host "Cole o token"   (fica só nesta janela)
//                npm.cmd run ig:descobrir
import { descobrirContas } from '../bridge/instagram-publish.mjs'
try {
  const contas = await descobrirContas()
  if (!contas.length) console.log('Nenhuma Página encontrada para este token. Confira as permissões (pages_show_list) e se você administra a Página.')
  for (const c of contas) console.log(`Página: ${c.pagina} | Instagram: ${c.usuario ? '@' + c.usuario : '(nenhum ligado)'} | IG_USER_ID: ${c.instagramUserId ?? '—'}`)
} catch (e) { console.log(String(e.message)); process.exit(1) }
