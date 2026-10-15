// Relatórios das abas 8–14 da planilha da secretaria, em HTML (imprimíveis).
//  8/9  Caixa B frente/verso   10/11 Caixa C frente/verso   12 Folhas pessoais   13 Livro caixa   14 Vale eletrônico
import { MESES_LONGOS, CODIGOS_PADRAO, moeda, r2, conferir } from './logic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const td = (v, cls = 'num') => `<td class="${cls}">${v === null || v === undefined ? '' : esc(v)}</td>`;
const soma = (lst) => r2(lst.reduce((s, v) => s + v.valor, 0));

function cabecalho(titulo, cfg, ano, mes, extra = '') {
  return `<header class="rel-cab"><div><strong>${esc(cfg.casa || 'CCBV')}</strong> · ${esc(titulo)}</div>
    <div>${MESES_LONGOS[mes - 1]} de ${ano}${extra ? ' · ' + esc(extra) : ''}</div></header>`;
}

/** Abas 8 e 10: receitas e despesas por conceito, havido no mês e acumulado, x orçado. */
export function caixaFrente({ cfg, vales, ano, mes, caixa }) {
  const tabela = cfg.codigos || CODIGOS_PADRAO;
  const orc = cfg.orcamento?.[ano] || {};
  const vs = vales.filter((v) => v.ano === ano && v.caixa === caixa);
  let html = cabecalho(caixa === 'B' ? 'CAIXA B — FRENTE' : 'CAIXA C — FRENTE', cfg, ano, mes);
  for (const es of ['E', 'S']) {
    const titulo = es === 'E' ? 'Receitas' : 'Despesas';
    html += `<table class="rel"><thead><tr><th>${titulo}</th><th>Havido</th><th>Orçado</th><th>Havido acumulado</th><th>Orçado acumulado</th></tr></thead><tbody>`;
    let t = [0, 0, 0, 0];
    for (const [cod, nome] of Object.entries(tabela[`${caixa}|${es}`] || {})) {
      const h = soma(vs.filter((v) => v.mes === mes && v.es === es && v.tipo === cod));
      const ha = soma(vs.filter((v) => v.mes <= mes && v.es === es && v.tipo === cod));
      const o = orc[`${caixa}|${es}|${cod}`] || 0;
      t = [t[0] + h, t[1] + o, t[2] + ha, t[3] + o * mes];
      html += `<tr>${td(`${nome} (${cod})`, 'txt')}${td(moeda(h))}${td(moeda(o))}${td(moeda(ha))}${td(moeda(o * mes))}</tr>`;
    }
    html += `<tr class="tot">${td('Total', 'txt')}${t.map((x) => td(moeda(r2(x)))).join('')}</tr></tbody></table>`;
  }
  return html;
}

/** Abas 9 e 11: balancete e comprovante do saldo final. */
export function caixaVerso({ cfg, vales, bancos, justificar, ano, mes, caixa, snapshots }) {
  const c = conferir({ ano, mes, vales, bancos, justificar, contas: cfg.contas || [], saldoInicial: cfg.saldoInicial?.[ano] || {},
    dinheiro: cfg.dinheiro?.[ano]?.[mes] || {}, snapshots })[caixa];
  const linhas = [
    ['Receitas', c.receitas], ['Despesas', c.despesas], ['Saldo anterior', c.anterior], ['Saldo final', c.final, 'tot'],
    null,
    ['Caixa (dinheiro)', c.dinheiro], ['Bancos', c.bancos],
    ...(caixa === 'C' ? [['Com a administração', c.comAdministracao]] : []),
    ['A justificar', caixa === 'C' ? r2(c.justificar - (c.comAdministracao || 0)) : c.justificar], ['Total', c.total, 'tot'],
  ];
  let html = cabecalho(caixa === 'B' ? 'CAIXA B — VERSO' : 'CAIXA C — VERSO', cfg, ano, mes);
  html += '<table class="rel estreita"><tbody>';
  for (const l of linhas) html += l ? `<tr class="${l[2] || ''}">${td(l[0], 'txt')}${td(moeda(l[1]))}</tr>` : '<tr class="sep"><td colspan="2"></td></tr>';
  html += '</tbody></table>';
  html += Math.abs(c.diferenca) < 0.01
    ? '<p class="ok">Saldo final confere com caixa + bancos + a justificar.</p>'
    : `<p class="erro">DIFERENÇA de ${moeda(c.diferenca)} entre o saldo final e caixa + bancos + a justificar.</p>`;
  return html;
}

/** Aba 12: folhas de gastos pessoais (por pessoa, no mês). */
export function folhasPessoais({ cfg, vales, ano, mes, sigla }) {
  const pessoas = (cfg.pessoas || []).map((p) => p.sigla);
  const lst = vales.filter((v) => v.ano === ano && v.mes === mes && v.caixa === 'B' && (!sigla || v.sigla === sigla));
  const siglas = [...new Set([...pessoas, ...lst.map((v) => v.sigla)])].filter((s) => lst.some((v) => v.sigla === s));
  let html = cabecalho('FOLHAS DE GASTOS PESSOAIS', cfg, ano, mes);
  for (const s of siglas) {
    const vs = lst.filter((v) => v.sigla === s);
    const rec = soma(vs.filter((v) => v.es === 'E')), desp = soma(vs.filter((v) => v.es === 'S'));
    const nome = (cfg.pessoas || []).find((p) => p.sigla === s)?.nome || s;
    html += `<table class="rel folha"><thead><tr><th colspan="5">${esc(s)} — ${esc(nome)}</th></tr>
      <tr><th>Dia</th><th>Tipo</th><th>Discriminação</th><th>Receitas</th><th>Despesas</th></tr></thead><tbody>`;
    for (const v of vs.sort((a, b) => (a.es === b.es ? 0 : a.es === 'E' ? -1 : 1) || a.dia - b.dia)) {
      html += `<tr>${td(v.dia)}${td(v.tipo, 'txt')}${td(v.disc, 'txt')}${td(v.es === 'E' ? moeda(v.valor) : '')}${td(v.es === 'S' ? moeda(v.valor) : '')}</tr>`;
    }
    html += `<tr class="tot">${td('')}${td('')}${td('Saldo do mês: ' + moeda(r2(rec - desp)), 'txt')}${td(moeda(rec))}${td(moeda(desp))}</tr></tbody></table>`;
  }
  return html || '<p>Sem lançamentos.</p>';
}

/** Aba 13: livro caixa (totais do mês por conceito, com sinal). */
export function livroCaixa({ cfg, vales, ano, mes, caixa }) {
  const tabela = cfg.codigos || CODIGOS_PADRAO;
  const vs = vales.filter((v) => v.ano === ano && v.mes === mes && v.caixa === caixa);
  let html = cabecalho('LIVRO CAIXA', cfg, ano, mes, `Caixa ${caixa}`);
  html += '<table class="rel estreita"><thead><tr><th>Código</th><th>Conceito</th><th></th><th>R$</th></tr></thead><tbody>';
  let saldo = 0;
  for (const es of ['E', 'S']) {
    for (const [cod, nome] of Object.entries(tabela[`${caixa}|${es}`] || {})) {
      const t = soma(vs.filter((v) => v.es === es && v.tipo === cod));
      saldo += es === 'E' ? t : -t;
      html += `<tr>${td(cod, 'txt')}${td(nome, 'txt')}${td(es === 'E' ? '(+)' : '(−)', 'txt')}${td(moeda(t))}</tr>`;
    }
  }
  html += `<tr class="tot">${td('')}${td('Resultado do mês', 'txt')}${td('')}${td(moeda(r2(saldo)))}</tr></tbody></table>`;
  if (caixa === 'B') {
    html += '<p class="pequeno">Siglas: ' + (cfg.pessoas || []).map((p) => `${esc(p.sigla)}: ${esc(p.nome)}`).join(' · ') + '</p>';
  }
  return html;
}

/** Aba 14: vale eletrônico de uma pessoa no mês (com linha para assinatura). */
export function valeEletronico({ cfg, vales, ano, mes, sigla }) {
  const vs = vales.filter((v) => v.ano === ano && v.mes === mes && v.sigla === sigla)
    .sort((a, b) => a.caixa.localeCompare(b.caixa) || (a.es === b.es ? 0 : a.es === 'E' ? -1 : 1) || a.dia - b.dia);
  const nome = (cfg.pessoas || []).find((p) => p.sigla === sigla)?.nome || sigla;
  let html = cabecalho('VALE ELETRÔNICO', cfg, ano, mes, `${sigla} — ${nome}`);
  html += '<table class="rel"><thead><tr><th>Núm</th><th>Dia</th><th>Caixa</th><th>E/S</th><th>Valor</th><th>Tipo</th><th>Discriminação</th></tr></thead><tbody>';
  vs.forEach((v, i) => {
    html += `<tr>${td(i + 1)}${td(v.dia)}${td(v.caixa, 'txt')}${td(v.es, 'txt')}${td(moeda(v.valor))}${td(v.tipo, 'txt')}${td(v.disc, 'txt')}</tr>`;
  });
  const liq = r2(vs.reduce((s, v) => s + (v.es === 'E' ? v.valor : -v.valor), 0));
  html += `<tr class="tot">${td('')}${td('')}${td('')}${td('')}${td(moeda(liq))}${td('')}${td('Resultado (entradas − saídas)', 'txt')}</tr></tbody></table>`;
  html += '<p class="assinatura">Assinatura: ______________________________________ &nbsp; Data: ___ / ___ / ______</p>';
  return html;
}

export const RELATORIOS = [
  { id: '8', nome: 'Caixa B — frente', fn: (o) => caixaFrente({ ...o, caixa: 'B' }) },
  { id: '9', nome: 'Caixa B — verso', fn: (o) => caixaVerso({ ...o, caixa: 'B' }) },
  { id: '10', nome: 'Caixa C — frente', fn: (o) => caixaFrente({ ...o, caixa: 'C' }) },
  { id: '11', nome: 'Caixa C — verso', fn: (o) => caixaVerso({ ...o, caixa: 'C' }) },
  { id: '12', nome: 'Folhas pessoais', fn: folhasPessoais, pessoa: 'opcional' },
  { id: '13', nome: 'Livro caixa', fn: livroCaixa, caixa: true },
  { id: '14', nome: 'Vale eletrônico', fn: valeEletronico, pessoa: 'obrigatória' },
];
