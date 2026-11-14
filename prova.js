/* Prova senza registrarti
   Dal tasto «Prova senza registrarti» della schermata d'accesso (o con ?prova nell'indirizzo) l'app parte con
   un cantiere di esempio. Offre all'app la stessa interfaccia di nm-fb.js (db, user, assets, downloads),
   ma tutto resta nella memoria di questa scheda del browser: niente account, niente database, niente invii.
   Chiusa la scheda (o con «Esci dalla prova») si riparte da capo. Senza la prova questo file non fa nulla. */
(function () {
  'use strict';
  var K = 'nm-prova', KD = 'nm-prova-dati', KS = 'nm-prova-settore', on = false;
  try { on = /[?&]prova\b/.test(location.search) || sessionStorage.getItem(K) === '1'; if (on) sessionStorage.setItem(K, '1'); } catch (e) { on = /[?&]prova\b/.test(location.search); }
  if (!on) return;
  // settore della prova: ?prova=officina o ?prova=impianti (senza: Nautica)
  var SETT = (/[?&]prova=(officina|impianti)\b/.exec(location.search) || [])[1] || '';
  try { if (/[?&]prova\b/.test(location.search)) { var vec = sessionStorage.getItem(KS) || ''; if (vec !== SETT) sessionStorage.removeItem(KD); sessionStorage.setItem(KS, SETT); } else SETT = sessionStorage.getItem(KS) || ''; } catch (e) { }
  try { if (/[?&]prova\b/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash); } catch (e) { }

  // L'aspetto scelto dalla prova non deve restare sul dispositivo (né quello vero entrare nella prova)
  try {
    var SP = Storage.prototype, gi = SP.getItem, si = SP.setItem, ri = SP.removeItem;
    var vero = function (st, k) { return st === window.localStorage && k === 'nm-aspetto'; };
    SP.getItem = function (k) { return vero(this, k) ? null : gi.apply(this, arguments); };
    SP.setItem = function (k) { if (!vero(this, k)) return si.apply(this, arguments); };
    SP.removeItem = function (k) { if (!vero(this, k)) return ri.apply(this, arguments); };
  } catch (e) { }

  var GIF0 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  var ME = 'prova-admin';
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function rid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function giorno(n) { var d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /* ---------- l'officina e l'azienda di impianti di esempio ---------- */
  function esempioSett(sett) {
    var now = new Date().toISOString(), D = {}, n = 0, OF = sett === 'officina';
    function add(c, id, x) { D[c] = D[c] || {}; D[c][id || ('e' + (++n))] = Object.assign({ creato: now, modificato: now, creatoDa: ME }, x); }
    add('impostazioni', 'schede', { chi: [] }); // come nella prova nautica: nessun avviso «schede da completare» sui giorni vuoti
    add('impostazioni', 'aspetto', { nome: OF ? 'Officina di prova' : 'Impianti di prova', fatto: true });
    add('impostazioni', 'categorie', { lista: OF ? ['Tagliando e motore', 'Freni e sospensioni', 'Gomme', 'Elettrico ed elettronica', 'Climatizzazione', 'Carrozzeria', 'Diagnosi', 'Revisione', 'Lavori interni']
      : ['Manutenzione', 'Installazione', 'Riparazione', 'Pronto intervento', 'Sopralluogo e preventivo', 'Certificazioni', 'Lavori interni'] });
    add('impostazioni', 'pacchetto', { il: now, applicato: true, tipiScadenza: OF ? ['Tagliando', 'Revisione', 'Cambio gomme', 'Assicurazione', 'Bollo', 'Cinghia di distribuzione', 'Ricarica clima', 'Fine deposito gomme']
      : ['Manutenzione caldaia', 'Controllo fumi', 'Manutenzione condizionatore', 'Verifica impianto elettrico', 'Verifica messa a terra', 'Estintori', 'Fine contratto di manutenzione', 'Garanzia'] });
    add('dipendenti', ME, { nome: 'Giulia (tu)' });
    add('dipendenti', 'prova-marco', { nome: 'Marco' });
    add('dipendenti', 'prova-luca', { nome: 'Luca' });
    if (OF) [
      ['b1', 'AB123CD', 'Fiat Panda 1.2', 'Auto', 'Mario Verdi', '333 1234567', 'In lavorazione', 84500, 'Benzina', '2017', 40],
      ['b2', 'CD456EF', 'Volkswagen Golf 2.0 TDI', 'Auto', 'Paola Rossi', '347 2223344', 'In rimessaggio', 132000, 'Diesel', '2015', 200],
      ['b3', 'EF789GH', 'Fiat Ducato camper', 'Camper', 'Andrea Neri', '338 9876543', 'In lavorazione', 61000, 'Diesel', '2019', 90],
      ['b4', 'AA12345', 'Honda SH 125', 'Moto', 'Luisa Bianchi', '339 5556677', 'Consegnata', 22000, 'Benzina', '2020', 300],
      ['b5', 'Landini di Galli', 'Landini 5D', 'Macchina agricola', 'Franco Galli', '335 1112233', 'In rimessaggio', null, 'Diesel', '2012', null]
    ].forEach(function (b) { add('barche', b[0], { nome: b[1], modello: b[2], tipo: b[3], proprietario: b[4], telefono: b[5], stato: b[6], km: b[7], alim: b[8], anno: b[9], revisione: b[10] == null ? '' : giorno(b[10]), motoreTipo: 'Nessuno', note: '' }); });
    else [
      ['b1', 'Mario Verdi', 'Privato', 'via Roma 12, Cecina', '333 1234567', 'Caldaia Vaillant ecoTEC 2019 in cucina\nCondizionatore Daikin in sala'],
      ['b2', 'Condominio Le Querce', 'Condominio', 'viale Italia 40, Livorno', '0586 123456', 'Centrale termica a gas\nAutoclave in cantina'],
      ['b3', 'Bar Centrale', 'Azienda', 'piazza Garibaldi 3, Cecina', '347 2223344', 'Quadro elettrico\n2 condizionatori nella sala'],
      ['b4', 'Paola Rossi', 'Privato', 'via dei Pini 7, Bibbona', '338 9876543', 'Scaldabagno elettrico Ariston 80 l']
    ].forEach(function (b) { add('barche', b[0], { nome: b[1], tipo: b[2], indirizzo: b[3], telefono: b[4], impianti: b[5], proprietario: b[1], stato: 'In rimessaggio', motoreTipo: 'Nessuno', note: '' }); });
    function lav(b, t, cat, st, g, chi, ore, extra) {
      add('lavori', null, Object.assign({ barcaId: b, titolo: t, categoria: cat, stato: st, data: g == null ? '' : giorno(g), descr: '', oreStima: ore || null, oreLavoro: st === 'fatto' ? ore || null : null, importo: null, oreMotore: null, ricambi: [], foto: [], utente: chi }, extra || {}));
    }
    if (OF) {
      lav('b1', 'Tagliando con cambio olio e filtri', 'Tagliando e motore', 'in_corso', 0, 'prova-marco', 2);
      lav('b2', 'Pastiglie dei freni anteriori', 'Freni e sospensioni', 'da_fare', 2, 'prova-luca', 1.5);
      lav('b2', 'Cambio gomme invernali', 'Gomme', 'da_fare', 9, '', 1);
      lav('b3', 'Diagnosi spia motore', 'Diagnosi', 'in_corso', 0, 'prova-marco', 1);
      lav('b4', 'Tagliando scooter', 'Tagliando e motore', 'fatto', -6, 'prova-luca', 1.5);
      lav('b1', 'Tagliando', 'Tagliando e motore', 'fatto', -1, ME, 2, { fonte: 'scheda' });
      lav('', 'Cambio lampadina del faro', 'Elettrico ed elettronica', 'fatto', -1, ME, 0.5, { fonte: 'scheda', clienteNome: 'Giorgio Sala', clienteTel: '333 0001112' });
      lav('', 'Pulizia del ponte sollevatore', 'Lavori interni', 'fatto', -1, ME, 1, { fonte: 'scheda' });
    } else {
      lav('b1', 'Manutenzione caldaia', 'Manutenzione', 'fatto', -12, 'prova-marco', 1.5);
      lav('b2', 'Sostituzione autoclave', 'Installazione', 'da_fare', 6, '', 5);
      lav('b3', 'Verifica impianto elettrico', 'Certificazioni', 'in_corso', 0, 'prova-luca', 3);
      lav('b4', 'Perdita sotto lo scaldabagno', 'Pronto intervento', 'fatto', -5, 'prova-marco', 1);
      lav('b1', 'Pulizia filtri condizionatore', 'Manutenzione', 'fatto', -1, ME, 1, { fonte: 'scheda' });
      lav('', 'Sostituzione rubinetto della cucina', 'Riparazione', 'fatto', -1, ME, 1.5, { fonte: 'scheda', clienteNome: 'Signora Gori', clienteTel: '' });
      lav('', 'Riordino del furgone', 'Lavori interni', 'fatto', -1, ME, 1, { fonte: 'scheda' });
    }
    function scad(b, t, g, mesi) { add('scadenze', null, { barcaId: b, tipo: t, modello: '', data: giorno(g), oreScadenza: null, ricorrenzaMesi: mesi || null, ricorrenzaOre: null, note: '', preavviso: null, fatta: false }); }
    if (OF) { scad('b1', 'Revisione', 40, 24); scad('b2', 'Tagliando', 9, 12); scad('b2', 'Cambio gomme', 20, 6); scad('b3', 'Assicurazione', -4, 12); scad('b4', 'Bollo', 45, 12); }
    else { scad('b1', 'Manutenzione caldaia', 20, 12); scad('b1', 'Controllo fumi', 200, 24); scad('b3', 'Manutenzione condizionatore', -3, 12); scad('b2', 'Fine contratto di manutenzione', 60, 12); }
    var M = OF ? [['m1', 'Filtro olio', 'ricambio', 'Tagliando e motore', 'pz', 4, 10], ['m2', 'Olio motore 5W30', 'prodotto', 'Tagliando e motore', 'l', 10, 40],
      ['m3', 'Pastiglie freni anteriori', 'ricambio', 'Freni e sospensioni', 'kit', 2, 3], ['m4', 'Guanti in nitrile', 'consumo', '', 'paia', 20, 60], ['m5', 'Spazzole tergicristallo', 'ricambio', 'Elettrico ed elettronica', 'pz', 4, 6]]
      : [['m1', 'Raccordo in rame 15 mm', 'ricambio', 'Installazione', 'pz', 10, 25], ['m2', 'Cavo FG16 3x2,5', 'prodotto', 'Installazione', 'm', 50, 200],
      ['m3', 'Differenziale 2P 25 A', 'ricambio', 'Riparazione', 'pz', 2, 4], ['m4', 'Guanti da lavoro', 'consumo', '', 'paia', 10, 30], ['m5', 'Guarnizioni assortite', 'consumo', 'Riparazione', 'conf', 2, 5]];
    M.forEach(function (m) {
      add('magazzino', m[0], { nome: m[1], tipo: m[2], categoria: m[3], um: m[4], minimo: m[5], fornitore: OF ? 'Ricambi Auto Rossi' : 'Termoidraulica Forniture', qtaOrdine: null, inLista: false, note: '', codice: '' });
      add('movimenti', null, { articoloId: m[0], qta: m[6], tipo: 'carico', data: giorno(-30), utente: ME, fornitore: '', bolla: '' });
    });
    if (OF) { add('modelli', null, { nome: 'Tagliando', voci: ['Olio motore e filtro', 'Filtro aria', 'Filtro abitacolo', 'Liquido freni', 'Luci', 'Pressione gomme'] }); add('modelli', null, { nome: 'Cambio gomme di stagione', voci: ['Smontaggio', 'Battistrada e data', 'Equilibratura', 'Montaggio', 'Pressione'] }); }
    else { add('modelli', null, { nome: 'Manutenzione caldaia', voci: ['Pulizia bruciatore e scambiatore', 'Pressione dell’impianto', 'Analisi dei fumi', 'Libretto di impianto compilato'] }); add('modelli', null, { nome: 'Fine lavoro dal cliente', voci: ['Prova di funzionamento', 'Pulizia', 'Spiegato al cliente', 'Foto del lavoro'] }); }
    return D;
  }

  /* ---------- il cantiere di esempio ---------- */
  function esempio() {
    if (SETT) return esempioSett(SETT);
    var now = new Date().toISOString(), D = {}, n = 0;
    function add(c, id, x) { D[c] = D[c] || {}; D[c][id || ('e' + (++n))] = Object.assign({ creato: now, modificato: now, creatoDa: ME }, x); }
    add('impostazioni', 'aspetto', { nome: 'Cantiere di prova', fatto: true });
    add('dipendenti', ME, { nome: 'Giulia (tu)' });
    add('dipendenti', 'prova-marco', { nome: 'Marco' });
    add('dipendenti', 'prova-luca', { nome: 'Luca' });
    var B = [
      ['b1', 'Aurora', 'Jeanneau Cap Camarat 7.5', 'Motore', 7.5, 'Mario Verdi', '333 1234567', 'In rimessaggio', 412],
      ['b2', 'Libeccio', 'Bavaria 34 Cruiser', 'Vela', 10.4, 'Paola Rossi', '347 2223344', 'In acqua', 1630],
      ['b3', 'Maestrale', 'Sessa Key Largo 24', 'Motore', 7.3, 'Andrea Neri', '338 9876543', 'In lavorazione', 655],
      ['b4', 'Gabbiano', 'Zodiac Medline 7.5', 'Gommone', 7.5, 'Luisa Bianchi', '339 5556677', 'In rimessaggio', 280],
      ['b5', 'Stella Polare', 'Beneteau Oceanis 38', 'Vela', 11.5, 'Franco Galli', '335 1112233', 'In acqua', 2210],
      ['b6', 'Delfino', 'Ranieri 19 Cayman', 'Motore', 5.8, 'Sara Conti', '340 4445566', 'In rimessaggio', 190]
    ];
    B.forEach(function (b) { add('barche', b[0], { nome: b[1], modello: b[2], tipo: b[3], lunghezza: b[4], proprietario: b[5], telefono: b[6], stato: b[7], oreMotore: b[8], note: '' }); });
    function lav(b, t, cat, st, g, chi, ore) {
      add('lavori', null, { barcaId: b, titolo: t, categoria: cat, stato: st, data: g == null ? '' : giorno(g), descr: '', oreStima: ore || null, oreLavoro: st === 'fatto' ? ore || null : null, importo: null, oreMotore: null, ricambi: [], foto: [], utente: chi || '' });
    }
    lav('b1', 'Tagliando motore', 'Motore', 'fatto', -12, 'prova-marco', 3);
    lav('b1', 'Antivegetativa', 'Carena e antivegetativa', 'da_fare', 6, '', 5);
    lav('b3', 'Sostituzione girante pompa acqua mare', 'Motore', 'in_corso', 0, 'prova-marco', 2);
    lav('b3', 'Lucidatura fiancate', 'Carrozzeria e lucidatura', 'da_fare', 2, 'prova-luca', 6);
    lav('b4', 'Riparazione tubolare', 'Coperta e attrezzatura', 'da_fare', 4, '', 3);
    lav('b6', 'Rimessaggio invernale', 'Rimessaggio', 'fatto', -20, 'prova-luca', 4);
    lav('b2', 'Controllo impianto elettrico', 'Elettrico ed elettronica', 'fatto', -5, 'prova-marco', 2);
    function scad(b, t, g, mesi) { add('scadenze', null, { barcaId: b, tipo: t, modello: '', data: giorno(g), oreScadenza: null, ricorrenzaMesi: mesi || null, ricorrenzaOre: null, note: '', preavviso: null, fatta: false }); }
    scad('b2', 'Assicurazione', 9, 12); scad('b5', 'Revisione zattera', -4, 24); scad('b1', 'Sostituzione anodi', 20, 12);
    scad('b4', 'Estintori', 45, 12); scad('b6', 'Fine contratto rimessaggio', 120, 12);
    add('vari', null, { barcaId: 'b1', tipo: 'varo', data: giorno(8), ora: '09:00', note: 'Dopo l’antivegetativa', fatto: false, utente: ME });
    add('vari', null, { barcaId: 'b5', tipo: 'alaggio', data: giorno(3), ora: '14:30', note: '', fatto: false, utente: ME });
    var M = [['m1', 'Filtro olio motore', 'ricambio', 'Motore', 'pz', 4, 10], ['m2', 'Antivegetativa blu 2,5 l', 'prodotto', 'Carena e antivegetativa', 'latta', 2, 3],
      ['m3', 'Girante pompa acqua mare', 'ricambio', 'Motore', 'pz', 2, 5], ['m4', 'Guanti in nitrile', 'consumo', '', 'paia', 20, 60], ['m5', 'Anodo a collare 30 mm', 'ricambio', 'Carena e antivegetativa', 'pz', 4, 3]];
    M.forEach(function (m) {
      add('magazzino', m[0], { nome: m[1], tipo: m[2], categoria: m[3], um: m[4], minimo: m[5], fornitore: 'Forniture Nautiche', qtaOrdine: null, inLista: false, note: '', codice: '' });
      add('movimenti', null, { articoloId: m[0], qta: m[6], tipo: 'carico', data: giorno(-30), utente: ME, fornitore: 'Forniture Nautiche', bolla: '' });
    });
    add('modelli', null, { nome: 'Preparazione al varo', voci: ['Antivegetativa', 'Anodi nuovi', 'Prese a mare e passascafo', 'Batterie montate e cariche', 'Motore in moto e scarico acqua', 'Pompe di sentina'] });
    add('modelli', null, { nome: 'Rimessaggio invernale', voci: ['Lavaggio carena', 'Antigelo nel circuito', 'Batterie scollegate e in carica', 'Acqua dolce svuotata', 'Serbatoio pieno con additivo'] });
    return D;
  }

  var D = null, FOTO = {};
  try { var sv = JSON.parse(sessionStorage.getItem(KD) || 'null'); if (sv && sv.d) { D = sv.d; FOTO = sv.f || {}; } } catch (e) { D = null; }
  if (!D) D = esempio();
  var tSave = 0;
  function salva() { // nella scheda: sopravvive a un ricaricamento, sparisce alla chiusura
    clearTimeout(tSave);
    tSave = setTimeout(function () {
      try { sessionStorage.setItem(KD, JSON.stringify({ d: D, f: FOTO })); }
      catch (e) { try { sessionStorage.setItem(KD, JSON.stringify({ d: D, f: {} })); } catch (x) { } } // troppe foto: restano solo in memoria
    }, 300);
  }

  /* ---------- db ---------- */
  var SUBS = {};
  function coll(n) { return D[n] || (D[n] = {}); }
  function snapOf(n) {
    var m = coll(n), docs = Object.keys(m).map(function (id) { var d = m[id]; return { id: id, exists: true, data: function () { return clone(d); }, metadata: { fromCache: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }
  function emit(n) { var s = snapOf(n); (SUBS[n] || []).slice().forEach(function (x) { try { x.next(s); } catch (e) { console.error(e); } }); }
  function docSnap(id, d) { return { id: id, exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }
  function write(n, id, kind, data) {
    var m = coll(n);
    if (kind === 'set') { var x = clone(data || {}); if (m[id] && m[id].creatoDa) x.creatoDa = m[id].creatoDa; else if (!x.creatoDa) x.creatoDa = ME; m[id] = x; }
    else if (kind === 'update') {
      if (!m[id]) return Promise.reject({ code: 'not_found', message: 'Elemento non trovato' });
      var u = Object.assign({}, m[id]); Object.keys(data || {}).forEach(function (k) { var v = data[k]; if (v && v.__delete__) delete u[k]; else u[k] = clone(v); }); m[id] = u;
    } else delete m[id];
    emit(n); salva();
    return Promise.resolve();
  }
  function ref(n, id) {
    return {
      id: id,
      get: function () { return Promise.resolve(docSnap(id, coll(n)[id] || null)); },
      set: function (d) { return write(n, id, 'set', d); },
      update: function (d) { return write(n, id, 'update', d); },
      delete: function () { return write(n, id, 'delete'); },
      onSnapshot: function (next, err) { return collection(n).onSnapshot(function () { next(docSnap(id, coll(n)[id] || null)); }, err); }
    };
  }
  function collection(n) {
    return {
      onSnapshot: function (next, err) {
        var s = { next: next, err: err }; (SUBS[n] = SUBS[n] || []).push(s);
        setTimeout(function () { if (SUBS[n].indexOf(s) >= 0) next(snapOf(n)); }, 0);
        return function () { SUBS[n] = SUBS[n].filter(function (x) { return x !== s; }); };
      },
      get: function () { return Promise.resolve(snapOf(n)); },
      doc: function (id) { return ref(n, id || rid('p')); }
    };
  }
  var DB = { collection: collection, doc: function (p) { p = String(p).split('/'); return ref(p[0], p[1]); } };

  /* ---------- persone: tu sei l'amministratore ---------- */
  function nomi() { var o = {}, d = coll('dipendenti'); Object.keys(d).forEach(function (id) { o[id] = d[id].nome || ''; }); return o; }
  var USER = {
    id: function () { return Promise.resolve(ME); },
    me: function () { return Promise.resolve({ id: ME, name: nomi()[ME] || 'Giulia', isOwner: true }); },
    isOwner: function () { return true; },
    canEdit: function () { return Promise.resolve(true); },
    can: function (k) { return Promise.resolve(k === 'data.write' ? true : null); },
    profiles: function (ids) { var nm = nomi(), o = {}; (ids || []).forEach(function (id) { o[id] = { id: id, name: nm[id] || '', avatarUrl: '' }; }); return Promise.resolve(o); },
    search: function (q) { var nm = nomi(); q = String(q || '').toLowerCase(); return Promise.resolve(Object.keys(nm).filter(function (id) { return !q || nm[id].toLowerCase().indexOf(q) >= 0; }).map(function (id) { return { id: id, name: nm[id] }; })); }
  };

  /* ---------- foto: rimpicciolite e tenute nella scheda ---------- */
  function piccola(blob) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1000 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.65));
      };
      img.onerror = function () { URL.revokeObjectURL(url); var r = new FileReader(); r.onload = function () { res(String(r.result)); }; r.onerror = function () { res(GIF0); }; r.readAsDataURL(blob); };
      img.src = url;
    });
  }
  var ASSETS = {
    upload: function (blob) { return piccola(blob).then(function (u) { var id = rid('f'); FOTO[id] = u; salva(); return { id: id, url: u, sizeBytes: u.length, contentType: 'image/jpeg' }; }); },
    delete: function (id) { delete FOTO[id]; salva(); return Promise.resolve(); },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };

  /* ---------- file da salvare: si scaricano come sul sito vero ---------- */
  var DL = {
    save: function (o) {
      var name = o.filename || 'file', data = o.data;
      var type = /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : /\.txt$/i.test(name) ? 'text/plain' : 'application/octet-stream';
      var blob = data instanceof Blob ? data : new Blob([data], { type: type }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
      return Promise.resolve({ status: 'saved' });
    }
  };

  function via() { try { sessionStorage.removeItem(KD); } catch (e) { } }
  window.__NM_DEMO = {
    settore: SETT || 'nautica', clienti: 'scheda',
    use: function (n) { return Promise.resolve({ db: DB, user: USER, assets: ASSETS, downloads: DL }[n] || null); },
    photoSrc: function (id) { return FOTO[id] || GIF0; },
    reset: function () { via(); location.reload(); },
    esci: function () { via(); try { sessionStorage.removeItem(K); } catch (e) { } location.replace(location.pathname); }
  };
})();
