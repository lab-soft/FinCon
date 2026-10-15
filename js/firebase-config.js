// Configuração web do projeto Firebase "app-fincon" (não é segredo: o acesso é controlado pelo login e pelas regras
// do Firestore em firestore.rules). Enquanto apiKey estiver vazio, o app roda em modo demonstração.
export const firebaseConfig = {
  apiKey: 'AIzaSyCmpxPeCtJKEM8jyrlHvCe3SpIwKZVqwAY',
  authDomain: 'app-fincon.firebaseapp.com',
  projectId: 'app-fincon',
  storageBucket: 'app-fincon.firebasestorage.app',
  messagingSenderId: '579131144570',
  appId: '1:579131144570:web:4f31abc0cba8ae15313ec3',
};
export const configured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
