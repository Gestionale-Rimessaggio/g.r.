/* Collegamento al database Firebase di questo sito: i valori si copiano da Firebase › Impostazioni progetto › Le tue app.
   Non sono segreti: servono al sito per sapere a quale progetto collegarsi. La protezione dei dati sta in firestore.rules. */
window.NM_FIREBASE_CONFIG = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: ''
};

/* Chiave pubblica per le notifiche sul telefono (Firebase › Impostazioni progetto › Cloud Messaging ›
   Certificati push web › «Coppia di chiavi»). Non è segreta. Finché è vuota le notifiche restano spente. */
window.NM_VAPID_KEY = '';

/* Chi riceve gli avvisi «chi entra nell'app e cosa fa» (solo un amministratore, mentre ha l'app aperta). Vuoto = nessun avviso. */
window.NM_AVVISI_A = '';

/* Aspetto: qui non c'è, quindi al primo accesso l'amministratore trova la procedura guidata (nome, colori, loghi, luogo, sezioni).
   Si può anche fissare qui, per esempio:
   window.NM_ASPETTO = { nome: 'Cantiere Rossi', colore1: '#1F4D3A', colore2: '#04140D', logo: 'marca/logo.png', scritta: 'marca/scritta.png', luogo: 'Piombino', lat: 42.9256, lon: 10.5253 }; */
