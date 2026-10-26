/* Nomina il gestore del servizio (chi approva le aziende e vede i loro report).
   Lo lancia a mano GitHub › Actions › «Gestore del servizio» con l'email di un account già registrato sul sito.
   Solo da qui si può diventare gestore: le regole del database non lo permettono a nessuno dall'app. */
const admin = require('firebase-admin');

(async () => {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.error('Manca il segreto FIREBASE_SERVICE_ACCOUNT.'); process.exit(1); }
  // l'email si legge dalla richiesta di Actions, non da una variabile: i log di GitHub (pubblici) mostrano le variabili
  let ev = {}; try { ev = JSON.parse(require('fs').readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs || {}; } catch (e) { }
  const email = String(ev.email || process.env.EMAIL || '').trim().toLowerCase(), togli = ev.togli === true || ev.togli === 'true' || process.env.TOGLI === '1';
  if (!email) { console.error('Scrivi l’email.'); process.exit(1); }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  const u = await admin.auth().getUserByEmail(email).catch(() => null);
  if (!u) { console.error('Nessun account con questa email: prima registrati sul sito, poi rilancia.'); process.exit(1); }
  const db = admin.firestore(), FV = admin.firestore.FieldValue, now = new Date().toISOString();
  if (togli) {
    await db.collection('creatori').doc(u.uid).delete();
    await db.collection('utenti').doc(u.uid).set({ stato: 'bloccato', modificato: now }, { merge: true });
    console.log('Tolto il ruolo di gestore a ' + email + '.');
    return;
  }
  await db.collection('creatori').doc(u.uid).set({ email: email, il: now }, { merge: true }); // tiene i telefoni iscritti alle notifiche
  await db.collection('utenti').doc(u.uid).set({ nome: u.displayName || email.split('@')[0], email: email, ruolo: 'creatore', stato: 'attivo', tipo: 'staff', azienda: FV.delete(), codice: FV.delete(), modificato: now }, { merge: true });
  console.log(email + ' ora è il gestore del servizio.');
})().catch((e) => { console.error('Non riuscito:', e.code || '', e.message); process.exit(1); });
