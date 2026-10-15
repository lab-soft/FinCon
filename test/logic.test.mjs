// Testes da lógica pura (rodam no navegador: abra test/index.html).
import * as L from '../js/logic.js';
import * as P from '../js/parsers.js';

export const testes = [];
const t = (nome, fn) => testes.push({ nome, fn });
const igual = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); };

t('num: formatos BR e US', () => {
  igual(L.num('1.093,69'), 1093.69); igual(L.num('- 2.300,62'), -2300.62); igual(L.num('94,825.19'), 94825.19);
  igual(L.num(' R$  67,625.49 '), 67625.49); igual(L.num('9.420,00 D'), -9420); igual(L.num('77.045,49 C'), 77045.49);
  igual(L.num(''), null); igual(L.num('abc'), null);
});
t('data: texto, serial do Excel', () => {
  igual(L.data('02/01/2025'), { a: 2025, m: 1, d: 2 }); igual(L.data(45906), { a: 2025, m: 9, d: 6 });
});
t('conserta acentuação corrompida', () => igual(L.conserta('JoÃ£o'), 'João'));
t('codigo: DP vira DV, casa, ???', () => {
  igual(L.codigo('DP'), 'DV'); igual(L.codigo('Casa'), 'casa'); igual(L.codigo('???'), L.INDEFINIDO); igual(L.codigo('DV (vou cancelar)'), 'DV');
});
t('codigoSecretaria: desconhecidos e caixa trocada', () => {
  igual(L.codigoSecretaria('B', 'S', '???'), ['B', 'DV', 'DESCONHECIDO']);
  igual(L.codigoSecretaria('B', 'E', null), ['B', 'RR', 'NÃO IDENTIFICADO']);
  igual(L.codigoSecretaria('B', 'S', 'TF')[0], 'C');
  igual(L.codigoSecretaria('B', 'S', 'JUST'), null);
  igual(L.codigoSecretaria('C', 'S', 'casa'), ['C', 'VR', 'CASA (a classificar)']);
});
t('novosLancamentos: repetidos no mesmo arquivo valem; entre arquivos, maior contagem', () => {
  const l = (v) => ({ conta: 'X', ano: 2025, mes: 1, dia: 2, texto: 'PIX QRS NITEROI PAR02/01', valor: v, es: 'S' });
  const ja = [l(5)];
  igual(L.novosLancamentos(ja, [l(5), l(5)]).length, 1);
  igual(L.novosLancamentos(ja, [l(5)]).length, 0);
});
t('classificar: regra e aprendido', () => {
  const ap = L.aprender([{ sigla: 'LK', texto: 'PIX QRS NITEROI PAR02/01', tipo: 'VC', caixa: 'B', disc: 'ESTACIONAMENTO' }]);
  igual(L.classificar({ sigla: 'LK', texto: 'PIX QRS NITEROI PAR05/03', es: 'S' }, { aprendido: ap }).tipo, 'VC');
  igual(L.classificar({ sigla: 'XX', texto: 'DA  CLARO RESID 81044250', es: 'S' }).caixa, 'C');
});
t('gerarMes + conferir: banco, justificar, rateio e diferença zero', () => {
  const contas = [{ id: 'CAA', sigla: 'AA', caixa: 'B' }, { id: 'CBB', sigla: 'BB', caixa: 'B' }];
  const pessoas = [{ sigla: 'AA', morador: true }, { sigla: 'BB', morador: true }];
  const lanc = [
    { sigla: 'AA', conta: 'CAA', ano: 2025, mes: 1, dia: 2, es: 'E', valor: 1000, tipo: 'RR', caixa: 'B' },
    { sigla: 'AA', conta: 'CAA', ano: 2025, mes: 1, dia: 3, es: 'S', valor: 100, tipo: 'GO', caixa: 'B' },
    { sigla: 'AA', conta: 'CAA', ano: 2025, mes: 1, dia: 4, es: 'S', valor: 300, tipo: 'AG', caixa: 'C' },
    { sigla: 'AA', conta: 'CAA', ano: 2025, mes: 1, dia: 5, es: 'S', valor: 50, tipo: 'JUST', caixa: 'B', disc: 'aplicação' },
    { sigla: 'BB', conta: 'CBB', ano: 2025, mes: 1, dia: 2, es: 'E', valor: 500, tipo: '???', caixa: 'B' },
  ];
  const g = L.gerarMes({ ano: 2025, mes: 1, lancamentos: lanc, contas, pessoas });
  igual(g.rateio, 300);
  igual(g.justificar.length, 1);
  const c = L.conferir({ ano: 2025, mes: 1, vales: g.vales, bancos: g.bancos, justificar: g.justificar, contas });
  igual(c.diferenca, 0, 'diferença');
  igual(c.C.final, 0, 'caixa C zerado pelo rateio');
});
t('parser Itaú PDF: linhas, saldo do dia e topo ignorado', () => {
  const r = P.itauPdf([[
    'período de visualização: 01/07/2025 até 31/07/2025',
    '05/08/2025 SALDO DO DIA 99.999,99',
    '01/07/2025 REMUNERACAO/SALARIO 25.321,23',
    '01/07/2025 PIX TRANSF FULANO01/07 -100,00',
    '01/07/2025 SALDO DO DIA 92.391,79',
  ]]);
  igual(r.movs.length, 2); igual(r.saldos, { '2025-07-01': 92391.79 });
});
t('parser Nubank CSV', () => {
  const r = P.nubankCsv('Data,Valor,Identificador,Descrição\n02/08/2025,200.00,x,Transferência recebida pelo Pix - MATEUS CAMPOS MARTINS - •••.659.337-•• - BCO\n');
  igual(r.movs[0].valor, 200); igual(r.movs[0].disc, 'PIX de Mateus Campos Martins');
});
t('parser modelo: saldo encadeado', () => {
  const rows = [['Ano', 'Núm', 'Mês', 'Dia', ':Caixa', ':E/S', 'Valor', ':Tipo1', 'Saldo', ':Discriminação', ':Nome', 'obs.'],
    [2025, null, 1, 1, null, null, 1000, null, 1000, 'SALDO INICIAL'],
    [2025, null, 1, 2, 'B', 'E', 500, 'RR', 1500, 'SALÁRIO', 'AA'],
    [2025, null, 1, 3, 'B', 'S', 200, 'GO', 1300, 'GO', 'AA'],
    [2025, null, 1, 31, null, null, null, null, 1300, 'SALDO FINAL']];
  const r = P.modelo(rows, 2025, 1);
  igual(r.abertura, 1000); igual(r.movs.length, 2); igual(r.saldoFinal, 1300);
});
