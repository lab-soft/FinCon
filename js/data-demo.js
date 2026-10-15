// Camada de dados de demonstração: tudo no localStorage deste navegador (mesma interface de data-firebase.js).
const CHAVE = 'fincon-demo';
export const DADOS = ['lancamentos', 'saldos', 'vales', 'justificar', 'bancos', 'meses'];

function carregar() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; }
}

export function createDemoApi() {
  let db = carregar() || {
    colecoes: { lancamentos: {}, saldos: {}, vales: {}, justificar: {}, bancos: {}, meses: {}, config: {}, lugares: {} },
    usuarios: { demo: { email: 'adm@demo', sigla: 'ADM', perfil: 'adm', lugar: null } },
  };
  db.colecoes.lugares ||= {};
  // demo da versão de um lugar só: o usuário de teste vira administrador (para testar a migração)
  if (db.usuarios.demo && !db.usuarios.demo.lugar && db.usuarios.demo.perfil !== 'adm') db.usuarios.demo = { ...db.usuarios.demo, perfil: 'adm', sigla: 'ADM', lugar: null };
  let sessao = { uid: 'demo', ...db.usuarios.demo };
  let lugar = localStorage.getItem('fincon-lugar') || Object.keys(db.colecoes.lugares)[0] || null;
  const ouvintes = [];
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (e) { alert('Sem espaço no navegador: ' + e.message); } };
  const novoId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const filtra = (obj, f = {}) => Object.entries(obj).map(([id, v]) => ({ id, ...v }))
    .filter((d) => Object.entries(f).every(([k, v]) => v === undefined || v === null || d[k] === v));
  const comLugar = (col, d) => (DADOS.includes(col) && !d.lugar ? { ...d, lugar } : d);

  return {
    demo: true,
    usarLugar(id) { lugar = id; },
    lugarAtual() { return lugar; },
    auth: {
      onChange(cb) { ouvintes.push(cb); setTimeout(() => cb(sessao), 0); },
      async entrar() { return sessao; },
      async sair() { location.search = ''; },
      async trocarSenha() {},
      async recuperar() {},
      async enviarDefinicaoSenha() {},
      /** só no demo: ver o app com outro perfil */
      async simular(perfil, sigla, lg) {
        sessao = { uid: 'demo', email: `${sigla || perfil}@demo`, sigla: ['cr', 'adm'].includes(perfil) ? '' : (sigla || ''), perfil,
          lugar: ['cr', 'adm'].includes(perfil) ? null : (lg || lugar) };
        if (sessao.lugar) lugar = sessao.lugar;
        ouvintes.forEach((cb) => cb(sessao));
      },
      async tornarAdm() {},
      async criarUsuario({ email, sigla, perfil, lugar: lg }) {
        const id = novoId(); db.usuarios[id] = { email, sigla: sigla || '', perfil, lugar: ['cr', 'adm'].includes(perfil) ? null : (lg || lugar) }; gravar(); return id;
      },
      async listarUsuarios() {
        const todos = Object.entries(db.usuarios).map(([uid, u]) => ({ uid, ...u }));
        return sessao.perfil === 'adm' ? todos : todos.filter((u) => u.lugar === sessao.lugar);
      },
      async salvarUsuario(uid, dados) { db.usuarios[uid] = { ...db.usuarios[uid], ...dados }; gravar(); },
    },
    async lugares() { return Object.entries(db.colecoes.lugares).map(([id, l]) => ({ id, ...l })); },
    async salvarLugar({ id, ...dados }) { db.colecoes.lugares[id] = { ...(db.colecoes.lugares[id] || {}), ...dados }; gravar(); },
    async config(lg = lugar) { return lg && lg !== '*' ? db.colecoes.config[lg] || null : null; },
    async salvarConfig(cfg, lg = lugar) { db.colecoes.config[lg] = cfg; gravar(); },
    async configLegada() { return db.colecoes.config.geral || null; },
    async listar(col, f = {}) {
      if (DADOS.includes(col)) { f = { lugar: f.lugar === undefined ? lugar : f.lugar, ...f }; if (f.lugar === '*') delete f.lugar; }
      if (sessao.perfil === 'residente' && ['lancamentos', 'saldos', 'vales'].includes(col)) f = { ...f, sigla: sessao.sigla };
      if (sessao.perfil === 'cr' && ['lancamentos', 'saldos'].includes(col)) return [];
      return filtra(db.colecoes[col] || {}, f);
    },
    async listarTudo(col) { return filtra(db.colecoes[col] || {}); },
    async salvar(col, obj) {
      const { id = novoId(), ...dados } = obj;
      (db.colecoes[col] ||= {})[id] = comLugar(col, dados); gravar(); return id;
    },
    async salvarVarios(col, objs) {
      const ids = [];
      for (const o of objs) { const { id = novoId(), ...dados } = o; (db.colecoes[col] ||= {})[id] = comLugar(col, dados); ids.push(id); }
      gravar(); return ids;
    },
    async apagarVarios(col, ids) { for (const id of ids) delete db.colecoes[col]?.[id]; gravar(); },
    async exportar() {
      const res = {};
      for (const col of DADOS) res[col] = Object.fromEntries((await this.listar(col, {})).map(({ id, ...d }) => [id, d]));
      res.config = { [lugar]: db.colecoes.config[lugar] || null };
      return res;
    },
    async importar(colecoes) {
      for (const [col, docs] of Object.entries(colecoes)) {
        if (col === 'config') { const c = docs[lugar] || docs.geral; if (c) db.colecoes.config[lugar] = c; continue; }
        for (const [id, d] of Object.entries(docs)) (db.colecoes[col] ||= {})[id] = { ...d, lugar };
      }
      gravar();
    },
    async zerar() { localStorage.removeItem(CHAVE); localStorage.removeItem('fincon-lugar'); location.reload(); },
  };
}
