// FinCon — telas. Dados via api (Firebase ou demo, mesma interface); lógica em logic.js, parsers.js, reports.js.
import { firebaseConfig, configured } from './firebase-config.js';
import {
  MESES, MESES_LONGOS, INDEFINIDO, RATEIO, CODIGOS_PADRAO, CODIGOS_EXTRA, moeda, r2, aprender, classificar,
  novosLancamentos, gerarMes, conferir, aJustificar, saldoConta, movimentoConta, num,
} from './logic.js';
import * as P from './parsers.js';
import { RELATORIOS, quadrimestral } from './reports.js';
import { importarSecretaria } from './importer.js';

const DEMO = new URLSearchParams(location.search).has('demo') || !configured;
const api = DEMO ? (await import('./data-demo.js')).createDemoApi()
  : (await import('./data-firebase.js')).createFirebaseApi(firebaseConfig);
const SHEETJS = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';

// ------------------------------------------------------------------ utilitários de tela
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const main = () => $('#main');
function toast(msg, erro = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (erro ? ' erro' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), erro ? 10000 : 3500);
}
async function tentar(fn) { try { return await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); } }
const opcoes = (lst, sel) => lst.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(t)}</option>`).join('');
const seletorMes = (id, sel) => `<select id="${id}">${opcoes(MESES.map((m, i) => [i + 1, MESES_LONGOS[i]]), sel)}</select>`;
let _xlsx = null;
const xlsx = async () => (_xlsx ||= await import(SHEETJS));

// ------------------------------------------------------------------ estado
let sessao = null;
let cfg = null;
const st = { ano: Number(localStorage.getItem('fincon-ano')) || new Date().getFullYear(), mes: new Date().getMonth() + 1, cache: {},
  lugar: null, lugares: [] };
const ADM = () => sessao?.perfil === 'adm';
const GLOBAL = () => ['adm', 'cr'].includes(sessao?.perfil);           // veem todos os lugares
const CONSOLIDADO = () => st.lugar === '*';
// acesso total no lugar em uso: cl do lugar ou administrador (quando um lugar está escolhido)
const SEC = () => (sessao?.perfil === 'secretaria' || ADM()) && Boolean(st.lugar) && !CONSOLIDADO();
const VE_RELATORIOS = () => ['secretaria', 'cr', 'adm'].includes(sessao?.perfil);
// valor gravado -> rótulo na tela ("secretaria" continua sendo o valor interno do perfil cl)
const PERFIS = [['secretaria', 'cl — acesso total no lugar'], ['residente', 'residente — próprios extratos']];
const PERFIS_GLOBAIS = [['cr', 'cr — só relatórios (todos os lugares)'], ['adm', 'adm — administrador (todos os lugares)']];
const rotuloPerfil = (p) => ({ secretaria: 'cl', residente: 'residente', cr: 'cr', adm: 'adm' }[p] || p);
const nomeLugar = (id) => (id === '*' ? 'Todos os lugares' : st.lugares.find((l) => l.id === id)?.nome || id || '');
const CFG_PADRAO = () => ({ casa: 'CCBV', pessoas: [], contas: [], codigos: CODIGOS_PADRAO, saldoInicial: {}, orcamento: {}, regras: [] });

async function dados(col, recarregar = false) {
  const k = `${col}|${st.lugar}|${st.ano}`;
  if (recarregar || !st.cache[k]) {
    const f = ['config'].includes(col) ? {} : { ano: st.ano };
    st.cache[k] = await api.listar(col, f);
  }
  return st.cache[k];
}
const invalidar = (...cols) => { for (const k of Object.keys(st.cache)) if (cols.includes(k.split('|')[0])) delete st.cache[k]; };
const tabela = () => cfg.codigos || CODIGOS_PADRAO;
const pessoasVisiveis = () => (SEC() ? cfg.pessoas : cfg.pessoas.filter((p) => p.sigla === sessao.sigla));
const todosCodigos = () => [...new Set([...Object.values(tabela()).flatMap(Object.keys), ...CODIGOS_EXTRA])];

// ------------------------------------------------------------------ navegação
const NAV = {
  secretaria: [['inicio', 'Início'], ['extratos', 'Extratos'], ['vales', 'Vales'], ['bancos', 'Bancos'],
    ['justificar', 'Justificar'], ['relatorios', 'Relatórios'], ['membros', 'Membros'], ['config', 'Configuração'], ['conta', 'Conta']],
  residente: [['inicio', 'Início'], ['extratos', 'Meus extratos'], ['meusvales', 'Meus vales'], ['conta', 'Conta']],
  cr: [['inicio', 'Início'], ['relatorios', 'Relatórios'], ['conta', 'Conta']],
};
function navItens() {
  if (ADM()) {
    if (!st.lugar) return [['lugares', 'Lugares'], ['conta', 'Conta']];
    if (CONSOLIDADO()) return [['inicio', 'Início'], ['relatorios', 'Relatórios'], ['lugares', 'Lugares'], ['conta', 'Conta']];
    return [...NAV.secretaria.slice(0, -1), ['lugares', 'Lugares'], ['conta', 'Conta']];
  }
  return NAV[sessao.perfil] || NAV.residente;
}
function montarNav() {
  $('#nav').innerHTML = navItens().map(([id, t]) => `<a href="#/${id}" data-v="${id}">${t}</a>`).join('');
  $('#quem').textContent = `${sessao.sigla ? sessao.sigla + ' · ' : ''}${rotuloPerfil(sessao.perfil)}${api.demo ? ' · DEMO' : ''}`;
  $('#seletor-ano').innerHTML = opcoes([2024, 2025, 2026, 2027, 2028].map((a) => [a, a]), st.ano);
  const sl = $('#seletor-lugar');
  if (GLOBAL() && st.lugares.length) {
    sl.innerHTML = opcoes([...st.lugares.map((l) => [l.id, l.nome || l.id]), ['*', 'Todos (consolidado)']], st.lugar);
    sl.disabled = false; sl.parentElement.hidden = false;
  } else if (st.lugar) {
    sl.innerHTML = opcoes([[st.lugar, nomeLugar(st.lugar)]], st.lugar); sl.disabled = true; sl.parentElement.hidden = false;
  } else sl.parentElement.hidden = true;
}
async function trocarLugar(id) {
  st.lugar = id || null; api.usarLugar(st.lugar);
  if (GLOBAL() && id) localStorage.setItem('fincon-lugar', id);
  cfg = { ...CFG_PADRAO(), ...((st.lugar && !CONSOLIDADO() ? await api.config(st.lugar) : null) || {}) };
  if (!cfg.casa || cfg.casa === 'CCBV') cfg.casa = st.lugar && !CONSOLIDADO() ? (nomeLugar(st.lugar) || 'CCBV') : 'Todos os lugares';
  st.cache = {};
  montarNav();
}
async function rotear() {
  const v = (location.hash.replace('#/', '') || 'inicio').split('?')[0];
  const permitidas = navItens().map((x) => x[0]);
  const view = permitidas.includes(v) ? v : permitidas[0];
  $$('#nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.v === view));
  main().innerHTML = '<p class="carregando">Carregando…</p>';
  main().onclick = null;
  await tentar(() => VIEWS[view]());
}

// ------------------------------------------------------------------ início
const VIEWS = {};
VIEWS.inicio = async () => {
  if (CONSOLIDADO()) return inicioConsolidado();
  let html = '';
  if (sessao.perfil !== 'cr') {
    const c = await contexto();
    const pessoas = pessoasVisiveis();
    html += `<section class="card"><h2>Situação de ${st.ano}</h2>
      <p class="pequeno">Lançamentos de extrato por mês (em vermelho, quantos ainda estão sem classificação "???").</p>
      <div class="rolagem"><table class="grade"><thead><tr><th>Pessoa</th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
    for (const p of pessoas) {
      html += `<tr><th>${esc(p.sigla)}</th>`;
      for (let m = 1; m <= 12; m++) {
        const ls = c.lanc.filter((l) => l.sigla === p.sigla && l.mes === m);
        const pend = ls.filter((l) => !l.tipo || l.tipo === INDEFINIDO).length;
        html += `<td>${ls.length ? ls.length : '<span class="vazio">—</span>'}${pend ? ` <span class="pend">${pend}</span>` : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table></div></section>';
    html += cartaoPendentes(c);
  }
  if (VE_RELATORIOS()) {
    const c = await contexto();
    const conf = {};
    html += `<section class="card"><h2>Conferência (diferença da aba 2, célula N1)</h2><div class="rolagem"><table class="grade"><thead><tr><th></th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody><tr><th>Diferença</th>`;
    for (let m = 1; m <= 12; m++) {
      if (!c.vales.some((v) => v.mes === m)) { html += '<td><span class="vazio">—</span></td>'; continue; }
      conf[m] = conferir({ ano: st.ano, mes: m, vales: c.vales, bancos: c.bancos, justificar: c.just, contas: cfg.contas, saldoInicial: cfg.saldoInicial?.[st.ano] || {}, snapshots: c.snaps });
      html += `<td class="${Math.abs(conf[m].diferenca) < 0.01 ? 'ok' : 'erro'}">${Math.abs(conf[m].diferenca) < 0.01 ? '✓' : moeda(conf[m].diferenca)}</td>`;
    }
    html += `</tr><tr><th>Encerrado</th>${MESES.map((_, i) => `<td>${c.snaps[i + 1] ? '🔒' : ''}</td>`).join('')}</tr></tbody></table></div>
      <p class="pequeno">✓ = saldo final dos caixas B e C igual a caixa + bancos + a justificar (como as abas 9 e 11).</p>
      ${detalheDiferencas(conf, c)}</section>`;
  }
  main().innerHTML = html;
};

/** Meses com diferença: de onde ela vem (caixa B/C) e quais contas não batem com o saldo do extrato. */
function detalheDiferencas(conf, c) {
  const linhas = [];
  for (const [m, x] of Object.entries(conf)) {
    for (const cx of ['B', 'C']) {
      const d = x[cx];
      if (Math.abs(d.diferenca) >= 0.01) linhas.push(`<tr><td>${MESES[m - 1]}</td><td>${cx}</td><td class="num">${moeda(d.final)}</td><td class="num">${moeda(d.dinheiro)}</td>
        <td class="num">${moeda(d.bancos)}</td><td class="num">${moeda(d.justificar)}</td><td class="num">${moeda(d.total)}</td><td class="num erro">${moeda(d.diferenca)}</td></tr>`);
    }
  }
  const contas = [];
  if (SEC()) {
    for (const s of c.saldos) {
      if (s.final == null) continue;
      const ct = cfg.contas.find((k) => k.id === s.conta);
      if (!ct || ct.cartao || !c.bancos.some((b) => b.conta === s.conta && b.mes <= s.mes)) continue;
      const calc = saldoConta(c.bancos, s.conta, st.ano, s.mes);
      const dif = r2(calc - s.final);
      if (Math.abs(dif) >= 0.01) contas.push(`<tr><td>${MESES[s.mes - 1]}</td><td>${esc(s.conta)}</td><td class="num">${moeda(calc)}</td><td class="num">${moeda(s.final)}</td><td class="num erro">${moeda(dif)}</td></tr>`);
    }
  }
  if (!linhas.length && !contas.length) return '';
  return `${linhas.length ? `<h3>Diferenças por caixa</h3><div class="rolagem"><table class="lanc"><thead><tr><th>Mês</th><th>Caixa</th><th>Saldo final</th><th>Dinheiro</th><th>Bancos</th><th>A justificar</th><th>Caixa + bancos + a justificar</th><th>Diferença</th></tr></thead><tbody>${linhas.join('')}</tbody></table></div>` : ''}
    ${contas.length ? `<h3>Contas com saldo diferente do extrato</h3><div class="rolagem"><table class="lanc"><thead><tr><th>Mês</th><th>Conta</th><th>Saldo calculado (BANCOS)</th><th>Saldo do extrato</th><th>Diferença</th></tr></thead><tbody>${contas.join('')}</tbody></table></div>` : ''}`;
}

/** Extratos pendentes: por conta, meses sem lançamentos e meses cujo saldo inicial não bate com o final anterior. */
function cartaoPendentes(c) {
  const hoje = new Date();
  const limite = st.ano < hoje.getFullYear() ? 12 : st.ano === hoje.getFullYear() ? hoje.getMonth() : 0;
  if (!limite) return '';
  const contas = cfg.contas.filter((k) => SEC() || k.sigla === sessao.sigla);
  if (!contas.length) return '';
  const saldo = new Map(c.saldos.map((s) => [`${s.conta}|${s.mes}`, s]));
  let pend = 0, parada = 0;
  let h = `<section class="card"><h2>Extratos pendentes</h2><p class="pequeno">✗ = mês não contabilizado (sem lançamentos de extrato nem movimento em BANCOS); ○ = mês já encerrado sem movimento da conta; ⚠ = o saldo inicial do
    extrato não bate com o final do mês anterior (faltam lançamentos). Até ${MESES_LONGOS[limite - 1]} de ${st.ano}.</p>
    <div class="rolagem"><table class="grade"><thead><tr><th>Conta</th><th>Pessoa</th>${MESES.slice(0, limite).map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
  // contabilizado = tem lançamentos de extrato, ou movimento na aba BANCOS (ex.: importado da planilha), ou mês encerrado
  const movimento = (id, m) => c.bancos.some((b) => b.conta === id && b.mes === m && b.rotulo !== 'SALDO ANTERIOR' && (b.entrada || b.saida));
  for (const k of contas) {
    const meses = [...c.lanc.filter((l) => l.conta === k.id), ...c.bancos.filter((b) => b.conta === k.id)].map((x) => x.mes);
    if (!meses.length && !k.sigla) continue; // conta sem dono e sem nenhum dado no ano
    const inicio = meses.length ? Math.min(...meses) : 1;
    const ate = cfg.pessoas.find((p) => p.sigla === k.sigla)?.ate || '';
    const fim = !ate ? limite : Number(ate.slice(0, 4)) > st.ano ? limite : Number(ate.slice(0, 4)) < st.ano ? 0 : Math.min(limite, Number(ate.slice(5, 7)));
    if (!fim) continue; // a pessoa já tinha saído
    h += `<tr><th>${esc(k.id)}</th><td>${esc(k.sigla || '')}</td>`;
    for (let m = 1; m <= limite; m++) {
      if (m > fim) { h += '<td><span class="vazio">·</span></td>'; continue; }
      const tem = c.lanc.some((l) => l.conta === k.id && l.mes === m) || movimento(k.id, m);
      const ab = saldo.get(`${k.id}|${m}`)?.abertura, ant = saldo.get(`${k.id}|${m - 1}`)?.final;
      const quebra = !k.cartao && ab != null && ant != null && Math.abs(ab - ant) >= 0.01;
      if (m < inicio && !tem) { h += '<td><span class="vazio">·</span></td>'; continue; }
      if (!tem && c.snaps[m]) { parada++; h += '<td class="pend" title="mês encerrado sem movimento desta conta">○</td>'; continue; }
      if (!tem || quebra) pend++;
      h += `<td class="${!tem || quebra ? 'erro' : 'ok'}" title="${quebra ? `saldo inicial ${moeda(ab)} ≠ final anterior ${moeda(ant)}` : ''}">${!tem ? '✗' : quebra ? '⚠' : '✓'}</td>`;
    }
    h += '</tr>';
  }
  return h + `</tbody></table></div><p class="pequeno">${pend ? `${pend} mês(es) pendente(s).` : 'Nenhuma pendência nos meses abertos.'}${parada ? ` ${parada} mês(es) encerrado(s) sem movimento da conta (○).` : ''}</p></section>`;
}

const mesEncerrado = (c, m) => c.snaps[m];

// ------------------------------------------------------------------ extratos
VIEWS.extratos = async () => {
  const pessoas = pessoasVisiveis();
  if (!pessoas.length) {
    main().innerHTML = `<section class="card"><p>${SEC() ? 'Cadastre as pessoas em <a href="#/config">Configuração</a> (ou importe a planilha da secretaria).' : 'Sua sigla ainda não está cadastrada: fale com a secretaria.'}</p></section>`;
    return;
  }
  const sigla = st.sigla && pessoas.some((p) => p.sigla === st.sigla) ? st.sigla : pessoas[0].sigla;
  st.sigla = sigla;
  const contas = cfg.contas.filter((c) => c.sigla === sigla);
  main().innerHTML = `
  <section class="card">
    <h2>Importar extratos</h2>
    <div class="linha">
      <label>Pessoa <select id="ex-pessoa" ${SEC() ? '' : 'disabled'}>${opcoes(pessoas.map((p) => [p.sigla, `${p.sigla} — ${p.nome}`]), sigla)}</select></label>
      <label>Conta <select id="ex-conta">${opcoes(contas.map((c) => [c.id, `${c.id} — ${c.nome}${c.cartao ? ' (cartão)' : ''}`]), st.conta)}</select></label>
      <button id="ex-nova-conta" class="sec">+ nova conta</button>
    </div>
    <p class="pequeno">Aceita: PDF do Itaú, planilha exportada do Itaú (.xls/.xlsx), CSV do Nubank, fatura do cartão Nubank e planilhas no
      formato do modelo consolidado (uma aba por mês). Os arquivos são lidos neste computador; só os lançamentos vão para a base.</p>
    <input type="file" id="ex-arquivos" multiple accept=".pdf,.xls,.xlsx,.csv">
    <div id="ex-previa"></div>
  </section>
  <section class="card">
    <h2>Lançamentos de ${esc(sigla)} em ${st.ano}</h2>
    <div class="linha">
      <label>Mês <select id="ex-mes"><option value="">todos</option>${opcoes(MESES.map((m, i) => [i + 1, MESES_LONGOS[i]]), st.exMes || '')}</select></label>
      <label><input type="checkbox" id="ex-pend" ${st.exPend ? 'checked' : ''}> só sem classificação</label>
      <button id="ex-sugerir" class="sec">Sugerir classificação dos "???"</button>
    </div>
    <div id="ex-lista"></div>
  </section>`;
  $('#ex-pessoa').onchange = (e) => { st.sigla = e.target.value; st.conta = null; rotear(); };
  $('#ex-conta').onchange = (e) => { st.conta = e.target.value; };
  st.conta = $('#ex-conta').value || null;
  $('#ex-nova-conta').onclick = () => novaConta(sigla);
  $('#ex-mes').onchange = (e) => { st.exMes = e.target.value; listaLancamentos(sigla); };
  $('#ex-pend').onchange = (e) => { st.exPend = e.target.checked; listaLancamentos(sigla); };
  $('#ex-arquivos').onchange = (e) => tentar(() => previaArquivos(sigla, [...e.target.files]));
  $('#ex-sugerir').onclick = () => tentar(() => sugerirTodos(sigla));
  await listaLancamentos(sigla);
};

async function novaConta(sigla) {
  const id = prompt('Sigla da conta (como na aba BANCOS, ex.: CLK, CLK2, CSC):', `C${sigla}`);
  if (!id) return;
  const nome = prompt('Nome da conta (ex.: Itaú 011528-1, Nubank, Cartão Nubank):', '') || id;
  const cartao = confirm('É cartão de crédito? (OK = sim, Cancelar = conta bancária)');
  const caixa = confirm('A conta é do Caixa B (pessoal)? (OK = B, Cancelar = C, da casa)') ? 'B' : 'C';
  if (cfg.contas.some((c) => c.id === id)) { toast('Já existe uma conta com essa sigla.', true); return; }
  cfg.contas.push({ id, sigla, nome, cartao, caixa });
  if (SEC()) await api.salvarConfig(cfg); else toast('Peça à secretaria para cadastrar a conta (só ela altera a configuração).', true);
  st.conta = id; rotear();
}

async function lerArquivo(f) {
  const nome = f.name;
  if (nome.toLowerCase().endsWith('.pdf')) {
    const pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
    const paginas = [];
    for (let i = 1; i <= doc.numPages; i++) paginas.push(P.linhasDaPagina((await (await doc.getPage(i)).getTextContent()).items));
    return [{ nome, aba: null, res: P.itauPdf(paginas) }];
  }
  if (nome.toLowerCase().endsWith('.csv')) {
    const texto = await f.text();
    return [{ nome, aba: null, res: P.nubankCsv(texto) }];
  }
  const XLSX = await xlsx();
  const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
  const out = [];
  for (const aba of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, defval: null, raw: true });
    const formato = P.detectar(nome, rows);
    if (formato === 'desconhecido' || /^(modelo|gabarito)$/i.test(aba)) continue;
    out.push({ nome, aba, formato, rows });
  }
  return out;
}

function mesDoNome(txt) {
  const t = txt.toLowerCase();
  let m = t.match(/(20\d\d)[-_ ](\d{2})(?!\d)/);
  if (m) return { a: Number(m[1]), m: Number(m[2]) };
  const i = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'].findIndex((x) => t.includes(x));
  return i >= 0 ? { a: null, m: i + 1 } : null;
}

async function previaArquivos(sigla, arquivos) {
  const conta = $('#ex-conta').value;
  if (!conta) { toast('Escolha (ou crie) a conta antes.', true); return; }
  const contaCfg = cfg.contas.find((c) => c.id === conta);
  const partes = [];
  for (const f of arquivos) partes.push(...await lerArquivo(f));
  const lancAno = await dados('lancamentos');
  const ap = aprender(lancAno);
  const novos = [];
  const saldos = [];
  const resumo = [];
  for (const p of partes) {
    let res = p.res;
    if (!res) {
      if (p.formato === 'modelo') {
        const dm = mesDoNome(p.aba) || mesDoNome(p.nome) || {};
        res = P.modelo(p.rows, dm.a || st.ano, dm.m || st.mes, sigla);
        res.mes = dm.m || st.mes;
      } else if (p.formato === 'cartao_nubank') res = P.cartaoNubank(p.rows);
      else res = P.itauPlanilha(p.rows);
    }
    const doAno = res.movs.filter((m) => m.data.a === st.ano);
    for (const m of doAno) {
      const l = { sigla, conta, ano: m.data.a, mes: m.data.m, dia: m.data.d, es: m.valor > 0 ? 'E' : 'S', valor: r2(Math.abs(m.valor)),
        texto: m.texto || '', tipo: m.tipo || null, disc: m.disc || null, caixa: m.caixa || null, arquivo: p.nome + (p.aba ? ` [${p.aba}]` : '') };
      const c = classificar(l, { aprendido: ap, tabela: tabela(), regras: [...(cfg.regras || []), ...P.REGRAS_PADRAO] });
      Object.assign(l, { tipo: c.tipo, caixa: l.caixa === 'justificar' ? 'justificar' : c.caixa, disc: c.disc, origemTipo: c.origem });
      if (contaCfg?.cartao && l.es === 'S' && !l.tipo) l.tipo = INDEFINIDO;
      novos.push(l);
    }
    if (res.formato === 'modelo') {
      saldos.push({ conta, sigla, ano: st.ano, mes: res.mes, abertura: res.abertura, final: res.saldoFinal ?? r2(res.abertura + res.movs.reduce((s, m) => s + m.valor, 0)) });
    } else {
      for (const [mes, x] of Object.entries(P.saldosMensais(res.saldos, st.ano))) saldos.push({ conta, sigla, ano: st.ano, mes: Number(mes), ...x });
    }
    resumo.push(`<li><strong>${esc(p.nome)}${p.aba ? ` [${esc(p.aba)}]` : ''}</strong>: ${esc(res.formato)}, ${res.movs.length} lançamentos (${doAno.length} em ${st.ano})${res.avisos?.length ? ' — ' + res.avisos.map(esc).join(' ') : ''}</li>`);
  }
  const daConta = lancAno.filter((l) => l.conta === conta);
  const entrar = novosLancamentos(daConta, novos);
  const pend = entrar.filter((l) => l.tipo === INDEFINIDO).length;
  $('#ex-previa').innerHTML = `<ul>${resumo.join('')}</ul>
    <p><strong>${entrar.length}</strong> lançamentos novos (${novos.length - entrar.length} já existiam), ${pend} sem classificação.</p>
    ${tabelaLanc(entrar.slice(0, 300), false)}${entrar.length > 300 ? '<p class="pequeno">(mostrando 300)</p>' : ''}
    <button id="ex-gravar" ${entrar.length ? '' : 'disabled'}>Importar ${entrar.length} lançamentos</button>`;
  $('#ex-gravar').onclick = () => tentar(async () => {
    await api.salvarVarios('lancamentos', entrar.map(({ origemTipo, ...l }) => l));
    const existentes = await api.listar('saldos', { ano: st.ano, sigla });
    const porChave = new Map(existentes.map((s) => [`${s.conta}|${s.mes}`, s]));
    await api.salvarVarios('saldos', saldos.map((s) => ({ ...porChave.get(`${s.conta}|${s.mes}`), ...Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && v !== undefined)) })));
    invalidar('lancamentos', 'saldos');
    toast(`${entrar.length} lançamentos importados.`);
    rotear();
  });
}

function tabelaLanc(lst, editavel) {
  if (!lst.length) return '<p class="pequeno">Nenhum lançamento.</p>';
  const cods = todosCodigos();
  let h = '<div class="rolagem"><table class="lanc"><thead><tr><th>Data</th><th>Conta</th><th>Texto do banco</th><th>E/S</th><th>Valor</th><th>Tipo1</th><th>Caixa</th><th>Discriminação</th>' + (editavel ? '<th></th>' : '') + '</tr></thead><tbody>';
  for (const l of lst) {
    const pend = !l.tipo || l.tipo === INDEFINIDO;
    h += `<tr data-id="${esc(l.id || '')}" class="${pend ? 'pend-linha' : ''}">
      <td>${String(l.dia).padStart(2, '0')}/${String(l.mes).padStart(2, '0')}</td><td>${esc(l.conta)}</td>
      <td class="texto" title="${esc(l.arquivo || '')}">${esc(l.texto)}</td><td>${l.es}</td><td class="num">${moeda(l.valor)}</td>`;
    if (editavel) {
      h += `<td><select data-f="tipo">${opcoes([['', ''], ...cods.map((c) => [c, c])], l.tipo || '')}</select></td>
        <td><select data-f="caixa">${opcoes([['B', 'B'], ['C', 'C'], ['justificar', 'justificar']], l.caixa || 'B')}</select></td>
        <td><input data-f="disc" value="${esc(l.disc || '')}"></td><td><button class="mini perigo" data-del="${esc(l.id)}" title="Apagar">✕</button></td>`;
    } else h += `<td>${esc(l.tipo || '')}${l.origemTipo ? ` <span class="pequeno">(${esc(l.origemTipo)})</span>` : ''}</td><td>${esc(l.caixa || '')}</td><td>${esc(l.disc || '')}</td>`;
    h += '</tr>';
  }
  return h + '</tbody></table></div>';
}

async function listaLancamentos(sigla) {
  const lanc = (await dados('lancamentos')).filter((l) => l.sigla === sigla &&
    (!st.exMes || l.mes === Number(st.exMes)) && (!st.exPend || !l.tipo || l.tipo === INDEFINIDO))
    .sort((a, b) => a.mes - b.mes || a.dia - b.dia || a.conta.localeCompare(b.conta));
  const el = $('#ex-lista');
  const arquivos = [...new Set(lanc.map((l) => l.arquivo).filter(Boolean))];
  el.innerHTML = `<p class="pequeno">${lanc.length} lançamentos.</p>${tabelaLanc(lanc, true)}
    ${arquivos.length ? `<details><summary>Apagar uma importação</summary><div class="linha"><select id="ex-arq">${opcoes(arquivos.map((a) => [a, a]))}</select><button id="ex-apagar-arq" class="perigo">Apagar lançamentos deste arquivo</button></div></details>` : ''}`;
  el.onchange = (e) => {
    const tr = e.target.closest('tr[data-id]'); const f = e.target.dataset.f;
    if (!tr || !f) return;
    const l = lanc.find((x) => x.id === tr.dataset.id);
    l[f] = e.target.value || null;
    if (f === 'tipo' && ['AG', 'LZ', 'IT', 'CS', 'casa', 'OR', 'CM', 'GG', 'MT', 'CP', 'CO'].includes(l.tipo)) { l.caixa = 'C'; tr.querySelector('[data-f=caixa]').value = 'C'; }
    tr.classList.toggle('pend-linha', !l.tipo || l.tipo === INDEFINIDO);
    tentar(() => api.salvar('lancamentos', l));
  };
  el.onclick = (e) => {
    const id = e.target.dataset.del;
    if (id && confirm('Apagar este lançamento?')) tentar(async () => { await api.apagarVarios('lancamentos', [id]); invalidar('lancamentos'); listaLancamentos(sigla); });
    if (e.target.id === 'ex-apagar-arq') {
      const arq = $('#ex-arq').value;
      const ids = lanc.filter((l) => l.arquivo === arq).map((l) => l.id);
      if (confirm(`Apagar ${ids.length} lançamentos de "${arq}"?`)) tentar(async () => { await api.apagarVarios('lancamentos', ids); invalidar('lancamentos'); listaLancamentos(sigla); });
    }
  };
}

async function sugerirTodos(sigla) {
  const lanc = await dados('lancamentos');
  const ap = aprender(lanc);
  const mud = [];
  for (const l of lanc.filter((x) => x.sigla === sigla && (!x.tipo || x.tipo === INDEFINIDO))) {
    const c = classificar({ ...l, tipo: null }, { aprendido: ap, tabela: tabela(), regras: [...(cfg.regras || []), ...P.REGRAS_PADRAO] });
    if (c.tipo !== INDEFINIDO) mud.push({ ...l, tipo: c.tipo, caixa: c.caixa, disc: l.disc || c.disc });
  }
  if (!mud.length) { toast('Nenhuma sugestão nova.'); return; }
  await api.salvarVarios('lancamentos', mud);
  invalidar('lancamentos'); toast(`${mud.length} lançamentos classificados.`); listaLancamentos(sigla);
}

// ------------------------------------------------------------------ vales (secretaria)
VIEWS.vales = async () => {
  const c = await contexto();
  const mes = st.mes;
  const enc = mesEncerrado(c, mes);
  const doMes = c.vales.filter((v) => v.mes === mes).sort((a, b) => a.sigla.localeCompare(b.sigla) || a.caixa.localeCompare(b.caixa) || (a.es === b.es ? 0 : a.es === 'E' ? -1 : 1));
  const conf = doMes.length ? conferir({ ano: st.ano, mes, vales: c.vales, bancos: c.bancos, justificar: c.just, contas: cfg.contas,
    saldoInicial: cfg.saldoInicial?.[st.ano] || {}, snapshots: c.snaps }) : null;
  main().innerHTML = `
  <section class="card"><h2>Vales — ${MESES_LONGOS[mes - 1]} de ${st.ano} ${enc ? '🔒' : ''}</h2>
    <div class="linha"><label>Mês ${seletorMes('va-mes', mes)}</label>
      <button id="va-gerar" ${enc ? 'disabled' : ''}>Gerar vales do mês a partir dos extratos</button>
      <button id="va-exportar" class="sec">Exportar planilha (VALES, JUSTIFICAR, BANCOS)</button></div>
    <div class="linha encerrar">${enc
      ? `<span>🔒 Mês encerrado${enc.em ? ` em ${new Date(enc.em).toLocaleDateString('pt-BR')}` : ''}${enc.por ? ` por ${esc(enc.por)}` : ''}. A justificar no encerramento: B ${moeda(enc.B)} · C ${moeda(r2((enc.Cax || 0) + (enc.C || 0)))}.</span>
         <button id="va-reabrir" class="sec">Reabrir o mês</button>`
      : `${conf ? `<span class="${Math.abs(conf.diferenca) < 0.01 ? 'ok' : 'erro'}">${Math.abs(conf.diferenca) < 0.01 ? 'Conferência: diferença zero.' : `Conferência: DIFERENÇA de ${moeda(conf.diferenca)} (B ${moeda(conf.B.diferenca)}, C ${moeda(conf.C.diferenca)}).`}</span>` : ''}
         <button id="va-encerrar" ${doMes.length ? '' : 'disabled'}>Encerrar o mês</button>`}</div>
    <p class="pequeno">Encerrar guarda o total a justificar do mês e trava vales, bancos e itens a justificar desse mês.</p>
    <div id="va-previa"></div></section>
  <section class="card"><h2>Lançados em ${MESES_LONGOS[mes - 1]}</h2>${tabelaVales(doMes, !enc)}
    ${enc ? '' : `<details><summary>Incluir vale manual</summary><div class="linha">
      <select id="vm-pessoa">${opcoes(cfg.pessoas.map((p) => [p.sigla, p.sigla]))}</select>
      <select id="vm-caixa">${opcoes([['B', 'B'], ['C', 'C']])}</select><select id="vm-es">${opcoes([['S', 'S'], ['E', 'E']])}</select>
      <input id="vm-valor" placeholder="Valor" size="8"><select id="vm-tipo">${opcoes(Object.values(tabela()).flatMap(Object.keys).map((x) => [x, x]))}</select>
      <input id="vm-disc" placeholder="Discriminação"><button id="vm-ok">Incluir</button></div></details>`}</section>`;
  $('#va-mes').onchange = (e) => { st.mes = Number(e.target.value); rotear(); };
  $('#va-gerar').onclick = () => tentar(previaVales);
  $('#va-exportar').onclick = () => tentar(exportarPlanilha);
  $('#va-encerrar') && ($('#va-encerrar').onclick = () => tentar(async () => {
    if (conf && Math.abs(conf.diferenca) >= 0.01 && !confirm(`A conferência de ${MESES_LONGOS[mes - 1]} tem diferença de ${moeda(conf.diferenca)}. Encerrar mesmo assim?`)) return;
    if (!confirm(`Encerrar ${MESES_LONGOS[mes - 1]} de ${st.ano}? Vales, bancos e itens a justificar do mês ficam travados.`)) return;
    const j = aJustificar(c.just, st.ano, mes);
    await api.salvar('meses', { id: `${st.lugar}_${st.ano}_${mes}`, ano: st.ano, mes, fechado: true, ...j, em: new Date().toISOString(), por: sessao.email });
    invalidar('meses'); toast('Mês encerrado.'); rotear();
  }));
  $('#va-reabrir') && ($('#va-reabrir').onclick = () => tentar(async () => {
    if (!confirm(`Reabrir ${MESES_LONGOS[mes - 1]}? O total a justificar volta a ser calculado e o mês pode ser alterado.`)) return;
    await api.salvar('meses', { ...enc, fechado: false, reaberto: new Date().toISOString() });
    invalidar('meses'); toast('Mês reaberto.'); rotear();
  }));
  $('#vm-ok') && ($('#vm-ok').onclick = () => tentar(async () => {
    const valor = Number(String($('#vm-valor').value).replace(/\./g, '').replace(',', '.'));
    if (!valor) throw new Error('Valor inválido.');
    await api.salvar('vales', { ano: st.ano, mes, dia: 1, sigla: $('#vm-pessoa').value, caixa: $('#vm-caixa').value, es: $('#vm-es').value,
      valor: r2(valor), tipo: $('#vm-tipo').value, disc: $('#vm-disc').value, origem: 'manual' });
    invalidar('vales'); rotear();
  }));
  main().onclick = (e) => {
    const id = e.target.dataset.delvale;
    if (id && !enc && confirm('Apagar este vale?')) tentar(async () => { await api.apagarVarios('vales', [id]); invalidar('vales'); rotear(); });
  };
};

function tabelaVales(lst, editavel = true) {
  if (!lst.length) return '<p class="pequeno">Nenhum vale neste mês.</p>';
  let h = '<div class="rolagem"><table class="lanc"><thead><tr><th>Pessoa</th><th>Caixa</th><th>E/S</th><th>Valor</th><th>Tipo1</th><th>Discriminação</th><th>Origem</th><th></th></tr></thead><tbody>';
  for (const v of lst) h += `<tr><td>${esc(v.sigla)}</td><td>${v.caixa}</td><td>${v.es}</td><td class="num">${moeda(v.valor)}</td><td>${esc(v.tipo)}</td><td>${esc(v.disc)}</td><td class="pequeno">${esc(v.origem || '')}</td><td>${v.id && editavel ? `<button class="mini perigo" data-delvale="${esc(v.id)}">✕</button>` : ''}</td></tr>`;
  const e = lst.filter((v) => v.es === 'E').reduce((s, v) => s + v.valor, 0), s = lst.filter((v) => v.es === 'S').reduce((s2, v) => s2 + v.valor, 0);
  return h + `</tbody></table></div><p class="pequeno">Entradas ${moeda(e)} · saídas ${moeda(s)}</p>`;
}

async function contexto() {
  const cols = SEC() ? ['lancamentos', 'vales', 'bancos', 'justificar', 'saldos', 'meses'] : ['vales', 'bancos', 'justificar', 'meses'];
  const r = Object.fromEntries(await Promise.all(cols.map(async (c) => [c, await dados(c)])));
  const [lanc, vales, bancos, just, saldos, meses] = ['lancamentos', 'vales', 'bancos', 'justificar', 'saldos', 'meses'].map((c) => r[c] || []);
  return { lanc, vales, bancos, just, saldos, meses, snaps: Object.fromEntries(meses.filter((m) => m.fechado).map((m) => [m.mes, m])) };
}

function saldoPlanilhaFn(bancos) {
  return (conta, m) => (m <= 0
    ? r2(bancos.filter((b) => b.conta === conta && b.rotulo === 'SALDO ANTERIOR').reduce((s, b) => s + (b.entrada || 0) - (b.saida || 0), 0))
    : saldoConta(bancos, conta, st.ano, m));
}

async function previaVales() {
  const mes = st.mes;
  const c = await contexto();
  if (mesEncerrado(c, mes)) throw new Error('Mês encerrado: reabra-o para gerar de novo.');
  const lancadas = new Set(c.vales.filter((v) => v.mes === mes && v.origem === 'importado').map((v) => v.sigla));
  const outrosVales = c.vales.filter((v) => !(v.mes === mes && ['gerado', 'rateio'].includes(v.origem)));
  const outrosBancos = c.bancos.filter((b) => !(b.mes === mes && b.origem === 'gerado'));
  const aberturas = {};
  for (const s of c.saldos) {
    if (s.abertura != null) ((aberturas[s.conta] ||= {})[s.mes] = s.abertura);
    else if (s.final != null && s.mes < 12) (aberturas[s.conta] ||= {})[s.mes + 1] ??= s.final;
  }
  const g = gerarMes({ ano: st.ano, mes, lancamentos: c.lanc, contas: cfg.contas, pessoas: cfg.pessoas, tabela: tabela(),
    valesExistentes: outrosVales, justificarExistentes: c.just.filter((j) => !(j.mes === mes && j.origem === 'gerado')),
    lancadas, aberturas, saldoPlanilha: saldoPlanilhaFn(outrosBancos) });
  const valesSim = [...outrosVales, ...g.vales];
  const bancosSim = [...outrosBancos, ...g.bancos.map((b) => ({ ...b, origem: 'gerado' }))];
  const justSim = [...c.just.filter((j) => !(j.mes === mes && j.origem === 'gerado')), ...g.justificar];
  const conf = conferir({ ano: st.ano, mes, vales: valesSim, bancos: bancosSim, justificar: justSim, contas: cfg.contas,
    saldoInicial: cfg.saldoInicial?.[st.ano] || {}, snapshots: Object.fromEntries(Object.entries(c.snaps).filter(([m]) => Number(m) !== mes)) });
  const ok = Math.abs(conf.diferenca) < 0.01;
  $('#va-previa').innerHTML = `
    ${lancadas.size ? `<p class="pequeno">Já lançados (oficiais, importados da secretaria) neste mês, ficam de fora: ${[...lancadas].join(', ')}.</p>` : ''}
    <p>${g.vales.length} linhas de vale, ${g.bancos.length} contas, ${g.justificar.length} itens a justificar; rateio do Caixa C: ${moeda(g.rateio)}.</p>
    ${g.ajustes.length ? `<p class="pequeno">Ajustes: ${g.ajustes.map((a) => `${a.sigla} ${a.tipo} ${moeda(a.valor, true)}`).join(' · ')}</p>` : ''}
    ${g.avisos.map((a) => `<p class="pequeno">${esc(a)}</p>`).join('')}
    <p class="${ok ? 'ok' : 'erro'}">${ok ? 'Conferência: diferença zero (caixas B e C batem com bancos + a justificar).' : `Conferência: DIFERENÇA de ${moeda(conf.diferenca)} (B ${moeda(conf.B.diferenca)}, C ${moeda(conf.C.diferenca)}).`}</p>
    ${tabelaVales(g.vales)}
    <button id="va-gravar">Gravar vales, bancos e itens a justificar do mês</button>`;
  $('#va-gravar').onclick = () => tentar(async () => {
    const velhosV = c.vales.filter((v) => v.mes === mes && ['gerado', 'rateio'].includes(v.origem)).map((v) => v.id);
    const velhosB = c.bancos.filter((b) => b.mes === mes && b.origem === 'gerado').map((b) => b.id);
    const velhosJ = c.just.filter((j) => j.mes === mes && j.origem === 'gerado').map((j) => j.id);
    await api.apagarVarios('vales', velhosV); await api.apagarVarios('bancos', velhosB); await api.apagarVarios('justificar', velhosJ);
    await api.salvarVarios('vales', g.vales);
    await api.salvarVarios('bancos', g.bancos.map((b) => ({ ...b, origem: 'gerado' })));
    await api.salvarVarios('justificar', g.justificar.map((j) => ({ ...j, origem: 'gerado' })));
    invalidar('vales', 'bancos', 'justificar');
    toast('Mês gravado.'); rotear();
  });
}

async function exportarPlanilha() {
  const XLSX = await xlsx();
  const c = await contexto();
  const wb = XLSX.utils.book_new();
  const v = [['Ano', 'Mês', 'Dia', 'Caixa', 'E/S', 'Valor', 'Tipo1', 'Tipo2', 'Discriminação', 'Nome', 'Origem'],
    ...c.vales.sort((a, b) => a.mes - b.mes || a.sigla.localeCompare(b.sigla)).map((x) => [st.ano, x.mes, x.dia, x.caixa, x.es, x.valor, x.tipo, '', x.disc, x.sigla, x.origem])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(v), 'VALES');
  const j = [['Caixa', 'Valor', 'Discriminação', 'Nome', 'Data'], ...c.just.map((x) => [x.caixa, x.valor, x.disc, x.sigla, x.data || ''])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(j), 'JUSTIFICAR');
  const b = [['Mês', 'Discriminação', 'Entrada', 'Saída', 'Conta'], ...c.bancos.sort((a, b2) => a.mes - b2.mes).map((x) => [x.mes, x.rotulo, x.entrada || null, x.saida || null, x.conta])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b), 'BANCOS');
  XLSX.writeFile(wb, `FinCon-${cfg.casa || 'CCBV'}-${st.ano}.xlsx`);
}

// ------------------------------------------------------------------ bancos
VIEWS.bancos = async () => {
  const c = await contexto();
  const real = new Map(c.saldos.map((s) => [`${s.conta}|${s.mes}`, s.final]));
  let h = `<section class="card"><h2>Bancos — ${st.ano}</h2><p class="pequeno">Saldo de cada conta no fim do mês pelas linhas da aba BANCOS (entradas − saídas acumuladas).
    Abaixo, em cinza, o saldo do extrato do banco quando conhecido; em vermelho, a diferença.</p>
    <div class="rolagem"><table class="grade"><thead><tr><th>Conta</th><th>Pessoa</th><th>Caixa</th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
  for (const ct of cfg.contas.filter((x) => !x.cartao)) {
    h += `<tr><th>${esc(ct.id)}</th><td>${esc(ct.sigla || '')}</td><td>${ct.caixa || 'B'}</td>`;
    for (let m = 1; m <= 12; m++) {
      const temMov = c.bancos.some((b) => b.conta === ct.id && b.mes === m);
      const calc = saldoConta(c.bancos, ct.id, st.ano, m);
      const rv = real.get(`${ct.id}|${m}`);
      const dif = rv != null ? r2(calc - rv) : null;
      h += `<td class="num">${temMov || calc ? moeda(calc) : '<span class="vazio">—</span>'}${rv != null ? `<br><span class="pequeno">${moeda(rv)}</span>` : ''}${dif ? `<br><span class="pend">${moeda(dif)}</span>` : ''}</td>`;
    }
    h += '</tr>';
  }
  h += `</tbody></table></div></section>
  <section class="card"><h2>Movimentos de ${MESES_LONGOS[st.mes - 1]}</h2><div class="linha"><label>Mês ${seletorMes('ba-mes', st.mes)}</label></div>
  <div class="rolagem"><table class="lanc"><thead><tr><th>Conta</th><th>Discriminação</th><th>Entrada</th><th>Saída</th><th>Origem</th><th></th></tr></thead><tbody>
  ${c.bancos.filter((b) => b.mes === st.mes).map((b) => `<tr><td>${esc(b.conta)}</td><td>${esc(b.rotulo)}</td><td class="num">${moeda(b.entrada)}</td><td class="num">${moeda(b.saida)}</td><td class="pequeno">${esc(b.origem || '')}</td><td><button class="mini perigo" data-delb="${esc(b.id)}">✕</button></td></tr>`).join('')}
  </tbody></table></div>
  <details><summary>Incluir movimento (ex.: SALDO ANTERIOR no início do ano)</summary><div class="linha">
    <select id="bm-conta">${opcoes(cfg.contas.map((x) => [x.id, x.id]))}</select><select id="bm-rot">${opcoes([['ENTRADA-SAÍDA', 'ENTRADA-SAÍDA'], ['SALDO ANTERIOR', 'SALDO ANTERIOR']])}</select>
    <input id="bm-e" placeholder="Entrada" size="9"><input id="bm-s" placeholder="Saída" size="9"><button id="bm-ok">Incluir</button></div></details></section>`;
  main().innerHTML = h;
  $('#ba-mes').onchange = (e) => { st.mes = Number(e.target.value); rotear(); };
  const n = (v) => Number(String(v || '0').replace(/\./g, '').replace(',', '.')) || 0;
  $('#bm-ok').onclick = () => tentar(async () => {
    if (mesEncerrado(c, st.mes)) throw new Error('Mês encerrado: reabra-o em Vales para alterar.');
    await api.salvar('bancos', { ano: st.ano, mes: st.mes, conta: $('#bm-conta').value, rotulo: $('#bm-rot').value, entrada: n($('#bm-e').value), saida: n($('#bm-s').value), origem: 'manual' });
    invalidar('bancos'); rotear();
  });
  main().onclick = (e) => { const id = e.target.dataset.delb; if (id && mesEncerrado(c, st.mes)) { toast('Mês encerrado: reabra-o em Vales para alterar.', true); return; } if (id && confirm('Apagar este movimento?')) tentar(async () => { await api.apagarVarios('bancos', [id]); invalidar('bancos'); rotear(); }); };
};

// ------------------------------------------------------------------ justificar
VIEWS.justificar = async () => {
  const c = await contexto();
  const j = aJustificar(c.just, st.ano, 12);
  const lst = [...c.just].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const travado = (x) => Boolean(x.mes && x.ano === st.ano && mesEncerrado(c, x.mes));
  let h = `<section class="card"><h2>A justificar</h2>
    <p>Total Caixa B: <strong>${moeda(j.B)}</strong> · Caixa C com a administração (AX): <strong>${moeda(j.Cax)}</strong> · Caixa C a justificar: <strong>${moeda(j.C)}</strong></p>
    <p class="pequeno">Valor positivo = saída a justificar; negativo = entrada (reduz o que falta justificar). Itens de meses encerrados (🔒) não podem ser excluídos.</p>
    <div class="linha"><button id="jt-excluir" class="perigo" disabled>Excluir selecionados</button><span id="jt-soma" class="pequeno"></span></div>
    <div class="rolagem"><table class="lanc"><thead><tr><th><input type="checkbox" id="jt-todos" title="Marcar todos"></th><th>Caixa</th><th>Valor</th><th>Discriminação</th><th>Nome</th><th>Mês</th></tr></thead><tbody id="jt-lista">
    ${lst.map((x) => `<tr><td>${travado(x) ? '🔒' : `<input type="checkbox" data-sel="${esc(x.id)}" data-valor="${x.valor}">`}</td><td>${x.caixa}</td><td class="num">${moeda(x.valor)}</td><td>${esc(x.disc)}</td><td>${esc(x.sigla)}</td><td>${x.mes ? MESES[x.mes - 1] + '/' + (x.ano || '') : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <details><summary>Incluir item</summary><div class="linha"><select id="jm-caixa">${opcoes([['B', 'B'], ['C', 'C']])}</select>
      <input id="jm-valor" placeholder="Valor (+ saída / − entrada)" size="12"><input id="jm-disc" placeholder="Discriminação">
      <select id="jm-pessoa">${opcoes([...cfg.pessoas.map((p) => [p.sigla, p.sigla]), ['AX', 'AX (administração)']])}</select>${seletorMes('jm-mes', st.mes)}<button id="jm-ok">Incluir</button></div></details></section>
    <section class="card"><h2>Meses encerrados</h2><p class="pequeno">O encerramento é feito em Vales (guarda o total a justificar do mês e trava o mês).</p><div class="linha">
    ${MESES.map((m, i) => `<span class="selo ${c.snaps[i + 1] ? 'ok' : 'vazio'}" title="${c.snaps[i + 1] ? `B ${moeda(c.snaps[i + 1].B)} · C ${moeda(c.snaps[i + 1].C)}` : 'aberto'}">${m} ${c.snaps[i + 1] ? '🔒' : ''}</span>`).join('')}</div></section>`;
  main().innerHTML = h;
  const selecionados = () => $$('#jt-lista [data-sel]:checked');
  const atualizar = () => {
    const s = selecionados();
    $('#jt-excluir').disabled = !s.length;
    $('#jt-excluir').textContent = s.length ? `Excluir ${s.length} selecionado(s)` : 'Excluir selecionados';
    $('#jt-soma').textContent = s.length ? `Soma: ${moeda(r2(s.reduce((a, x) => a + Number(x.dataset.valor), 0)))}` : '';
  };
  $('#jt-todos').onchange = (e) => { $$('#jt-lista [data-sel]').forEach((x) => { x.checked = e.target.checked; }); atualizar(); };
  $('#jt-lista').onchange = atualizar;
  $('#jt-excluir').onclick = () => tentar(async () => {
    const ids = selecionados().map((x) => x.dataset.sel);
    if (!ids.length || !confirm(`Excluir ${ids.length} item(ns) a justificar?`)) return;
    await api.apagarVarios('justificar', ids); invalidar('justificar'); toast(`${ids.length} item(ns) excluído(s).`); rotear();
  });
  $('#jm-ok').onclick = () => tentar(async () => {
    const valor = Number(String($('#jm-valor').value).replace(/\./g, '').replace(',', '.'));
    if (!valor) throw new Error('Valor inválido.');
    const mes = Number($('#jm-mes').value);
    if (mesEncerrado(c, mes)) throw new Error('Mês encerrado: reabra-o em Vales para incluir itens.');
    await api.salvar('justificar', { ano: st.ano, mes, caixa: $('#jm-caixa').value, valor: r2(valor), disc: $('#jm-disc').value, sigla: $('#jm-pessoa').value,
      data: `${st.ano}-${String(mes).padStart(2, '0')}-01`, origem: 'manual' });
    invalidar('justificar'); rotear();
  });
};

// ------------------------------------------------------------------ relatórios
VIEWS.relatorios = async () => {
  const cons = CONSOLIDADO() ? await consolidado() : null;
  const c = cons || await contexto();
  const cfgR = cons ? cons.cfg : cfg;
  const lista = cons ? RELATORIOS.filter((r) => !r.pessoa) : RELATORIOS;
  if (cons && !lista.some((r) => r.id === st.rel)) st.rel = '8';
  const rel = lista.find((r) => r.id === (st.rel || '8')) || lista[0];
  st.rel = rel.id;
  const pessoaSel = st.relPessoa || cfg.pessoas[0]?.sigla || '';
  const q = st.quad || Math.min(3, Math.ceil(st.mes / 4));
  const padrao = ['8', '9', '10', '11'];
  main().innerHTML = `<section class="card nao-imprime"><h2>Relatórios</h2><div class="linha">
    <label>Relatório <select id="re-rel">${opcoes(lista.map((r) => [r.id, `${r.id} — ${r.nome}`]), rel.id)}</select></label>
    ${cons ? `<span class="pequeno">Consolidado de ${cons.n} lugares (folhas pessoais e vale eletrônico: escolha um lugar).</span>` : ''}
    <label>Mês ${seletorMes('re-mes', st.mes)}</label>
    ${rel.caixa ? `<label>Caixa <select id="re-caixa">${opcoes([['B', 'B'], ['C', 'C']], st.relCaixa || 'B')}</select></label>` : ''}
    ${rel.pessoa ? `<label>Pessoa <select id="re-pessoa">${rel.pessoa === 'opcional' ? '<option value="">todas</option>' : ''}${opcoes(cfg.pessoas.map((p) => [p.sigla, p.sigla]), rel.pessoa === 'opcional' ? (st.relPessoa || '') : pessoaSel)}</select></label>` : ''}
    <button onclick="window.print()">Imprimir</button></div>
    <details><summary>Exportar para xlsx</summary><p class="pequeno">Abas da planilha (mês escolhido acima):</p><div class="linha">
      ${lista.map((r) => `<label><input type="checkbox" data-exp="${r.id}" ${padrao.includes(r.id) ? 'checked' : ''}> ${r.id} — ${esc(r.nome)}</label>`).join('')}</div>
      <button id="re-exportar">Exportar xlsx</button></details>
    <details ${st.quadAberto ? 'open' : ''}><summary>Relatório quadrimestral</summary><div class="linha">
      <label>Quadrimestre <select id="re-quad">${opcoes([[1, '1º — janeiro a abril'], [2, '2º — maio a agosto'], [3, '3º — setembro a dezembro']], q)}</select></label>
      <button id="re-quad-ver" class="sec">Ver</button><button id="re-quad-exp">Exportar xlsx</button></div>
      <p class="pequeno">Caixas B e C: receitas e despesas por conceito em cada mês e no quadrimestre (com o orçado), evolução mensal e
        comprovante do saldo no fim do quadrimestre${cons ? ', somando todos os lugares' : ''}.</p></details></section>
    <section class="card relatorio" id="re-saida"></section>`;
  const base = () => ({ cfg: cfgR, vales: c.vales, bancos: c.bancos, justificar: c.just, ano: st.ano, mes: st.mes, snapshots: c.snaps });
  const desenhar = () => {
    $('#re-saida').innerHTML = rel.fn({ ...base(), caixa: st.relCaixa || 'B', sigla: rel.pessoa === 'opcional' ? (st.relPessoa || '') : pessoaSel });
  };
  $('#re-rel').onchange = (e) => { st.rel = e.target.value; rotear(); };
  $('#re-mes').onchange = (e) => { st.mes = Number(e.target.value); desenhar(); };
  $('#re-caixa') && ($('#re-caixa').onchange = (e) => { st.relCaixa = e.target.value; desenhar(); });
  $('#re-pessoa') && ($('#re-pessoa').onchange = (e) => { st.relPessoa = e.target.value; rotear(); });
  $('#re-quad').onchange = (e) => { st.quad = Number(e.target.value); };
  $('#re-quad-ver').onclick = () => { st.quadAberto = true; $('#re-saida').innerHTML = quadrimestral({ ...base(), q: Number($('#re-quad').value) }); };
  $('#re-quad-exp').onclick = () => tentar(async () => {
    const qq = Number($('#re-quad').value);
    await exportarAbas([[`Quadrimestre ${qq}`, quadrimestral({ ...base(), q: qq })]], `quadrimestre-${qq}`);
  });
  $('#re-exportar').onclick = () => tentar(async () => {
    const ids = $$('[data-exp]:checked').map((x) => x.dataset.exp);
    if (!ids.length) throw new Error('Marque ao menos um relatório.');
    const abas = [];
    for (const id of ids) {
      const r = RELATORIOS.find((x) => x.id === id);
      if (r.caixa) for (const cx of ['B', 'C']) abas.push([`${id} ${r.nome} ${cx}`, r.fn({ ...base(), caixa: cx })]);
      else if (r.pessoa === 'obrigatória') {
        const comVale = cfg.pessoas.filter((p) => c.vales.some((v) => v.mes === st.mes && v.sigla === p.sigla));
        for (const p of comVale) abas.push([`${id} Vale ${p.sigla}`, r.fn({ ...base(), sigla: p.sigla })]);
      } else abas.push([`${id} ${r.nome}`, r.fn({ ...base(), sigla: '' })]);
    }
    await exportarAbas(abas, MESES[st.mes - 1].toLowerCase());
  });
  desenhar();
};

/** Converte relatórios em HTML (cabeçalho + tabelas) em abas de uma planilha xlsx e baixa o arquivo. */
async function exportarAbas(abas, sufixo) {
  const XLSX = await xlsx();
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  for (const [nome, html] of abas) {
    const linhas = htmlParaLinhas(html);
    const ws = XLSX.utils.aoa_to_sheet(linhas);
    const larg = [];
    for (const l of linhas) l.forEach((v, i) => { larg[i] = Math.max(larg[i] || 8, Math.min(60, String(v ?? '').length + 2)); });
    ws['!cols'] = larg.map((w) => ({ wch: w }));
    let n = nome.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
    for (let k = 2; usados.has(n); k++) n = `${n.slice(0, 28)} ${k}`;
    usados.add(n);
    XLSX.utils.book_append_sheet(wb, ws, n);
  }
  XLSX.writeFile(wb, `FinCon-${CONSOLIDADO() ? 'consolidado' : slug(cfg.casa || nomeLugar(st.lugar) || 'ccbv')}-${st.ano}-${sufixo}.xlsx`);
}

function htmlParaLinhas(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const linhas = [];
  const valor = (s) => {
    const t = s.trim();
    return /^[−-]?[\d.]+,\d{2}$/.test(t) ? num(t.replace('−', '-')) : t;
  };
  for (const el of div.children) {
    if (el.tagName === 'TABLE') {
      for (const tr of el.querySelectorAll('tr')) linhas.push([...tr.children].map((c) => valor(c.textContent)));
      linhas.push([]);
    } else if (el.textContent.trim()) {
      linhas.push(el.classList.contains('rel-cab') ? [...el.children].map((x) => x.textContent.trim()) : [el.textContent.trim()]);
      if (el.tagName !== 'H3') linhas.push([]);
    }
  }
  return linhas;
}

// ------------------------------------------------------------------ meus vales (residente)
VIEWS.meusvales = async () => {
  const vales = await dados('vales');
  main().innerHTML = `<section class="card"><h2>Meus vales — ${st.ano}</h2><div class="linha"><label>Mês ${seletorMes('mv-mes', st.mes)}</label><button onclick="window.print()">Imprimir</button></div></section>
    <section class="card relatorio">${RELATORIOS.find((r) => r.id === '14').fn({ cfg, vales, ano: st.ano, mes: st.mes, sigla: sessao.sigla })}</section>`;
  $('#mv-mes').onchange = (e) => { st.mes = Number(e.target.value); rotear(); };
};

// ------------------------------------------------------------------ configuração (secretaria)
VIEWS.config = async () => {
  const si = cfg.saldoInicial?.[st.ano] || { B: 0, C: 0 };
  main().innerHTML = `
  <section class="card"><h2>Planilha da secretaria</h2>
    <p class="pequeno">Importa de uma "Secretaria Evolution.ANO.xlsx" as pessoas, os códigos (aba 1), o saldo inicial, os VALES já lançados (aba 2),
      JUSTIFICAR e fechamentos (aba 3), BANCOS (aba 4) e o orçamento (aba 6). Os dados desse ano no app são substituídos.</p>
    <input type="file" id="cf-sec" accept=".xlsx"><div id="cf-sec-status" class="pequeno"></div></section>
  <section class="card"><h2>Contas</h2><table class="lanc"><thead><tr><th>Sigla</th><th>Pessoa</th><th>Nome</th><th>Caixa</th><th>Cartão</th><th></th></tr></thead><tbody id="cf-contas">
    ${cfg.contas.map((c, i) => `<tr data-i="${i}"><td><input data-f="id" value="${esc(c.id)}" size="6"></td><td><input data-f="sigla" value="${esc(c.sigla || '')}" size="4"></td>
      <td><input data-f="nome" value="${esc(c.nome || '')}"></td><td><select data-f="caixa">${opcoes([['B', 'B'], ['C', 'C']], c.caixa || 'B')}</select></td>
      <td><input type="checkbox" data-f="cartao" ${c.cartao ? 'checked' : ''}></td><td><button class="mini perigo" data-delc="${i}">✕</button></td></tr>`).join('')}
    </tbody></table><button id="cf-add-c" class="sec">+ conta</button></section>
  <section class="card"><h2>Saldo inicial de ${st.ano}</h2><div class="linha">
    <label>Caixa B <input id="cf-sib" value="${si.B ?? 0}" size="12"></label><label>Caixa C <input id="cf-sic" value="${si.C ?? 0}" size="12"></label>
    <label>Nome da casa <input id="cf-casa" value="${esc(cfg.casa || 'CCBV')}" size="14"></label></div>
    <button id="cf-salvar">Salvar configuração</button><p class="pequeno">Pessoas e logins ficam em <a href="#/membros">Membros</a>.</p></section>
  <section class="card"><h2>Cópia de segurança</h2><div class="linha"><button id="cf-backup" class="sec">Baixar cópia (JSON)</button>
    <label>Restaurar <input type="file" id="cf-restaurar" accept=".json"></label>${api.demo ? '<button id="cf-zerar" class="perigo">Apagar dados da demonstração</button>' : ''}</div></section>`;
  const lerTab = (sel, lst) => $$(`${sel} tr`).forEach((tr) => {
    const o = lst[Number(tr.dataset.i)];
    $$('[data-f]', tr).forEach((inp) => { o[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
  });
  $('#cf-salvar').onclick = () => tentar(async () => {
    lerTab('#cf-contas', cfg.contas);
    const n = (v) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
    (cfg.saldoInicial ||= {})[st.ano] = { B: n($('#cf-sib').value), C: n($('#cf-sic').value) };
    cfg.casa = $('#cf-casa').value.trim() || 'CCBV';
    await api.salvarConfig(cfg); toast('Configuração salva.');
  });
  $('#cf-add-c').onclick = () => tentar(async () => { lerTab('#cf-contas', cfg.contas); cfg.contas.push({ id: '', sigla: '', nome: '', caixa: 'B' }); await api.salvarConfig(cfg); rotear(); });
  main().onclick = (e) => {
    if (e.target.dataset.delc) tentar(async () => { cfg.contas.splice(Number(e.target.dataset.delc), 1); await api.salvarConfig(cfg); rotear(); });
  };
  $('#cf-sec').onchange = async (e) => {
    const etapa = (txt, erro = false) => { const el = $('#cf-sec-status'); if (el) { el.textContent = txt; el.className = erro ? 'erro' : 'pequeno'; } };
    try { await importarPlanilhaSecretaria(e.target.files[0], etapa); }
    catch (err) { console.error(err); etapa('Erro na importação: ' + (err.code ? err.code + ' — ' : '') + (err.message || err), true); }
  };
  $('#cf-backup').onclick = () => tentar(async () => {
    const blob = new Blob([JSON.stringify(await api.exportar())], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fincon-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  $('#cf-restaurar').onchange = (e) => tentar(async () => {
    if (!confirm('Restaurar a cópia? Os documentos com o mesmo identificador são substituídos.')) return;
    await api.importar(JSON.parse(await e.target.files[0].text())); location.reload();
  });
  $('#cf-zerar') && ($('#cf-zerar').onclick = () => confirm('Apagar todos os dados da demonstração?') && api.zerar());
};

// ------------------------------------------------------------------ membros da casa (cl)
const STATUS = [['', 'sem acesso'], ['residente', 'residente'], ['secretaria', 'cl']];
VIEWS.membros = async () => {
  const usuarios = (await api.auth.listarUsuarios()).filter((u) => u.lugar === st.lugar);
  const loginDe = (sigla) => usuarios.find((u) => u.sigla && u.sigla === sigla);
  const semPessoa = usuarios.filter((u) => !u.sigla || !cfg.pessoas.some((p) => p.sigla === u.sigla));
  main().innerHTML = `<section class="card"><h2>Membros — ${esc(nomeLugar(st.lugar))}</h2>
    <p class="pequeno">Moradores dividem o Caixa C (rateio PS/CO). "Até" = último mês (AAAA-MM) de quem saiu. Status: <strong>residente</strong> envia e
      classifica os próprios extratos; <strong>cl</strong> tem acesso total ao lugar; <strong>sem acesso</strong> = sem login (informe o e-mail para criar).</p>
    <div class="rolagem"><table class="lanc"><thead><tr><th>Sigla</th><th>Nome</th><th>Morador</th><th>Desde</th><th>Até</th><th>E-mail (login)</th><th>Status</th><th></th></tr></thead><tbody id="mb-lista">
    ${cfg.pessoas.map((p, i) => {
      const u = loginDe(p.sigla);
      return `<tr data-i="${i}" data-uid="${esc(u?.uid || '')}"><td><input data-f="sigla" value="${esc(p.sigla)}" size="4"></td><td><input data-f="nome" value="${esc(p.nome)}"></td>
        <td><input type="checkbox" data-f="morador" ${p.morador ? 'checked' : ''}></td><td><input data-f="desde" value="${esc(p.desde || '')}" size="7" placeholder="AAAA-MM"></td>
        <td><input data-f="ate" value="${esc(p.ate || '')}" size="7" placeholder="AAAA-MM"></td>
        <td>${u ? esc(u.email) : '<input data-f="email" placeholder="e-mail (opcional)" size="18">'}</td>
        <td><select data-f="status">${opcoes(u ? STATUS.slice(1) : STATUS, u ? u.perfil : '')}</select></td>
        <td class="acoes"><button class="mini" data-salvar="${i}">Salvar</button>${u ? ` <button class="mini sec" data-convite="${i}">Convite</button>` : ''} <button class="mini perigo" data-remover="${i}" title="Remover da lista de membros">✕</button></td></tr>`;
    }).join('')}
    ${semPessoa.map((u) => `<tr data-uid="${esc(u.uid)}" data-sopessoa="1"><td>${esc(u.sigla || '—')}</td><td colspan="4" class="pequeno">login sem cadastro de membro</td><td>${esc(u.email)}</td>
        <td><select data-f="status">${opcoes(STATUS.slice(1), u.perfil)}</select></td><td class="acoes"><button class="mini" data-salvaru="${esc(u.uid)}">Salvar</button> <button class="mini sec" data-convitel="${esc(u.uid)}">Convite</button></td></tr>`).join('')}
    </tbody></table></div><div id="us-convite"></div>
    <details ${cfg.pessoas.length ? '' : 'open'}><summary>Novo membro</summary><div class="linha">
      <input id="nm-sigla" placeholder="sigla" size="5"><input id="nm-nome" placeholder="nome"><label><input type="checkbox" id="nm-morador" checked> morador</label>
      <input id="nm-email" placeholder="e-mail (opcional)"><select id="nm-status">${opcoes(STATUS, 'residente')}</select><button id="nm-ok">Incluir</button></div>
      <p class="pequeno">Com e-mail, o login é criado e o Firebase envia o e-mail para a pessoa definir a senha; em seguida aparece a mensagem de convite.</p></details></section>`;
  const ler = (tr) => Object.fromEntries($$('[data-f]', tr).map((x) => [x.dataset.f, x.type === 'checkbox' ? x.checked : x.value.trim()]));
  $('#nm-ok').onclick = () => tentar(async () => {
    const sigla = $('#nm-sigla').value.trim().toUpperCase(), nome = $('#nm-nome').value.trim(), email = $('#nm-email').value.trim(), status = $('#nm-status').value;
    if (!sigla || !nome) throw new Error('Informe a sigla e o nome.');
    if (cfg.pessoas.some((p) => p.sigla === sigla)) throw new Error('Já existe um membro com essa sigla.');
    if (status && !email) throw new Error('Para dar acesso, informe o e-mail.');
    cfg.pessoas.push({ sigla, nome, morador: $('#nm-morador').checked });
    await api.salvarConfig(cfg);
    if (status) await api.auth.criarUsuario({ email, senha: '', sigla, perfil: status, lugar: st.lugar });
    toast('Membro incluído.'); await rotear();
    if (status) mostrarConvite({ email, sigla, perfil: status, comSenha: false, enviado: !api.demo });
  });
  main().onclick = (e) => {
    const tr = e.target.closest('tr');
    const d = e.target.dataset;
    if (d.salvar) tentar(async () => {
      const i = Number(d.salvar), p = cfg.pessoas[i], v = ler(tr), u = usuarios.find((x) => x.uid === tr.dataset.uid);
      const sigla = v.sigla.toUpperCase();
      if (!sigla) throw new Error('Informe a sigla.');
      if (cfg.pessoas.some((x, k) => k !== i && x.sigla === sigla)) throw new Error('Já existe um membro com essa sigla.');
      Object.assign(p, { sigla, nome: v.nome, morador: v.morador, desde: v.desde, ate: v.ate });
      await api.salvarConfig(cfg);
      if (u) {
        if (u.uid === sessao.uid && v.status !== 'secretaria' && !confirm('Você está tirando o seu próprio acesso total (cl). Continuar?')) return;
        await api.auth.salvarUsuario(u.uid, { sigla, perfil: v.status });
      } else if (v.status) {
        if (!v.email) throw new Error('Para dar acesso, informe o e-mail.');
        await api.auth.criarUsuario({ email: v.email, senha: '', sigla, perfil: v.status, lugar: st.lugar });
        toast('Login criado.'); await rotear();
        mostrarConvite({ email: v.email, sigla, perfil: v.status, comSenha: false, enviado: !api.demo });
        return;
      }
      toast('Membro atualizado.'); rotear();
    });
    if (d.salvaru) tentar(async () => {
      const v = ler(tr);
      if (d.salvaru === sessao.uid && v.status !== 'secretaria' && !confirm('Você está tirando o seu próprio acesso total (cl). Continuar?')) return;
      await api.auth.salvarUsuario(d.salvaru, { perfil: v.status }); toast('Login atualizado.'); rotear();
    });
    if (d.remover) tentar(async () => {
      const p = cfg.pessoas[Number(d.remover)];
      if (!confirm(`Remover ${p.sigla} — ${p.nome} da lista de membros? (os lançamentos e vales continuam; o login, se houver, não é apagado)`)) return;
      cfg.pessoas.splice(Number(d.remover), 1); await api.salvarConfig(cfg); rotear();
    });
    const conv = d.convite !== undefined ? usuarios.find((x) => x.uid === tr.dataset.uid) : d.convitel ? usuarios.find((x) => x.uid === d.convitel) : null;
    if (conv) tentar(async () => {
      const enviar = confirm(`Enviar também o e-mail do Firebase para ${conv.email} definir (ou redefinir) a senha?\n(OK = enviar; Cancelar = só mostrar a mensagem de convite)`);
      if (enviar) await api.auth.enviarDefinicaoSenha(conv.email);
      mostrarConvite({ email: conv.email, sigla: conv.sigla, perfil: conv.perfil, comSenha: false, enviado: enviar && !api.demo });
    });
  };
};

// ------------------------------------------------------------------ convite por e-mail
const URL_PUBLICA = 'https://lab-soft.github.io/FinCon/';
function textoConvite({ email, sigla, perfil, comSenha, lugar }) {
  const nome = (cfg.pessoas || []).find((p) => p.sigla === sigla)?.nome || '';
  const global = ['adm', 'cr'].includes(perfil);
  const onde = global ? 'todos os lugares' : nomeLugar(lugar || st.lugar);
  const primeiro = nome.split(' ')[0];
  const passos = perfil === 'adm'
    ? '3. Como administrador, em "Lugares" você cria os lugares e os primeiros logins de cada um; escolhendo um lugar no '
      + 'alto da tela, tem o acesso completo a ele.'
    : perfil === 'cr'
    ? '3. No alto da tela, escolha o lugar (ou "Todos" para o consolidado). Em "Relatórios" você vê e imprime os relatórios '
      + 'do mês (Caixa B e C frente e verso, folhas pessoais, livro caixa e vale eletrônico); em "Início", a conferência de '
      + 'cada mês. Seu acesso é só de consulta.'
    : perfil === 'secretaria'
    ? '3. Pelo menu você acessa os extratos de todos, gera os vales do mês, controla bancos e itens a justificar e '
      + 'imprime os relatórios (Caixa B e C, folhas pessoais, livro caixa e vale eletrônico).'
    : '3. Em "Meus extratos", escolha a sua conta e envie os extratos do mês: PDF ou planilha exportada do Itaú, CSV do '
      + 'Nubank, fatura do cartão Nubank ou a planilha no modelo consolidado. Depois confira a classificação de cada '
      + 'lançamento (Tipo1); os que aparecem com "???" precisam da sua indicação.\n'
      + '4. Em "Meus vales" você vê e imprime os seus vales do mês.';
  return {
    assunto: 'Seu acesso ao FinCon — controle financeiro da CCBV',
    corpo: `Olá${primeiro ? ', ' + primeiro : ''}!

Seu acesso ao FinCon, o aplicativo de controle financeiro da CCBV, foi criado.

E-mail de acesso: ${email}
${sigla ? `Sigla: ${sigla}\n` : ''}Perfil: ${rotuloPerfil(perfil)}
Lugar: ${onde}

Como começar:
1. ${comSenha
    ? 'Use a senha provisória que vou te passar pessoalmente. No primeiro acesso, o app pede para você criar a sua senha.'
    : 'Você vai receber (ou já recebeu) um e-mail de noreply@app-fincon.firebaseapp.com com um link para definir a sua '
      + 'senha. Se não encontrar, procure na caixa de spam ou lixo eletrônico.'}
2. Entre em ${URL_PUBLICA} com o seu e-mail e a senha.
${passos}

Privacidade: os arquivos de extrato são lidos no seu próprio computador; só os lançamentos vão para a base, e cada pessoa vê apenas os próprios dados.

Qualquer dúvida, é só responder este e-mail.

${sessao.sigla || ''}
${global ? 'Administração do FinCon' : `Secretaria — ${onde}`}`,
  };
}

function mostrarConvite(u) {
  const { assunto, corpo } = textoConvite(u);
  const el = $('#us-convite');
  const mailto = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`;
  el.innerHTML = `<div class="card convite"><h3>Convite para ${esc(u.email)}</h3>
    ${u.enviado ? '<p class="ok">O Firebase enviou o e-mail com o link para definir a senha.</p>' : ''}
    <p class="pequeno">Mensagem de boas-vindas (o sistema não envia e-mails próprios): abra no seu programa de e-mail ou copie.</p>
    <p><strong>Assunto:</strong> ${esc(assunto)}</p><textarea id="cv-texto" rows="16">${esc(corpo)}</textarea>
    <div class="linha"><a class="botao" href="${mailto}">Abrir no meu e-mail</a><button id="cv-copiar" class="sec">Copiar texto</button>
      <button id="cv-fechar" class="sec">Fechar</button></div></div>`;
  $('#cv-copiar').onclick = () => tentar(async () => { await navigator.clipboard.writeText(`${assunto}\n\n${$('#cv-texto').value}`); toast('Mensagem copiada.'); });
  $('#cv-fechar').onclick = () => { el.innerHTML = ''; };
  el.scrollIntoView({ behavior: 'smooth' });
}

async function importarPlanilhaSecretaria(f, etapa = () => {}) {
  etapa('Carregando o leitor de planilhas…');
  const XLSX = await xlsx();
  etapa(`Lendo ${f.name}…`);
  const r = importarSecretaria(XLSX, XLSX.read(await f.arrayBuffer(), { cellDates: true }));
  etapa(`Planilha lida: ${r.vales.length} vales. Aguardando confirmação…`);
  if (!confirm(`Importar ${f.name}: ano ${r.ano}, ${r.config.pessoas.length} pessoas, ${r.vales.length} vales, ${r.justificar.length} itens a justificar, ${r.bancos.length} movimentos de banco, ${r.meses.length} meses fechados?\nOs vales, bancos, itens a justificar e fechamentos de ${r.ano} no app serão substituídos.`)) return;
  const antigos = {};
  etapa(`Apagando os dados antigos de ${r.ano}…`);
  for (const col of ['vales', 'bancos', 'justificar', 'meses']) antigos[col] = (await api.listar(col, { ano: r.ano })).map((d) => d.id);
  for (const [col, ids] of Object.entries(antigos)) await api.apagarVarios(col, ids);
  // as pessoas/contas/códigos novos se juntam aos que já existem
  const pessoas = new Map(cfg.pessoas.map((p) => [p.sigla, p]));
  for (const p of r.config.pessoas) {
    const ja = pessoas.get(p.sigla);
    pessoas.set(p.sigla, ja ? { ...ja, morador: p.morador, ate: p.ate || ja.ate || '' } : p);
  }
  const contas = new Map(cfg.contas.map((c) => [c.id, c]));
  for (const c of r.config.contas) contas.set(c.id, { ...c, ...(contas.get(c.id) || {}) });
  cfg = { ...cfg, casa: r.config.casa, codigos: r.config.codigos, pessoas: [...pessoas.values()], contas: [...contas.values()],
    saldoInicial: { ...(cfg.saldoInicial || {}), ...r.config.saldoInicial }, orcamento: { ...(cfg.orcamento || {}), ...r.config.orcamento } };
  etapa('Gravando pessoas, contas e códigos…');
  await api.salvarConfig(cfg);
  etapa(`Gravando ${r.vales.length} vales…`);
  await api.salvarVarios('vales', r.vales);
  etapa(`Gravando ${r.bancos.length} movimentos de banco…`);
  await api.salvarVarios('bancos', r.bancos);
  etapa(`Gravando ${r.justificar.length} itens a justificar e ${r.meses.length} fechamentos…`);
  // itens de anos anteriores (ou sem data) contam desde o começo do ano importado
  await api.salvarVarios('justificar', r.justificar.map((j) => ({ ...j, ano: r.ano, mes: !j.ano || j.ano < r.ano || !j.mes ? 1 : j.mes })));
  await api.salvarVarios('meses', r.meses.map((m) => ({ ...m, id: `${st.lugar}_${m.ano}_${m.mes}` })));
  etapa('Importação concluída.');
  st.ano = r.ano; localStorage.setItem('fincon-ano', r.ano);
  st.cache = {};
  toast('Planilha importada.'); location.hash = '#/inicio'; rotear();
}

// ------------------------------------------------------------------ consolidado (todos os lugares)
async function consolidado() {
  const k = `consolidado|${st.ano}`;
  if (st.cache[k]) return st.cache[k];
  const res = { vales: [], bancos: [], just: [], snaps: {}, n: 0,
    cfg: { ...CFG_PADRAO(), casa: 'Todos os lugares', pessoas: [], contas: [], saldoInicial: { [st.ano]: { B: 0, C: 0 } }, orcamento: { [st.ano]: {} } } };
  const porMes = {};
  for (const l of st.lugares) {
    const [c, vales, bancos, just, meses] = await Promise.all([api.config(l.id),
      ...['vales', 'bancos', 'justificar', 'meses'].map((col) => api.listar(col, { ano: st.ano, lugar: l.id }))]);
    const cf = { ...CFG_PADRAO(), ...(c || {}) };
    res.n++;
    if (res.n === 1) res.cfg.codigos = cf.codigos;
    // contas com o lugar no nome (siglas iguais em lugares diferentes)
    const pre = (id) => `${l.id}:${id}`;
    res.cfg.contas.push(...cf.contas.map((x) => ({ ...x, id: pre(x.id) })));
    res.bancos.push(...bancos.map((b) => ({ ...b, conta: pre(b.conta) })));
    res.vales.push(...vales); res.just.push(...just);
    const si = cf.saldoInicial?.[st.ano] || {};
    res.cfg.saldoInicial[st.ano].B += si.B || 0; res.cfg.saldoInicial[st.ano].C += si.C || 0;
    for (const [kk, v] of Object.entries(cf.orcamento?.[st.ano] || {})) res.cfg.orcamento[st.ano][kk] = (res.cfg.orcamento[st.ano][kk] || 0) + v;
    // total a justificar por mês: o fechamento do lugar, ou o calculado se o mês está aberto
    const snaps = Object.fromEntries(meses.filter((m) => m.fechado).map((m) => [m.mes, m]));
    for (let m = 1; m <= 12; m++) {
      const j = snaps[m] || aJustificar(just, st.ano, m);
      const x = (porMes[m] ||= { B: 0, Cax: 0, C: 0 });
      x.B = r2(x.B + (j.B || 0)); x.Cax = r2(x.Cax + (j.Cax || 0)); x.C = r2(x.C + (j.C || 0));
    }
    (res.porLugar ||= []).push({ lugar: l, cfg: cf, vales, bancos, just, snaps });
  }
  res.snaps = porMes;
  return (st.cache[k] = res);
}

async function inicioConsolidado() {
  const c = await consolidado();
  const linha = (rotulo, d, conta) => {
    let h = `<tr><th>${esc(rotulo)}</th>`;
    for (let m = 1; m <= 12; m++) {
      if (!d.vales.some((v) => v.mes === m)) { h += '<td><span class="vazio">—</span></td>'; continue; }
      const x = conferir({ ano: st.ano, mes: m, vales: d.vales, bancos: d.bancos, justificar: d.just, contas: conta.contas,
        saldoInicial: conta.saldoInicial?.[st.ano] || {}, snapshots: d.snaps });
      h += `<td class="${Math.abs(x.diferenca) < 0.01 ? 'ok' : 'erro'}">${Math.abs(x.diferenca) < 0.01 ? '✓' : moeda(x.diferenca)}</td>`;
    }
    return h + '</tr>';
  };
  let html = `<section class="card"><h2>Conferência de ${st.ano} — todos os lugares</h2><div class="rolagem"><table class="grade">
    <thead><tr><th>Lugar</th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
  for (const p of c.porLugar || []) html += linha(p.lugar.nome || p.lugar.id, p, p.cfg);
  html += `${linha('Consolidado', c, c.cfg)}</tbody></table></div>
    <p class="pequeno">✓ = saldo final dos caixas B e C igual a caixa + bancos + a justificar. Os relatórios do consolidado somam todos os lugares.</p></section>`;
  main().innerHTML = html;
}

// ------------------------------------------------------------------ lugares (administrador)
const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

VIEWS.lugares = async () => {
  const legada = await api.configLegada();
  const migrado = st.lugares.some((l) => l.migradoDe === 'geral');
  const usuarios = await api.auth.listarUsuarios();
  const contagem = (id) => usuarios.filter((u) => u.lugar === id).length;
  main().innerHTML = `
  ${legada && !migrado ? `<section class="card"><h2>Migrar os dados da versão anterior</h2>
    <p>Os dados lançados antes (configuração, lançamentos, vales, bancos, justificar e fechamentos) ainda não têm lugar.
      Escolha o lugar para onde vão; os logins de cl e residentes sem lugar também passam a ele.</p>
    <div class="linha"><label>Nome do lugar <input id="mg-nome" value="${esc(legada.casa || 'CCBV')}"></label>
      <label>Identificador <input id="mg-id" value="${esc(slug(legada.casa || 'CCBV'))}" size="10"></label>
      <button id="mg-ok">Migrar</button></div><div id="mg-status" class="pequeno"></div></section>` : ''}
  <section class="card"><h2>Lugares</h2>
    <table class="lanc"><thead><tr><th>Lugar</th><th>Identificador</th><th>Logins</th><th></th></tr></thead><tbody>
    ${st.lugares.map((l) => `<tr><td>${esc(l.nome || l.id)}</td><td>${esc(l.id)}</td><td>${contagem(l.id)}</td>
      <td><button class="mini sec" data-usar="${esc(l.id)}">Usar</button></td></tr>`).join('') || '<tr><td colspan="4" class="pequeno">Nenhum lugar ainda.</td></tr>'}
    </tbody></table>
    <details ${st.lugares.length ? '' : 'open'}><summary>Novo lugar</summary>
      <div class="linha"><label>Nome <input id="lg-nome" placeholder="ex.: Centro Cultural X"></label>
        <label>Identificador <input id="lg-id" placeholder="ex.: ccx" size="10"></label></div>
      <p class="pequeno">Primeiro login de cl (acesso total no lugar) — opcional:</p>
      <div class="linha"><input id="lg-email" placeholder="e-mail do cl"><input id="lg-senha" placeholder="senha provisória (opcional)">
        <input id="lg-sigla" placeholder="sigla (opcional)" size="10"><button id="lg-criar-lugar">Criar lugar</button></div></details></section>
  <section class="card"><h2>Logins globais</h2><p class="pequeno">cr = só relatórios de todos os lugares; adm = administrador.</p>
    <table class="lanc"><thead><tr><th>E-mail</th><th>Perfil</th><th>Lugar</th><th></th></tr></thead><tbody>
    ${usuarios.map((u) => `<tr data-uid="${esc(u.uid)}"><td>${esc(u.email)}</td><td>${esc(rotuloPerfil(u.perfil))}</td><td>${esc(u.lugar ? nomeLugar(u.lugar) : 'todos')}</td>
      <td>${['cr', 'adm'].includes(u.perfil) ? `<button class="mini sec" data-conviteg="${esc(u.uid)}">Convite</button>` : ''}</td></tr>`).join('')}
    </tbody></table>
    <details><summary>Criar login global</summary><div class="linha"><input id="gl-email" placeholder="e-mail"><input id="gl-senha" placeholder="senha provisória (opcional)">
      <select id="gl-perfil">${opcoes(PERFIS_GLOBAIS, 'cr')}</select><button id="gl-ok">Criar</button></div></details>
    <div id="us-convite"></div></section>`;
  $('#lg-nome').oninput = (e) => { if (!$('#lg-id').dataset.mexeu) $('#lg-id').value = slug(e.target.value); };
  $('#lg-id').oninput = (e) => { e.target.dataset.mexeu = '1'; };
  $('#mg-ok') && ($('#mg-ok').onclick = () => tentar(() => migrarLegado($('#mg-id').value.trim(), $('#mg-nome').value.trim(), legada, usuarios)));
  $('#lg-criar-lugar').onclick = () => tentar(async () => {
    const nome = $('#lg-nome').value.trim(), id = slug($('#lg-id').value || nome);
    if (!nome || !id) throw new Error('Informe o nome do lugar.');
    if (st.lugares.some((l) => l.id === id)) throw new Error('Já existe um lugar com esse identificador.');
    await api.salvarLugar({ id, nome, criado: new Date().toISOString() });
    await api.salvarConfig({ ...CFG_PADRAO(), casa: nome }, id);
    st.lugares = await api.lugares();
    const email = $('#lg-email').value.trim(), senha = $('#lg-senha').value, sigla = $('#lg-sigla').value.trim().toUpperCase();
    if (email) await api.auth.criarUsuario({ email, senha, sigla, perfil: 'secretaria', lugar: id });
    toast('Lugar criado.');
    await trocarLugar(st.lugar || id);
    await rotear();
    if (email) mostrarConvite({ email, sigla, perfil: 'secretaria', lugar: id, comSenha: Boolean(senha), enviado: !senha && !api.demo });
  });
  $('#gl-ok').onclick = () => tentar(async () => {
    const email = $('#gl-email').value.trim(), senha = $('#gl-senha').value, perfil = $('#gl-perfil').value;
    if (!email) throw new Error('Informe o e-mail.');
    await api.auth.criarUsuario({ email, senha, sigla: '', perfil });
    toast('Login criado.'); await rotear();
    mostrarConvite({ email, sigla: '', perfil, comSenha: Boolean(senha), enviado: !senha && !api.demo });
  });
  main().onclick = (e) => {
    if (e.target.dataset.usar) tentar(async () => { await trocarLugar(e.target.dataset.usar); location.hash = '#/inicio'; rotear(); });
    const g = e.target.dataset.conviteg;
    if (g) tentar(async () => {
      const u = usuarios.find((x) => x.uid === g);
      const enviar = confirm(`Enviar também o e-mail do Firebase para ${u.email} definir (ou redefinir) a senha?`);
      if (enviar) await api.auth.enviarDefinicaoSenha(u.email);
      mostrarConvite({ email: u.email, sigla: '', perfil: u.perfil, comSenha: false, enviado: enviar && !api.demo });
    });
  };
};

async function migrarLegado(id, nome, legada, usuarios) {
  id = slug(id || nome);
  if (!id || !nome) throw new Error('Informe o nome e o identificador do lugar.');
  const etapa = (txt) => { const el = $('#mg-status'); if (el) el.textContent = txt; };
  if (!confirm(`Mover todos os dados atuais para o lugar "${nome}" (${id})?`)) return;
  etapa('Criando o lugar…');
  await api.salvarLugar({ id, nome, migradoDe: 'geral', criado: new Date().toISOString() });
  await api.salvarConfig({ ...legada, casa: legada.casa || nome }, id);
  for (const col of ['lancamentos', 'saldos', 'vales', 'justificar', 'bancos', 'meses']) {
    const sem = (await api.listarTudo(col)).filter((d) => !d.lugar);
    etapa(`Movendo ${sem.length} documentos de ${col}…`);
    if (sem.length) await api.salvarVarios(col, sem.map((d) => ({ ...d, lugar: id })));
  }
  const semLugar = usuarios.filter((u) => ['secretaria', 'residente'].includes(u.perfil) && !u.lugar);
  etapa(`Ligando ${semLugar.length} logins ao lugar…`);
  for (const u of semLugar) await api.auth.salvarUsuario(u.uid, { lugar: id });
  st.lugares = await api.lugares();
  await trocarLugar(id);
  toast('Migração concluída.'); location.hash = '#/inicio'; rotear();
}

// ------------------------------------------------------------------ conta
VIEWS.conta = async () => {
  main().innerHTML = `<section class="card"><h2>Conta</h2><p>${esc(sessao.email)}${sessao.sigla ? ' · ' + esc(sessao.sigla) : ''} · ${esc(rotuloPerfil(sessao.perfil))}</p>
    ${api.demo ? `<p class="pequeno">Demonstração: ver o app como <select id="ct-sim">${opcoes([['adm|', 'adm (administrador)'], ['cr|', 'cr (só relatórios)'], ['secretaria|', `cl de ${nomeLugar(st.lugar) || '…'}`], ...(cfg.pessoas || []).map((p) => [`residente|${p.sigla}`, `residente ${p.sigla}`])], `${sessao.perfil}|${sessao.sigla}`)}</select></p>` : `
    <div class="linha"><input type="password" id="ct-nova" placeholder="nova senha"><button id="ct-trocar">Trocar senha</button></div>`}
    <button id="ct-sair" class="sec">Sair</button></section>`;
  $('#ct-sair').onclick = () => api.auth.sair();
  $('#ct-trocar') && ($('#ct-trocar').onclick = () => tentar(async () => { await api.auth.trocarSenha($('#ct-nova').value); toast('Senha trocada.'); }));
  $('#ct-sim') && ($('#ct-sim').onchange = (e) => { const [p, s] = e.target.value.split('|'); api.auth.simular(p, s, st.lugar && st.lugar !== '*' ? st.lugar : null); });
};

// ------------------------------------------------------------------ login e início
function telaLogin(extra = '') {
  $('#nav').innerHTML = ''; $('#quem').textContent = '';
  main().innerHTML = `<section class="card login"><h2>Entrar</h2>${extra}
    <label>E-mail <input id="lg-email" type="email" autocomplete="username"></label>
    <label>Senha <input id="lg-senha" type="password" autocomplete="current-password"></label>
    <div class="linha"><button id="lg-ok">Entrar</button><button id="lg-esqueci" class="sec">Esqueci a senha</button></div>
    <details><summary>Primeiro acesso do administrador</summary><p class="pequeno">Crie a conta e, em seguida, confirme que você é o administrador (só o primeiro usuário pode).</p>
      <button id="lg-criar" class="sec">Criar conta com este e-mail e senha</button></details></section>`;
  $('#lg-ok').onclick = () => tentar(() => api.auth.entrar($('#lg-email').value.trim(), $('#lg-senha').value));
  $('#lg-esqueci').onclick = () => tentar(async () => { await api.auth.recuperar($('#lg-email').value.trim()); toast('Enviamos um e-mail para redefinir a senha.'); });
  $('#lg-criar').onclick = () => tentar(() => api.auth.criarConta($('#lg-email').value.trim(), $('#lg-senha').value));
}

api.auth.onChange(async (u) => {
  sessao = u;
  if (!u) { telaLogin(); return; }
  if (u.semPerfil) {
    telaLogin(u.podeSerPrimeiro
      ? `<p>Conta criada (${esc(u.email)}). <button id="lg-sou">Sou o administrador</button> <input id="lg-sigla" placeholder="sua sigla" size="5"></p>`
      : `<p>Sua conta (${esc(u.email)}) ainda não foi liberada: peça a quem administra o seu lugar.</p>`);
    $('#lg-sou') && ($('#lg-sou').onclick = () => tentar(async () => { await api.auth.souPrimeiro($('#lg-sigla').value.trim() || 'SEC'); location.reload(); }));
    return;
  }
  // versão anterior (um lugar só): quem fez o primeiro acesso vira administrador
  if (u.fundador && u.perfil !== 'adm') {
    $('#nav').innerHTML = '';
    main().innerHTML = `<section class="card login"><h2>Atualização: vários lugares</h2>
      <p>O FinCon agora atende vários lugares independentes. Como você fez o primeiro acesso, passa a ser o
      <strong>administrador</strong> (adm): cria os lugares e os primeiros logins de cada um. Em seguida, na tela Lugares,
      os dados atuais são movidos para um lugar (ex.: CCBV).</p><button id="up-adm">Tornar-me administrador</button></section>`;
    $('#up-adm').onclick = () => tentar(async () => { await api.auth.tornarAdm(); location.reload(); });
    return;
  }
  if (!GLOBAL() && !u.lugar) {
    $('#nav').innerHTML = '';
    main().innerHTML = `<section class="card login"><h2>Aguardando liberação</h2><p>Sua conta (${esc(u.email)}) ainda não está ligada a um
      lugar. Isso acontece durante a atualização para vários lugares: peça ao administrador para concluir a migração.</p>
      <button id="ag-sair" class="sec">Sair</button></section>`;
    $('#ag-sair').onclick = () => api.auth.sair();
    return;
  }
  st.lugares = await api.lugares();
  const salvo = localStorage.getItem('fincon-lugar');
  const inicial = !GLOBAL() ? u.lugar
    : (salvo && (salvo === '*' || st.lugares.some((l) => l.id === salvo)) ? salvo : st.lugares[0]?.id || (sessao.perfil === 'cr' ? '*' : null));
  await trocarLugar(inicial);
  if (u.mustChange && !api.demo) {
    main().innerHTML = `<section class="card login"><h2>Defina sua senha</h2><input type="password" id="ms-nova" placeholder="nova senha (mín. 6)"><button id="ms-ok">Salvar</button></section>`;
    $('#ms-ok').onclick = () => tentar(async () => { await api.auth.trocarSenha($('#ms-nova').value); location.reload(); });
    return;
  }
  rotear();
});
window.addEventListener('hashchange', () => sessao && !sessao.semPerfil && rotear());
$('#seletor-ano').onchange = (e) => { st.ano = Number(e.target.value); localStorage.setItem('fincon-ano', st.ano); st.cache = {}; rotear(); };
$('#seletor-lugar').onchange = (e) => tentar(async () => { await trocarLugar(e.target.value); rotear(); });
