/* Collegamento al database Firebase di questo sito: i valori si copiano da Firebase › Impostazioni progetto › Le tue app.
   Non sono segreti: servono al sito per sapere a quale progetto collegarsi. La protezione dei dati sta in firestore.rules. */
window.NM_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC0lYTnGK2jQs6_agSkExWnKRnfmn8k2Ow',
  authDomain: 'gestionale-rimessaggio.firebaseapp.com',
  projectId: 'gestionale-rimessaggio',
  storageBucket: 'gestionale-rimessaggio.firebasestorage.app',
  messagingSenderId: '265979005250',
  appId: '1:265979005250:web:eb55d6f22799e51d2ae0db'
};

/* Chiave pubblica per le notifiche sul telefono (Firebase › Impostazioni progetto › Cloud Messaging ›
   Certificati push web › «Coppia di chiavi»). Non è segreta. Finché è vuota le notifiche restano spente. */
window.NM_VAPID_KEY = 'BGC2dNeHBs4rKq1EUNzQvNR6LBWAKa8qKLgT550dmyj4r8CjjQ_hRWBVPpDttCq3Zte1p4VUWUC1xuh0ZYJnENo';

/* Chi riceve gli avvisi «chi entra nell'app e cosa fa» (solo un amministratore, mentre ha l'app aperta). Vuoto = nessun avviso. */
window.NM_AVVISI_A = '';

/* Aspetto: qui non c'è, quindi al primo accesso l'amministratore trova la procedura guidata (nome, colori, loghi, luogo, sezioni).
   Si può anche fissare qui, per esempio:
   window.NM_ASPETTO = { nome: 'Cantiere Rossi', colore1: '#1F4D3A', colore2: '#04140D', logo: 'marca/logo.png', scritta: 'marca/scritta.png', luogo: 'Piombino', lat: 42.9256, lon: 10.5253 }; */

/* App Check (obbligatorio per l'AI dal 2 novembre 2026): chiave del sito reCAPTCHA registrata in
   Firebase › App Check › App › app web. tipo: 'v3' (reCAPTCHA v3) oppure 'enterprise'.
   Non è segreta. Finché è vuota l'app non manda il gettone e, dal 2/11, l'AI dalla foto non risponde. */
window.NM_APPCHECK = { tipo: 'enterprise', siteKey: '6LfNKgIuAAAAAE9ymahD2tzNXOmKYVW6T5UBV2mR' };
