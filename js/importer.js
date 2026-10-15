// Importa uma planilha "Secretaria Evolution.ANO.xlsx" (lida pelo SheetJS) para o formato do app:
// aba 1 (pessoas, códigos, saldo inicial), 2 (VALES), 3 (JUSTIFICAR + fechamentos mensais), 4 (BANCOS), 6 (orçamento).
import { num, data, MESES, r2 } from './logic.js';

const cel = (ws, XLSX, ref) => ws?.[ref]?.v ?? null;
const linhas = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();

export function importarSecretaria(XLSX, wb) {
  const aba = (n) => wb.Sheets[n];
  const a1 = aba('1');
  const ano = Number(cel(a1, XLSX, 'B8')) || new Date().getFullYear();
  const L1 = linhas(XLSX, a1);
  // pessoas (D = nome, E = sigla, linhas 4..44)
  const pessoas = [];
  for (let r = 3; r < 44; r++) {
    const sig = s(L1[r]?.[4]), nome = s(L1[r]?.[3]);
    if (sig && nome) pessoas.push({ sigla: sig, nome, morador: true });
  }
  // códigos (P:Q = caixa B, S:T = caixa C), seções "entrada"/"saída"
  const codigos = { 'B|E': {}, 'B|S': {}, 'C|E': {}, 'C|S': {} };
  for (const [cx, cn, cc] of [['B', 15, 16], ['C', 18, 19]]) {
    let sec = null;
    for (let r = 3; r < 46; r++) {
      const nome = s(L1[r]?.[cn]), cod = s(L1[r]?.[cc]);
      const n = nome.toLowerCase();
      if (n === 'entrada' || n === 'saída' || n === 'saida') sec = n === 'entrada' ? 'E' : 'S';
      else if (sec && cod) codigos[`${cx}|${sec}`][cod] = nome;
    }
  }
  const saldoInicial = { [ano]: { B: num(cel(a1, XLSX, 'B10')) || 0, C: num(cel(a1, XLSX, 'B11')) || 0 } };
  const casa = s(cel(a1, XLSX, 'A6')) || 'CCBV';

  // aba 2: VALES (G..O = Mês, Dia, Caixa, E/S, Valor, Tipo1, Tipo2, Discriminação, Nome)
  const vales = [];
  for (const r of linhas(XLSX, aba('2')).slice(3)) {
    const mes = r[6], v = num(r[10]);
    if (typeof mes !== 'number' || mes < 1 || mes > 12 || v === null || !s(r[14])) continue;
    vales.push({ ano, mes, dia: Number(r[7]) || 1, caixa: s(r[8]).toUpperCase() || 'B', es: s(r[9]).toUpperCase(), valor: r2(v),
      tipo: s(r[11]), disc: s(r[13]), sigla: s(r[14]), origem: 'importado' });
  }
  // moradores = quem entra no rateio do Caixa C (CO "PENSÃO+CONTRIB. LABORES"); quem parou de entrar antes do
  // último mês rateado saiu ("até" = último mês em que entrou)
  const rateio = vales.filter((v) => v.tipo === 'CO' && v.disc.toUpperCase().includes('PENSÃO+CONTRIB'));
  if (rateio.length) {
    const ultimo = Math.max(...rateio.map((v) => v.mes));
    for (const p of pessoas) {
      const meses = rateio.filter((v) => v.sigla === p.sigla).map((v) => v.mes);
      p.morador = meses.length > 0;
      if (meses.length && Math.max(...meses) < ultimo) p.ate = `${ano}-${String(Math.max(...meses)).padStart(2, '0')}`;
    }
  }

  // aba 3: JUSTIFICAR (A..E) e fechamentos (blocos I..K, linhas 5..20)
  const L3 = linhas(XLSX, aba('3'));
  const justificar = [];
  for (let r = 3; r < 474; r++) {
    const x = L3[r] || [];
    const v = num(x[1]);
    if (v === null || v === 0) continue;
    const d = data(x[4]);
    justificar.push({ ano: d?.a ?? null, mes: d?.m ?? null, caixa: s(x[0]) === 'C' ? 'C' : 'B', valor: r2(v), disc: s(x[2]),
      sigla: s(x[3]), data: d ? `${d.a}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null });
  }
  const meses = [];
  for (const base of [4, 8, 12, 16]) {                       // linhas 5, 9, 13, 17 (índice 0)
    for (let c = 8; c <= 10; c++) {
      const rotulo = s(L3[base]?.[c]).toUpperCase();
      const mes = MESES.indexOf(rotulo) + 1;
      if (!mes) continue;
      const vals = [1, 2, 3].map((k) => num(L3[base + k]?.[c]));
      const formula = aba('3')?.[XLSX.utils.encode_cell({ r: base + 1, c })]?.f;
      if (!formula && vals[0] !== null) meses.push({ id: `${ano}_${mes}`, ano, mes, fechado: true, B: vals[0] || 0, Cax: vals[1] || 0, C: vals[2] || 0 });
    }
  }

  // aba 4: BANCOS (A..F = mês, data, discriminação, entrada, saída, conta) e contas (K) com saldo real (H)
  const L4 = linhas(XLSX, aba('4'));
  const bancos = [];
  for (let r = 5; r < L4.length; r++) {
    const x = L4[r] || [];
    if (s(x[0]) === 'x') break;
    const mes = Number(x[0]), conta = s(x[5]);
    const e = num(x[3]), sa = num(x[4]);
    if (!mes || !conta || (e === null && sa === null)) continue;
    bancos.push({ ano, mes, conta, rotulo: s(x[2]) || 'ENTRADA-SAÍDA', entrada: e || 0, saida: sa || 0, origem: 'importado' });
  }
  const contas = [];
  for (let r = 5; r < 101; r++) {
    const id = s(L4[r]?.[10]);
    if (!id) continue;
    const caixaC = r <= 8;                                    // linhas 6..9 = contas do Caixa C (CTR1..4)
    const sig = id.replace(/^C/, '').replace(/\d+$/, '');
    contas.push({ id, sigla: pessoas.some((p) => p.sigla === sig) ? sig : '', nome: id, caixa: caixaC ? 'C' : 'B',
      cartao: false, saldoReal: num(L4[r]?.[7]) });
  }

  // aba 6: orçamento mensal aprovado (E = caixa B, L = caixa C), pelo nome do conceito
  const L6 = linhas(XLSX, aba('6'));
  const orcamento = { [ano]: {} };
  const porNome = {};
  for (const [k, t] of Object.entries(codigos)) for (const [cod, nome] of Object.entries(t)) porNome[`${k[0]}|${nome.trim().toLowerCase()}`] = [k, cod];
  for (let r = 5; r < 23; r++) {
    for (const [cx, cn, cv] of [['B', 0, 4], ['C', 7, 11]]) {
      const nome = s(L6[r]?.[cn]).toLowerCase(); const v = num(L6[r]?.[cv]);
      const achou = porNome[`${cx}|${nome}`];
      if (achou && v) orcamento[ano][`${achou[0]}|${achou[1]}`] = v;
    }
  }
  return { ano, config: { casa, pessoas, codigos, saldoInicial, contas, orcamento }, vales, justificar, meses, bancos };
}
