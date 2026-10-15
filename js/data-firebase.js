// Camada de dados no Firebase: Auth (e-mail/senha) + Firestore. Mesma interface de data-demo.js.
// Coleções: users, config/geral, settings/bootstrap, lancamentos, saldos, vales, justificar, bancos, meses.
// Quem pode ler/gravar o quê está em firestore.rules (residente só vê os próprios lançamentos e saldos).
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword, sendPasswordResetEmail,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs, writeBatch, runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const RESTRITAS = ['lancamentos', 'saldos', 'vales'];      // residente só lê as próprias (campo sigla)

export function createFirebaseApi(config) {
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  let sessao = null;

  async function perfil(u) {
    if (!u) return null;
    const s = await getDoc(doc(db, 'users', u.uid));
    if (!s.exists()) {
      const b = await getDoc(doc(db, 'settings', 'bootstrap'));
      return { uid: u.uid, email: u.email, semPerfil: true, podeSerPrimeiro: !b.exists() };
    }
    return { uid: u.uid, email: u.email, ...s.data() };
  }

  return {
    demo: false,
    auth: {
      onChange(cb) { onAuthStateChanged(auth, async (u) => { sessao = await perfil(u); cb(sessao); }); },
      async entrar(email, senha) { await signInWithEmailAndPassword(auth, email, senha); },
      async sair() { await signOut(auth); },
      async trocarSenha(nova) {
        await updatePassword(auth.currentUser, nova);
        await updateDoc(doc(db, 'users', auth.currentUser.uid), { mustChange: false });
      },
      async recuperar(email) { await sendPasswordResetEmail(auth, email); },
      /** primeiro acesso: o primeiro usuário vira secretaria (uma única vez) */
      async souPrimeiro(sigla) {
        const u = auth.currentUser;
        await runTransaction(db, async (t) => {
          const b = doc(db, 'settings', 'bootstrap');
          if ((await t.get(b)).exists()) throw new Error('O administrador já foi definido.');
          t.set(b, { uid: u.uid, em: new Date().toISOString() });
          t.set(doc(db, 'users', u.uid), { email: u.email, sigla, perfil: 'secretaria' });
        });
        sessao = await perfil(u);
        return sessao;
      },
      async criarConta(email, senha) { await createUserWithEmailAndPassword(auth, email, senha); },
      /** a secretaria cria o login de alguém sem perder a própria sessão (app secundário) */
      async criarUsuario({ email, senha, sigla, perfil: papel }) {
        const sec = initializeApp(config, 'secundario-' + Date.now());
        const a2 = getAuth(sec);
        const cred = await createUserWithEmailAndPassword(a2, email, senha);
        await setDoc(doc(db, 'users', cred.user.uid), { email, sigla, perfil: papel, mustChange: true });
        await signOut(a2);
        return cred.user.uid;
      },
      async listarUsuarios() { return (await getDocs(collection(db, 'users'))).docs.map((d) => ({ uid: d.id, ...d.data() })); },
      async salvarUsuario(uid, dados) { await setDoc(doc(db, 'users', uid), dados, { merge: true }); },
    },
    async config() { const s = await getDoc(doc(db, 'config', 'geral')); return s.exists() ? s.data() : null; },
    async salvarConfig(cfg) { await setDoc(doc(db, 'config', 'geral'), JSON.parse(JSON.stringify(cfg))); },
    async listar(col, f = {}) {
      if (sessao?.perfil !== 'secretaria' && RESTRITAS.includes(col)) f = { ...f, sigla: sessao?.sigla };
      const conds = Object.entries(f).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => where(k, '==', v));
      const snap = await getDocs(query(collection(db, col), ...conds));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async salvar(col, obj) {
      const { id, ...dados } = obj;
      const ref = id ? doc(db, col, id) : doc(collection(db, col));
      await setDoc(ref, limpar(dados));
      return ref.id;
    },
    async salvarVarios(col, objs) {
      const ids = [];
      for (let i = 0; i < objs.length; i += 400) {
        const b = writeBatch(db);
        for (const o of objs.slice(i, i + 400)) {
          const { id, ...dados } = o;
          const ref = id ? doc(db, col, id) : doc(collection(db, col));
          b.set(ref, limpar(dados));
          ids.push(ref.id);
        }
        await b.commit();
      }
      return ids;
    },
    async apagarVarios(col, ids) {
      for (let i = 0; i < ids.length; i += 400) {
        const b = writeBatch(db);
        for (const id of ids.slice(i, i + 400)) b.delete(doc(db, col, id));
        await b.commit();
      }
    },
    async exportar() {
      const res = {};
      for (const col of ['lancamentos', 'saldos', 'vales', 'justificar', 'bancos', 'meses']) {
        res[col] = Object.fromEntries((await getDocs(collection(db, col))).docs.map((d) => [d.id, d.data()]));
      }
      res.config = { geral: (await getDoc(doc(db, 'config', 'geral'))).data() || null };
      return res;
    },
    async importar(colecoes) {
      for (const [col, docs] of Object.entries(colecoes)) {
        if (col === 'config') { if (docs.geral) await setDoc(doc(db, 'config', 'geral'), docs.geral); continue; }
        await this.salvarVarios(col, Object.entries(docs).map(([id, d]) => ({ id, ...d })));
      }
    },
  };
}

// o Firestore não aceita undefined
function limpar(o) { return JSON.parse(JSON.stringify(o)); }
