// Lógica pura do FinCon (sem DOM, sem rede): utilitários, classificação, geração dos vales do mês,
// saldos de bancos, itens a justificar e conferência da diferença (célula N1 da aba 2 da secretaria).
// Mesmas regras do gerador Python de CCBV-scl (codigo/vales.py e codigo/secretaria.py).

export const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
export const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto',
  'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const INDEFINIDO = '???';
export const RATEIO = 'PENSÃO+CONTRIB. LABORES';

// Tabela de códigos da aba "1" (SIGLAS / DADOS) da secretaria — pode ser substituída na configuração.
export const CODIGOS_PADRAO = {
  'B|E': { RR: 'Residentes', AR: 'Adjuntos', SB: 'Subvenções' },
  'B|S': { PS: 'Pensões', GO: 'Gastos Ordinários', RP: 'Roupas', MR: 'Médicos e Remédios', DV: 'Diversos Pessoais',
    AD: 'Adjuntos', VC: 'Veículos', NF: 'Natal e Festas', VR: 'Vários', DC: 'Donativos ao Centro',
    DL: 'Contrib. labores ap.' },
  'C|E': { CO: 'Contribuição de residentes', CP: 'Contribuições participantes', OT: 'Outros conceitos' },
  'C|S': { CF: 'IPTU e Seguros', OR: 'Ordenados e Honorários', CM: 'Comestíveis', GG: 'Gerais Administração',
    LZ: 'Luz', AG: 'Água', GS: 'Gás', TF: 'Telefone', CS: 'Consertos', MT: 'Manutenção/Reposição', VR: 'Vários',
    AC: 'Atividades culturais', IT: 'Instalações' },
};
// Códigos usados nas planilhas das pessoas (além dos da tabela)
export const CODIGOS_EXTRA = ['JUST', 'casa', 'CC', 'CR', 'DP', INDEFINIDO];
const CASA = new Set(['AG', 'LZ', 'IT', 'CS', 'casa', 'OR', 'CM', 'GG', 'GS', 'MT', 'CF', 'AC', 'CP', 'CO']);

// ---------------------------------------------------------------- utilitários
export function num(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/R\$/g, '').replace(/\s/g, '').replace(/​/g, '').trim();
  if (!s || s.startsWith('#')) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[CD]$/i.test(s)) { if (/D$/i.test(s)) neg = !neg; s = s.slice(0, -1); }
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf('.') > s.lastIndexOf(',') ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

export const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

export function moeda(v, comSinal = false) {
  if (v === null || v === undefined || v === '') return '';
  const s = Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : comSinal && v > 0 ? '+' : '') + s;
}

/** Data a partir de Date, número de série do Excel ou texto dd/mm/aaaa (ou dd/mm/aa). Devolve {a, m, d} ou null. */
export function data(v) {
  if (v instanceof Date && !isNaN(v)) return { a: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  if (typeof v === 'number' && v > 30000 && v < 60000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return { a: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  if (typeof v === 'string') {
    let m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { a, m: Number(m[2]), d: Number(m[1]) };
    }
    m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return { a: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }
  return null;
}
export const iso = (x) => `${x.a}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
export const ultimoDia = (a, m) => new Date(a, m, 0).getDate();

/** Corrige acentuação corrompida (UTF-8 lido como Latin-1: 'JoÃ£o' -> 'João'). */
export function conserta(s) {
  if (typeof s !== 'string' || !/[ÃÂâ]/.test(s)) return s;
  try {
    const bytes = new Uint8Array([...s].map((c) => c.charCodeAt(0) & 0xff));
    const r = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return r;
  } catch { return s; }
}

/** Descrição do banco normalizada (sem datas, números longos, acentos), usada para aprender e deduplicar. */
export function chave(desc) {
  return conserta(String(desc || '')).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\d{2}\/\d{2}/g, ' ').replace(/\d{3,}/g, ' ').replace(/\bPAY\s*-\s*/g, 'PAY ')
    .replace(/\s+/g, ' ').trim();
}

/** Código de Tipo1 se o texto for um (ou começar por um: 'DV (vou cancelar)'). */
export function codigo(v, tabela = CODIGOS_PADRAO) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s === '??' || s === '???') return INDEFINIDO;
  const conhecidos = new Set([...Object.values(tabela).flatMap(Object.keys), ...CODIGOS_EXTRA]);
  const u = s.toUpperCase();
  if (u === 'CASA') return 'casa';
  if (conhecidos.has(u)) return u === 'DP' ? 'DV' : u;
  const m = s.match(/^([A-Za-z]{2,4})(?:\s*[(:\-]|\s+\()/);
  if (m && conhecidos.has(m[1].toUpperCase())) return m[1].toUpperCase() === 'DP' ? 'DV' : m[1].toUpperCase();
  return null;
}

// ---------------------------------------------------------------- classificação
// Regras: [padrão (regex no texto do banco), sinal '+', '-' ou '±', Tipo1, discriminação, caixa?]
export const REGRAS_PADRAO = [
  ['REMUNERACAO|SALARIO|REMUNER BAS POUP|JUROS POUPANCA', '+', 'RR', 'SALÁRIO'],
  ['TED .*FUNDACAO', '+', 'RR', 'SALÁRIO'],
  ['AMIL|PLANO DE SA[UÚ]DE|UNIMED|DROGARIA|DROGASIL|PACHECO|FARMACIA|RAIA', '-', 'MR', 'REMÉDIOS'],
  ['IFOOD|SUPERMERC|MERCADO|PADARIA|RESTAURANTE|PIX QRS SUPER', '-', 'GO', 'GO'],
  ['UBER|99 ?RIDE|99APP|POSTO|SHELL|IPIRANGA|PEDAGIO|SEM PARAR|ESTACIONAMENTO|NITEROI PAR', '-', 'VC', 'VEÍCULOS'],
  ['CLARO|VIVO|TIM |OI FIBRA|INTERNET', '-', 'TF', 'TELEFONE/INTERNET', 'C'],
  ['AMPLA|ENEL|LIGHT ', '-', 'LZ', 'LUZ', 'C'],
  ['AGUAS DE|CEDAE', '-', 'AG', 'ÁGUA', 'C'],
  ['APLICACAO|APLIC AUT|CDB', '-', 'JUST', 'INVESTIMENTOS'],
  ['RESGATE', '+', 'JUST', 'RESGATE DE INVESTIMENTO'],
  ['DEP DIN', '+', 'OT', 'PENSÃO (depósito em dinheiro)', 'C'],
  // conta "caixa da casa" (Nubank): como a secretaria lançou os meses oficiais
  ['GUSTAVO DE FARIAS SOUSA|PECCI', '+', 'OT', 'PENSÃO', 'C'],
  ['CAROLINA FERNANDES FURTADO|ANA MARIA WISTUBA', '-', 'OR', 'ORDENADOS', 'C'],
  ['ROSANE DA CONCEICAO', '-', 'OR', 'DIÁRIAS D. ROSANE', 'C'],
  ['FAST SHOP|CASAS BAHIA', '-', 'MT', 'MANUTENÇÃO/REPOSIÇÃO', 'C'],
];

/** Mapa aprendido: chave do texto do banco -> {tipo, disc, caixa} pela maioria (>= 75%) das classificações. */
export function aprender(lancamentos) {
  const cont = new Map();
  for (const l of lancamentos) {
    if (!l.tipo || l.tipo === INDEFINIDO || l.tipo === 'CC' || !l.texto) continue;
    const k = `${l.sigla}|${chave(l.texto)}`;
    if (!cont.has(k)) cont.set(k, new Map());
    const t = `${l.tipo}|${l.caixa || ''}|${l.disc || ''}`;
    cont.get(k).set(t, (cont.get(k).get(t) || 0) + 1);
  }
  const res = new Map();
  for (const [k, m] of cont) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [melhor, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    const porTipo = [...m.entries()].filter(([t]) => t.split('|')[0] === melhor.split('|')[0])
      .reduce((a, [, c]) => a + c, 0);
    if (porTipo / total >= 0.75) {
      const [tipo, caixa, disc] = melhor.split('|');
      res.set(k, { tipo, caixa: caixa || null, disc: disc || null, n });
    }
  }
  return res;
}

/** Sugere Tipo1/caixa/discriminação para um lançamento sem tipo. Devolve {tipo, caixa, disc, origem}. */
export function classificar(l, { regras = REGRAS_PADRAO, aprendido = new Map(), tabela = CODIGOS_PADRAO } = {}) {
  if (l.tipo && l.tipo !== INDEFINIDO) {
    return { tipo: l.tipo, caixa: l.caixa || (CASA.has(l.tipo) ? 'C' : 'B'), disc: l.disc || null, origem: 'pessoa' };
  }
  const anot = codigo(l.disc || '', tabela);
  if (anot && anot !== INDEFINIDO) return { tipo: anot, caixa: CASA.has(anot) ? 'C' : 'B', disc: l.disc, origem: 'anotação' };
  const ap = aprendido.get(`${l.sigla}|${chave(l.texto)}`);
  if (ap) return { tipo: ap.tipo, caixa: ap.caixa || (CASA.has(ap.tipo) ? 'C' : 'B'), disc: l.disc || ap.disc, origem: 'aprendido' };
  const txt = conserta(l.texto || '');
  for (const [padrao, sinal, tipo, disc, caixa] of regras) {
    const okSinal = sinal === '±' || (sinal === '+') === (l.es === 'E');
    if (okSinal && new RegExp(padrao, 'i').test(txt)) {
      return { tipo, caixa: caixa || (CASA.has(tipo) ? 'C' : 'B'), disc: l.disc || disc, origem: 'regra' };
    }
  }
  return { tipo: INDEFINIDO, caixa: l.caixa || 'B', disc: l.disc || null, origem: 'pendente' };
}

// ---------------------------------------------------------------- deduplicação
/** Lançamentos novos que ainda não existem. Repetidos dentro do mesmo arquivo são legítimos; entre arquivos,
 *  vale a maior contagem (mesmo dia + mesmo texto normalizado + mesmo valor). */
export function novosLancamentos(existentes, novos) {
  const k = (l) => `${l.conta}|${l.ano}-${l.mes}-${l.dia}|${chave(l.texto)}|${r2(l.valor)}|${l.es}`;
  const ja = new Map();
  for (const l of existentes) ja.set(k(l), (ja.get(k(l)) || 0) + 1);
  const vistos = new Map();
  const res = [];
  for (const l of novos) {
    const c = (vistos.get(k(l)) || 0) + 1;
    vistos.set(k(l), c);
    if (c > (ja.get(k(l)) || 0)) res.push(l);
  }
  return res;
}

// ---------------------------------------------------------------- códigos da secretaria
export function rotuloCodigo(caixa, es, t, tabela = CODIGOS_PADRAO) {
  const nome = tabela[`${caixa}|${es}`]?.[t];
  const curtos = { RR: 'SALÁRIO', GO: 'GO', RP: 'ROUPAS', MR: 'REMÉDIOS', DV: 'DIVERSOS', VC: 'VEÍCULOS', VR: 'VÁRIOS',
    TF: 'TELEFONE', AG: 'ÁGUA', LZ: 'LUZ', IT: 'Instalações', CS: 'Consertos' };
  return curtos[t] || (nome ? nome.toUpperCase() : t);
}

/** Converte (caixa, E/S, Tipo1) dos extratos para um código que exista na tabela da aba "1" (as abas 8 e 10
 *  só somam esses códigos). Desconhecidos: DV "DESCONHECIDO" / RR "NÃO IDENTIFICADO" (provisório). */
export function codigoSecretaria(caixa, es, tipo, tabela = CODIGOS_PADRAO) {
  caixa = caixa === 'C' ? 'C' : 'B';
  const t = tipo === 'DP' ? 'DV' : tipo;
  if (t === 'JUST' || t === 'CC') return null;
  if (!t || t === INDEFINIDO) {
    if (caixa === 'C') return es === 'S' ? ['C', 'VR', 'DESCONHECIDO'] : ['C', 'OT', 'NÃO IDENTIFICADO'];
    return es === 'S' ? ['B', 'DV', 'DESCONHECIDO'] : ['B', 'RR', 'NÃO IDENTIFICADO'];
  }
  if (t === 'casa') return es === 'S' ? ['C', 'VR', 'CASA (a classificar)'] : ['C', 'OT', 'CASA (entrada)'];
  if (tabela[`${caixa}|${es}`]?.[t]) return [caixa, t, rotuloCodigo(caixa, es, t, tabela)];
  const outra = caixa === 'B' ? 'C' : 'B';
  if (tabela[`${outra}|${es}`]?.[t]) return [outra, t, rotuloCodigo(outra, es, t, tabela)];
  if (t === 'CR') return ['C', 'TF', 'INTERNET'];
  if (es === 'S') return caixa === 'C' ? ['C', 'VR', `${t} (outros)`] : ['B', 'DV', `${t} (outros)`];
  return caixa === 'C' ? ['C', 'OT', `${t} (outros)`] : ['B', 'RR', `${t} (outros)`];
}

// ---------------------------------------------------------------- contas e saldos
/** Saldo de uma conta no fim do mês pela lista de movimentos bancários (como a aba 4: soma de entradas −
 *  saídas, incluindo as linhas SALDO ANTERIOR, até o mês). */
export function saldoConta(bancos, conta, ano, mes) {
  return r2(bancos.filter((b) => b.conta === conta && b.ano === ano && b.mes <= mes)
    .reduce((s, b) => s + (b.entrada || 0) - (b.saida || 0), 0));
}

/** Resumo mensal de uma conta a partir dos lançamentos: {mes: {e, s}}. */
export function movimentoConta(lancs, conta, ano) {
  const res = {};
  for (const l of lancs) {
    if (l.conta !== conta || l.ano !== ano) continue;
    const x = (res[l.mes] ||= { e: 0, s: 0, n: 0 });
    if (l.es === 'E') x.e += l.valor; else x.s += l.valor;
    x.n++;
  }
  return res;
}

// ---------------------------------------------------------------- geração dos vales do mês
/**
 * Gera as linhas da VALES, os itens a justificar e as linhas da aba BANCOS de um mês.
 * ctx = { ano, mes, lancamentos (do ano), contas [{id, sigla, cartao}], pessoas [{sigla, morador}],
 *         tabela, valesExistentes (do ano), bancosExistentes (do ano), justificarExistentes,
 *         lancadas: Set('SIGLA') de pessoas cujo mês já está lançado (oficial) }
 * Devolve { vales, justificar, bancos, ajustes, rateio, avisos }.
 */
export function gerarMes(ctx) {
  const { ano, mes, tabela = CODIGOS_PADRAO, contas = [], pessoas = [] } = ctx;
  const lancadas = ctx.lancadas || new Set();
  const out = { vales: [], justificar: [], bancos: [], ajustes: [], avisos: [], rateio: 0 };
  const doMes = (ctx.lancamentos || []).filter((l) => l.ano === ano && l.mes === mes);
  const contaDe = new Map(contas.map((c) => [c.id, c]));
  const siglas = [...new Set(doMes.map((l) => l.sigla))];
  const justificados = new Map();
  for (const j of ctx.justificarExistentes || []) {
    if (j.data || j.mes) { const k = `${j.sigla}|${r2(j.valor)}`; justificados.set(k, (justificados.get(k) || 0) + 1); }
  }
  for (const sigla of siglas) {
    if (lancadas.has(sigla)) continue;
    const ls = doMes.filter((l) => l.sigla === sigla);
    const temCartao = ls.some((l) => contaDe.get(l.conta)?.cartao);
    const linhas = new Map();
    const just = new Map();
    const add = (cx, es, cod, rot, v) => {
      const k = `${cx}|${es}|${cod}|${rot}`;
      linhas.set(k, (linhas.get(k) || 0) + v);
    };
    for (const l of ls) {
      const justificar = l.tipo === 'JUST' || String(l.caixa).toLowerCase() === 'justificar';
      if (justificar) {
        const cx = l.caixa === 'C' ? 'C' : 'B';
        const disc = (l.disc || l.texto || 'a justificar').slice(0, 60);
        const k = `${cx}|${disc}`;
        just.set(k, (just.get(k) || 0) + (l.es === 'S' ? l.valor : -l.valor));
        continue;
      }
      if (temCartao && l.tipo === 'CC' && !contaDe.get(l.conta)?.cartao) continue;
      const conv = codigoSecretaria(l.caixa, l.es, l.tipo, tabela);
      if (conv) add(conv[0], l.es, conv[1], conv[2], l.valor);
    }
    // bancos: entradas e saídas do mês por conta (todas as movimentações), + diferença de saldo
    let bancoLiq = 0, difSaldo = 0;
    const contasPessoa = [...new Set(ls.map((l) => l.conta))].filter((c) => !contaDe.get(c)?.cartao);
    for (const c of contasPessoa) {
      const lc = ls.filter((l) => l.conta === c);
      let e = lc.filter((l) => l.es === 'E').reduce((s, l) => s + l.valor, 0);
      let s = lc.filter((l) => l.es === 'S').reduce((s2, l) => s2 + l.valor, 0);
      const abertura = ctx.aberturas?.[c]?.[mes];
      const ant = ctx.saldoPlanilha ? ctx.saldoPlanilha(c, mes - 1) : null;
      if (abertura != null && ant != null && Math.abs(abertura - ant) >= 0.01) {
        const dif = r2(abertura - ant);
        difSaldo += dif;
        if (dif > 0) e += dif; else s -= dif;
      }
      bancoLiq += e - s;
      out.bancos.push({ ano, mes, conta: c, rotulo: 'ENTRADA-SAÍDA', entrada: r2(e), saida: r2(s), sigla });
    }
    difSaldo = r2(difSaldo);
    if (Math.abs(difSaldo) >= 0.01) {
      add('B', difSaldo > 0 ? 'E' : 'S', difSaldo > 0 ? 'RR' : 'DV',
        'AJUSTE SALDO BANCÁRIO (lançamentos que faltam no extrato)', Math.abs(difSaldo));
      out.ajustes.push({ sigla, tipo: 'saldo', valor: difSaldo });
    }
    let valesLiq = 0;
    for (const [k, v] of linhas) valesLiq += k.split('|')[1] === 'E' ? v : -v;
    let justLiq = 0;
    for (const [k, v] of just) {
      const [cx, disc] = k.split('|');
      const jk = `${sigla}|${r2(v)}`;
      if ((justificados.get(jk) || 0) > 0) {
        justificados.set(jk, justificados.get(jk) - 1);
        out.avisos.push(`${sigla}: "${disc}" ${moeda(v)} já estava na lista a justificar.`);
        justLiq += v;   // o valor continua explicando o banco, mas não entra de novo na lista
        continue;
      }
      justLiq += v;
      out.justificar.push({ ano, mes, caixa: cx, valor: r2(v), disc, sigla, data: `${ano}-${String(mes).padStart(2, '0')}-01` });
    }
    const ajuste = r2(bancoLiq + justLiq - valesLiq);
    if (Math.abs(ajuste) >= 0.01) {
      const rot = temCartao ? 'AJUSTE CARTÃO (compras − fatura paga)' : 'AJUSTE (extrato x lançamentos)';
      add('B', ajuste > 0 ? 'E' : 'S', ajuste > 0 ? 'RR' : 'DV', rot, Math.abs(ajuste));
      out.ajustes.push({ sigla, tipo: temCartao ? 'cartão' : 'diferença', valor: ajuste });
    }
    for (const [k, v] of linhas) {
      const [cx, es, cod, rot] = k.split('|');
      if (Math.abs(v) >= 0.005) out.vales.push({ ano, mes, dia: 1, caixa: cx, es, valor: r2(v), tipo: cod, disc: rot, sigla, origem: 'gerado' });
    }
  }
  // rateio do Caixa C do mês entre os moradores (B/S "PS" e C/E "CO")
  const todos = [...(ctx.valesExistentes || []).filter((v) => v.ano === ano && v.mes === mes), ...out.vales];
  const deficit = r2(todos.filter((v) => v.caixa === 'C' && !(v.tipo === 'CO' && v.disc === RATEIO))
    .reduce((s, v) => s + (v.es === 'S' ? v.valor : -v.valor), 0));
  const jaRateado = todos.some((v) => v.tipo === 'CO' && v.disc === RATEIO);
  const am = `${ano}-${String(mes).padStart(2, '0')}`;          // morador desde/até no formato AAAA-MM
  const mor = pessoas.filter((p) => p.morador && (!p.ate || p.ate >= am) && (!p.desde || p.desde <= am))
    .map((p) => p.sigla);
  if (!jaRateado && mor.length && Math.abs(deficit) >= 0.01) {
    const cota = r2(deficit / mor.length);
    mor.forEach((s, i) => {
      const v = i < mor.length - 1 ? cota : r2(deficit - cota * (mor.length - 1));
      out.vales.push({ ano, mes, dia: 1, caixa: 'B', es: 'S', valor: v, tipo: 'PS', disc: RATEIO, sigla: s, origem: 'rateio' });
      out.vales.push({ ano, mes, dia: 1, caixa: 'C', es: 'E', valor: v, tipo: 'CO', disc: RATEIO, sigla: s, origem: 'rateio' });
    });
    out.rateio = deficit;
  }
  return out;
}

// ---------------------------------------------------------------- conferência (N1)
/** Total a justificar até o fim do mês: {B, Cax, C} (como G1:G3 da aba 3, mas por mês). */
export function aJustificar(justificar, ano, mes) {
  const ate = justificar.filter((j) => (j.ano ?? ano) < ano || ((j.ano ?? ano) === ano && (j.mes ?? 1) <= mes));
  const B = r2(ate.filter((j) => j.caixa !== 'C').reduce((s, j) => s + j.valor, 0));
  const Cax = r2(ate.filter((j) => j.caixa === 'C' && j.sigla === 'AX').reduce((s, j) => s + j.valor, 0));
  const C = r2(ate.filter((j) => j.caixa === 'C' && j.sigla !== 'AX').reduce((s, j) => s + j.valor, 0));
  return { B, Cax, C };
}

/** Conferência do mês (abas 9 e 11): saldo final de cada caixa = caixa em dinheiro + bancos + a justificar. */
export function conferir({ ano, mes, vales, bancos, justificar, contas, saldoInicial = { B: 0, C: 0 }, dinheiro = { B: 0, C: 0 },
  snapshots = {} }) {
  // meses fechados guardam o total a justificar do fechamento (como a aba 3 da secretaria); senão, calcula
  const snap = snapshots[mes];
  const res = {};
  for (const cx of ['B', 'C']) {
    const vs = vales.filter((v) => v.ano === ano && v.mes <= mes && v.caixa === cx);
    const doMes = vs.filter((v) => v.mes === mes);
    const receitas = r2(doMes.filter((v) => v.es === 'E').reduce((s, v) => s + v.valor, 0));
    const despesas = r2(doMes.filter((v) => v.es === 'S').reduce((s, v) => s + v.valor, 0));
    const anterior = r2(vs.filter((v) => v.mes < mes).reduce((s, v) => s + (v.es === 'E' ? v.valor : -v.valor), 0) + (saldoInicial[cx] || 0));
    const final = r2(receitas - despesas + anterior);
    const ids = contas.filter((c) => (c.caixa || 'B') === cx && !c.cartao).map((c) => c.id);
    const bancosCx = r2(ids.reduce((s, id) => s + saldoConta(bancos, id, ano, mes), 0));
    const j = snap || aJustificar(justificar, ano, mes);
    const just = cx === 'B' ? j.B : r2(j.Cax + j.C);
    const total = r2((dinheiro[cx] || 0) + bancosCx + just);
    res[cx] = { receitas, despesas, anterior, final, dinheiro: dinheiro[cx] || 0, bancos: bancosCx, justificar: just,
      comAdministracao: cx === 'C' ? j.Cax : undefined, total, diferenca: r2(final - total) };
  }
  res.diferenca = r2(res.B.diferenca + res.C.diferenca);
  return res;
}
