#!/usr/bin/env node
// Bateria de testes do JARVIS. Uso: npm test   (offline)   |   npm run test:live  (inclui Claude Code real)
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
const apSt = IG.createStore(mkdtempSync(join(tmpdir(), 'ig-ap-')))
const mk1 = (o) => apSt.salvar({ tipo: 'post', titulo: 'T', legenda: 'Oi', midiaUrls: ['https://e.com/a.jpg'], ...o })
const aOk = mk1({ agendadoPara: '2026-10-16 12:00' }), aFut = mk1({ agendadoPara: '2026-10-16 20:00' }), aVelho = mk1({ agendadoPara: '2026-10-10 12:00' }), aNaoApr = mk1({ agendadoPara: '2026-10-16 11:00' }), aSemMidia = mk1({ agendadoPara: '2026-10-16 11:30', midiaUrls: [] })
apSt.aprovarLote([aOk.id, aFut.id, aVelho.id, aSemMidia.id])
const agora = new Date('2026-10-16T13:00:00-03:00')
const dev = PUB.devidos(apSt, agora).map((x) => x.id)
t('autopost: só aprovado, no horário, com mídia e dentro de 36 h', dev.length === 1 && dev[0] === aOk.id && !dev.includes(aNaoApr.id))
t('autopost: interpreta horário sem fuso como Brasília', PUB.horario('2026-10-16 12:00') === Date.parse('2026-10-16T12:00:00-03:00'))
process.env.IG_EXPECTED_USERNAME = 'cris'
const rodou = await PUB.rodarAgendador(apSt, { agora, fetchFn: fakeFetch, parar: () => false })
t('autopost publica o devido, marca como publicado e guarda o id', rodou.publicados.length === 1 && rodou.publicados[0].ok && apSt.obter(aOk.id).status === 'publicado' && apSt.obter(aOk.id).idMidia === 'PUB1')
t('autopost não publica o mesmo duas vezes nem o que não é devido', (await PUB.rodarAgendador(apSt, { agora, fetchFn: fakeFetch, parar: () => false })).publicados.length === 0 && apSt.obter(aNaoApr.id).status === 'rascunho')
const apSt2 = IG.createStore(mkdtempSync(join(tmpdir(), 'ig-ap2-')))
const b1 = apSt2.salvar({ tipo: 'post', titulo: 'B', midiaUrls: ['https://e.com/b.jpg'], agendadoPara: '2026-10-16 09:00' }); apSt2.aprovarLote([b1.id])
t('PARAR-INSTAGRAM interrompe o piloto automático', (await PUB.rodarAgendador(apSt2, { agora, fetchFn: fakeFetch, parar: () => true })).ativo === false && apSt2.obter(b1.id).status === 'aprovado')
process.env.IG_EXPECTED_USERNAME = 'outra.conta'
const rErro = await PUB.rodarAgendador(apSt2, { agora, fetchFn: fakeFetch, parar: () => false })
t('autopost em conta errada não publica e conta a falha', rErro.publicados[0].ok === false && /Conta incorreta/.test(rErro.publicados[0].erro) && apSt2.obter(b1.id).falhas === 1)
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
const semana = JSON.parse(readFileSync(new URL('../conteudo/semana-01.json', import.meta.url), 'utf8'))
const imp1 = MK.importarRascunhos(semana, mkSt)
t('semana-01: todas as peças importam como rascunho (nada publicado)', imp1.length === semana.length && semana.length >= 5 && imp1.every((x) => x.ok) && mkSt.listar('rascunho').filter((x) => x.campanha === 'Liderança com método').length === semana.length)
t('semana-01: nenhuma peça tem aviso editorial (promessa, termo interno, CTA, coach)', imp1.every((x) => x.revisao.filter((a) => !/Sem mídia/.test(a)).length === 0))
const primeiroStory = semana.find((x) => x.tipo === 'story')
const mudou = MK.importarRascunhos(semana.map((x) => (x === primeiroStory ? { ...x, agendadoPara: '2026-10-30 12:00' } : x)), mkSt)
t('importar de novo atualiza só o horário e não duplica', mudou.filter((x) => /horário atualizado/.test(x.motivo ?? '')).length === 1 && mkSt.listar().filter((x) => x.campanha === 'Liderança com método').length === semana.length)
MK.importarRascunhos(semana, mkSt)
t('importar de novo não duplica', MK.importarRascunhos(semana, mkSt).every((x) => !x.ok && x.motivo === 'já importado'))
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

// ---- unidade: mídia / Supabase Storage (SIMULADO: nenhum upload real, nenhuma chamada à Meta) ----
console.log('\n[mídia / Supabase Storage — simulado]')
const MP = await import('../bridge/media-prep.mjs')
const MS = await import('../bridge/media-storage.mjs')
const SC = await import('../scripts/scan-secrets.mjs')
const HM = await import('../bridge/home.mjs')
const tmpAntes = readdirSync(tmpdir()).filter((n) => n.startsWith(MP.PREFIXO_TMP)).length
const mdDir = mkdtempSync(join(tmpdir(), 'md-test-'))
const mdFf = (await VF.detectarFfmpeg()).ok
const CHAVE_SB = 'sb_secret_' + 'Z'.repeat(32) // chave FALSA montada em tempo de execução
const CHAVE_JWT = 'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20) // JWT FALSO
const envOk = { SUPABASE_URL: 'https://projeto.supabase.co', SUPABASE_SECRET_KEY: CHAVE_SB }
const mkFetch = (h) => { const calls = []; const f = async (url, opt = {}) => { calls.push({ url: String(url), method: opt.method ?? 'GET', headers: opt.headers ?? {}, body: opt.body }); return h(String(url), opt) }; f.calls = calls; return f }
const resp = (status, body = '') => ({ ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => (typeof body === 'string' ? JSON.parse(body || '{}') : body), headers: { get: () => null } })
const jpegFalso = join(mdDir, 'ok.jpg'); writeFileSync(jpegFalso, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 1)]))
const prepFalsa = { ok: true, arquivo: jpegFalso, mime: 'image/jpeg', tamanho: 2004 }

if (mdFf) {
  const png1 = join(mdDir, 'arte1.png'), png2 = join(mdDir, 'arte2.png')
  for (const p of [png1, png2]) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x102a43:s=1080x1350', '-frames:v', '1', p])
  const c = await MP.converterParaJpeg(png1)
  t('1. conversão PNG→JPEG válida (JPEG real, original preservado)', c.ok && MP.detectarTipo(c.saida) === 'image/jpeg' && existsSync(png1) && c.largura === 1080 && c.altura === 1350)
  t('1b. não sobrescreve JPEG existente', (await MP.converterParaJpeg(png1)).codigo === 'SAIDA_EXISTE')
  const p2 = await MS.prepararMidia(png2, { formato: 'feed' })
  t('1c. prepararMidia converte e valida (4:5, JPEG ≤ 8 MB)', p2.ok && p2.convertido === true && p2.mime === 'image/jpeg' && existsSync(png2))
  const larga = join(mdDir, 'larga.png'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x102a43:s=2000x400', '-frames:v', '1', larga])
  const p2b = await MS.prepararMidia(png2, { formato: 'feed' })
  t('1c2. preparar de novo reaproveita o JPEG válido (não falha nem sobrescreve)', p2b.ok && p2b.reaproveitado === true && p2b.arquivo === p2.arquivo)
  t('1d. proporção fora de 4:5–1,91:1 é recusada para feed', (await MS.prepararMidia(larga, { formato: 'feed' })).codigo === 'IMAGEM_INVALIDA')
  const png3 = join(mdDir, 'arte3.png'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x102a43:s=1080x1350', '-frames:v', '1', png3])
  t('4b. limite de tamanho do JPEG gerado é respeitado', (await MP.converterParaJpeg(png3, { limites: { imagemBytes: 200, videoBytes: 200 }, saida: join(mdDir, 'pequeno.jpg') })).codigo === 'JPEG_INVALIDO')
  const vid = await VF.produzirVideo({ titulo: 'md teste', cenas: [{ texto: 'a', duracao: 2 }, { texto: 'b', duracao: 2 }], base: join(mdDir, 'v') })
  const pv = await MS.prepararMidia(vid.arquivos.video)
  t('MP4 do VIDEO_FACTORY é validado (H.264, 9:16, áudio) antes de qualquer envio', pv.ok && pv.tipo === 'video' && pv.mime === 'video/mp4')
  const mp4Falso = join(mdDir, 'falso.mp4'); writeFileSync(mp4Falso, Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(100)]))
  t('MP4 que só parece MP4 (sem fluxo de vídeo legível) NÃO é aceito', (await MS.prepararMidia(mp4Falso)).ok === false)
} else console.log('  ⏭  testes de conversão/validação de mídia — FFmpeg não encontrado neste computador')

const lixo = join(mdDir, 'lixo.jpg'); writeFileSync(lixo, Buffer.from('isto não é uma imagem'))
t('2. arquivo inválido (conteúdo falso com extensão .jpg) é rejeitado', MP.validarArquivo(lixo).ok === false && (await MS.prepararMidia(lixo)).ok === false)
const txt = join(mdDir, 'nota.txt'); writeFileSync(txt, 'texto')
const pdf = join(mdDir, 'doc.pdf'); writeFileSync(pdf, '%PDF-1.4 conteudo')
const pngComoMp4 = join(mdDir, 'engano.mp4'); writeFileSync(pngComoMp4, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50)]))
t('3. tipos incompatíveis rejeitados (txt, pdf, PNG disfarçado de MP4)', [txt, pdf, pngComoMp4].every((f) => MP.validarArquivo(f).ok === false))
t('4. limite de tamanho respeitado na validação', MP.validarArquivo(jpegFalso, { limites: { imagemBytes: 100, videoBytes: 100 } }).ok === false)

// credenciais
const semCred = await MS.enviarMidia(prepFalsa, { env: {}, fetchFn: mkFetch(() => resp(200)) })
t('5. sem credenciais: erro claro com só os NOMES das variáveis', semCred.codigo === 'SEM_CREDENCIAIS' && semCred.faltando.includes('SUPABASE_SECRET_KEY') && !JSON.stringify(semCred).includes('sb_'))
const f401 = mkFetch(() => resp(401, `chave inválida ${CHAVE_SB} e Bearer ${CHAVE_JWT}`))
const r401 = await MS.enviarMidia(prepFalsa, { env: envOk, fetchFn: f401 })
t('5b. 401 tratado e a mensagem NÃO revela a chave', r401.codigo === 'NAO_AUTORIZADO' && !JSON.stringify(r401).includes(CHAVE_SB) && !JSON.stringify(r401).includes(CHAVE_JWT))
// falha de upload
const r500 = await MS.enviarMidia(prepFalsa, { env: envOk, fetchFn: mkFetch(() => resp(500, 'erro interno')) })
const rRede = await MS.enviarMidia(prepFalsa, { env: envOk, fetchFn: async () => { throw new Error(`conexão caiu com ${CHAVE_SB}`) } })
t('6. falha de upload tratada (HTTP 500 e queda de rede), sem vazar a chave', r500.codigo === 'UPLOAD_FALHOU' && rRede.codigo === 'REDE' && !JSON.stringify([r500, rRede]).includes(CHAVE_SB))
// sucesso simulado + URL
const fOk = mkFetch((u) => (u.includes('/object/sign/') ? resp(200, { signedURL: u.replace('https://projeto.supabase.co/storage/v1', '') + '?token=TOKENFALSOABC123' }) : resp(200, { Key: 'x' })))
const rOk = await MS.enviarMidia(prepFalsa, { env: envOk, fetchFn: fOk })
const cfgT = MS.configStorage(envOk)
t('7. envio simulado: URL assinada com validade e SEM credenciais embutidas', rOk.ok && rOk.acesso === 'assinada' && MS.validarUrlMidia(rOk.url, cfgT).ok && !rOk.url.includes(CHAVE_SB) && !!rOk.expiraEm)
const U = 'https://projeto.supabase.co/storage/v1/object/'
t('7b. validação de URL recusa http, usuário/senha, apikey, outro host e caminho estranho', [
  'http://projeto.supabase.co/storage/v1/object/sign/b/a.jpg?token=x',
  'https://usr:pw@projeto.supabase.co/storage/v1/object/sign/b/a.jpg?token=x',
  `${U}sign/b/a.jpg?token=x&apikey=y`, `${U}public/b/a.jpg?token=x`,
  'https://outro.exemplo.com/storage/v1/object/sign/b/a.jpg?token=x', 'https://projeto.supabase.co/rest/v1/tabela',
].every((u) => !MS.validarUrlMidia(u, cfgT).ok) && MS.validarUrlMidia(`${U}public/b/a.jpg`, cfgT).ok)
t('7c. URL assinada é mascarada para exibição', !MS.mascararUrl(`${U}sign/b/a.jpg?token=SEGREDO123`).includes('SEGREDO123'))
const upCall = fOk.calls.find((c) => c.method === 'POST' && !c.url.includes('/sign/'))
t('7d. objeto com nome imprevisível (uuid), não o nome do arquivo, e cabeçalho correto para chave sb_', /\/jarvis-midia\/\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/.test(upCall.url) && !upCall.url.includes('ok.jpg') && !!upCall.headers.apikey && !upCall.headers.Authorization)
const fJwt = mkFetch((u) => (u.includes('/object/sign/') ? resp(200, { signedURL: '/object/sign/jarvis-midia/x.jpg?token=T' }) : resp(200)))
await MS.enviarMidia(prepFalsa, { env: { ...envOk, SUPABASE_SECRET_KEY: CHAVE_JWT }, fetchFn: fJwt })
t('7e. chave em formato JWT (legado) usa apikey + Authorization', !!fJwt.calls[0].headers.Authorization && !!fJwt.calls[0].headers.apikey)
t('7f. config usa padrões seguros: bucket privado, URL temporária, validade limitada', cfgT.acesso === 'assinada' && cfgT.ttlHoras === 24 && MS.configStorage({ ...envOk, SUPABASE_MEDIA_TTL_HORAS: '9999' }).ttlHoras === 168 && !MS.configStorage({ SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SECRET_KEY: 'k' }).url)
// nenhuma publicação
const todas = [...f401.calls, ...fOk.calls, ...fJwt.calls]
const fonteMidia = readFileSync(new URL('../bridge/media-storage.mjs', import.meta.url), 'utf8') + readFileSync(new URL('../bridge/media-prep.mjs', import.meta.url), 'utf8')
t('8. nenhuma publicação real: nenhuma chamada à Meta e os módulos de mídia não importam o publicador', todas.every((c) => !/facebook\.com|instagram\.com/.test(c.url)) && !/instagram-publish|graph\.facebook/.test(fonteMidia))
// segredos
const achados = (() => { try { return SC.varrerRepositorio() } catch { return null } })()
t('9. nenhum segredo nos arquivos versionados', achados === null || achados.length === 0)
t('9b. o detector acha segredos (token Meta, chave Supabase, JWT) e a máscara de log os esconde', SC.detectarSegredos('EAA' + 'B'.repeat(30)).includes('token Meta') && SC.detectarSegredos(CHAVE_SB).includes('chave secreta Supabase') && SC.detectarSegredos(CHAVE_JWT).includes('JWT / chave de serviço') && [CHAVE_SB, CHAVE_JWT, 'EAA' + 'B'.repeat(30)].every((x) => !HM.redact(`erro ${x}`).includes(x)))
const srcFront = readdirSync(new URL('../src/lib', import.meta.url)).map((n) => readFileSync(new URL(`../src/lib/${n}`, import.meta.url), 'utf8')).join('')
t('9c. a chave de servidor não aparece no código do navegador (src/)', !/SUPABASE_SECRET|service_role|sb_secret/.test(srcFront))
const exemploSec = readFileSync(new URL('../jarvis-secrets.example.cmd', import.meta.url), 'utf8')
t('9d. o exemplo de segredos traz as variáveis do Supabase com valor VAZIO', /set "SUPABASE_SECRET_KEY="\r?\n/.test(exemploSec) && /set "SUPABASE_URL="\r?\n/.test(exemploSec))
// limpeza
const fLista = mkFetch((u) => (u.includes('/object/list/') ? resp(200, [{ name: '11111111-1111-1111-1111-111111111111.jpg', created_at: '2020-01-01T00:00:00Z' }, { name: '22222222-2222-2222-2222-222222222222.jpg', created_at: new Date().toISOString() }, { name: 'meu-arquivo-pessoal.jpg', created_at: '2020-01-01T00:00:00Z' }]) : resp(200)))
const seco = await MS.limparAntigos({ dias: 2, env: envOk, fetchFn: fLista })
t('10. limpeza remota: por padrão só LISTA, ignora objetos que não são nossos e os recentes', seco.dryRun === true && seco.encontrados >= 1 && seco.objetos.every((o) => /[0-9a-f-]{36}\.jpg$/.test(o) && !o.includes('2222') && !o.includes('pessoal')) && !fLista.calls.some((c) => c.method === 'DELETE'))
const apaga = await MS.limparAntigos({ dias: 2, dryRun: false, env: envOk, fetchFn: fLista })
t('10b. com apagar explícito, remove só os antigos nossos', apaga.ok && fLista.calls.filter((c) => c.method === 'DELETE').length === 1 && !String(fLista.calls.find((c) => c.method === 'DELETE').body).includes('pessoal'))
t('10c. remover recusa caminhos que não são deste módulo', (await MS.removerMidia('jarvis-midia/../../etc/passwd', { env: envOk, fetchFn: mkFetch(() => resp(200)) })).codigo === 'CAMINHO_INVALIDO')
rmSync(mdDir, { recursive: true, force: true })
const tmpDepois = readdirSync(tmpdir()).filter((n) => n.startsWith(MP.PREFIXO_TMP)).length
t('10d. diretórios temporários da conversão foram removidos', tmpDepois === tmpAntes)

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

console.log('\n[etapa 2 — facebook + log, tudo simulado]')
{
  const { mkdtempSync, rmSync, readFileSync: rf } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join: jn } = await import('node:path')
  const FB = await import('../bridge/facebook-publish.mjs')
  const LG = await import('../bridge/publicacao-log.mjs')
  const dir = mkdtempSync(jn(tmpdir(), 'jarvis-fb-')); const arq = jn(dir, 'log.jsonl')
  const item = { id: 'x1', status: 'aprovado', legenda: 'Oi', midiaUrls: ['https://exemplo.com/a.jpg'] }
  const semRede = () => { throw new Error('rede!') }
  const TOK = 'EA' + 'A' + 'x'.repeat(24)
  delete process.env.FB_PAGE_TOKEN; delete process.env.FB_PAGE_ID
  t('FB sem credenciais simula e não chama a rede', (await FB.publicarNaPagina(item, { fetchFn: semRede, logArquivo: arq })).simulado === true)
  let m = null; try { await FB.publicarNaPagina({ ...item, status: 'rascunho' }, { logArquivo: arq }) } catch (e) { m = e.message }
  t('FB recusa rascunho não aprovado', /APROVADOS/.test(m ?? ''))
  m = null; try { await FB.publicarNaPagina({ ...item, midiaUrls: ['http://x.com/a.jpg'] }, { logArquivo: arq }) } catch (e) { m = e.message }
  t('FB recusa mídia sem https', /https/.test(m ?? ''))
  process.env.FB_PAGE_TOKEN = TOK; process.env.FB_PAGE_ID = '123'
  const chamadas = []
  const fake = async (url) => { chamadas.push(String(url)); const ok = (b) => ({ ok: true, status: 200, json: async () => b }); return String(url).includes('/photos') ? ok({ id: 'p1', post_id: '123_9' }) : ok({ id: '123' }) }
  const r1 = await FB.publicarNaPagina(item, { fetchFn: fake, logArquivo: arq })
  t('FB publica foto (rede simulada) e devolve id', r1.idMidia === '123_9' && chamadas.some((c) => c.includes('/123/photos')))
  const n = chamadas.length
  const r2 = await FB.publicarNaPagina(item, { fetchFn: fake, logArquivo: arq })
  t('FB é idempotente: segunda chamada não envia nada', r2.duplicado === true && chamadas.length === n)
  const falha = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'ruim ' + TOK } }) })
  m = null; try { await FB.publicarNaPagina({ ...item, id: 'x2' }, { fetchFn: falha, logArquivo: arq }) } catch (e) { m = e.message }
  t('FB falha sem vazar o token e registra no log', m && !m.includes(TOK) && LG.ler(arq).some((x) => x.id === 'x2' && x.resultado === 'falhou'))
  t('log não contém o token', !rf(arq, 'utf8').includes(TOK))
  delete process.env.FB_PAGE_TOKEN; delete process.env.FB_PAGE_ID
  rmSync(dir, { recursive: true, force: true })
}

{
  const { mkdtempSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join: jn } = await import('node:path')
  const FB = await import('../bridge/facebook-publish.mjs'); const LG = await import('../bridge/publicacao-log.mjs')
  const dir = mkdtempSync(jn(tmpdir(), 'jarvis-fb2-')); const arq = jn(dir, 'log.jsonl')
  const mk = (id, extra = {}) => ({ id, status: 'aprovado', tipo: 'post', legenda: 'a', agendadoPara: '2026-10-18 12:00', midiaUrls: ['https://e.com/a.jpg'], ...extra })
  const itens = [mk('a'), mk('b', { tipo: 'story' }), mk('c', { agendadoPara: '2099-01-01 12:00' }), mk('d', { status: 'rascunho' })]
  const store = { listar: (s) => itens.filter((x) => x.status === s) }
  const agora = new Date('2026-10-18T16:00:00Z')
  delete process.env.FB_PAGE_TOKEN
  t('agendador FB inativo sem credenciais', (await FB.rodarAgendadorFacebook(store, { agora, logArquivo: arq })).ativo === false)
  t('FB só seleciona aprovado vencido e não-story', FB.devidosFacebook(store, agora, arq).map((x) => x.id).join() === 'a')
  process.env.FB_PAGE_TOKEN = 'EA' + 'A' + 'y'.repeat(24); process.env.FB_PAGE_ID = '9'
  const bad = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'x' } }) })
  for (let i = 0; i < 4; i++) await FB.rodarAgendadorFacebook(store, { agora, logArquivo: arq, fetchFn: bad })
  t('FB para após 3 falhas', LG.ler(arq).filter((x) => x.resultado === 'falhou').length === 3)
  t('FB respeita PARAR-INSTAGRAM', (await FB.rodarAgendadorFacebook(store, { agora, logArquivo: arq, parar: () => true })).ativo === false)
  delete process.env.FB_PAGE_TOKEN; delete process.env.FB_PAGE_ID
  rmSync(dir, { recursive: true, force: true })
}

{
  const { trocarToken, gravarToken } = await import('../bridge/instagram-token.mjs')
  const { mkdtempSync, rmSync, writeFileSync: wf, readFileSync: rf } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join: jn } = await import('node:path')
  const CURTO = 'EA' + 'A' + 'c'.repeat(30), SEG = 'seg' + 'z'.repeat(20), LONGO = 'EA' + 'A' + 'l'.repeat(30)
  t('troca de token avisa o que falta', (await trocarToken({ env: {} })).erro.includes('FB_APP_SECRET'))
  const okF = async (u) => ({ ok: true, status: 200, json: async () => ({ access_token: LONGO, expires_in: 5184000 }) })
  const r = await trocarToken({ env: { IG_ACCESS_TOKEN: CURTO, FB_APP_ID: '1', FB_APP_SECRET: SEG }, fetchFn: okF })
  t('troca devolve token longo (~60 dias)', r.ok && r.token === LONGO && r.expiraEmDias === 60)
  const ruim = async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'x ' + CURTO + ' ' + SEG } }) })
  const e = await trocarToken({ env: { IG_ACCESS_TOKEN: CURTO, FB_APP_ID: '1', FB_APP_SECRET: SEG }, fetchFn: ruim })
  t('erro da troca não vaza token nem chave', !e.ok && !e.erro.includes(CURTO) && !e.erro.includes(SEG))
  const d = mkdtempSync(jn(tmpdir(), 'jarvis-tk-')); const f = jn(d, 's.cmd')
  wf(f, 'set A=1\r\nset "IG_ACCESS_TOKEN="\r\nset B=2\r\n'); gravarToken(f, LONGO)
  const c = rf(f, 'utf8'); t('gravarToken troca só a linha do token', c.includes('set A=1') && c.includes('set B=2') && c.includes(`IG_ACCESS_TOKEN=${LONGO}`) && !c.includes('IG_ACCESS_TOKEN="'))
  rmSync(d, { recursive: true, force: true })
}

{
  const P = await import('../bridge/instagram-publish.mjs')
  const TK = 'EA' + 'A' + 'q'.repeat(30)
  process.env.IG_ACCESS_TOKEN = TK; process.env.IG_USER_ID = '77'; delete process.env.IG_EXPECTED_USERNAME
  const chamadas = []
  const gfetch = async (url) => { chamadas.push(String(url)); const ok = (b) => ({ ok: true, status: 200, json: async () => b }); const u = String(url); return u.includes('fields=username') ? ok({ username: 'cristianogeraldo.ofc' }) : u.includes('/media_publish') ? ok({ id: 'M1' }) : ok({ id: 'C1', status_code: 'FINISHED' }) }
  const itens = { s1: { id: 's1', status: 'aprovado', tipo: 'story', midiaLocal: ['C:/x/a.jpg'], agendadoPara: '2026-10-18 12:00' }, s2: { id: 's2', status: 'aprovado', tipo: 'story', midiaLocal: ['C:/x/b.jpg'], agendadoPara: '2026-10-18 12:00' } }
  const feitos = [], falhas = []
  const store = { obter: (i) => itens[i], marcarPublicado: (i) => feitos.push(i), registrarFalha: (i) => falhas.push(i), listar: (st) => Object.values(itens).filter((x) => x.status === st) }
  const removidos = []
  const dub = { preparar: async () => ({ ok: true, mime: 'image/jpeg' }), enviar: async (p) => ({ ok: true, url: 'https://x.supabase.co/storage/v1/object/sign/b/a.jpg?token=t', caminho: 'b/a.jpg' }), remover: async (c) => { removidos.push(c); return { ok: true } }, fetchFn: gfetch }
  t('autopost enxerga rascunho só com arquivo local', P.devidos(store, new Date('2026-10-18T16:00:00Z')).length === 2)
  const r = await P.publicarLote(store, ['s1'], dub)
  t('lote sobe o local, publica e marca publicado', r[0].ok && r[0].idMidia === 'M1' && feitos.includes('s1'))
  t('mídia do Supabase é apagada após publicar', removidos.length === 1 && removidos[0] === 'b/a.jpg')
  const r2 = await P.publicarLote(store, ['s2'], { ...dub, fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'ruim' } }) }) })
  t('falha na Meta registra falha e ainda apaga a mídia', !r2[0].ok && falhas.includes('s2') && removidos.length === 2)
  const r3 = await P.publicarLote(store, ['s2'], { ...dub, preparar: async () => ({ ok: false, problemas: ['arquivo ruim'] }) })
  t('mídia inválida não chega à Meta', !r3[0].ok && /inválida/.test(r3[0].erro))
  delete process.env.IG_ACCESS_TOKEN; delete process.env.IG_USER_ID
}

{
  const FIN = await import('../bridge/financas.mjs')
  const S = 'senha-' + 'z'.repeat(12), K = 'chavepublica' + 'k'.repeat(10)
  const env = { FIN_SUPABASE_URL: 'https://x.supabase.co/', FIN_SUPABASE_KEY: K, FIN_EMAIL: 'a@b.com', FIN_PASSWORD: S }
  const semCred = await FIN.resumoFinanceiro({ env: {}, fetchFn: () => { throw new Error('rede!') } })
  t('finanças sem credenciais lista o que falta e não usa a rede', semCred.conectado === false && semCred.faltando.length === 4)
  const metodos = [], urls = []
  const fake = async (url, o) => { metodos.push(o?.method); urls.push(String(url)); const ok = (b) => ({ ok: true, status: 200, json: async () => b }); const u = String(url)
    if (u.includes('/auth/v1/token')) return ok({ access_token: 'tok' })
    if (u.includes('/accounts')) return ok([{ balance: 100, account_type: 'BANK', is_active: true }, { balance: 50.5, account_type: 'CREDIT', is_active: true }])
    if (u.includes('/categories')) return ok([{ id: 1, name: 'Mercado' }])
    if (u.includes('/alerts')) return ok([])
    if (u.includes('/pluggy_items')) return ok([{ connector_name: 'Banco', status: 'UPDATED' }])
    return ok([{ amount: -30, category_id: 1, date: '2026-10-02' }, { amount: 200, category_id: null, date: '2026-10-03' }]) }
  const r = await FIN.resumoFinanceiro({ env, fetchFn: fake, agora: new Date('2026-10-25T12:00:00Z') })
  t('finanças: resumo calcula saldo, entradas e saídas sem presumir o sinal', r.conectado && r.saldoContas.total === 150.5 && r.mesAtual.valoresNegativos === -30 && r.mesAtual.valoresPositivos === 200 && /confirmar/.test(r.convencaoDoSinal))
  t('finanças: só GET nas consultas (POST apenas no login)', metodos.filter((m) => m !== 'GET').length === 1 && urls.filter((u) => !u.includes('/auth/v1/')).every((u, i) => metodos[urls.indexOf(u)] === 'GET'))
  t('finanças: recusa tabela fora da lista', await FIN.consultar({ url: 'https://x', key: 'k' }, 't', 'users', '', fake).then(() => false, (e) => /não permitida/.test(e.message)))
  const ruim = async () => ({ ok: false, status: 400, json: async () => ({ error_description: 'bad ' + S + ' ' + K }) })
  const e = await FIN.resumoFinanceiro({ env, fetchFn: ruim })
  t('finanças: erro de login não vaza senha nem chave', e.conectado === false && !JSON.stringify(e).includes(S) && !JSON.stringify(e).includes(K))
}

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
