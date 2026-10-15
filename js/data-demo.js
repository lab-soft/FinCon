// Camada de dados de demonstração: tudo no localStorage deste navegador (mesma interface de data-firebase.js).
const CHAVE = 'fincon-demo';

function carregar() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; }
}

export function createDemoApi() {
  let db = carregar() || {
    colecoes: { lancamentos: {}, saldos: {}, vales: {}, justificar: {}, bancos: {}, meses: {}, config: {} },
    usuarios: { demo: { email: 'secretaria@demo', sigla: 'SEC', perfil: 'secretaria' } },
  };
  let sessao = { uid: 'demo', ...db.usuarios.demo };
  const ouvintes = [];
  const gravar = () => { try { localStorage.setItem(CHAVE, JSON.stringify(db)); } catch (e) { alert('Sem espaço no navegador: ' + e.message); } };
  const novoId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const filtra = (obj, f = {}) => Object.entries(obj).map(([id, v]) => ({ id, ...v }))
    .filter((d) => Object.entries(f).every(([k, v]) => v === undefined || v === null || d[k] === v));

  return {
    demo: true,
    auth: {
      onChange(cb) { ouvintes.push(cb); setTimeout(() => cb(sessao), 0); },
      async entrar() { return sessao; },
      async sair() { location.search = ''; },
      async trocarSenha() {},
      async recuperar() {},
      /** só no demo: ver o app como uma pessoa (residente) ou como secretaria */
      async simular(perfil, sigla) {
        sessao = { uid: 'demo', email: `${sigla || 'sec'}@demo`, sigla: sigla || 'SEC', perfil };
        ouvintes.forEach((cb) => cb(sessao));
      },
      async criarUsuario({ email, sigla, perfil }) {
        const id = novoId(); db.usuarios[id] = { email, sigla, perfil }; gravar(); return id;
      },
      async listarUsuarios() { return Object.entries(db.usuarios).map(([uid, u]) => ({ uid, ...u })); },
      async salvarUsuario(uid, dados) { db.usuarios[uid] = { ...db.usuarios[uid], ...dados }; gravar(); },
    },
    async config() { return db.colecoes.config.geral || null; },
    async salvarConfig(cfg) { db.colecoes.config.geral = cfg; gravar(); },
    async listar(col, f = {}) {
      if (sessao.perfil !== 'secretaria' && ['lancamentos', 'saldos', 'vales'].includes(col)) f = { ...f, sigla: sessao.sigla };
      return filtra(db.colecoes[col] || {}, f);
    },
    async salvar(col, obj) {
      const { id = novoId(), ...dados } = obj;
      (db.colecoes[col] ||= {})[id] = dados; gravar(); return id;
    },
    async salvarVarios(col, objs) {
      const ids = [];
      for (const o of objs) { const { id = novoId(), ...dados } = o; (db.colecoes[col] ||= {})[id] = dados; ids.push(id); }
      gravar(); return ids;
    },
    async apagarVarios(col, ids) { for (const id of ids) delete db.colecoes[col]?.[id]; gravar(); },
    async exportar() { return JSON.parse(JSON.stringify(db.colecoes)); },
    async importar(colecoes) { db.colecoes = { ...db.colecoes, ...colecoes }; gravar(); },
    async zerar() { localStorage.removeItem(CHAVE); location.reload(); },
  };
}
