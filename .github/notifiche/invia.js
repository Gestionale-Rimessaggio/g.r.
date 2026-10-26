/* Nautica Mare · riepilogo del mattino sul telefono
   Gira su GitHub (.github/workflows/notifiche.yml). Legge da Firestore le regole (impostazioni/notifiche),
   chi è iscritto (notifiche/{utente}) e le scadenze, poi manda un solo avviso a testa con Firebase Cloud Messaging.
   Le regole si cambiano dall'app: Altro › Notifiche. */
'use strict';

var DEF = { ora: '07:30', chi: 'tutti', avvisi: 'settimana', preavviso: 30, ripetiScadute: true, sogliaOre: 20, cantiere: true, weekend: false };
var STAFF = ['base', 'editor', 'admin'];

function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : null; }
function giorni(da, a) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(da + 'T00:00:00Z')) / 864e5); }
function oraRoma(d) {
  var p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
    .formatToParts(d).forEach(function (x) { p[x.type] = x.value; });
  return { oggi: p.year + '-' + p.month + '-' + p.day, ora: (p.hour === '24' ? '00' : p.hour) + ':' + p.minute, festivo: p.weekday === 'Sat' || p.weekday === 'Sun' };
}
function quando(d) { return d < 0 ? 'scaduta da ' + (-d) + (d === -1 ? ' giorno' : ' giorni') : d === 0 ? 'scade oggi' : d === 1 ? 'scade domani' : 'tra ' + d + ' giorni'; }

// Quali scadenze vanno nell'avviso di oggi.
// avvisate: id → ultimo giorno in cui è stata avvisata (serve per «una volta a settimana» e per le ore motore)
function scegli(cfg, oggi, scadenze, scadC, barche, avvisate) {
  var out = [], nuove = {};
  function ripeti(id, d) { // dentro il preavviso: vale la regola scelta
    var last = avvisate[id];
    if (cfg.avvisi === 'ogni') return true;
    if (cfg.avvisi === 'tre') return d === 1 || d === 0 || !last;
    return !last || giorni(last, oggi) >= 7 || d === 0; // una a settimana, e il giorno stesso
  }
  function valuta(id, data, preS, oreLeft) {
    var pre = num(preS) != null ? num(preS) : cfg.preavviso, d = data ? giorni(oggi, data) : null, testo = null, late = false;
    if (d != null && d < 0) { if (cfg.ripetiScadute || !avvisate[id]) { testo = quando(d); late = true; } else nuove[id] = avvisate[id]; }
    else if (d != null && d <= pre) { if (ripeti(id, d)) testo = quando(d); else nuove[id] = avvisate[id]; }
    else if (oreLeft != null && oreLeft <= cfg.sogliaOre) {
      if (oreLeft <= 0 ? (cfg.ripetiScadute || !avvisate[id]) : ripeti(id, null)) { testo = oreLeft <= 0 ? 'ore motore superate' : 'mancano ' + oreLeft + ' h motore'; late = oreLeft <= 0; }
      else nuove[id] = avvisate[id];
    }
    if (testo != null) nuove[id] = oggi;
    return testo == null ? null : { testo: testo, late: late, d: d == null ? 0 : d };
  }
  scadenze.forEach(function (s) {
    if (s.fatta) return;
    var b = barche[s.barcaId] || {}, oreS = num(s.oreScadenza), ore = num(b.oreMotore);
    var v = valuta(s.id, s.data, s.preavviso, oreS != null && ore != null ? oreS - ore : null);
    if (v) out.push({ late: v.late, t: (b.nome || 'Barca') + ' · ' + (s.tipo || 'scadenza') + ': ' + v.testo, d: v.d });
  });
  if (cfg.cantiere) scadC.forEach(function (s) {
    if (s.fatta) return;
    var v = valuta('c:' + s.id, s.data, s.preavviso, null);
    if (v) out.push({ late: v.late, t: (s.rif || 'Cantiere') + ' · ' + (s.tipo || 'scadenza') + ': ' + v.testo, d: v.d });
  });
  out.sort(function (a, b) { return a.d - b.d; });
  return { voci: out, avvisate: nuove };
}

// il nome dell'azienda: quello scelto nell'app (impostazioni/aspetto), altrimenti quello di config.js
var NOME = (function () { try { var m = require('fs').readFileSync(require('path').join(__dirname, '../../config.js'), 'utf8').match(/NM_ASPETTO\s*=\s*\{[^}]*nome:\s*'([^']+)'/); return m ? m[1] : 'Gestionale cantiere'; } catch (e) { return 'Gestionale cantiere'; } })();

function messaggio(voci) {
  var late = voci.filter(function (v) { return v.late; }).length;
  var title = NOME + ' · ' + voci.length + (voci.length === 1 ? ' scadenza' : ' scadenze') + (late ? ' (' + late + (late === 1 ? ' superata)' : ' superate)') : '');
  var righe = voci.slice(0, 4).map(function (v) { return v.t; });
  if (voci.length > 4) righe.push('e altre ' + (voci.length - 4) + ' nell’app');
  return { title: title, body: righe.join('\n') };
}

async function main() {
  var admin = require('firebase-admin');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Manca il segreto FIREBASE_SERVICE_ACCOUNT: notifiche non attive.'); return; }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  var db = admin.firestore(), prova = process.env.PROVA === '1';
  async function tutti(c) { var s = await db.collection(c).get(), out = []; s.forEach(function (d) { var x = d.data(); if (!x._del) out.push(Object.assign({ id: d.id }, x)); }); return out; }

  var asp = await db.collection('impostazioni').doc('aspetto').get();
  if (asp.exists && !asp.data()._del && asp.data().nome) NOME = String(asp.data().nome).slice(0, 60);
  var cfgRef = db.collection('impostazioni').doc('notifiche'), cfgDoc = await cfgRef.get(), cfgRaw = cfgDoc.exists && !cfgDoc.data()._del ? cfgDoc.data() : {};
  var cfg = Object.assign({}, DEF, cfgRaw), now = oraRoma(new Date());
  if (!prova) {
    if (cfgRaw.ultimoInvio === now.oggi) { console.log('Già mandato oggi.'); return; }
    if (now.ora < cfg.ora) { console.log('Non è ancora l’ora (' + now.ora + ' < ' + cfg.ora + ').'); return; }
    if (!cfg.weekend && now.festivo) { console.log('Sabato o domenica: niente avvisi.'); return; }
  }

  var utenti = {}; (await tutti('utenti')).forEach(function (u) { utenti[u.id] = u; });
  var iscritti = (await tutti('notifiche')).filter(function (n) {
    var u = utenti[n.utente || n.id];
    return u && u.stato === 'attivo' && STAFF.indexOf(u.ruolo) >= 0 && (n.tokens || []).length;
  });
  var solo = String(process.env.SOLO_EMAIL || '').trim().toLowerCase();
  if (solo) iscritti = iscritti.filter(function (n) { return String((utenti[n.utente || n.id] || {}).email || '').toLowerCase() === solo; });
  if (!iscritti.length) { console.log(solo ? 'Nessun telefono iscritto per ' + solo + '.' : 'Nessun telefono iscritto.'); }

  var msg, dest;
  if (prova) {
    msg = { title: NOME + ' · prova', body: 'Le notifiche funzionano su questo telefono.' };
    dest = iscritti;
  } else {
    var barche = {}; (await tutti('barche')).forEach(function (b) { barche[b.id] = b; });
    var r = scegli(cfg, now.oggi, await tutti('scadenze'), cfg.cantiere ? await tutti('scadCantiere') : [], barche, cfgRaw.avvisate || {});
    await cfgRef.set({ ultimoInvio: now.oggi, avvisate: r.avvisate }, { merge: true });
    if (!r.voci.length) { console.log('Nessuna scadenza da avvisare oggi.'); return; }
    msg = messaggio(r.voci);
    dest = iscritti.filter(function (n) { var u = utenti[n.utente || n.id]; return n.scadenze !== false && (cfg.chi !== 'admin' || u.ruolo === 'admin'); });
  }

  var inviati = 0;
  for (var i = 0; i < dest.length; i++) {
    var n = dest[i], tokens = n.tokens.slice();
    var res = await admin.messaging().sendEachForMulticast({ tokens: tokens, data: { title: msg.title, body: msg.body, url: './', tag: 'nm-riepilogo' }, webpush: { headers: { Urgency: 'high', TTL: '43200' } } });
    var morti = [];
    res.responses.forEach(function (x, k) {
      if (x.success) inviati++;
      else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test((x.error && x.error.code) || '')) morti.push(tokens[k]);
      else console.log('Errore su un telefono:', x.error && x.error.code);
    });
    if (morti.length) await db.collection('notifiche').doc(n.id).update({ tokens: tokens.filter(function (t) { return morti.indexOf(t) < 0; }) });
  }
  console.log('Mandate ' + inviati + ' notifiche a ' + dest.length + ' persone.');
}

module.exports = { scegli: scegli, messaggio: messaggio, oraRoma: oraRoma };
if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
