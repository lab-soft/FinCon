// Leitores de extratos (no navegador). Entrada: linhas de planilha (arrays, via SheetJS), texto de CSV ou linhas
// de texto de PDF (via pdf.js). Saída comum: { formato, movs: [{data:{a,m,d}, valor (com sinal), texto, tipo?,
// disc?, caixa?}], saldos: {'aaaa-mm-dd': saldo}, abertura?, avisos: [] }.
import { num, data, iso, conserta, codigo, INDEFINIDO, REGRAS_PADRAO } from './logic.js';

const LINE_RE = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+(-?[\d.]+,\d{2})\s*$/;
const PERIODO_RE = /per[ií]odo de visualiza[cç][aã]o:.*?(\d{2}\/\d{2}\/\d{4})\s+(?:até|ate|a)\s+(\d{2}\/\d{2}\/\d{4})/i;
const MARCAS_SALDO = ['SALDO DO DIA', 'SDO CTA/APL', 'SALDO TOTAL DISPON', 'SALDO APLIC AUT'];
const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

/** Identifica o formato pelas primeiras linhas. */
export function detectar(nome, conteudo) {
  const n = nome.toLowerCase();
  if (n.endsWith('.pdf')) return 'itau_pdf';
  if (typeof conteudo === 'string') return /identificador/i.test(conteudo.split('\n')[0]) ? 'nubank_csv' : 'desconhecido';
  for (const r of conteudo.slice(0, 40)) {
    const cel = r.map((x) => s(x).toLowerCase());
    if (cel[0] === 'ano' && cel.some((x) => x.includes('mês') || x.includes('mes')) && cel.some((x) => x.includes('saldo'))) return 'modelo';
    if (cel[0] === 'date' && cel[1] === 'title' && cel[2] === 'amount') return 'cartao_nubank';
    if (cel[0] === 'data' && cel[1]?.startsWith('lan')) return 'itau_planilha';
    if (cel[0] === 'data' && cel[1] === 'valor' && cel[2] === 'identificador') return 'nubank_csv';
  }
  return 'desconhecido';
}

// ------------------------------------------------------------ Itaú PDF
/** paginas: array de arrays de linhas de texto (uma por página). */
export function itauPdf(paginas) {
  const out = { formato: 'itau_pdf', movs: [], saldos: {}, avisos: [] };
  let fimAtual = null;
  const sdo = new Set();
  for (const linhas of paginas) {
    const m = PERIODO_RE.exec(linhas.join(' '));
    if (m) fimAtual = data(m[2]);
    for (const linha of linhas) {
      const x = LINE_RE.exec(linha.trim());
      if (!x) continue;
      const d = data(x[1]); const desc = x[2].trim(); const v = num(x[3]); const up = desc.toUpperCase();
      if (up.includes('SALDO ANTERIOR')) continue;
      if (MARCAS_SALDO.some((k) => up.includes(k))) {
        const dentro = !fimAtual || iso(d) <= iso(fimAtual);
        if (dentro && Math.abs(v) > 1 && !(sdo.has(iso(d)) && !up.includes('SDO CTA/APL'))) {
          out.saldos[iso(d)] = v;
          if (up.includes('SDO CTA/APL')) sdo.add(iso(d));
        }
        continue;
      }
      out.movs.push({ data: d, valor: v, texto: desc });
    }
  }
  out.movs.sort((a, b) => iso(a.data).localeCompare(iso(b.data)));
  return out;
}

/** Reconstrói linhas de texto de uma página do pdf.js (itens agrupados pela altura). */
export function linhasDaPagina(itens) {
  const grupos = new Map();
  for (const it of itens) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const k = [...grupos.keys()].find((g) => Math.abs(g - y) <= 2) ?? y;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(it);
  }
  return [...grupos.entries()].sort((a, b) => b[0] - a[0])
    .map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4]).map((i) => i.str.trim()).join(' ')
      .replace(/\s+/g, ' '));
}

// ------------------------------------------------------------ planilha exportada do Itaú
function detectarAnotacoes(linhas, ignorar) {
  const stats = {};
  for (const r of linhas) {
    r.forEach((v, c) => {
      if (ignorar.has(c)) return;
      const st = (stats[c] ||= [0, 0]);
      const cod = codigo(typeof v === 'string' ? v : '');
      if (cod && cod !== INDEFINIDO) st[0]++;
      else if (typeof v === 'string' && v.trim() && !/^[\d.,\- ]+$/.test(v) && !['E', 'S'].includes(v.trim())) st[1]++;
    });
  }
  const cols = Object.keys(stats).map(Number);
  let tipoCol = cols.sort((a, b) => stats[b][0] - stats[a][0] || a - b)[0];
  if (tipoCol === undefined || stats[tipoCol][0] < 2) tipoCol = null;
  const discCol = cols.filter((c) => c !== tipoCol).sort((a, b) => stats[b][1] - stats[a][1] || a - b)[0];
  return { tipoCol, discCol: discCol !== undefined && stats[discCol][1] >= 2 ? discCol : null };
}

export function itauPlanilha(rows) {
  const out = { formato: 'itau_planilha', movs: [], saldos: {}, avisos: [] };
  let ini = 0, colValor = 3, colSaldo = 4;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((x) => s(x).toLowerCase());
    if (r[0] === 'data' && r[1]?.startsWith('lan')) {
      ini = i + 1;
      const v = r.findIndex((x) => x.startsWith('valor'));
      const sd = r.findIndex((x) => x.startsWith('saldo'));
      if (v >= 0) colValor = v;
      colSaldo = sd >= 0 ? sd : colValor + 1;
      break;
    }
  }
  const temSdo = rows.some((r) => s(r[1]).toUpperCase().includes('SDO CTA/APL'));
  const corpo = [];
  for (const r of rows.slice(ini)) {
    const d = data(r[0]);
    if (!d) continue;
    const desc = conserta(s(r[1]));
    const up = desc.toUpperCase();
    if (up.includes('SALDO') || up.startsWith('SDO ')) {
      const sv = num(r[colSaldo]) ?? num(r[colValor]);
      let ok = sv !== null && Math.abs(sv) > 1 && !(up.includes('SALDO ANTERIOR') && temSdo);
      if (up.includes('SALDO FINAL') || up.includes('SALDO INICIAL')) ok = false;
      if (ok) out.saldos[iso(d)] = sv;
      continue;
    }
    const v = num(r[colValor]);
    if (!v) continue;
    corpo.push({ d, desc, v, r });
  }
  const ignorar = new Set([0, 1, colValor, colSaldo]);
  const { tipoCol, discCol } = detectarAnotacoes(corpo.map((c) => c.r), ignorar);
  for (const { d, desc, v, r } of corpo) {
    const tv = tipoCol !== null ? r[tipoCol] : null;
    const dv = discCol !== null ? r[discCol] : null;
    const tipo = codigo(typeof tv === 'string' ? tv : '') || codigo(typeof dv === 'string' ? dv : '');
    const disc = typeof dv === 'string' && dv.trim() && !codigo(dv) ? conserta(dv.trim()) : null;
    out.movs.push({ data: d, valor: v, texto: desc, tipo, disc });
  }
  return out;
}

// ------------------------------------------------------------ Nubank
export function csv(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((x) => x.trim()));
}

/** Nome da pessoa num PIX do Nubank ("Transferência recebida pelo Pix - NOME - •••.123..."). */
export function nomePix(desc) {
  const partes = desc.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  const p = partes.slice(1).find((x) => /[A-Za-z]{3}/.test(x) && !x.includes('•'));
  return p ? p.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : '';
}

export function nubankCsv(texto) {
  const out = { formato: 'nubank_csv', movs: [], saldos: {}, avisos: ['CSV do Nubank não traz saldo: confira o saldo final no app do banco.'] };
  const [cab, ...linhas] = csv(texto.replace(/^﻿/, ''));
  const iD = cab.findIndex((x) => /^data$/i.test(x.trim()));
  const iV = cab.findIndex((x) => /^valor$/i.test(x.trim()));
  const iT = cab.findIndex((x) => /descri/i.test(x));
  for (const l of linhas) {
    const d = data(l[iD]); const v = num(l[iV]);
    if (!d || !v) continue;
    const desc = conserta(l[iT] || '').trim();
    const pessoa = nomePix(desc);
    out.movs.push({ data: d, valor: v, texto: desc.slice(0, 160),
      disc: pessoa ? `PIX ${v > 0 ? 'de' : 'para'} ${pessoa}` : desc.split(' - ')[0] });
  }
  return out;
}

export function cartaoNubank(rows, dataPadrao = null) {
  const out = { formato: 'cartao_nubank', movs: [], saldos: {}, avisos: [] };
  for (const r of rows) {
    let d = data(r[0]), titulo, valor, a1, a2;
    if (!d && dataPadrao && typeof r[0] === 'string' && num(r[1]) !== null) { d = dataPadrao; [titulo, valor, a1, a2] = [r[0], num(r[1]), r[2], r[3]]; }
    else if (d) [titulo, valor, a1, a2] = [r[1], num(r[2]), r[3], r[4]];
    else continue;
    titulo = conserta(s(titulo));
    if (valor === null || /pagamento recebido/i.test(titulo)) continue;
    const tipo = codigo(typeof a1 === 'string' ? a1 : '') || codigo(typeof a2 === 'string' ? a2 : '');
    const disc = (typeof a2 === 'string' && a2.trim()) || (typeof a1 === 'string' && a1.trim() && !codigo(a1) ? a1.trim() : null);
    out.movs.push({ data: d, valor: -valor, texto: titulo, tipo, disc });
  }
  return out;
}

// ------------------------------------------------------------ planilha no formato do modelo consolidado
/** Bloco mensal no formato do modelo (Ano, Núm, Mês, Dia, Caixa, E/S, Valor, Tipo1, Saldo, Discriminação, Nome,
 *  obs). O mês vem de fora (o escrito na planilha costuma estar errado). Usa a coluna Saldo para achar o saldo
 *  inicial e para parar quando o saldo deixa de encadear. */
export function modelo(rows, ano, mes, nomePadrao = '') {
  const out = { formato: 'modelo', movs: [], saldos: {}, avisos: [], abertura: null, saldoFinal: null };
  const cab = (rows[0] || []).map((x) => s(x).toLowerCase());
  const dt = (dia) => ({ a: ano, m: mes, d: Math.min(Math.max(1, dia || 1), new Date(ano, mes, 0).getDate()) });
  if (!s(rows[0]?.[6]) && cab[8] === 'saldo') {
    // variante sem coluna Valor: valores com sinal na coluna Saldo (RV set/2026)
    out.abertura = 0;
    for (const r0 of rows.slice(1)) {
      const r = [...r0, ...Array(12).fill(null)];
      const jt = s(r[9]).toLowerCase(), lt = s(r[11]).toLowerCase(), v = num(r[8]);
      if (jt.includes('saldo inicial')) { out.abertura = v || 0; continue; }
      if (jt.includes('saldo final') || lt.startsWith('saldo final')) { out.saldoFinal = v; break; }
      const es = s(r[5]).toUpperCase();
      if (!v || (!['E', 'S'].includes(es) && !lt.includes('justificar'))) continue;
      const valor = es === 'E' ? Math.abs(v) : es === 'S' ? -Math.abs(v) : v;
      out.movs.push({ data: dt(1), valor, texto: s(r[11]), tipo: es ? codigo(s(r[7])) || s(r[7]) || null : 'JUST',
        disc: s(r[9]) || null, caixa: es ? (s(r[4]) || null) : 'justificar', modelo: true });
    }
    return out;
  }
  let declarado = null, saldo = null, comecou = false;
  for (let i = 1; i < rows.length; i++) {
    const r = [...rows[i], ...Array(12).fill(null)];
    const [A, , , D, E, F, G, H, I, J, K, L] = r;
    const jt = s(J).toLowerCase(), lt = s(L).toLowerCase();
    if (s(A) === 'Ano') continue;
    if (jt.includes('saldo inicial') && !comecou) { declarado = num(G) || num(I); continue; }
    if (comecou && (jt.includes('saldo final') || lt.startsWith('saldo final') || s(H) === 'Caixa' || jt.includes('total a justificar'))) {
      if ((jt.includes('saldo final') || lt.startsWith('saldo final')) && num(I) !== null) out.saldoFinal = num(I);
      break;
    }
    if (jt.includes('saldo final') && !comecou) { if (num(I) !== null) declarado = num(I); continue; }
    const g = num(G), iv = num(I);
    const es = s(F).toUpperCase();
    let caixa = s(E);
    const justificar = caixa.toLowerCase() === 'justificar' || lt.includes('justificar') || jt.includes('justificar');
    if (!g || (!['E', 'S'].includes(es) && !justificar)) continue;
    if (justificar && !['E', 'S'].includes(es) && !caixa) caixa = 'justificar';
    let valor = es === 'E' ? g : es === 'S' ? -g : null;
    if (valor === null) { const base = saldo ?? declarado; valor = iv !== null && base !== null ? iv - base : -g; }
    if (!comecou) {
      comecou = true;
      saldo = iv !== null ? iv - valor : (declarado ?? 0);
      out.abertura = Math.round(saldo * 100) / 100;
      if (declarado !== null && Math.abs(declarado - saldo) > 0.005) out.avisos.push(`Saldo inicial escrito (${declarado}) difere do que as linhas indicam (${out.abertura}).`);
    }
    const esperado = saldo + valor;
    if (iv !== null && Math.abs(iv - esperado) > 0.01) {
      out.avisos.push(`A partir da linha ${i + 1} o saldo deixa de encadear; o resto foi ignorado (parece de outro mês).`);
      break;
    }
    saldo = esperado;
    const nomeK = s(K);
    let tipo = codigo(s(H)) || s(H) || null;
    if (nomeK.toLowerCase() === 'casa' && !tipo) tipo = 'casa';
    out.movs.push({ data: dt(typeof D === 'number' ? D : 1), valor, texto: s(L), tipo, disc: s(J) || null,
      caixa: caixa || null, modelo: true });
  }
  if (!comecou) out.abertura = declarado || 0;
  return out;
}

/** Saldos reais por mês a partir dos saldos diários do extrato: {mes: {abertura, final}} do ano. */
export function saldosMensais(saldos, ano) {
  const datas = Object.keys(saldos).sort();
  const res = {};
  for (let m = 1; m <= 12; m++) {
    const ini = `${ano}-${String(m).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(m).padStart(2, '0')}-31`;
    const antes = datas.filter((d) => d < ini).pop();
    const ultimo = datas.filter((d) => d >= ini && d <= fim).pop();
    if (antes || ultimo) res[m] = { abertura: antes ? saldos[antes] : null, final: ultimo ? saldos[ultimo] : null };
  }
  return res;
}

export { REGRAS_PADRAO };
