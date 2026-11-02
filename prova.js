/* Prova senza registrarti
   Dal tasto «Prova senza registrarti» della schermata d'accesso (o con ?prova nell'indirizzo) l'app parte con
   un cantiere di esempio. Offre all'app la stessa interfaccia di nm-fb.js (db, user, assets, downloads),
   ma tutto resta nella memoria di questa scheda del browser: niente account, niente database, niente invii.
   Chiusa la scheda (o con «Esci dalla prova») si riparte da capo. Senza la prova questo file non fa nulla. */
(function () {
  'use strict';
  var K = 'nm-prova', KD = 'nm-prova-dati', on = false;
  try { on = /[?&]prova\b/.test(location.search) || sessionStorage.getItem(K) === '1'; if (on) sessionStorage.setItem(K, '1'); } catch (e) { on = /[?&]prova\b/.test(location.search); }
  if (!on) return;
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

  /* ---------- il cantiere di esempio ---------- */
  function esempio() {
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
    use: function (n) { return Promise.resolve({ db: DB, user: USER, assets: ASSETS, downloads: DL }[n] || null); },
    photoSrc: function (id) { return FOTO[id] || GIF0; },
    reset: function () { via(); location.reload(); },
    esci: function () { via(); try { sessionStorage.removeItem(K); } catch (e) { } location.replace(location.pathname); }
  };
})();
