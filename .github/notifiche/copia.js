/* Gestionale Rimessaggio · copia automatica dei dati di TUTTE le aziende
   Gira su GitHub ogni domenica notte (.github/workflows/copia.yml). Per ogni azienda scrive un file .json nello
   stesso formato di Altro › Copia dei dati (l'amministratore dell'azienda lo recupera con «Recupera ciò che
   manca»); in più un file «servizio» con le raccolte comuni (aziende, profili, codici, gestore). Le foto no.
   Il workflow chiude tutto con la password COPIA_PASSWORD (7-Zip): il repository è pubblico, il file in chiaro
   non esce mai. La copia completa è scritta nell'informativa privacy che le aziende accettano. */
'use strict';

var fs = require('fs');
var SENZA = ['foto']; // pesanti e già fuori dalla copia dell'app

function semplice(v) {
  if (v === null || typeof v !== 'object') return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v.latitude === 'number' && typeof v.longitude === 'number' && Object.keys(v).length <= 2) return { lat: v.latitude, lon: v.longitude };
  if (typeof v.path === 'string' && typeof v.id === 'string' && v.firestore) return v.path;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (Array.isArray(v)) return v.map(semplice);
  var o = {}; Object.keys(v).forEach(function (k) { o[k] = semplice(v[k]); }); return o;
}

// le raccolte di un'azienda, nel formato dell'app
async function azienda(ref) {
  var cols = (await ref.listCollections()).map(function (c) { return c.id; }).filter(function (n) { return SENZA.indexOf(n) < 0; }).sort();
  var coll = {}, conteggi = {}, tot = 0;
  for (var i = 0; i < cols.length; i++) {
    var snap = await ref.collection(cols[i]).get(), m = {}, n = 0;
    snap.forEach(function (d) { if (cols[i] === 'impostazioni' && d.id === 'backup') return; m[d.id] = semplice(d.data()); n++; });
    coll[cols[i]] = m; conteggi[cols[i]] = n; tot += n;
  }
  return { coll: coll, conteggi: conteggi, tot: tot };
}

// raccolte comuni, con le sottoraccolte (es. servizio/avvisi/lista), per percorso
async function comuni(db) {
  var out = {}, tot = 0;
  async function giro(col) {
    var snap = await col.get();
    for (var i = 0; i < snap.docs.length; i++) {
      var d = snap.docs[i]; out[d.ref.path] = semplice(d.data()); tot++;
      var subs = await d.ref.listCollections();
      for (var j = 0; j < subs.length; j++) await giro(subs[j]);
    }
    // documenti «vuoti» che hanno solo sottoraccolte (servizio/avvisi …)
    var refs = await col.listDocuments();
    for (var k = 0; k < refs.length; k++) {
      if (out[refs[k].path] !== undefined) continue;
      var s2 = await refs[k].listCollections();
      for (var q = 0; q < s2.length; q++) await giro(s2[q]);
    }
  }
  var roots = await db.listCollections();
  for (var r = 0; r < roots.length; r++) {
    if (roots[r].id === 'aziende') { var a = await roots[r].get(); a.forEach(function (d) { out[d.ref.path] = semplice(d.data()); tot++; }); continue; }
    if (SENZA.indexOf(roots[r].id) >= 0) continue;
    await giro(roots[r]);
  }
  return { doc: out, tot: tot };
}

function pulito(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9-]+/g, '') || 'azienda'; }

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error('Manca il segreto FIREBASE_SERVICE_ACCOUNT.');
  var dir = process.argv[2] || '.';
  var admin = require('firebase-admin');
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  var db = admin.firestore(), now = new Date(), giorno = now.toISOString().slice(0, 10), totale = 0;
  // anche le aziende che esistono solo come cartella (senza documento)
  var refs = await db.collection('aziende').listDocuments();
  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i], info = await ref.get(), nome = info.exists ? (info.data().nome || '') : '';
    var r = await azienda(ref);
    if (!r.tot && !info.exists) continue;
    var file = { app: 'Gestionale cantiere', tipo: 'Copia dei dati', formato: 1, creata: now.toISOString(), creataDa: 'Copia automatica', azienda: { id: ref.id, nome: nome }, voci: r.tot, conteggi: r.conteggi, collezioni: r.coll };
    fs.writeFileSync(dir + '/' + pulito(nome) + '-' + ref.id + '-copia-' + giorno + '.json', JSON.stringify(file, null, 1));
    // l'app mostra la data dell'ultima copia automatica in Altro › Copia dei dati
    await ref.collection('impostazioni').doc('backup').set({ auto: { ultima: now.toISOString(), voci: r.tot } }, { merge: true });
    totale += r.tot;
    console.log('Azienda ' + ref.id + ': ' + r.tot + ' voci.');
  }
  var c = await comuni(db);
  fs.writeFileSync(dir + '/servizio-copia-' + giorno + '.json', JSON.stringify({ app: 'Gestionale cantiere', tipo: 'Copia del servizio', formato: 1, creata: now.toISOString(), voci: c.tot, documenti: c.doc }, null, 1));
  console.log('Copia pronta: ' + refs.length + ' aziende, ' + totale + ' voci delle aziende, ' + c.tot + ' documenti comuni.');
}

module.exports = { semplice: semplice, pulito: pulito };
if (require.main === module) main().catch(function (e) { console.error(e && e.message ? e.message : e); process.exit(1); });
