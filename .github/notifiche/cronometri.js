/* Nautica Mare · avviso del cronometro dimenticato acceso
   Gira su GitHub ogni ora (.github/workflows/cronometri.yml). Legge i cronometri accesi (cronometri/{utente}):
   se uno è acceso da più di 9 ore, o dal giorno prima (la stessa regola della Home dell'app),
   manda un avviso sul telefono solo a chi lo usa, una volta per ogni avvio (campo avvisatoPer = inizio).
   Ognuno lo può spegnere da Altro › Notifiche. */
'use strict';

var oraRoma = require('./invia').oraRoma;
var ORE = 9, DALLE = '07:00', ALLE = '22:30';
var STAFF = ['base', 'editor', 'admin'];

function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
function msAcceso(c, now) { var b = c.pausaDa ? Date.parse(c.pausaDa) : now; return Math.max(0, b - Date.parse(c.inizio) - (num(c.pausaMs) || 0)); }
function dimenticato(c, now) {
  if (!c || c._del || !c.inizio || isNaN(Date.parse(c.inizio))) return false;
  return oraRoma(new Date(c.inizio)).oggi < oraRoma(new Date(now)).oggi || msAcceso(c, now) > ORE * 3600000;
}
function daAvvisare(cron, now) { return cron.filter(function (c) { return dimenticato(c, now) && c.avvisatoPer !== c.inizio; }); }

function messaggio(c, barca, now) {
  var a = oraRoma(new Date(c.inizio)), oggi = oraRoma(new Date(now)).oggi, ieri = oraRoma(new Date(now - 864e5)).oggi;
  var quando = (a.oggi === oggi ? 'oggi' : a.oggi === ieri ? 'ieri' : 'il ' + a.oggi.slice(8) + '/' + a.oggi.slice(5, 7)) + ' alle ' + a.ora;
  var dove = barca ? (barca.nome || 'Barca') : 'Lavori di cantiere', ore = Math.floor(msAcceso(c, now) / 3600000);
  return {
    title: 'Cronometro ancora acceso',
    body: dove + (c.titolo ? ' · ' + c.titolo : '') + ': acceso da ' + ore + (ore === 1 ? ' ora' : ' ore') + ' (avviato ' + quando + ').' + (c.pausaDa ? ' È in pausa.' : '') + ' Apri l’app e segna a che ora hai finito.'
  };
}

async function main() {
  var admin = require('firebase-admin');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Manca il segreto FIREBASE_SERVICE_ACCOUNT: avvisi non attivi.'); return; }
  var now = Date.now(), r = oraRoma(new Date(now));
  if (r.ora < DALLE || r.ora > ALLE) { console.log('Fuori orario (' + r.ora + '): niente avvisi.'); return; }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  var db = admin.firestore();
  async function tutti(c) { var s = await db.collection(c).get(), out = []; s.forEach(function (d) { var x = d.data(); if (!x._del) out.push(Object.assign({ id: d.id }, x)); }); return out; }

  var cfgDoc = await db.collection('impostazioni').doc('notifiche').get(), cfg = cfgDoc.exists ? cfgDoc.data() : {};
  if (r.festivo && !cfg.weekend) { console.log('Sabato o domenica: niente avvisi.'); return; }

  var lista = daAvvisare(await tutti('cronometri'), now);
  if (!lista.length) { console.log('Nessun cronometro dimenticato.'); return; }
  var utenti = {}; (await tutti('utenti')).forEach(function (u) { utenti[u.id] = u; });
  var iscr = {}; (await tutti('notifiche')).forEach(function (n) { iscr[n.utente || n.id] = n; });

  var inviati = 0;
  for (var i = 0; i < lista.length; i++) {
    var c = lista[i], uid = c.utente || c.id, u = utenti[uid], n = iscr[uid];
    if (!u || u.stato !== 'attivo' || STAFF.indexOf(u.ruolo) < 0 || !n || n.cronometro === false || !(n.tokens || []).length) { console.log('Cronometro di ' + uid + ': nessun telefono da avvisare.'); continue; }
    var b = null; if (c.barcaId) { var bd = await db.collection('barche').doc(c.barcaId).get(); if (bd.exists) b = bd.data(); }
    var msg = messaggio(c, b, now), tokens = n.tokens.slice(), morti = [], ok = 0;
    var res = await admin.messaging().sendEachForMulticast({ tokens: tokens, data: { title: msg.title, body: msg.body, url: './', tag: 'nm-crono' }, webpush: { headers: { Urgency: 'high', TTL: '7200' } } });
    res.responses.forEach(function (x, k) {
      if (x.success) ok++;
      else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test((x.error && x.error.code) || '')) morti.push(tokens[k]);
      else console.log('Errore su un telefono:', x.error && x.error.code);
    });
    if (morti.length) await db.collection('notifiche').doc(n.id).update({ tokens: tokens.filter(function (t) { return morti.indexOf(t) < 0; }) });
    // segnato anche se nessun telefono l'ha ricevuto: si riprova solo al prossimo avvio
    await db.collection('cronometri').doc(c.id).update({ avvisatoPer: c.inizio });
    inviati += ok;
  }
  console.log('Mandati ' + inviati + ' avvisi per ' + lista.length + ' cronometri dimenticati.');
}

module.exports = { dimenticato: dimenticato, daAvvisare: daAvvisare, messaggio: messaggio };
if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
