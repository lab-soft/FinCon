// FinCon — telas. Dados via api (Firebase ou demo, mesma interface); lógica em logic.js, parsers.js, reports.js.
import { firebaseConfig, configured } from './firebase-config.js';
import {
  MESES, MESES_LONGOS, INDEFINIDO, RATEIO, CODIGOS_PADRAO, CODIGOS_EXTRA, moeda, r2, aprender, classificar,
  novosLancamentos, gerarMes, conferir, aJustificar, saldoConta, movimentoConta,
} from './logic.js';
import * as P from './parsers.js';
import { RELATORIOS } from './reports.js';
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
const st = { ano: Number(localStorage.getItem('fincon-ano')) || new Date().getFullYear(), mes: new Date().getMonth() + 1, cache: {} };
const SEC = () => sessao?.perfil === 'secretaria';
const CFG_PADRAO = () => ({ casa: 'CCBV', pessoas: [], contas: [], codigos: CODIGOS_PADRAO, saldoInicial: {}, orcamento: {}, regras: [] });

async function dados(col, recarregar = false) {
  const k = `${col}|${st.ano}`;
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
    ['justificar', 'Justificar'], ['relatorios', 'Relatórios'], ['config', 'Configuração'], ['conta', 'Conta']],
  residente: [['inicio', 'Início'], ['extratos', 'Meus extratos'], ['meusvales', 'Meus vales'], ['conta', 'Conta']],
};
function montarNav() {
  const itens = NAV[sessao.perfil] || NAV.residente;
  $('#nav').innerHTML = itens.map(([id, t]) => `<a href="#/${id}" data-v="${id}">${t}</a>`).join('');
  $('#quem').textContent = `${sessao.sigla || ''} · ${sessao.perfil}${api.demo ? ' · DEMO' : ''}`;
  $('#seletor-ano').innerHTML = opcoes([2024, 2025, 2026, 2027, 2028].map((a) => [a, a]), st.ano);
}
async function rotear() {
  const v = (location.hash.replace('#/', '') || 'inicio').split('?')[0];
  const permitidas = (NAV[sessao.perfil] || NAV.residente).map((x) => x[0]);
  const view = permitidas.includes(v) ? v : 'inicio';
  $$('#nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.v === view));
  main().innerHTML = '<p class="carregando">Carregando…</p>';
  main().onclick = null;
  await tentar(() => VIEWS[view]());
}

// ------------------------------------------------------------------ início
const VIEWS = {};
VIEWS.inicio = async () => {
  const lanc = await dados('lancamentos');
  const pessoas = pessoasVisiveis();
  let html = `<section class="card"><h2>Situação de ${st.ano}</h2>
    <p class="pequeno">Lançamentos de extrato por mês (em vermelho, quantos ainda estão sem classificação "???").</p>
    <div class="rolagem"><table class="grade"><thead><tr><th>Pessoa</th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
  for (const p of pessoas) {
    html += `<tr><th>${esc(p.sigla)}</th>`;
    for (let m = 1; m <= 12; m++) {
      const ls = lanc.filter((l) => l.sigla === p.sigla && l.mes === m);
      const pend = ls.filter((l) => !l.tipo || l.tipo === INDEFINIDO).length;
      html += `<td>${ls.length ? ls.length : '<span class="vazio">—</span>'}${pend ? ` <span class="pend">${pend}</span>` : ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div></section>';
  if (SEC()) {
    const [vales, bancos, just, meses] = await Promise.all([dados('vales'), dados('bancos'), dados('justificar'), dados('meses')]);
    const snaps = Object.fromEntries(meses.filter((m) => m.fechado).map((m) => [m.mes, m]));
    html += `<section class="card"><h2>Conferência (diferença da aba 2, célula N1)</h2><div class="rolagem"><table class="grade"><thead><tr><th></th>${MESES.map((m) => `<th>${m}</th>`).join('')}</tr></thead><tbody><tr><th>Diferença</th>`;
    for (let m = 1; m <= 12; m++) {
      if (!vales.some((v) => v.mes === m)) { html += '<td><span class="vazio">—</span></td>'; continue; }
      const c = conferir({ ano: st.ano, mes: m, vales, bancos, justificar: just, contas: cfg.contas, saldoInicial: cfg.saldoInicial?.[st.ano] || {}, snapshots: snaps });
      html += `<td class="${Math.abs(c.diferenca) < 0.01 ? 'ok' : 'erro'}">${Math.abs(c.diferenca) < 0.01 ? '✓' : moeda(c.diferenca)}</td>`;
    }
    html += `</tr><tr><th>Fechado</th>${MESES.map((_, i) => `<td>${snaps[i + 1] ? '🔒' : ''}</td>`).join('')}</tr></tbody></table></div>
      <p class="pequeno">✓ = saldo final dos caixas B e C igual a caixa + bancos + a justificar (como as abas 9 e 11).</p></section>`;
  }
  main().innerHTML = html;
};

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
  const [vales] = await Promise.all([dados('vales')]);
  const mes = st.mes;
  const doMes = vales.filter((v) => v.mes === mes).sort((a, b) => a.sigla.localeCompare(b.sigla) || a.caixa.localeCompare(b.caixa) || (a.es === b.es ? 0 : a.es === 'E' ? -1 : 1));
  main().innerHTML = `
  <section class="card"><h2>Vales — ${MESES_LONGOS[mes - 1]} de ${st.ano}</h2>
    <div class="linha"><label>Mês ${seletorMes('va-mes', mes)}</label>
      <button id="va-gerar">Gerar vales do mês a partir dos extratos</button>
      <button id="va-exportar" class="sec">Exportar planilha (VALES, JUSTIFICAR, BANCOS)</button></div>
    <div id="va-previa"></div></section>
  <section class="card"><h2>Lançados em ${MESES_LONGOS[mes - 1]}</h2>${tabelaVales(doMes)}
    <details><summary>Incluir vale manual</summary><div class="linha">
      <select id="vm-pessoa">${opcoes(cfg.pessoas.map((p) => [p.sigla, p.sigla]))}</select>
      <select id="vm-caixa">${opcoes([['B', 'B'], ['C', 'C']])}</select><select id="vm-es">${opcoes([['S', 'S'], ['E', 'E']])}</select>
      <input id="vm-valor" placeholder="Valor" size="8"><select id="vm-tipo">${opcoes(Object.values(tabela()).flatMap(Object.keys).map((c) => [c, c]))}</select>
      <input id="vm-disc" placeholder="Discriminação"><button id="vm-ok">Incluir</button></div></details></section>`;
  $('#va-mes').onchange = (e) => { st.mes = Number(e.target.value); rotear(); };
  $('#va-gerar').onclick = () => tentar(previaVales);
  $('#va-exportar').onclick = () => tentar(exportarPlanilha);
  $('#vm-ok').onclick = () => tentar(async () => {
    const valor = Number(String($('#vm-valor').value).replace('.', '').replace(',', '.'));
    if (!valor) throw new Error('Valor inválido.');
    await api.salvar('vales', { ano: st.ano, mes, dia: 1, sigla: $('#vm-pessoa').value, caixa: $('#vm-caixa').value, es: $('#vm-es').value,
      valor: r2(valor), tipo: $('#vm-tipo').value, disc: $('#vm-disc').value, origem: 'manual' });
    invalidar('vales'); rotear();
  });
  main().onclick = (e) => {
    const id = e.target.dataset.delvale;
    if (id && confirm('Apagar este vale?')) tentar(async () => { await api.apagarVarios('vales', [id]); invalidar('vales'); rotear(); });
  };
};

function tabelaVales(lst) {
  if (!lst.length) return '<p class="pequeno">Nenhum vale neste mês.</p>';
  let h = '<div class="rolagem"><table class="lanc"><thead><tr><th>Pessoa</th><th>Caixa</th><th>E/S</th><th>Valor</th><th>Tipo1</th><th>Discriminação</th><th>Origem</th><th></th></tr></thead><tbody>';
  for (const v of lst) h += `<tr><td>${esc(v.sigla)}</td><td>${v.caixa}</td><td>${v.es}</td><td class="num">${moeda(v.valor)}</td><td>${esc(v.tipo)}</td><td>${esc(v.disc)}</td><td class="pequeno">${esc(v.origem || '')}</td><td>${v.id ? `<button class="mini perigo" data-delvale="${esc(v.id)}">✕</button>` : ''}</td></tr>`;
  const e = lst.filter((v) => v.es === 'E').reduce((s, v) => s + v.valor, 0), s = lst.filter((v) => v.es === 'S').reduce((s2, v) => s2 + v.valor, 0);
  return h + `</tbody></table></div><p class="pequeno">Entradas ${moeda(e)} · saídas ${moeda(s)}</p>`;
}

async function contexto() {
  const [lanc, vales, bancos, just, saldos, meses] = await Promise.all(['lancamentos', 'vales', 'bancos', 'justificar', 'saldos', 'meses'].map((c) => dados(c)));
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
    await api.salvar('bancos', { ano: st.ano, mes: st.mes, conta: $('#bm-conta').value, rotulo: $('#bm-rot').value, entrada: n($('#bm-e').value), saida: n($('#bm-s').value), origem: 'manual' });
    invalidar('bancos'); rotear();
  });
  main().onclick = (e) => { const id = e.target.dataset.delb; if (id && confirm('Apagar este movimento?')) tentar(async () => { await api.apagarVarios('bancos', [id]); invalidar('bancos'); rotear(); }); };
};

// ------------------------------------------------------------------ justificar
VIEWS.justificar = async () => {
  const c = await contexto();
  const j = aJustificar(c.just, st.ano, 12);
  const lst = [...c.just].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  let h = `<section class="card"><h2>A justificar</h2>
    <p>Total Caixa B: <strong>${moeda(j.B)}</strong> · Caixa C com a administração (AX): <strong>${moeda(j.Cax)}</strong> · Caixa C a justificar: <strong>${moeda(j.C)}</strong></p>
    <p class="pequeno">Valor positivo = saída a justificar; negativo = entrada (reduz o que falta justificar).</p>
    <div class="rolagem"><table class="lanc"><thead><tr><th>Caixa</th><th>Valor</th><th>Discriminação</th><th>Nome</th><th>Mês</th><th></th></tr></thead><tbody>
    ${lst.map((x) => `<tr><td>${x.caixa}</td><td class="num">${moeda(x.valor)}</td><td>${esc(x.disc)}</td><td>${esc(x.sigla)}</td><td>${x.mes ? MESES[x.mes - 1] + '/' + (x.ano || '') : ''}</td><td><button class="mini perigo" data-delj="${esc(x.id)}">✕</button></td></tr>`).join('')}
    </tbody></table></div>
    <details><summary>Incluir item</summary><div class="linha"><select id="jm-caixa">${opcoes([['B', 'B'], ['C', 'C']])}</select>
      <input id="jm-valor" placeholder="Valor (+ saída / − entrada)" size="12"><input id="jm-disc" placeholder="Discriminação">
      <select id="jm-pessoa">${opcoes([...cfg.pessoas.map((p) => [p.sigla, p.sigla]), ['AX', 'AX (administração)']])}</select>${seletorMes('jm-mes', st.mes)}<button id="jm-ok">Incluir</button></div></details></section>
    <section class="card"><h2>Fechamento dos meses</h2><p class="pequeno">Fechar o mês guarda o total a justificar daquele mês (como trocar a fórmula pelo valor na aba 3).</p><div class="linha">`;
  for (let m = 1; m <= 12; m++) {
    const f = c.snaps[m];
    h += `<button class="${f ? 'sec' : ''}" data-fechar="${m}" title="${f ? `B ${moeda(f.B)} · C ${moeda(f.C)}` : 'aberto'}">${MESES[m - 1]} ${f ? '🔒' : ''}</button>`;
  }
  main().innerHTML = h + '</div></section>';
  $('#jm-ok').onclick = () => tentar(async () => {
    const valor = Number(String($('#jm-valor').value).replace(/\./g, '').replace(',', '.'));
    if (!valor) throw new Error('Valor inválido.');
    const mes = Number($('#jm-mes').value);
    await api.salvar('justificar', { ano: st.ano, mes, caixa: $('#jm-caixa').value, valor: r2(valor), disc: $('#jm-disc').value, sigla: $('#jm-pessoa').value,
      data: `${st.ano}-${String(mes).padStart(2, '0')}-01`, origem: 'manual' });
    invalidar('justificar'); rotear();
  });
  main().onclick = (e) => {
    const id = e.target.dataset.delj;
    if (id && confirm('Apagar este item?')) tentar(async () => { await api.apagarVarios('justificar', [id]); invalidar('justificar'); rotear(); });
    const m = Number(e.target.dataset.fechar);
    if (m) tentar(async () => {
      const f = c.snaps[m];
      if (f) { if (confirm(`Reabrir ${MESES_LONGOS[m - 1]}? O total passa a ser recalculado.`)) await api.salvar('meses', { ...f, fechado: false }); }
      else { const t = aJustificar(c.just, st.ano, m); await api.salvar('meses', { id: `${st.ano}_${m}`, ano: st.ano, mes: m, fechado: true, ...t }); }
      invalidar('meses'); rotear();
    });
  };
};

// ------------------------------------------------------------------ relatórios
VIEWS.relatorios = async () => {
  const c = await contexto();
  const rel = RELATORIOS.find((r) => r.id === (st.rel || '8')) || RELATORIOS[0];
  st.rel = rel.id;
  const pessoaSel = st.relPessoa || cfg.pessoas[0]?.sigla || '';
  main().innerHTML = `<section class="card nao-imprime"><h2>Relatórios</h2><div class="linha">
    <label>Relatório <select id="re-rel">${opcoes(RELATORIOS.map((r) => [r.id, `${r.id} — ${r.nome}`]), rel.id)}</select></label>
    <label>Mês ${seletorMes('re-mes', st.mes)}</label>
    ${rel.caixa ? `<label>Caixa <select id="re-caixa">${opcoes([['B', 'B'], ['C', 'C']], st.relCaixa || 'B')}</select></label>` : ''}
    ${rel.pessoa ? `<label>Pessoa <select id="re-pessoa">${rel.pessoa === 'opcional' ? '<option value="">todas</option>' : ''}${opcoes(cfg.pessoas.map((p) => [p.sigla, p.sigla]), rel.pessoa === 'opcional' ? (st.relPessoa || '') : pessoaSel)}</select></label>` : ''}
    <button onclick="window.print()">Imprimir</button></div></section>
    <section class="card relatorio" id="re-saida"></section>`;
  const desenhar = () => {
    $('#re-saida').innerHTML = rel.fn({ cfg, vales: c.vales, bancos: c.bancos, justificar: c.just, ano: st.ano, mes: st.mes,
      caixa: st.relCaixa || 'B', sigla: rel.pessoa === 'opcional' ? (st.relPessoa || '') : pessoaSel, snapshots: c.snaps });
  };
  $('#re-rel').onchange = (e) => { st.rel = e.target.value; rotear(); };
  $('#re-mes').onchange = (e) => { st.mes = Number(e.target.value); desenhar(); };
  $('#re-caixa') && ($('#re-caixa').onchange = (e) => { st.relCaixa = e.target.value; desenhar(); });
  $('#re-pessoa') && ($('#re-pessoa').onchange = (e) => { st.relPessoa = e.target.value; rotear(); });
  desenhar();
};

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
  const usuarios = await api.auth.listarUsuarios();
  main().innerHTML = `
  <section class="card"><h2>Planilha da secretaria</h2>
    <p class="pequeno">Importa de uma "Secretaria Evolution.ANO.xlsx" as pessoas, os códigos (aba 1), o saldo inicial, os VALES já lançados (aba 2),
      JUSTIFICAR e fechamentos (aba 3), BANCOS (aba 4) e o orçamento (aba 6). Os dados desse ano no app são substituídos.</p>
    <input type="file" id="cf-sec" accept=".xlsx"><div id="cf-sec-status" class="pequeno"></div></section>
  <section class="card"><h2>Pessoas</h2><p class="pequeno">Moradores dividem o Caixa C (rateio PS/CO). "Até" = último mês (AAAA-MM) de quem saiu.</p>
    <table class="lanc"><thead><tr><th>Sigla</th><th>Nome</th><th>Morador</th><th>Desde</th><th>Até</th><th></th></tr></thead><tbody id="cf-pessoas">
    ${cfg.pessoas.map((p, i) => `<tr data-i="${i}"><td><input data-f="sigla" value="${esc(p.sigla)}" size="4"></td><td><input data-f="nome" value="${esc(p.nome)}"></td>
      <td><input type="checkbox" data-f="morador" ${p.morador ? 'checked' : ''}></td><td><input data-f="desde" value="${esc(p.desde || '')}" size="7" placeholder="AAAA-MM"></td>
      <td><input data-f="ate" value="${esc(p.ate || '')}" size="7" placeholder="AAAA-MM"></td><td><button class="mini perigo" data-delp="${i}">✕</button></td></tr>`).join('')}
    </tbody></table><button id="cf-add-p" class="sec">+ pessoa</button></section>
  <section class="card"><h2>Contas</h2><table class="lanc"><thead><tr><th>Sigla</th><th>Pessoa</th><th>Nome</th><th>Caixa</th><th>Cartão</th><th></th></tr></thead><tbody id="cf-contas">
    ${cfg.contas.map((c, i) => `<tr data-i="${i}"><td><input data-f="id" value="${esc(c.id)}" size="6"></td><td><input data-f="sigla" value="${esc(c.sigla || '')}" size="4"></td>
      <td><input data-f="nome" value="${esc(c.nome || '')}"></td><td><select data-f="caixa">${opcoes([['B', 'B'], ['C', 'C']], c.caixa || 'B')}</select></td>
      <td><input type="checkbox" data-f="cartao" ${c.cartao ? 'checked' : ''}></td><td><button class="mini perigo" data-delc="${i}">✕</button></td></tr>`).join('')}
    </tbody></table><button id="cf-add-c" class="sec">+ conta</button></section>
  <section class="card"><h2>Saldo inicial de ${st.ano}</h2><div class="linha">
    <label>Caixa B <input id="cf-sib" value="${si.B ?? 0}" size="12"></label><label>Caixa C <input id="cf-sic" value="${si.C ?? 0}" size="12"></label>
    <label>Nome da casa <input id="cf-casa" value="${esc(cfg.casa || 'CCBV')}" size="8"></label></div>
    <button id="cf-salvar">Salvar configuração</button></section>
  <section class="card"><h2>Usuários</h2><datalist id="siglas">${cfg.pessoas.map((p) => `<option value="${esc(p.sigla)}">${esc(p.nome)}</option>`).join('')}</datalist>
    <table class="lanc"><thead><tr><th>E-mail</th><th>Sigla</th><th>Perfil</th><th></th></tr></thead><tbody id="us-lista">
    ${usuarios.map((u) => `<tr data-uid="${esc(u.uid)}"><td>${esc(u.email)}</td><td><input data-u="sigla" value="${esc(u.sigla || '')}" size="5" list="siglas"></td>
      <td><select data-u="perfil">${opcoes([['residente', 'residente'], ['secretaria', 'secretaria']], u.perfil)}</select></td>
      <td><button class="mini" data-salvaru="${esc(u.uid)}">Salvar</button></td></tr>`).join('')}</tbody></table>
    <details><summary>Criar login</summary><div class="linha"><input id="us-email" placeholder="e-mail"><input id="us-senha" placeholder="senha provisória">
      <input id="us-sigla" placeholder="sigla (ex.: RV)" size="8" list="siglas"><select id="us-perfil">${opcoes([['residente', 'residente'], ['secretaria', 'secretaria']])}</select>
      <button id="us-ok">Criar</button></div><p class="pequeno">A pessoa troca a senha no primeiro acesso.</p></details></section>
  <section class="card"><h2>Cópia de segurança</h2><div class="linha"><button id="cf-backup" class="sec">Baixar cópia (JSON)</button>
    <label>Restaurar <input type="file" id="cf-restaurar" accept=".json"></label>${api.demo ? '<button id="cf-zerar" class="perigo">Apagar dados da demonstração</button>' : ''}</div></section>`;
  const lerTab = (sel, lst) => $$(`${sel} tr`).forEach((tr) => {
    const o = lst[Number(tr.dataset.i)];
    $$('[data-f]', tr).forEach((inp) => { o[inp.dataset.f] = inp.type === 'checkbox' ? inp.checked : inp.value.trim(); });
  });
  const salvar = async () => {
    lerTab('#cf-pessoas', cfg.pessoas); lerTab('#cf-contas', cfg.contas);
    const n = (v) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0;
    (cfg.saldoInicial ||= {})[st.ano] = { B: n($('#cf-sib').value), C: n($('#cf-sic').value) };
    cfg.casa = $('#cf-casa').value.trim() || 'CCBV';
    await api.salvarConfig(cfg); toast('Configuração salva.');
  };
  $('#cf-salvar').onclick = () => tentar(salvar);
  $('#cf-add-p').onclick = () => tentar(async () => { lerTab('#cf-pessoas', cfg.pessoas); cfg.pessoas.push({ sigla: '', nome: '', morador: true }); await api.salvarConfig(cfg); rotear(); });
  $('#cf-add-c').onclick = () => tentar(async () => { lerTab('#cf-contas', cfg.contas); cfg.contas.push({ id: '', sigla: '', nome: '', caixa: 'B' }); await api.salvarConfig(cfg); rotear(); });
  main().onclick = (e) => {
    if (e.target.dataset.delp) tentar(async () => { cfg.pessoas.splice(Number(e.target.dataset.delp), 1); await api.salvarConfig(cfg); rotear(); });
    if (e.target.dataset.delc) tentar(async () => { cfg.contas.splice(Number(e.target.dataset.delc), 1); await api.salvarConfig(cfg); rotear(); });
    const uid = e.target.dataset.salvaru;
    if (uid) tentar(async () => {
      const tr = e.target.closest('tr');
      const sigla = $('[data-u=sigla]', tr).value.trim().toUpperCase();
      if (!sigla) throw new Error('Informe a sigla.');
      await api.auth.salvarUsuario(uid, { sigla, perfil: $('[data-u=perfil]', tr).value });
      toast('Usuário atualizado.');
    });
  };
  $('#us-ok').onclick = () => tentar(async () => {
    const sigla = $('#us-sigla').value.trim().toUpperCase();
    if (!sigla) throw new Error('Informe a sigla da pessoa.');
    await api.auth.criarUsuario({ email: $('#us-email').value.trim(), senha: $('#us-senha').value, sigla, perfil: $('#us-perfil').value });
    toast('Login criado.'); rotear();
  });
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
  await api.salvarVarios('justificar', r.justificar.map((j) => ({ ...j, ano: j.ano || r.ano })));
  await api.salvarVarios('meses', r.meses);
  etapa('Importação concluída.');
  st.ano = r.ano; localStorage.setItem('fincon-ano', r.ano);
  st.cache = {};
  toast('Planilha importada.'); location.hash = '#/inicio'; rotear();
}

// ------------------------------------------------------------------ conta
VIEWS.conta = async () => {
  main().innerHTML = `<section class="card"><h2>Conta</h2><p>${esc(sessao.email)} · ${esc(sessao.sigla)} · ${esc(sessao.perfil)}</p>
    ${api.demo ? `<p class="pequeno">Demonstração: ver o app como <select id="ct-sim">${opcoes([['secretaria|SEC', 'secretaria'], ...cfg.pessoas.map((p) => [`residente|${p.sigla}`, `residente ${p.sigla}`])], `${sessao.perfil}|${sessao.sigla}`)}</select></p>` : `
    <div class="linha"><input type="password" id="ct-nova" placeholder="nova senha"><button id="ct-trocar">Trocar senha</button></div>`}
    <button id="ct-sair" class="sec">Sair</button></section>`;
  $('#ct-sair').onclick = () => api.auth.sair();
  $('#ct-trocar') && ($('#ct-trocar').onclick = () => tentar(async () => { await api.auth.trocarSenha($('#ct-nova').value); toast('Senha trocada.'); }));
  $('#ct-sim') && ($('#ct-sim').onchange = (e) => { const [p, s] = e.target.value.split('|'); api.auth.simular(p, s); });
};

// ------------------------------------------------------------------ login e início
function telaLogin(extra = '') {
  $('#nav').innerHTML = ''; $('#quem').textContent = '';
  main().innerHTML = `<section class="card login"><h2>Entrar</h2>${extra}
    <label>E-mail <input id="lg-email" type="email" autocomplete="username"></label>
    <label>Senha <input id="lg-senha" type="password" autocomplete="current-password"></label>
    <div class="linha"><button id="lg-ok">Entrar</button><button id="lg-esqueci" class="sec">Esqueci a senha</button></div>
    <details><summary>Primeiro acesso da secretaria</summary><p class="pequeno">Crie a conta e, em seguida, confirme que você é a secretaria (só o primeiro usuário pode).</p>
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
      ? `<p>Conta criada (${esc(u.email)}). <button id="lg-sou">Sou a secretaria</button> <input id="lg-sigla" placeholder="sua sigla" size="5"></p>`
      : `<p>Sua conta (${esc(u.email)}) ainda não foi liberada: peça à secretaria.</p>`);
    $('#lg-sou') && ($('#lg-sou').onclick = () => tentar(async () => { await api.auth.souPrimeiro($('#lg-sigla').value.trim() || 'SEC'); location.reload(); }));
    return;
  }
  cfg = { ...CFG_PADRAO(), ...((await api.config()) || {}) };
  st.cache = {};
  montarNav();
  if (u.mustChange && !api.demo) {
    main().innerHTML = `<section class="card login"><h2>Defina sua senha</h2><input type="password" id="ms-nova" placeholder="nova senha (mín. 6)"><button id="ms-ok">Salvar</button></section>`;
    $('#ms-ok').onclick = () => tentar(async () => { await api.auth.trocarSenha($('#ms-nova').value); location.reload(); });
    return;
  }
  rotear();
});
window.addEventListener('hashchange', () => sessao && !sessao.semPerfil && rotear());
$('#seletor-ano').onchange = (e) => { st.ano = Number(e.target.value); localStorage.setItem('fincon-ano', st.ano); st.cache = {}; rotear(); };
