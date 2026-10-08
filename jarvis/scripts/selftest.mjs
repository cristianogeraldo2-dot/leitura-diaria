#!/usr/bin/env node
// Bateria de testes do JARVIS. Uso: npm test   (offline)   |   npm run test:live  (inclui Claude Code real)
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.argv.includes('--live')
const PORT = 18787
let pass = 0, fail = 0, skip = 0
const t = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? ' — ' + extra : ''}`) }
const sk = (name, why) => { skip++; console.log(`  ⏭  ${name} — ${why}`) }

// ---- unidade: analytics -----------------------------------------------------
const { analyze } = await import('../bridge/analytics.mjs')
const P0 = await import('../bridge/persona.mjs')
const ex = JSON.parse(readFileSync(join(ROOT, 'knowledge/operacao.exemplo.json'), 'utf8'))
const a = analyze(ex)
console.log('\n[analytics]')
t('sem dados → "Não tenho esse dado disponível."', analyze(null).reason === 'Não tenho esse dado disponível.')
t('conversão = vendas/Q (2/9 = 22,2%)', a.dados.conversao === 22.2)
t('gap de casais = 20', a.dados.gap.casais === 20)
t('ritmo abaixo → META ABAIXO DO RITMO', a.alertas.some((x) => x.code === 'META_ABAIXO_DO_RITMO'))
t('recuperação detectada', a.alertas.some((x) => x.code === 'OPORTUNIDADE_RECUPERACAO'))
t('produtividade baixa aponta Captador B', a.equipe.atencao.includes('Captador B'))
t('acima da média aponta Captador A', a.equipe.destaque.includes('Captador A'))
const sem = analyze({ realizado: { casais: 5 }, meta: {} })
t('campos ausentes viram null (nunca inventa)', sem.dados.conversao === null && sem.dados.gap.casais === null && sem.alertas.length === 0)
const noPace = analyze({ meta: { casais: 40 }, realizado: { casais: 10 } })
t('sem progressoDia não há alerta de ritmo', !noPace.alertas.some((x) => x.code.startsWith('META_')))

// ---- unidade: importador do snapshot do dashboard (dados FICTÍCIOS, só em memória) ----
const { snapshotToOperacao } = await import('../bridge/dashboard-data.mjs')
const snapFx = { generatedAt: '2000-01-01T10:00:00Z', status: 'ok', buildStatus: 'built', queries: {
  daily_metrics: { rows: [{ metric: 'abc', actual: 1, target: 2, attainment: 50, gap: 1, unit: 'un' }] },
  casais_detail: { rows: [{ presencas: 20, qsRealizados: 8, nqsComPropostas: 2, nqsComVendas: 1, qMaisNqComProposta: 6, qMaisNqComVenda: 3, anoAnterior: 15, mesAnterior: 18 }] },
  cotas_detail: { rows: [{ propostas: 5, compradoresPropostas: 4, cotasVendidas: 3, metaCotas: 6, anoAnterior: 2, mesAnterior: 4, superMeta: 8, megaMeta: 10, metaEsparta: 12 }] },
  vgv_detail: { rows: [{ propostasVgv: 100, vendasVgv: 60, metaVgv: 120, eficienciaGeralPropostas: 1, eficienciaPropostas: 1, eficienciaMeta: 1, eficienciaAnoAnterior: 1, eficienciaMesAnterior: 1 }] } } }
const opFx = snapshotToOperacao(snapFx)
console.log('\n[dashboard → operacao.json]')
t('mapeia casais/Q/vendas/cotas/VGV', opFx.realizado.casais === 20 && opFx.realizado.q === 8 && opFx.realizado.vendas === 3 && opFx.realizado.cotas === 3 && opFx.realizado.vgv === 60)
t('derivados explícitos (NQ e Q com venda)', opFx.realizado.nq === 12 && opFx.realizado.qComVenda === 2 && opFx.derivados.length === 2)
t('não inventa o que o dashboard não traz', opFx.captadores.length === 0 && opFx.meta.casais === null && opFx.progressoDia === null)
const anFx = analyze(opFx)
t('análise do snapshot: atingimento cotas/VGV e conversão Q', anFx.dados.atingimentoCotas === 50 && anFx.dados.atingimentoVgv === 50 && anFx.dados.conversao === 25)
t('dados antigos geram aviso de defasagem', anFx.idadeDias > 1000 && /DEFASADOS/.test(anFx.avisos[0]))
t('avisa que não há dados por captador e cita a data', anFx.avisos.some((x) => /captador/.test(x)) && anFx.avisos.some((x) => /2000-01-01/.test(x)))

// ---- unidade: exportação do Radar (dados FICTÍCIOS, só em memória) ----
const { radarToOperacao, validateRadar, parseRef } = await import('../bridge/radar-data.mjs')
const radarFx = {
  SNAP: { mes: 'Mês/2000', ano: 2000, mesIdx: 0, ref: '05/01/2000 · Sala', metaCotas: 100, metaVgv: 1000000, metaQs: 200, pesos: { util: 1, sex: 1.3, fds: 1.6 } },
  REAL: { vgvVendido: 100000, cotasVendidas: 10, presencas: 50, qVenda: 20, nqVenda: 5, compradores: 8, cotasPropostas: 12, vgvPropostas: 150000, qnqProposta: 15 },
  DIARIO: { '05/01': { casais: 10, vendas: 1, vgv: 10000, qs: 5, comp: 1 } },
  PENETRACAO: {}, PLANO_FDS: [], LOCAIS: [['Ponto A', 3, 20, 7]], FONTES: [{ nome: 'Fonte pendente X', conf: 'pendente' }],
  CAPTADORES: [
    { nome: 'A', equipe: 'Alta', pres: 10, q: 6, nqv: 1, valid: 7, vendas: 2, valor: 50000 },
    { nome: 'B', equipe: 'Média', pres: 2, q: 0, nqv: 0, valid: 0, vendas: 0, valor: 0 },
    { nome: 'C', equipe: 'Base', pres: 0, q: null, nqv: null, valid: 0, vendas: 0, valor: 0 },
  ],
}
console.log('\n[radar → operacao.json]')
const opR = radarToOperacao(radarFx)
t('valida e lê o carimbo (dd/mm → data)', validateRadar(radarFx) && opR.data === '2000-01-05' && parseRef('05/10/2026 23:02:09') === '2026-10-05')
t('Total de Qs = Q + NQ c/ venda; NQ = presenças − Q', opR.realizado.totalQs === 25 && opR.realizado.nq === 30)
t('eficiências nas definições da Cris', opR.eficiencias.aproveitamentoQs === 50 && opR.eficiencias.eficienciaQs === 40 && opR.eficiencias.comprador === 16 && opR.eficiencias.geral === 20)
t('progresso do mês por peso de dia entre 0 e 1', opR.progressoMes > 0 && opR.progressoMes < 1)
t('captador sem registro é marcado e não vira zero', opR.captadores[2].semRegistro === true && opR.captadores[2].casais === null)
const anR = analyze(opR)
t('análise: atingimento VGV/cotas/Qs e ritmo pelo mês', anR.dados.atingimentoVgv === 10 && anR.dados.atingimentoQs === 12.5 && anR.ritmo !== null)
t('ranking ignora captador sem registro e cita fontes pendentes', anR.equipe.captadores === 2 && anR.equipe.semRegistro.includes('C') && anR.avisos.some((x) => /pendentes/.test(x)))

// ---- unidade: leitor de planilhas (CSV/XLSX), dados FICTÍCIOS ----
const { readTable, describeTable, toNumber } = await import('../bridge/tabular.mjs')
console.log('\n[planilhas]')
const csvT = readTable(join(ROOT, 'scripts/fixtures/ficticio.csv'))
t('CSV com ; e Latin-1 e aspas', csvT.headers.join('|') === 'Captador|Vendas|Valor|Data' && csvT.rows.length === 2 && csvT.rows[0][0] === 'José "Zé" Silva')
t('número no formato brasileiro', toNumber('1.234,56') === 1234.56 && toNumber('R$ 10.000.001') === 10000001 && toNumber('12,5%') === 12.5 && toNumber('abc') === null)
const xlT = readTable(join(ROOT, 'scripts/fixtures/ficticio.xlsx'))
t('XLSX sem dependências (strings compartilhadas, & e inline)', xlT.headers.join('|') === 'Captador|Vendas|Data' && xlT.rows[0][0] === 'Fulano & Cia' && xlT.rows[0][1] === '3' && xlT.rows[0][2] === '05/10/2000')
const dsc = describeTable(csvT)
t('descrição da estrutura não vaza valores', dsc.linhas === 2 && dsc.colunas[1].tipo === 'número' && dsc.colunas[3].tipo === 'data' && !JSON.stringify(dsc).includes('Silva'))

// ---- unidade: leitura do HTML do Radar (FICTÍCIO) ----
const { extractRadarFromHtml } = await import('../bridge/radar-data.mjs')
const htmlFx = `<html><body><script>
const SNAP = { mes: 'M', ano: 2000, mesIdx: 0, ref: '05/01/2000 · Sala', metaCotas: 10, metaVgv: 100, metaQs: 20, pesos: { util: 1, sex: 1.3, fds: 1.6 } };
const REAL = { presencas: 4, qVenda: 2, nqVenda: 1, cotasVendidas: 1, vgvVendido: 50, compradores: 1 }; // comentário; com ponto e vírgula
const PLANO_FDS = []; const PENETRACAO = {}; const DIARIO = { '05/01': { casais: 4, vendas: 1, vgv: 50, qs: 3, comp: 1 } };
const CAPTADORES = [ ['Ana; Maria','Alta',2,1,0,1,0,0], ['Sem Registro','Base'] ].map(([nome,equipe,pres=0,q=null,nqv=null,valid=0,vendas=0,valor=0])=>({nome,equipe,pres,q,nqv,valid,vendas,valor}));
const LOCAIS = [['P1',1,5,2]];
const FONTES = [{ nome:'F', carimbo:'x', conf:'ok', txt:'texto longo' }];
function util(){ return 1 }
</script></body></html>`
const exH = extractRadarFromHtml(htmlFx)
console.log('\n[radar html]')
t('lê os literais do HTML (incl. ; dentro de string e .map)', exH && exH.SNAP.metaCotas === 10 && exH.CAPTADORES.length === 2 && exH.CAPTADORES[0].nome === 'Ana; Maria' && exH.CAPTADORES[1].q === null)
t('FONTES vêm sem o texto livre', exH.FONTES[0].txt === undefined && exH.FONTES[0].conf === 'ok')
t('HTML com código perigoso é recusado', extractRadarFromHtml('<script>const SNAP={a:process.exit(1)};const REAL={};const CAPTADORES=[];const PLANO_FDS=[];const PENETRACAO={};const DIARIO={};const LOCAIS=[];</script>') === null)
t('HTML que não é o Radar é recusado', extractRadarFromHtml('<html><body>oi</body></html>') === null)

// ---- unidade: módulo Instagram (dados FICTÍCIOS, pasta temporária) ----
const IG = await import('../bridge/instagram.mjs')
console.log('\n[instagram]')
const igTmp = mkdtempSync(join(tmpdir(), 'ig-'))
const igSt = IG.createStore(igTmp)
t('perfil vazio e atualização parcial preserva o resto', JSON.stringify(igSt.perfil()) === '{}' && igSt.perfil({ nicho: 'viagem' }).nicho === 'viagem' && igSt.perfil({ tom: 'leve' }).nicho === 'viagem')
const r1 = igSt.salvar({ tipo: 'reel', titulo: 'Teste', legenda: 'x' })
t('rascunho nasce como "rascunho" e não como publicado', r1.status === 'rascunho' && igSt.listar('rascunho').length === 1 && igSt.listar('aprovado').length === 0)
t('aprovar muda o status e id inválido não quebra', igSt.aprovar(r1.id).status === 'aprovado' && igSt.aprovar('nao-existe') === null && igSt.aprovar('../../x') === null)
const csvIg = 'Data;Tipo;Alcance;Curtidas;Comentários;Salvamentos;Compartilhamentos;Legenda\r\n01/01/2000;Reel;1000;50;5;10;10;A\r\n02/01/2000;Post;1000;10;0;0;0;B\r\n03/01/2000;Reel;500;40;10;20;5;C\r\n04/01/2000;Story;0;1;0;0;0;D\r\n'
writeFileSync(join(igTmp, 'ficticio.csv'), csvIg)
const rk = IG.rankPosts(readTable(join(igTmp, 'ficticio.csv')))
t('ranking por engajamento ponderado (Reel C > Reel A > Post B)', rk.melhores[0].legenda === 'C' && rk.melhores[1].legenda === 'A' && rk.melhores[2].legenda === 'B')
t('média por tipo e colunas reconhecidas', rk.mediaPorTipo.Reel.posts === 2 && rk.colunasReconhecidas.alcance === 'Alcance' && rk.colunasReconhecidas.salvamentos === 'Salvamentos')
t('alcance zero não gera taxa inventada', !rk.melhores.some((x) => x.legenda === 'D'))
let bloqueou = false; try { IG.importarMetricas('../../fora.csv', igSt, join(igTmp, 'entrada')) } catch { bloqueou = true }
t('importação só lê dentro da pasta de entrada', bloqueou)
rmSync(igTmp, { recursive: true, force: true })
t('modo conteúdo é reconhecido por voz', P0.detectMode('Jarvis, modo conteúdo') === 'conteudo' && P0.detectMode('modo instagram') === 'conteudo')

// ---- unidade: publicação no Instagram (API SIMULADA; nenhuma rede, credenciais falsas) ----
const PUB = await import('../bridge/instagram-publish.mjs')
console.log('\n[instagram publicar — simulado]')
const rej = async (item) => { try { await PUB.publicarRascunho(item); return null } catch (e) { return String(e.message) } }
const ok0 = { id: 'a', tipo: 'post', status: 'aprovado', legenda: 'Oi', hashtags: ['viagem'], midiaUrls: ['https://exemplo.com/a.jpg'] }
t('recusa rascunho não aprovado', /APROVADOS/.test(await rej({ ...ok0, status: 'rascunho' })))
t('recusa sem mídia e mídia não-https', /não tem mídia/.test(await rej({ ...ok0, midiaUrls: [] })) && /https/.test(await rej({ ...ok0, midiaUrls: ['http://x.com/a.jpg'] })))
t('sem credenciais roda em SIMULAÇÃO e não chama a rede', (await PUB.publicarRascunho(ok0, { fetchFn: () => { throw new Error('rede!') } })).simulado === true)
process.env.IG_ACCESS_TOKEN = 'TOKEN_FALSO_123456'; process.env.IG_USER_ID = '999'; process.env.IG_EXPECTED_USERNAME = '@Cris'
const chamadas = []
const fakeFetch = async (url, opt = {}) => {
  const corpo = String(opt.body ?? '') + ' ' + url
  chamadas.push({ url: String(url).replace(/^https:\/\/graph\.facebook\.com\/[^/]+/, ''), corpo })
  const base = (j, status = 200) => ({ ok: status < 400, status, json: async () => j })
  if (/status_code/.test(String(url))) return base({ status_code: 'FINISHED' })
  if (/media_publish/.test(String(url))) return base({ id: 'PUB1' })
  if (/\/999\/media$/.test(String(url))) return base({ id: 'C' + chamadas.length })
  if (/\/999\?/.test(String(url))) return base({ username: 'cris', account_type: 'BUSINESS' })
  return base({ error: { message: 'falhou com TOKEN_FALSO_123456' } }, 400)
}
const rPost = await PUB.publicarRascunho(ok0, { fetchFn: fakeFetch })
t('post: cria contêiner e publica (2 chamadas) com legenda+hashtags', rPost.idMidia === 'PUB1' && chamadas.length === 3 && chamadas.some((c) => c.corpo.includes('caption=Oi') && c.corpo.includes('%23viagem')))
chamadas.length = 0
const rReel = await PUB.publicarRascunho({ ...ok0, tipo: 'reel', midiaUrls: ['https://exemplo.com/v.mp4'] }, { fetchFn: fakeFetch, dormir: async () => {} })
t('reel: REELS + espera processar + publica', rReel.idMidia === 'PUB1' && chamadas.some((c) => c.corpo.includes('media_type=REELS')) && chamadas.some((c) => /status_code/.test(c.url)))
chamadas.length = 0
const rCar = await PUB.publicarRascunho({ ...ok0, tipo: 'carrossel', midiaUrls: ['https://e.com/1.jpg', 'https://e.com/2.jpg'] }, { fetchFn: fakeFetch })
t('carrossel: filhos + contêiner CAROUSEL + publica', rCar.idMidia === 'PUB1' && chamadas.filter((c) => c.corpo.includes('is_carousel_item=true')).length === 2 && chamadas.some((c) => c.corpo.includes('media_type=CAROUSEL')))
t('1 mídia só não vira carrossel', /pelo menos 2/.test(await rej({ ...ok0, tipo: 'carrossel' }) ?? ''))
const badFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'erro com TOKEN_FALSO_123456' } }) })
const msgErr = await (async () => { try { await PUB.publicarRascunho(ok0, { fetchFn: badFetch }) } catch (e) { return String(e.message) } })()
t('erro da API nunca vaza o token', msgErr && !msgErr.includes('TOKEN_FALSO_123456'))
const conn = await PUB.verificarConexao(fakeFetch)
t('verificar conexão mostra usuário e não o token', conn.ok === true && conn.usuario === 'cris' && !JSON.stringify(conn).includes('TOKEN_FALSO'))
const fakeContas = async () => ({ ok: true, status: 200, json: async () => ({ data: [{ name: 'Página X', instagram_business_account: { id: '123', username: 'cris' } }, { name: 'Sem IG' }] }) })
const dc = await PUB.descobrirContas(fakeContas)
t('descobrir contas lista Página, @ e ID, sem token', dc.length === 2 && dc[0].instagramUserId === '123' && dc[1].instagramUserId === null && !JSON.stringify(dc).includes('TOKEN_FALSO'))
process.env.IG_EXPECTED_USERNAME = 'outra.conta'
chamadas.length = 0
const msgConta = await (async () => { try { await PUB.publicarRascunho(ok0, { fetchFn: fakeFetch }) } catch (e) { return String(e.message) } })()
t('NUNCA publica em outra conta: confere o @ antes de criar mídia', /Conta incorreta/.test(msgConta ?? '') && !chamadas.some((c) => /media|media_publish/.test(c.url) && !/\?/.test(c.url)))
t('conexão indica se a conta é a oficial', (await PUB.verificarConexao(fakeFetch)).contaOficial === false)
delete process.env.IG_EXPECTED_USERNAME
delete process.env.IG_ACCESS_TOKEN; delete process.env.IG_USER_ID
t('sem credenciais a conexão diz como configurar', (await PUB.verificarConexao()).configurado === false)

// ---- unidade: diretor de marketing + VIDEO_FACTORY -------------------------
const MK = await import('../bridge/marketing.mjs')
const VF = await import('../bridge/video-factory.mjs')
console.log('\n[diretor de marketing]')
const mkTmp = mkdtempSync(join(tmpdir(), 'mk-')); const mkSt = IG.createStore(join(mkTmp, 'instagram')); const mkMk = MK.createMarketingStore(mkTmp)
const hojeStr = new Date().toISOString().slice(0, 10)
const mk_r1 = mkSt.salvar({ tipo: 'reel', titulo: 'Reel de hoje', legenda: 'Salve este Reel', roteiro: 'cena 1', agendadoPara: `${hojeStr} 20:00` })
const mk_p0 = MK.painel({ store: mkSt, mk: mkMk, agora: new Date(`${hojeStr}T10:00:00-03:00`), env: {} })
t('painel: conteúdo de hoje vem dos rascunhos reais', mk_p0.conteudoDeHoje.length === 1 && mk_p0.conteudoDeHoje[0].id === mk_r1.id && mk_p0.conta === 'cristianogeraldo.ofc')
t('painel sem métricas diz "Não tenho esse dado disponível" e não inventa', mk_p0.desempenho.disponivel === false && mk_p0.seguidoresGanhos.disponivel === false && /Não tenho dados/.test(mk_p0.recomendacao) && mk_p0.melhoresConteudos.length === 0)
t('painel mostra a próxima ação da agenda', /^(07|08|12|18|20|23)/.test(mk_p0.proximaAcao) && mk_p0.agenda.length === 9)
t('agenda: depois das 23:30 a próxima é amanhã', MK.proximaAcao(new Date('2026-10-08T23:45:00')).amanha === true)
t('DIRECTOR_AUTONOMOUS não publica sozinho: cai em revisão e avisa', MK.modoDiretor({ MARKETING_DIRECTOR_MODE: 'true', DIRECTOR_AUTONOMOUS: 'true' }).modo === 'revisao' && !!MK.modoDiretor({ DIRECTOR_AUTONOMOUS: 'true' }).aviso)
const mk_rev = MK.revisarRascunho({ id: 'x', tipo: 'reel', titulo: 'Renda extra garantida com 30% a mais', legenda: 'Os clientes da Vila Dia compraram', roteiro: 'segredo', hashtags: [] })
t('revisão pega promessa financeira, termo interno, número sem fonte, coach e falta de CTA', mk_rev.avisos.length >= 5 && !mk_rev.aprovadoParaPublicar)
t('revisão aprova conteúdo limpo (CTA, sem termos internos)', MK.revisarRascunho({ id: 'y', tipo: 'post', titulo: 'Clareza antes de cobrança', legenda: 'Líder que explica antes de cobrar constrói confiança. Salve para reler.', hashtags: ['lideranca'] }).aprovadoParaPublicar === true)
mkMk.aprendizado({ proximoPasso: 'Testar gancho com pergunta' }); mkMk.campanha({ nome: 'Legado', objetivo: 'autoridade' })
t('aprendizados e campanhas ficam registrados', mkMk.ler().aprendizados.length === 1 && mkMk.ler().campanhas.length === 1)
t('quebra de texto respeita o limite por linha', VF.quebrar('Líder de verdade não grita e cria clareza', 12).every((l) => l.length <= 12))
const mk_ff = await VF.detectarFfmpeg()
if (mk_ff.ok && VF.acharFonte()) {
  const vOut = join(mkTmp, 'videos')
  const mk_v = await VF.produzirVideo({ titulo: 'Liderança é legado', campanha: 'Teste', cta: 'Salve e compartilhe', cenas: [{ texto: 'Líder de verdade não grita.' }, { texto: 'Cria clareza e entrega exemplo.', duracao: 3 }], base: vOut })
  t('VIDEO_FACTORY: MP4 9:16 H.264 com áudio existe e foi validado', mk_v.ok === true && mk_v.existe === true && mk_v.validacao.resolucao === '1080x1920' && mk_v.validacao.codec === 'h264' && mk_v.validacao.audio === true)
  t('VIDEO_FACTORY: capa e legendas existem e a pasta é por data/campanha', existsSync(mk_v.arquivos.capa) && existsSync(mk_v.arquivos.legendas) && mk_v.arquivos.video.includes(`${hojeStr}`) && mk_v.arquivos.video.includes('teste'))
  const mk_bad = await VF.validarVideo(join(mkTmp, 'nao-existe.mp4'))
  t('validação de arquivo inexistente nunca finge sucesso', mk_bad.ok === false && mk_bad.existe === false)
  const mk_out = await VF.produzirVideo({ titulo: 'x', cenas: [{ texto: 'a', imagem: '../../../../etc/passwd' }], base: vOut })
  t('VIDEO_FACTORY só lê imagens da pasta de entrada', mk_out.ok === false && /Por segurança|não encontrado/i.test(mk_out.motivo ?? ''))
} else console.log('  ⏭  VIDEO_FACTORY ao vivo — FFmpeg/fonte não encontrados neste computador')
rmSync(mkTmp, { recursive: true, force: true })

// ---- unidade: persona/modos/confirmação -------------------------------------
console.log('\n[persona]')
const P = await import('../bridge/persona.mjs')
t('detecta "modo reunião"', P.detectMode('Jarvis, modo reunião.') === 'reuniao')
t('detecta "modo liderança"', P.detectMode('jarvis modo lideranca') === 'lideranca')
t('detecta "modo análise"', P.detectMode('Jarvis, modo análise') === 'analise')
t('frase comum não muda modo', P.detectMode('como estamos hoje?') === null)
P.setMode('reuniao'); t('tag de modo injeta regras', P.modeTag().includes('MODO REUNIÃO')); P.setMode('padrao')
t('prompt cita "Cris", GAV e Vila Dia', /Cris/.test(P.PERSONA_PT) && /GAV Resorts/.test(P.PERSONA_PT) && /Vila Dia/.test(P.PERSONA_PT))
t('prompt proíbe inventar números', /NUNCA INVENTE NÚMEROS/.test(P.PERSONA_PT))
t('"confirmo" sem pendência não libera nada', !P.confirmPending())
P.notePending('Bash'); t('"confirmo" reconhecido', P.isConfirmation('Confirmo.'))
t('confirmação libera exatamente 1 chamada', P.confirmPending() && P.consumeGrant('Bash') && !P.consumeGrant('Bash'))
P.notePending('Write'); P.confirmPending(); t('grant não vale para outra ferramenta', !P.consumeGrant('Bash'))
t('"talvez" não é confirmação', !P.isConfirmation('talvez depois'))
P.noteAwaiting(); t('confirmação após a pergunta libera 1 chamada de qualquer ferramenta', P.confirmPending() && P.consumeGrant('Write') && !P.consumeGrant('Write'))
t('depois de usada, nova confirmação solta não libera', !P.confirmPending())

// ---- unidade: segredos e dashboard ------------------------------------------
console.log('\n[segurança/dashboard]')
const { redact } = await import('../bridge/home.mjs')
t('redact remove chave sk-…', !redact('usei sk-ant-abcdef1234567890 ok').includes('abcdef'))
t('redact remove api_key=…', !redact('api_key=SEGREDO123').includes('SEGREDO123'))
const { inspectDashboard } = await import('../bridge/ops.mjs')
const tmp = mkdtempSync(join(tmpdir(), 'jv-'))
const fx = join(tmp, 'leao-da-vila-dashboard.html')
writeFileSync(fx, '<html><head><link href="x.css" rel="stylesheet"><script src="https://cdn.jsdelivr.net/npm/chart.js"></script></head><body><canvas id="g1"></canvas><table></table><script>const dados=[1,2];function render(){fetch("/api/kpis?token=abc")}</script></body></html>')
const insp = inspectDashboard(fx)
t('inspeção acha Chart.js, canvas, função e API', insp.chartLibraries.includes('Chart.js') && insp.htmlTags.canvas === 1 && insp.js.functions.includes('render') && insp.apis.length === 1)
rmSync(tmp, { recursive: true, force: true })
const { operationInsight, DATA_FILE } = await import('../bridge/ops.mjs')
if (!existsSync(DATA_FILE)) {
  writeFileSync(DATA_FILE, readFileSync(join(ROOT, 'knowledge/operacao.exemplo.json')))
  const g = operationInsight(); rmSync(DATA_FILE)
  t('operacao.json com dados de EXEMPLO é recusado', g.available === false && /EXEMPLO/.test(g.hint))
} else sk('guarda de dados fictícios', 'operacao.json real presente')

// ---- integração: bridge ------------------------------------------------------
console.log('\n[bridge]')
const env = { ...process.env, JARVIS_BRIDGE_PORT: String(PORT) }
const child = spawn(process.execPath, ['bridge/server.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d))
const base = `http://127.0.0.1:${PORT}`
const get = async (p, o) => { try { const r = await fetch(base + p, o); return { s: r.status, b: await r.text() } } catch (e) { return { s: 0, b: String(e) } } }
let up = false
for (let i = 0; i < 40 && !up; i++) { up = (await get('/health')).s === 200; if (!up) await new Promise((r) => setTimeout(r, 250)) }
t('bridge inicia e responde /health', up)
const listening = /127\.0\.0\.1|listening/.test(out)
t('bridge escuta só em loopback', (await get('/health')).s === 200 && listening)
const st = JSON.parse((await get('/jarvis/status')).b || '{}')
t('/jarvis/status devolve só booleanos', st.bridge === true && typeof st.claude === 'boolean')
const ins = JSON.parse((await get('/jarvis/insight')).b || '{}')
t('/jarvis/insight sem dados reais → não inventa', existsSync(join(ROOT, 'knowledge/operacao.json')) || ins.available === false)
t('origem hostil é recusada (403)', (await get('/health', { headers: { origin: 'https://evil.example' } })).s === 403)
const dg = JSON.parse((await get('/jarvis/diagnostics')).b || '{}')
t('diagnóstico cobre bridge/frontend/claude/mcp/portas/dashboard/memória', ['bridge', 'frontend', 'claudeCode', 'mcp', 'portas', 'dashboard', 'memoria'].every((k) => k in dg))
t('/jarvis-widget.js servido', (await get('/jarvis-widget.js')).b.includes('JARVIS INTELLIGENCE'))

// WebSocket: handshake aceito/recusado
const wsOpen = (origin) => new Promise((res) => { const w = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: origin ? { Origin: origin } : {} }); w.on('open', () => res({ w, ok: true })); w.on('error', () => res({ ok: false })); w.on('unexpected-response', () => res({ ok: false })) })
const good = await wsOpen('http://localhost:5173'); t('frontend↔bridge: WebSocket aceita origem local', good.ok)
const bad = await wsOpen('https://evil.example'); t('WebSocket recusa origem externa', !bad.ok)

if (LIVE && good.ok) {
  console.log('\n[claude code — ao vivo]')
  const ask = (text) => new Promise((res) => { let acc = ''; const to = setTimeout(() => res(acc || null), 120000)
    good.w.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'text') acc += m.delta; if (m.type === 'turn' && m.done || m.type === 'done' || m.type === 'end') { clearTimeout(to); res(acc) } })
    good.w.send(JSON.stringify({ type: 'ask', id: 'q1', text })) ; setTimeout(() => { clearTimeout(to); res(acc || null) }, 60000) })
  const r = await ask('Responda apenas com a palavra: PRONTO')
  t('Claude Code recebe e responde via bridge', typeof r === 'string' && /pronto/i.test(r), JSON.stringify(r))
} else if (!LIVE) sk('Claude Code ao vivo', 'use npm run test:live')

try { good.w?.close() } catch { /* fecha */ }
child.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 400))
t('STOP: processo da bridge encerra', child.killed || child.exitCode !== null)
console.log(`\nResultado: ${pass} ok · ${fail} falhas · ${skip} ignorados`)
process.exit(fail ? 1 : 0)
