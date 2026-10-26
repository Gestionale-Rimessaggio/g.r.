/* Gestore del servizio · avvisi e consumi
   Gli avvisi per il gestore stanno in servizio/avvisi/lista/{id} (li vede il Pannello del gestore) e arrivano anche
   sul suo telefono, se ha acceso le notifiche dal pannello (creatori/{uid}.tokens). Senza telefono iscritto
   diventano una segnalazione (issue) nel repository GitHub, che gli arriva per email.
   - ogni ora (cronometri.yml › node gestore.js): richieste di aziende nuove ed errori ripetuti;
   - ogni mattina (invia.js › consumi): i consumi del giorno prima, solo numeri contati davvero, in servizio/consumi/giorni/{giorno}. */
'use strict';

var oraRoma = function (d) { return require('./invia').oraRoma(d); };
var COLLS = ['barche', 'lavori', 'scadenze', 'dipendenti', 'conferme', 'impostazioni', 'magazzino', 'movimenti', 'vari', 'modelli',
  'checkBarca', 'checklist', 'opModelli', 'operazioni', 'mezzi', 'attrezzatura', 'programma', 'cariche', 'posti', 'richieste',
  'rifiuti', 'ritiri', 'scadCantiere', 'preventivi', 'assenze', 'kit', 'inventari', 'giri', 'cronometri', 'ditte', 'pin', 'controlliMezzi', 'foto', 'fotoInfo', 'notifiche', 'attivita', 'cestino', 'portale'];
var ERRORI_SOGLIA = 5, INATTIVA_GG = 30;

// mezzanotte di Roma del giorno «g» (AAAA-MM-GG), in ISO
function mezzanotte(g) {
  var t = Date.parse(g + 'T12:00:00Z'), r = oraRoma(new Date(t)), off = parseInt(r.ora, 10) - 12; // +1 d'inverno, +2 d'estate
  return new Date(Date.parse(g + 'T00:00:00Z') - off * 3600000).toISOString();
}
function giornoPrima(g) { return new Date(Date.parse(g + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10); }

async function alGitHub(titolo, testo) {
  var tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!tok || !repo) { console.log('Avviso al gestore (senza GitHub):', titolo); return; }
  var r = await fetch('https://api.github.com/repos/' + repo + '/issues', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: titolo, body: testo }) });
  console.log('Segnalazione su GitHub:', titolo, r.status);
}

// un avviso al gestore: nel pannello sempre, sul telefono se iscritto, altrimenti su GitHub
async function avvisa(admin, root, a) {
  var now = new Date().toISOString();
  await root.collection('servizio').doc('avvisi').collection('lista').add({ tipo: a.tipo, azienda: a.azienda || '', nome: a.nome || '', titolo: a.titolo, testo: a.testo || '', il: now, letto: false });
  var cr = await root.collection('creatori').get(), inviati = 0;
  for (var i = 0; i < cr.docs.length; i++) {
    var d = cr.docs[i], tokens = (d.data().tokens || []).slice(); if (!tokens.length) continue;
    var res = await admin.messaging().sendEachForMulticast({ tokens: tokens, data: { title: a.titolo, body: a.testo || '', url: './', tag: 'gr-gestore-' + a.tipo }, webpush: { headers: { Urgency: 'high', TTL: '43200' } } });
    var morti = [];
    res.responses.forEach(function (x, k) { if (x.success) inviati++; else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test((x.error && x.error.code) || '')) morti.push(tokens[k]); });
    if (morti.length) await d.ref.update({ tokens: tokens.filter(function (t) { return morti.indexOf(t) < 0; }) });
  }
  if (!inviati) await alGitHub(a.titolo, (a.testo || '') + '\n\nLo trovi anche nel Pannello del gestore › Avvisi. Per riceverlo sul telefono: Pannello del gestore › Notifiche su questo telefono.');
  console.log('Avviso al gestore: ' + a.titolo + ' (' + inviati + ' telefoni)');
}

// Consumi del giorno prima, una volta al giorno: tutti numeri contati (foto e documenti contati uno per uno, accessi dal registro)
// più letture e scritture di Firestore prese da Google Cloud Monitoring, se il service account ha il permesso.
async function consumi(admin, root, oggi) {
  var cRef = root.collection('servizio').doc('consumi'), cDoc = await cRef.get();
  if (cDoc.exists && cDoc.data().ultimo === oggi) return;
  var ieri = giornoPrima(oggi), da = mezzanotte(ieri), a = mezzanotte(oggi), out = { giorno: ieri, il: new Date().toISOString(), aziende: {}, tot: { fotoMb: 0, docs: 0, accessi: 0, persone: 0, errori: 0 } };
  var az = await root.collection('aziende').get();
  for (var i = 0; i < az.docs.length; i++) {
    var A = az.docs[i], x = A.data(); if (x.stato !== 'attiva') continue;
    var kb = 0; (await A.ref.collection('fotoInfo').get()).forEach(function (d) { kb += d.data().kb || 0; });
    var docs = 0; for (var c = 0; c < COLLS.length; c++) { try { docs += (await A.ref.collection(COLLS[c]).count().get()).data().count; } catch (e) { } }
    var att = await A.ref.collection('attivita').where('il', '>=', da).where('il', '<', a).get(), chi = {}, acc = 0, err = 0;
    att.forEach(function (d) { var y = d.data(), t = String(y.cosa || ''); if (/^è entrato/.test(t)) { acc++; chi[y.uid] = 1; } if (t.indexOf('⚠') === 0) err++; });
    var r = { nome: x.nome || A.id, fotoMb: Math.round(kb / 1024 * 10) / 10, docs: docs, accessi: acc, persone: Object.keys(chi).length, errori: err };
    out.aziende[A.id] = r; ['fotoMb', 'docs', 'accessi', 'persone', 'errori'].forEach(function (k) { out.tot[k] += r[k]; });
    // senza accessi da 30 giorni: un avviso, una volta sola finché qualcuno non rientra
    var ultimo = await A.ref.collection('attivita').orderBy('il', 'desc').limit(1).get(), uIl = ultimo.empty ? (x.approvata || x.creato || '') : ultimo.docs[0].data().il;
    var ferma = uIl && Date.now() - Date.parse(uIl) > INATTIVA_GG * 864e5;
    if (ferma && !x.avvisoInattiva) { await A.ref.update({ avvisoInattiva: oggi }); await avvisa(admin, root, { tipo: 'inattiva', azienda: A.id, nome: r.nome, titolo: r.nome + ': nessun accesso da ' + INATTIVA_GG + ' giorni', testo: 'L’ultimo accesso è del ' + String(uIl).slice(0, 10) + '. Forse non usano più il gestionale.' }); }
    else if (!ferma && x.avvisoInattiva) await A.ref.update({ avvisoInattiva: admin.firestore.FieldValue.delete() });
  }
  out.tot.fotoMb = Math.round(out.tot.fotoMb * 10) / 10;
  out.firestore = await monitoring(admin, da, a);
  await cRef.collection('giorni').doc(ieri).set(out);
  await cRef.set({ ultimo: oggi, giorno: ieri }, { merge: true });
  console.log('Consumi del ' + ieri + ': ' + JSON.stringify(out.tot) + ' · Firestore ' + JSON.stringify(out.firestore));
}

// letture, scritture e cancellazioni del giorno su tutto il database (i numeri della console di Firebase)
async function monitoring(admin, da, a) {
  try {
    var sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT), tok = (await admin.credential.cert(sa).getAccessToken()).access_token, out = {};
    var tipi = { letture: ['document/read_ops_count', 'document/read_count'], scritture: ['document/write_ops_count', 'document/write_count'], cancellazioni: ['document/delete_ops_count', 'document/delete_count'] };
    for (var k in tipi) {
      for (var j = 0; j < tipi[k].length && out[k] == null; j++) {
        var q = 'filter=' + encodeURIComponent('metric.type="firestore.googleapis.com/' + tipi[k][j] + '"') + '&interval.startTime=' + encodeURIComponent(da) + '&interval.endTime=' + encodeURIComponent(a) +
          '&aggregation.alignmentPeriod=86400s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM';
        var r = await fetch('https://monitoring.googleapis.com/v3/projects/' + sa.project_id + '/timeSeries?' + q, { headers: { Authorization: 'Bearer ' + tok } });
        if (r.status === 403) return { errore: 'permesso' };
        if (!r.ok) continue;
        var js = await r.json(), n = 0, ok = false;
        (js.timeSeries || []).forEach(function (s) { (s.points || []).forEach(function (p) { ok = true; n += Number(p.value.int64Value || p.value.doubleValue || 0); }); });
        if (ok) out[k] = n;
      }
    }
    return out;
  } catch (e) { console.log('Monitoring non letto:', e.message); return { errore: 'lettura' }; }
}

// Ogni ora: aziende nuove in attesa ed errori ripetuti (oltre 5 nelle ultime 24 ore, un avviso al giorno per azienda)
async function main() {
  var admin = require('firebase-admin');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Manca il segreto FIREBASE_SERVICE_ACCOUNT.'); return; }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  var root = admin.firestore(), az = await root.collection('aziende').get(), oggi = oraRoma(new Date()).oggi;
  for (var i = 0; i < az.docs.length; i++) {
    var A = az.docs[i], x = A.data(), nome = x.nome || A.id;
    if (x.stato === 'in_attesa' && !x.avvisatoGestore) {
      await A.ref.update({ avvisatoGestore: new Date().toISOString() });
      await avvisa(admin, root, { tipo: 'richiesta', azienda: A.id, nome: nome, titolo: 'Nuova azienda da approvare: ' + nome, testo: (x.adminNome || '') + ' · ' + (x.email || '') + (x.telefono ? ' · tel. ' + x.telefono : '') });
    }
    if (x.stato === 'attiva' && x.avvisoErrori !== oggi) {
      var s = await A.ref.collection('attivita').where('il', '>=', new Date(Date.now() - 864e5).toISOString()).get(), n = 0;
      s.forEach(function (d) { if (String(d.data().cosa || '').indexOf('⚠') === 0) n++; });
      if (n >= ERRORI_SOGLIA) { await A.ref.update({ avvisoErrori: oggi }); await avvisa(admin, root, { tipo: 'errori', azienda: A.id, nome: nome, titolo: nome + ': ' + n + ' errori nelle ultime 24 ore', testo: 'Apri il report dell’azienda nel Pannello del gestore per vedere quali.' }); }
    }
  }
}

module.exports = { avvisa: avvisa, consumi: consumi, mezzanotte: mezzanotte };
if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
