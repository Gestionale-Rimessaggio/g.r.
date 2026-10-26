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
var NOME0 = (function () { try { var m = require('fs').readFileSync(require('path').join(__dirname, '../../config.js'), 'utf8').match(/NM_ASPETTO\s*=\s*\{[^}]*nome:\s*'([^']+)'/); return m ? m[1] : 'Gestionale cantiere'; } catch (e) { return 'Gestionale cantiere'; } })();

function messaggio0(voci) {
  var late = voci.filter(function (v) { return v.late; }).length;
  var title = NOME0 + ' · ' + voci.length + (voci.length === 1 ? ' scadenza' : ' scadenze') + (late ? ' (' + late + (late === 1 ? ' superata)' : ' superate)') : '');
  var righe = voci.slice(0, 4).map(function (v) { return v.t; });
  if (voci.length > 4) righe.push('e altre ' + (voci.length - 4) + ' nell’app');
  return { title: title, body: righe.join('\n') };
}

// Spazio: le foto di ogni azienda (fotoInfo.kb) rispetto alla sua quota (aziende/{az}.quotaMb, la decide il gestore; 100 MB se non scritta),
// e di tutte insieme rispetto al GB del piano gratuito. Si avvisa salendo all'80% e al 95%, una volta per livello, una misura al giorno.
var QUOTA0 = 100, SERVIZIO_MB = 1024;
function livello(pct) { return pct >= 95 ? 95 : pct >= 80 ? 80 : 0; }

// Il gestore riceve sempre gli avvisi sullo spazio: come segnalazione (issue) nel repository GitHub, che gli arriva per email e nell'app GitHub.
async function alGestore(titolo, testo) {
  var tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!tok || !repo) { console.log('Avviso al gestore (senza GitHub):', titolo); return; }
  var r = await fetch('https://api.github.com/repos/' + repo + '/issues', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: titolo, body: testo }) });
  console.log('Avviso al gestore:', titolo, r.status);
}

async function main() {
  var admin = require('firebase-admin');
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) { console.log('Manca il segreto FIREBASE_SERVICE_ACCOUNT: notifiche non attive.'); return; }
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
  // più aziende: ognuna ha i suoi dati in aziende/{id}/… e le sue regole per le notifiche
  var root = admin.firestore(), az = await root.collection('aziende').where('stato', '==', 'attiva').get();
  var spazi = [];
  for (var a = 0; a < az.docs.length; a++) {
    console.log('— ' + (az.docs[a].data().nome || az.docs[a].id));
    try { await unaAzienda(admin, root, az.docs[a], spazi); } catch (e) { console.error(e); process.exitCode = 1; }
  }
  if (!spazi.length) return; // misurato oggi già prima, o prova
  var tot = 0; az.docs.forEach(function (d) { tot += d.data().spazioMb || 0; });
  spazi.forEach(function (x) { tot += x.mb - x.mbPrima; });
  var pct = tot / SERVIZIO_MB * 100, liv = livello(pct), sRef = root.collection('servizio').doc('spazio'), sDoc = await sRef.get(), prima = sDoc.exists ? sDoc.data().liv || 0 : 0;
  await sRef.set({ mb: Math.round(tot), pct: Math.round(pct), liv: liv, il: new Date().toISOString() }, { merge: true });
  var salite = spazi.filter(function (x) { return x.liv > x.prima; });
  if (liv > prima || salite.length) {
    var righe = spazi.slice().sort(function (p, q) { return q.mb - p.mb; }).map(function (x) { return '- ' + x.nome + ': ' + Math.round(x.mb) + ' MB su ' + x.quota + ' MB (' + Math.round(x.pct) + '%)' + (x.liv > x.prima ? ' ⚠️' : ''); });
    await alGestore('Spazio ' + (liv > prima ? 'del servizio al ' + Math.round(pct) + '%' : (salite.length === 1 ? 'quasi pieno per ' + salite[0].nome : 'quasi pieno per ' + salite.length + ' aziende')),
      'Foto di tutte le aziende: ' + Math.round(tot) + ' MB su ' + SERVIZIO_MB + ' MB del piano gratuito (' + Math.round(pct) + '%).\n\n' + righe.join('\n') + '\n\nLa quota di ogni azienda si cambia nel Pannello del gestore › Quota spazio.');
  }
}

async function unaAzienda(admin, root, azDoc, spazi) {
  var db = azDoc.ref, prova = process.env.PROVA === '1', NOME = String(azDoc.data().nome || NOME0).slice(0, 60);
  function messaggio(voci) { var m = messaggio0(voci); m.title = m.title.replace(NOME0, NOME); return m; }
  async function tutti(c) { if (c === 'utenti') { var su = await root.collection('utenti').where('azienda', '==', azDoc.id).get(), ou = []; su.forEach(function (d) { ou.push(Object.assign({ id: d.id }, d.data())); }); return ou; } var s = await db.collection(c).get(), out = []; s.forEach(function (d) { var x = d.data(); if (!x._del) out.push(Object.assign({ id: d.id }, x)); }); return out; }

  async function manda(dest, msg, tag) {
    var inviati = 0;
    for (var i = 0; i < dest.length; i++) {
      var n = dest[i], tokens = n.tokens.slice();
      var res = await admin.messaging().sendEachForMulticast({ tokens: tokens, data: { title: msg.title, body: msg.body, url: './', tag: tag }, webpush: { headers: { Urgency: 'high', TTL: '43200' } } });
      var morti = [];
      res.responses.forEach(function (x, k) {
        if (x.success) inviati++;
        else if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test((x.error && x.error.code) || '')) morti.push(tokens[k]);
        else console.log('Errore su un telefono:', x.error && x.error.code);
      });
      if (morti.length) await db.collection('notifiche').doc(n.id).update({ tokens: tokens.filter(function (t) { return morti.indexOf(t) < 0; }) });
    }
    console.log('Mandate ' + inviati + ' notifiche (' + tag + ') a ' + dest.length + ' persone.');
  }

  var asp = await db.collection('impostazioni').doc('aspetto').get();
  if (asp.exists && !asp.data()._del && asp.data().nome) NOME = String(asp.data().nome).slice(0, 60);
  var cfgRef = db.collection('impostazioni').doc('notifiche'), cfgDoc = await cfgRef.get(), cfgRaw = cfgDoc.exists && !cfgDoc.data()._del ? cfgDoc.data() : {};
  var cfg = Object.assign({}, DEF, cfgRaw), now = oraRoma(new Date());
  if (!prova && cfgRaw.spazioIl !== now.oggi) await spazio();
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
  async function spazio() { // una volta al giorno, anche nei festivi e prima dell'ora degli avvisi
    var kb = 0; (await db.collection('fotoInfo').get()).forEach(function (d) { kb += d.data().kb || 0; });
    var A = azDoc.data(), quota = A.quotaMb > 0 ? A.quotaMb : QUOTA0, mb = kb / 1024, pct = mb / quota * 100, liv = livello(pct), prima = cfgRaw.spazioLiv || 0;
    await cfgRef.set({ spazioIl: now.oggi, spazioMb: Math.round(mb), spazioPct: Math.round(pct), spazioLiv: liv, spazioQuota: quota }, { merge: true });
    await db.update({ spazioMb: Math.round(mb * 10) / 10, spazioLiv: liv, spazioIl: now.oggi });
    spazi.push({ nome: NOME, mb: mb, mbPrima: A.spazioMb || 0, quota: quota, pct: pct, liv: liv, prima: prima });
    if (liv <= prima) return;
    var ut = {}; (await tutti('utenti')).forEach(function (u) { ut[u.id] = u; });
    var dest = (await tutti('notifiche')).filter(function (n) { var u = ut[n.utente || n.id]; return u && u.stato === 'attivo' && u.ruolo === 'admin' && n.spazio !== false && (n.tokens || []).length; });
    await manda(dest, { title: NOME + ' · spazio ' + (liv >= 95 ? 'quasi finito' : 'quasi pieno') + ' (' + Math.round(pct) + '%)', body: 'Le foto occupano ' + Math.round(mb) + ' MB su ' + quota + ' MB dell’azienda. In Altro › Copia dei dati puoi togliere le foto non più usate.' }, 'nm-spazio');
  }
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

  await manda(dest, msg, 'nm-riepilogo');
}

module.exports = { scegli: scegli, messaggio: messaggio0, oraRoma: oraRoma };
if (require.main === module) main().catch(function (e) { console.error(e); process.exit(1); });
