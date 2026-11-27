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

/* App Check: spento dal 4/11/2026. L'AI dalla foto usa la chiave gratuita di Google AI Studio
   (Altro › Strumenti in più / Aspetto dell'app), che non ha bisogno di App Check né della fatturazione. */
window.NM_APPCHECK = { tipo: 'enterprise', siteKey: '' };

/* Chi fornisce il servizio Kardan: compare in Condizioni d'uso (condizioni.html) e Privacy (privacy.html).
   Finché un dato è vuoto, nelle pagine si legge «da completare». Da riempire all'apertura della partita IVA. */
window.KARDAN_FORNITORE = { nome: '', piva: '', sede: '', email: 'andreatorcini01@gmail.com', pec: '', foro: '' };
/* Versione delle condizioni (AAAA-MM-GG): se cambia, l'amministratore di ogni azienda le riaccetta al primo accesso. */
window.KARDAN_COND_VER = '2026-11-27';
/* true finché i testi non sono stati controllati da un consulente: nelle pagine compare l'avviso «Bozza». */
window.KARDAN_TESTI_BOZZA = true;
