// Camada de dados no Firebase: Auth (e-mail/senha) + Firestore. Mesma interface de data-demo.js.
// Vários lugares independentes: cada documento de dados tem o campo "lugar"; a configuração fica em config/{lugar}.
// Coleções: users, lugares, config/{lugar}, settings/bootstrap, lancamentos, saldos, vales, justificar, bancos, meses.
// Quem pode ler/gravar o quê está em firestore.rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export const DADOS = ['lancamentos', 'saldos', 'vales', 'justificar', 'bancos', 'meses'];
const RESTRITAS = ['lancamentos', 'saldos', 'vales'];      // residente só lê as próprias (campo sigla)

export function createFirebaseApi(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  auth.languageCode = 'pt-BR';                         // e-mails do Firebase (definir senha) em português
  const URL_APP = location.origin + location.pathname;  // link de volta ao app depois de definir a senha
  const db = getFirestore(app);
  let sessao = null;
  let lugar = null;                                    // lugar em uso ('*' = todos, só leitura de adm/cr)

  async function perfil(u) {
    if (!u) return null;
    const s = await getDoc(doc(db, 'users', u.uid));
    const b = await getDoc(doc(db, 'settings', 'bootstrap'));
    const fundador = b.exists() && b.data().uid === u.uid;
    if (!s.exists()) return { uid: u.uid, email: u.email, semPerfil: true, podeSerPrimeiro: !b.exists() };
    return { uid: u.uid, email: u.email, ...s.data(), fundador };
  }
  const comLugar = (dados) => (dados.lugar ? dados : { ...dados, lugar });

  return {
    demo: false,
    usarLugar(id) { lugar = id; },
    lugarAtual() { return lugar; },
    auth: {
      onChange(cb) { onAuthStateChanged(auth, async (u) => { sessao = await perfil(u); lugar = sessao?.lugar || lugar; cb(sessao); }); },
      async entrar(email, senha) { await signInWithEmailAndPassword(auth, email, senha); },
      async sair() { await signOut(auth); },
      async trocarSenha(nova) {
        await updatePassword(auth.currentUser, nova);
        await updateDoc(doc(db, 'users', auth.currentUser.uid), { mustChange: false });
      },
      async recuperar(email) { await sendPasswordResetEmail(auth, email, { url: URL_APP }); },
      /** e-mail do Firebase com o link para a pessoa definir (ou redefinir) a senha */
      async enviarDefinicaoSenha(email) { await sendPasswordResetEmail(auth, email, { url: URL_APP }); },
      /** primeiro acesso: o primeiro usuário vira administrador (uma única vez) */
      async souPrimeiro(sigla) {
        const u = auth.currentUser;
        await runTransaction(db, async (t) => {
          const b = doc(db, 'settings', 'bootstrap');
          if ((await t.get(b)).exists()) throw new Error('O administrador já foi definido.');
          t.set(b, { uid: u.uid, em: new Date().toISOString() });
          t.set(doc(db, 'users', u.uid), { email: u.email, sigla, perfil: 'adm' });
        });
        sessao = await perfil(u);
        return sessao;
      },
      /** quem fez o primeiro acesso (settings/bootstrap) passa a administrador — migração da versão de um lugar só */
      async tornarAdm() { await updateDoc(doc(db, 'users', auth.currentUser.uid), { perfil: 'adm', lugar: null }); },
      async criarConta(email, senha) { await createUserWithEmailAndPassword(auth, email, senha); },
      /** cria o login de alguém sem perder a própria sessão (app secundário). Sem senha informada: senha aleatória
       *  e a pessoa define a sua pelo e-mail do Firebase. */
      async criarUsuario({ email, senha, sigla, perfil: papel, lugar: lg }) {
        const sec = initializeApp(config, 'secundario-' + Date.now());
        const a2 = getAuth(sec);
        const provisoria = senha || Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36)).join('');
        const cred = await createUserWithEmailAndPassword(a2, email, provisoria);
        const global = ['adm', 'cr'].includes(papel);
        await setDoc(doc(db, 'users', cred.user.uid), { email, sigla: sigla || '', perfil: papel, lugar: global ? null : (lg || lugar), mustChange: Boolean(senha) });
        await signOut(a2);
        if (!senha) await sendPasswordResetEmail(auth, email, { url: URL_APP });
        return cred.user.uid;
      },
      /** usuários do lugar (cl) ou todos (adm) */
      async listarUsuarios() {
        const q = sessao?.perfil === 'adm' ? collection(db, 'users') : query(collection(db, 'users'), where('lugar', '==', sessao?.lugar || lugar));
        return (await getDocs(q)).docs.map((d) => ({ uid: d.id, ...d.data() }));
      },
      async salvarUsuario(uid, dados) { await setDoc(doc(db, 'users', uid), dados, { merge: true }); },
    },
    // lugares
    async lugares() { return (await getDocs(collection(db, 'lugares'))).docs.map((d) => ({ id: d.id, ...d.data() })); },
    async salvarLugar({ id, ...dados }) { await setDoc(doc(db, 'lugares', id), dados, { merge: true }); },
    // configuração do lugar
    async config(lg = lugar) { if (!lg || lg === '*') return null; const s = await getDoc(doc(db, 'config', lg)); return s.exists() ? s.data() : null; },
    async salvarConfig(cfg, lg = lugar) { await setDoc(doc(db, 'config', lg), limpar(cfg)); },
    async configLegada() { const s = await getDoc(doc(db, 'config', 'geral')); return s.exists() ? s.data() : null; },
    async listar(col, f = {}) {
      if (DADOS.includes(col)) {
        f = { lugar: f.lugar === undefined ? lugar : f.lugar, ...f };
        if (f.lugar === '*') delete f.lugar;               // todos os lugares (adm/cr)
      }
      if (sessao?.perfil === 'residente' && RESTRITAS.includes(col)) f = { ...f, sigla: sessao?.sigla };
      const conds = Object.entries(f).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => where(k, '==', v));
      const snap = await getDocs(query(collection(db, col), ...conds));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    /** todos os documentos da coleção (para a migração; só o administrador consegue) */
    async listarTudo(col) { return (await getDocs(collection(db, col))).docs.map((d) => ({ id: d.id, ...d.data() })); },
    async salvar(col, obj) {
      const { id, ...dados } = obj;
      const ref = id ? doc(db, col, id) : doc(collection(db, col));
      await setDoc(ref, limpar(DADOS.includes(col) ? comLugar(dados) : dados));
      return ref.id;
    },
    async salvarVarios(col, objs) {
      const ids = [];
      const lotes = [];
      for (let i = 0; i < objs.length; i += LOTE) {
        const b = writeBatch(db);
        for (const o of objs.slice(i, i + LOTE)) {
          const { id, ...dados } = o;
          const ref = id ? doc(db, col, id) : doc(collection(db, col));
          b.set(ref, limpar(DADOS.includes(col) ? comLugar(dados) : dados));
          ids.push(ref.id);
        }
        lotes.push(b);
      }
      await emParalelo(lotes.map((b) => () => b.commit()));
      return ids;
    },
    async apagarVarios(col, ids) {
      const lotes = [];
      for (let i = 0; i < ids.length; i += LOTE) {
        const b = writeBatch(db);
        for (const id of ids.slice(i, i + LOTE)) b.delete(doc(db, col, id));
        lotes.push(b);
      }
      await emParalelo(lotes.map((b) => () => b.commit()));
    },
    async exportar() {
      const res = {};
      for (const col of DADOS) res[col] = Object.fromEntries((await this.listar(col, {})).map(({ id, ...d }) => [id, d]));
      res.config = { [lugar]: await this.config() };
      return res;
    },
    async importar(colecoes) {
      for (const [col, docs] of Object.entries(colecoes)) {
        if (col === 'config') { const c = docs[lugar] || docs.geral; if (c) await this.salvarConfig(c); continue; }
        await this.salvarVarios(col, Object.entries(docs).map(([id, d]) => ({ id, ...d, lugar })));
      }
    },
  };
}

// o Firestore não aceita undefined
function limpar(o) { return JSON.parse(JSON.stringify(o)); }

// Lotes pequenos: as regras consultam o perfil (users/uid) a cada documento gravado, e o Firestore limita as
// consultas das regras por requisição (20 em gravações em lote). 5 documentos por lote, 10 lotes ao mesmo tempo.
const LOTE = 5;
async function emParalelo(tarefas, n = 10) {
  for (let i = 0; i < tarefas.length; i += n) await Promise.all(tarefas.slice(i, i + n).map((t) => t()));
}
