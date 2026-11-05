/* Nautica Mare · versione sul sito proprio
   I dati stanno su Firebase (Google) invece che su Claude. Offre all'app la stessa interfaccia
   (db, user, assets, downloads) e aggiunge: accesso con email e password, approvazione dei nuovi
   colleghi, ruoli, foto salvate nel database, sincronizzazione che legge solo ciò che è cambiato. */
(function () {
  'use strict';
  var CFG = window.NM_FIREBASE_CONFIG || null;
  var COLLS = ['barche', 'lavori', 'scadenze', 'dipendenti', 'conferme', 'impostazioni', 'magazzino', 'movimenti', 'vari', 'modelli',
    'checkBarca', 'checklist', 'opModelli', 'operazioni', 'mezzi', 'attrezzatura', 'deposito', 'programma', 'cariche', 'posti', 'richieste', 'rifiuti', 'ritiri', 'scadCantiere', 'preventivi', 'assenze', 'kit', 'inventari', 'giri', 'cronometri', 'ditte', 'pin', 'controlliMezzi', 'richiesteCliente', 'verbali', 'componenti', 'barattoli', 'noteColleghi'];
  var RUOLI = { base: 'Dipendente', editor: 'Dipendente', admin: 'Amministratore', cliente: 'Cliente' }; // «editor» era «Può cancellare»: ora vale come Dipendente
  var FULL_EVERY = 7 * 864e5;            // una rilettura completa a settimana per sicurezza
  var GIF0 = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

  /* ---------- piccoli aiuti ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }
  function nowISO() { return new Date().toISOString(); }
  function rid(p) { return (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // Firestore non accetta liste dentro liste: le avvolgo e le srotolo in lettura
  function enc(v) {
    if (Array.isArray(v)) return v.map(function (x) { return Array.isArray(x) ? { _a: enc(x) } : enc(x); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { if (v[k] !== undefined) o[k] = enc(v[k]); }); return o; }
    return v;
  }
  function dec(v) {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === 'object') {
      var ks = Object.keys(v);
      if (ks.length === 1 && ks[0] === '_a' && Array.isArray(v._a)) return dec(v._a);
      var o = {}; ks.forEach(function (k) { o[k] = dec(v[k]); }); return o;
    }
    return v;
  }
  function strip(x) {
    if (!x) return x;
    var o = {}; Object.keys(x).forEach(function (k) { if (k !== '_ts' && k !== '_del') o[k] = x[k]; });
    return dec(clone(o));
  }
  function errOf(e) {
    var c = (e && e.code) || 'unknown';
    var m = { 'permission-denied': 'permission_denied', 'unavailable': 'unavailable', 'resource-exhausted': 'quota_exceeded', 'invalid-argument': 'invalid_argument', 'not-found': 'not_found' };
    return { code: m[c] || String(c).replace(/^firestore\//, '').replace(/-/g, '_'), message: (e && e.message) || '' };
  }

  /* ---------- archivio sul dispositivo (IndexedDB) ---------- */
  var IDB = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        try {
          var r = indexedDB.open('nautica-mare', 1);
          r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('colls')) d.createObjectStore('colls'); if (!d.objectStoreNames.contains('foto')) d.createObjectStore('foto'); };
          r.onsuccess = function () { res(r.result); }; r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
      return dbp;
    }
    function tx(store, mode, fn) {
      return open().then(function (d) {
        if (!d) return null;
        return new Promise(function (res) {
          try { var t = d.transaction(store, mode), q = fn(t.objectStore(store)); t.oncomplete = function () { res(q && q.result); }; t.onerror = t.onabort = function () { res(null); }; }
          catch (e) { res(null); }
        });
      });
    }
    return {
      get: function (s, k) { return tx(s, 'readonly', function (o) { return o.get(k); }); },
      put: function (s, k, v) { return tx(s, 'readwrite', function (o) { return o.put(v, k); }); },
      del: function (s, k) { return tx(s, 'readwrite', function (o) { return o.delete(k); }); },
      keys: function (s) { return tx(s, 'readonly', function (o) { return o.getAllKeys(); }); },
      clear: function () { return Promise.all([tx('colls', 'readwrite', function (o) { return o.clear(); }), tx('foto', 'readwrite', function (o) { return o.clear(); })]); }
    };
  })();

  /* ---------- schermata di accesso ---------- */
  var CSS = '#nmfb{position:fixed;inset:0;z-index:99999;background:var(--bg,#06002e);color:#f4f5f7;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;overflow-y:auto;padding:calc(env(safe-area-inset-top) + 28px) 18px 32px}' +
    '#nmfb .box{width:100%;max-width:400px}#nmfb .logo{display:block;width:78%;max-width:300px;margin:22px auto 26px}#nmfb.load{justify-content:center;padding:24px}#nmfb.load .box{position:relative;max-width:none}#nmfb.load .logo{width:84%;max-width:440px;margin:0 auto}#nmfb.load .spin{position:absolute;left:50%;top:100%;margin:28px 0 0 -17px}' +
    '#nmfb h2{font-size:1.35rem;margin:0 0 6px}#nmfb p{color:#b9bccb;margin:0 0 14px}#nmfb label{display:block;font-size:.9rem;color:#b9bccb;margin:12px 0 6px}' +
    '#nmfb input{width:100%;box-sizing:border-box;font:inherit;font-size:17px;padding:13px 14px;border-radius:12px;border:1px solid #33355a;background:#12114a;color:#fff;outline:none}' +
    '#nmfb input:focus{border-color:#2f8ff0}#nmfb .btn{display:block;width:100%;margin-top:18px;padding:14px;border:0;border-radius:12px;background:#2f8ff0;color:#fff;font:inherit;font-weight:600;font-size:17px;cursor:pointer}' +
    '#nmfb .pw{position:relative}#nmfb .pw input{padding-right:54px}' +
    '#nmfb .eye{position:absolute;right:3px;top:50%;transform:translateY(-50%);width:48px;height:44px;margin:0;padding:0;border:0;border-radius:10px;background:none;color:#b9bccb;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '#nmfb .eye svg{width:22px;height:22px}#nmfb .eye[aria-pressed="true"]{color:#8cc2ff}' +
    '#nmfb .btn[disabled]{opacity:.6}#nmfb .lnk{display:block;width:100%;margin-top:12px;background:none;border:0;color:#8cc2ff;font:inherit;padding:8px;cursor:pointer}' +
    '#nmfb .err{color:#ff8a80;min-height:1.3em;margin-top:10px;font-size:.95rem}#nmfb .ok{color:#7fe0a0}#nmfb .card{background:#12114a;border:1px solid #33355a;border-radius:14px;padding:16px;margin-top:6px}' +
    '#nmfb .spin{width:34px;height:34px;border-radius:50%;border:3px solid #33355a;border-top-color:#2f8ff0;margin:30px auto;animation:nmspin 1s linear infinite}@keyframes nmspin{to{transform:rotate(360deg)}}' +
    /* pannelli (utenti, account) */
    '#nmpan{position:fixed;inset:0;z-index:99998;background:var(--bg,#0e0e10);color:var(--text,#f4f5f7);overflow-y:auto;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;padding:calc(env(safe-area-inset-top) + 8px) 16px 40px}' +
    '#nmpan .top{display:flex;align-items:center;gap:8px;height:52px;position:sticky;top:0;background:inherit;z-index:2}#nmpan .top h3{flex:1;text-align:center;margin:0;font-size:1.05rem}' +
    '#nmpan .back{background:none;border:0;color:#2f8ff0;font:inherit;font-size:1rem;padding:8px 4px;cursor:pointer;min-width:64px;text-align:left}' +
    '#nmpan h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a9daa;margin:22px 4px 8px}' +
    '#nmpan .grp{background:#1b1c20;border:1px solid #2a2c31;border-radius:14px;overflow:hidden}#nmpan .u{padding:14px;border-top:1px solid #2a2c31}#nmpan .u:first-child{border-top:0}' +
    '#nmpan .nm{font-weight:600}#nmpan .em{color:#9a9daa;font-size:.9rem;word-break:break-all}#nmpan .acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
    '#nmpan button.b{border:1px solid #2a2c31;background:#26272d;color:#f4f5f7;border-radius:10px;padding:9px 12px;font:inherit;font-size:.92rem;cursor:pointer}' +
    '#nmpan button.b.pri{background:#2f8ff0;border-color:#2f8ff0;color:#fff}#nmpan button.b.red{color:#ff8a80}#nmpan select{font:inherit;font-size:.92rem;padding:8px 10px;border-radius:10px;background:#26272d;color:#f4f5f7;border:1px solid #2a2c31}' +
    '#nmpan .pill{display:inline-block;font-size:.78rem;padding:2px 8px;border-radius:99px;background:#26272d;color:#c9ccd6;margin-left:6px}#nmpan .note{color:#9a9daa;font-size:.9rem;margin:10px 4px}' +
    '#nmfb .opt{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid #33355a;border-radius:12px;margin-top:8px;font-size:16px;color:#f4f5f7;cursor:pointer}#nmfb .opt input{width:20px;height:20px;padding:0;margin:0;flex:none;accent-color:#2f8ff0}' +
    '#nmfb .bc{margin-top:14px}#nmfb .bh{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}#nmfb .bn{font-size:1.25rem;font-weight:700}#nmfb .bm{color:#b9bccb;font-size:.95rem}' +
    '#nmfb .st{flex:none;font-size:.8rem;font-weight:600;padding:3px 10px;border-radius:99px;background:#26275e;color:#c9d4ff}#nmfb .st.acqua{background:#0f3b2a;color:#7fe0a0}#nmfb .st.lav{background:#3d2f0b;color:#ffcf6b}' +
    '#nmfb .where{display:flex;gap:12px;align-items:center;border-radius:12px;padding:10px 12px;margin-top:12px}#nmfb .where b{display:block;font-size:1.02rem}#nmfb .where small{display:block;font-size:.85rem;opacity:.85}#nmfb .where.msv{background:rgba(95,208,184,.14);color:#7fe3cc}#nmfb .where.nm{background:#1A3150;color:#EAF2FB}#nmfb .where.porto{background:rgba(140,194,255,.14);color:#a9d1ff}#nmfb .where.terzi{background:rgba(201,182,255,.14);color:#d6c8ff}#nmfb .dv-ic{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center}#nmfb .dv-ic svg{width:72%;height:72%}#nmfb .dv-ic.msv{background:rgba(95,208,184,.16);color:#5fd0b8}#nmfb .dv-ic.porto{background:rgba(140,194,255,.15);color:#8cc2ff}#nmfb .dv-ic.terzi{background:rgba(201,182,255,.15);color:#c9b6ff}#nmfb .dv-ic.nm{background:#26406a;color:#EAF2FB}#nmfb.cli .bt .where{grid-column:span 2;margin-top:0}' +
    '#nmfb .kv{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #2a2c5c;padding:10px 0;font-size:.95rem}#nmfb .kv span{color:#b9bccb}#nmfb .kv b{text-align:right;font-weight:600}' +
    '#nmfb .rqb{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}#nmfb .rqbtn{flex:1;min-width:140px;padding:10px;border-radius:10px;border:1px solid #3a3d7a;background:transparent;color:inherit;font:inherit;font-weight:600}' +
    '#nmrc{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center}#nmrc .box{background:#14163a;color:#eef;width:100%;max-width:520px;border-radius:16px 16px 0 0;padding:18px 16px 24px;font-family:inherit}' +
    '#nmrc h3{margin:0 0 12px}#nmrc label{display:block;margin:0 0 12px;font-size:.9rem}#nmrc input,#nmrc textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #3a3d7a;background:#0d0f2a;color:inherit;font:inherit;font-size:16px}' +
    '#nmrc .row2{display:flex;justify-content:space-between;gap:10px}#nmrc .pri{padding:10px 18px;border-radius:10px;border:0;background:#2ec4a6;color:#062;font-weight:700;font:inherit}#nmrc .lnk{background:none;border:0;color:#9ab;font:inherit}#nmrc .err{color:#ff8a80}' +
    '#nmfb .avb{height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}#nmfb .avb i{display:block;height:100%;background:#2ec4a6;border-radius:4px}' +
    '#nmfb h5{margin:14px 0 6px;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a9dc0}#nmfb .lv{display:flex;gap:12px;padding:7px 0;border-top:1px solid #23245a;font-size:.95rem}#nmfb .lv .d{flex:none;width:58px;color:#9a9dc0;font-variant-numeric:tabular-nums}#nmfb .dfo{display:flex;gap:6px;flex:none}#nmfb .dfo img{width:52px;height:52px;object-fit:cover;border-radius:9px;background:#23245a;cursor:zoom-in}#nmfb .dfo img.big{position:fixed;inset:0;margin:auto;width:auto;height:auto;max-width:94vw;max-height:80vh;z-index:5;border-radius:12px;box-shadow:0 0 0 100vmax rgba(0,0,0,.7);cursor:zoom-out}' +
    '#nmfb .oy{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px}#nmfb .oy button{padding:5px 13px;border-radius:99px;border:1px solid #3a3d7a;background:none;color:#b9bccb;font:inherit;font-size:.85rem;cursor:pointer}#nmfb .oy button[aria-pressed="true"]{background:#2f8ff0;border-color:#2f8ff0;color:#fff}' +
    '#nmfb .odn{display:flex;justify-content:center;margin:6px 0 4px}#nmfb .oc{display:flex;width:100%;align-items:center;gap:10px;padding:9px 0;border:0;border-top:1px solid #23245a;background:none;color:inherit;font:inherit;font-size:.95rem;text-align:left;cursor:pointer}#nmfb .oc i{width:11px;height:11px;border-radius:3px;flex:none}#nmfb .oc span{flex:1}#nmfb .oc b{white-space:nowrap;font-variant-numeric:tabular-nums}#nmfb .oc small{color:#8a8db0;width:12px}' +
    '#nmfb .ors{padding:0 0 6px 12px;border-left:3px solid;margin:0 0 8px 4px}#nmfb .ors .lv{font-size:.9rem;border-top:0;padding:5px 0}#nmfb .ors .lv .d{width:52px}#nmfb .ors .on{display:block;color:#9a9dc0;font-size:.82rem;margin-top:1px}#nmfb .lv .oh{margin-left:auto;padding-left:8px;white-space:nowrap;color:#c9d4ff;font-variant-numeric:tabular-nums}#nmfb .otot{display:flex;justify-content:space-between;padding:10px 0 2px;border-top:2px solid #3a3d7a;font-weight:700}' +
    '#nmfb .gd{margin-top:18px;color:#b9bccb;font-size:.95rem}#nmfb .gd summary{color:#8cc2ff;cursor:pointer;padding:8px 0}#nmfb .gd ul{margin:4px 0 0;padding-left:20px}#nmfb .gd li{margin:6px 0}' +
    /* area cliente su computer e tablet: schede delle barche in alto e riquadri su 2 o 3 colonne (sul telefono non cambia nulla) */
    '#nmfb .btabs{display:none}@media (min-width:768px) and (min-height:500px){#nmfb.cli .box{max-width:1180px}#nmfb.cli .logo{width:220px;margin:6px 0 18px}' +
    '#nmfb.cli .btabs{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 14px;border-bottom:1px solid #2a2c5c}#nmfb.cli .btabs button{background:none;border:0;border-bottom:3px solid transparent;margin-bottom:-1px;color:#b9bccb;font:inherit;font-weight:700;font-size:1.05rem;padding:10px 16px;cursor:pointer;text-align:left}' +
    '#nmfb.cli .btabs button[aria-selected="true"]{color:#fff;border-color:#2f8ff0}#nmfb.cli .btabs small{display:block;font-weight:500;font-size:.78rem;color:#9a9dc0}' +
    '#nmfb.cli .bc{display:none}#nmfb.cli .bc.on{display:block}#nmfb.cli .bc.full{background:none;border:0;padding:0}' +
    '#nmfb.cli .bt{background:#12114a;border:1px solid #33355a;border-radius:14px;padding:18px 22px;margin-bottom:16px;display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:0 26px;align-items:center}' +
    '#nmfb.cli .bt .kv{border-top:0;flex-direction:column;gap:2px;margin:0!important;padding:4px 0}#nmfb.cli .bt .kv b{text-align:left}' +
    '#nmfb.cli .cg{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start;grid-auto-flow:row dense;margin-bottom:16px}#nmfb.cli .cso{grid-row:span 2}#nmfb.cli .cs{box-sizing:border-box;background:#12114a;border:1px solid #33355a;border-radius:14px;padding:16px 18px;margin:0}' +
    '#nmfb.cli .cs>h5:first-child{margin-top:0}#nmfb.cli .bc.full>.upd{margin-top:0}#nmfb.cli .lv .d{width:auto;min-width:22px;white-space:nowrap}#nmfb.cli>.box>.lnk{display:inline-block;width:auto;margin-right:14px}}' +
    '@media (min-width:1100px) and (min-height:500px){#nmfb.cli .cg{grid-template-columns:repeat(3,minmax(0,1fr))}}' +
    '#nmfb .upd{color:#8a8db0;font-size:.82rem;margin-top:10px}#nmfb .more{background:none;border:0;color:#8cc2ff;font:inherit;padding:8px 0;cursor:pointer}' +
    '#nmpan .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;width:100%}#nmpan .chip{display:inline-flex;align-items:center;gap:4px;background:#1e3a5f;color:#d6e8ff;border-radius:99px;padding:4px 4px 4px 10px;font-size:.9rem}' +
    '#nmpan .chip button{background:none;border:0;color:#d6e8ff;font-size:1.1rem;line-height:1;padding:2px 6px;cursor:pointer}' +
    /* pannello del gestore: a tutto schermo, come i pannelli */
    '#nmcr{position:fixed;inset:0;z-index:99999;background:var(--bg,#0e0e10);color:#f4f5f7;overflow-y:auto;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;padding:env(safe-area-inset-top) 16px 40px}#nmcr .in{max-width:760px;margin:0 auto}' +
    '#nmcr .top{display:flex;align-items:center;gap:8px;height:56px}#nmcr .top h3{flex:1;text-align:center;margin:0;font-size:1.1rem}#nmcr .back{background:none;border:0;color:#8cc2ff;font:inherit;padding:8px 4px;cursor:pointer;min-width:64px;text-align:left}' +
    '#nmcr h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9a9daa;margin:22px 4px 8px}#nmcr .grp{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden}' +
    '#nmcr .u{padding:14px;border-top:1px solid rgba(255,255,255,.1)}#nmcr .u:first-child{border-top:0}#nmcr .nm{font-weight:600}#nmcr .em{color:#b0b3c0;font-size:.9rem;word-break:break-word;margin-top:2px}#nmcr .acts,#nmcr .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
    '#nmcr button.b{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);color:#f4f5f7;border-radius:10px;padding:9px 12px;font:inherit;font-size:.92rem;cursor:pointer}#nmcr button.b.pri{background:#2f8ff0;border-color:#2f8ff0;color:#fff}#nmcr button.b.red{color:#ff8a80}' +
    '#nmcr .pill{display:inline-block;font-size:.78rem;padding:2px 8px;border-radius:99px;background:rgba(255,255,255,.1);color:#c9ccd6;margin-left:6px;font-weight:500}#nmcr .note{color:#9a9daa;font-size:.9rem;margin:12px 4px}' +
    /* computer e tablet: il pannello lascia libero il menù a sinistra dell'app (largo 236px) */
    '@media (min-width:768px) and (min-height:500px){#nmpan{left:236px}}' +
    '#nmmsg,#nmabb{position:fixed;top:calc(env(safe-area-inset-top) + 64px);left:10px;right:10px;z-index:100000;display:flex;justify-content:center}#nmmsg .it,#nmabb .it{max-width:520px;width:100%;box-sizing:border-box;background:#1e3a5f;color:#fff;border:1px solid #2f8ff0;border-radius:14px;padding:12px 14px;font:15px/1.45 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}#nmmsg .ok,#nmabb .ok{margin-top:8px;border:0;border-radius:10px;background:#2f8ff0;color:#fff;padding:8px 14px;font:inherit;cursor:pointer}#nmcr select.b{appearance:auto}#nmnov{position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px}#nmnov .it{max-width:520px;width:100%;max-height:85vh;overflow:auto;box-sizing:border-box;background:#18212c;color:#eef3f8;border:1px solid #2a3644;border-radius:18px;padding:18px 18px 16px;font:15px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.5)}#nmnov h3{margin:0 0 6px;font-size:1.2rem}#nmnov h4{margin:12px 0 4px;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:#9aabbd}#nmnov ul{margin:0;padding-left:20px}#nmnov li{margin:6px 0}#nmnov .ok{margin-top:14px;width:100%;border:0;border-radius:12px;background:#2ec4b6;color:#062a26;padding:12px;font:600 15px/1 -apple-system,BlinkMacSystemFont,sans-serif;cursor:pointer}#nmabb{top:auto;bottom:calc(env(safe-area-inset-bottom) + 84px)}#nmabb .it{background:#4a3a12;border-color:#ffb020}#nmabb .ok{background:#ffb020;color:#2a1f00}' +
    '#nmatt{position:fixed;bottom:calc(env(safe-area-inset-bottom) + 76px);right:10px;left:10px;z-index:100001;display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}' +
    '#nmatt .it{pointer-events:auto;position:relative;max-width:420px;width:100%;box-sizing:border-box;background:#2b2c33;color:#fff;border-radius:14px;padding:10px 40px 10px 14px;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)}#nmatt .x{position:absolute;top:4px;right:4px;width:32px;height:32px;border:0;background:none;color:#c9cbe0;font-size:20px;line-height:1;cursor:pointer}' +
    '#nmatt .it b{display:block}#nmatt .it span{color:#c9cbe0}#nmattv{width:100%;text-align:left}#nmattv .ar{display:block;padding:10px 0;border-top:1px solid #2a2d55}#nmattv .ar:first-child{border-top:0}#nmattv .ar b{display:block}#nmattv .ar div{color:#b7bad8;font-size:.9rem}' +
    /* modifiche in attesa di rete: piccola icona in alto a destra, sotto la barra (giallo = da inviare, verde = inviate) */
    '#nmpend{position:fixed;top:calc(env(safe-area-inset-top) + 46px);right:10px;z-index:99990;display:flex;align-items:center;gap:4px;height:25px;padding:0 8px;border:1px solid rgba(255,200,90,.5);background:rgba(40,30,8,.94);color:#ffd27a;border-radius:99px;font:700 12px/1 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.35);cursor:pointer}' +
    '#nmpend svg{width:15px;height:15px;flex:none}#nmpend[data-s="ok"]{border-color:rgba(90,220,150,.5);background:rgba(8,40,26,.94);color:#7fe0a0}' +
    '@media (min-width:1024px) and (min-height:500px){#nmpend{top:10px;right:190px;height:38px;padding:0 14px;gap:7px;font-size:16px}#nmpend svg{width:22px;height:22px}}' +
    '#nmtoast{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 90px);transform:translateX(-50%);z-index:100000;background:#2b2c33;color:#fff;padding:10px 16px;border-radius:12px;font:15px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.4)}';
  function ensureCss() { if (!$('#nmfb-css')) { var st = document.createElement('style'); st.id = 'nmfb-css'; st.textContent = CSS; document.head.appendChild(st); } }
  function logoSrc() { var l = document.getElementById('logo-src'); return l ? l.getAttribute('src') : ''; }
  function nomeAz() { return window.NM_MARCA ? NM_MARCA.nome() : 'Gestionale cantiere'; } // nome dell'azienda (Altro › Aspetto)
  function overlay(html) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { overlay(html); }, { once: true }); return null; }
    ensureCss();
    var o = $('#nmfb'); if (!o) { o = document.createElement('div'); o.id = 'nmfb'; document.body.appendChild(o); }
    o.className = html === '<div class="spin"></div>' ? 'load' : ''; // caricamento: logo al centro dello schermo come nella schermata d'avvio, rotellina sotto
    o.innerHTML = '<div class="box">' + (logoSrc() ? '<img class="logo" alt="' + esc(nomeAz()) + '" src="' + logoSrc() + '">' : '<h2>' + esc(nomeAz()) + '</h2>') + html + '</div>';
    return o;
  }
  function hideOverlay() { var o = $('#nmfb'); if (o) o.remove(); }
  function toast(t) {
    ensureCss(); var d = $('#nmtoast'); if (d) d.remove();
    d = document.createElement('div'); d.id = 'nmtoast'; d.textContent = t; document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.remove(); }, 3800);
  }

  if (window.__NM_DEMO) return; // «Prova senza registrarti» (prova.js): niente accesso né database, i dati restano nella finestra
  if (!CFG || !CFG.apiKey || /INSERISCI/.test(CFG.apiKey) || typeof firebase === 'undefined') {
    window.__NM_FB = { use: function () { return new Promise(function () { }); }, photoSrc: function () { return GIF0; }, altroRows: function () { return []; }, open: function () { } };
    var showCfg = function () {
      overlay(typeof firebase === 'undefined'
        ? '<h2>Nessuna connessione</h2><p>Per il primo avvio serve internet. Controlla la connessione e riapri l’app.</p><button class="btn" onclick="location.reload()">Riprova</button>'
        : '<h2>Quasi pronta</h2><p>Manca il collegamento al database Firebase del cantiere. Va inserito una sola volta nel file <b>config.js</b> del sito.</p>');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showCfg); else showCfg();
    return;
  }

  /* ---------- Firebase ---------- */
  firebase.initializeApp(CFG);
  /* App Check: dimostra a Google che le richieste all'AI arrivano dal nostro sito (obbligatorio per AI Logic dal 2/11/2026).
     Sta su un'app Firebase a parte ('ai'), usata solo per il gettone dell'AI: così accesso e dati non lo aspettano mai,
     anche se reCAPTCHA non si carica (senza campo, blocco pubblicità…). Si accende solo la prima volta che serve, a pagina caricata.
     Per le prove fuori dal sito: localStorage 'nm_appcheck_debug' = gettone di debug registrato nella console. */
  var ACK = window.NM_APPCHECK || {}, AC_P = null;
  function appCheckToken() {
    if (!ACK.siteKey || !firebase.appCheck) return Promise.resolve('');
    if (!AC_P) AC_P = new Promise(function (res) {
      if (document.body) res(); else document.addEventListener('DOMContentLoaded', function () { res(); });
    }).then(function () {
      var dbg = null; try { dbg = localStorage.getItem('nm_appcheck_debug'); } catch (e) { }
      if (dbg) self.FIREBASE_APPCHECK_DEBUG_TOKEN = dbg === 'true' ? true : dbg;
      var ac = firebase.appCheck(firebase.initializeApp(CFG, 'ai'));
      ac.activate(ACK.tipo === 'enterprise' ? new firebase.appCheck.ReCaptchaEnterpriseProvider(ACK.siteKey) : new firebase.appCheck.ReCaptchaV3Provider(ACK.siteKey), false); // niente rinnovo automatico: il gettone si chiede solo quando si usa l’AI (meno verifiche, restano nella quota gratis)
      return ac;
    }).catch(function (e) { console.warn('App Check', e); return null; });
    return AC_P.then(function (ac) {
      if (!ac) { AC_P = null; return ''; }
      var t = ac.getToken(false).then(function (r) { return r && r.token || ''; }, function (e) { console.warn('App Check', e); return ''; });
      return Promise.race([t, new Promise(function (r) { setTimeout(function () { r(''); }, 15000); })]); // mai bloccare l’AI più di 15 secondi
    });
  }
  var auth = firebase.auth(); auth.languageCode = 'it';
  var fs = firebase.firestore();
  try { fs.settings({ cacheSizeBytes: 100 * 1024 * 1024, ignoreUndefinedProperties: true, merge: true }); } catch (e) { }
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () { }); } catch (e) { }
  var FV = firebase.firestore.FieldValue, TS = firebase.firestore.Timestamp;

  var READY_RES, READY = new Promise(function (r) { READY_RES = r; });
  var ME = null, UT = {}, UT_UNSUB = null, ME_UNSUB = null, registering = false, started = false, CLIENTE = false;
  // Più aziende sullo stesso sito: i dati di ognuna stanno in aziende/{AZ}/…; profili (utenti), aziende e codici sono comuni.
  // Le regole (firestore.rules) fanno vedere a ognuno solo la sua azienda.
  var AZ = '', AZD = undefined, MEX = null, AZ_UNSUB = null;
  function AC(name) { return fs.collection('aziende').doc(AZ || '_').collection(name); }

  /* ---------- collezioni vive: archivio locale + solo ciò che è cambiato ---------- */
  var LIVE = {};
  function live(name) {
    if (LIVE[name]) return LIVE[name];
    var L = LIVE[name] = { name: name, map: {}, ts: 0, full: 0, ready: false, subs: [], waiters: [] };
    L.start = READY.then(function () { return IDB.get('colls', AZ + '/' + name); }).then(function (saved) {
      if (saved && saved.docs) { L.map = saved.docs; L.ts = saved.ts || 0; L.full = saved.full || 0; markReady(L); emit(L); }
      listen(L);
    });
    return L;
  }
  function markReady(L) { if (!L.ready) { L.ready = true; L.waiters.splice(0).forEach(function (f) { f(); }); } }
  function whenReady(L, ms) { return L.ready ? Promise.resolve() : new Promise(function (r) { L.waiters.push(r); setTimeout(r, ms || 15000); }); }
  function listen(L) {
    if (L.unsub) { L.unsub(); L.unsub = null; }
    var fullDue = !L.full || !L.ts || Date.now() - L.full > FULL_EVERY;
    var q = AC(L.name);
    // PIN del tablet: chi non è amministratore, gestore in assistenza né tablet legge solo il suo (vedi firestore.rules), sempre per intero
    if (L.name === 'pin' && !(ME && (ME.ruolo === 'admin' || ME.assist || ME.tablet))) { fullDue = true; q = q.where('utente', '==', ME ? ME.uid : '-'); }
    else if (!fullDue) q = q.where('_ts', '>=', TS.fromMillis(L.ts - 5000));
    var first = true;
    L.unsub = q.onSnapshot(function (snap) {
      if (first && fullDue) {
        var m = {};
        snap.docs.forEach(function (d) { var x = d.data({ serverTimestamps: 'estimate' }); track(L, x, d); if (!x._del) m[d.id] = strip(x); });
        Object.keys(L.pend || {}).forEach(function (id) { if (L.pend[id] === 'del') delete m[id]; else if (L.map[id]) m[id] = L.map[id]; });
        L.map = m; L.full = Date.now();
      } else {
        snap.docChanges().forEach(function (ch) {
          var id = ch.doc.id;
          if (ch.type === 'removed') { delete L.map[id]; return; }
          var x = ch.doc.data({ serverTimestamps: 'estimate' }); track(L, x, ch.doc);
          if (x._del) delete L.map[id]; else L.map[id] = strip(x);
        });
      }
      first = false; markReady(L); save(L); emit(L);
    }, function (err) {
      var e = errOf(err);
      L.subs.forEach(function (s) { if (s.err) try { s.err(e); } catch (x) { } });
      if (e.code === 'permission_denied') return;
      setTimeout(function () { listen(L); }, 4000);
    });
  }
  function track(L, x, d) { if (x && x._ts && x._ts.toMillis && !(d.metadata && d.metadata.hasPendingWrites)) L.ts = Math.max(L.ts, x._ts.toMillis()); }
  function save(L) {
    clearTimeout(L.st);
    L.st = setTimeout(function () { IDB.put('colls', AZ + '/' + L.name, { docs: L.map, ts: L.ts, full: L.full }); }, 500);
  }
  function snapOf(L) {
    var docs = Object.keys(L.map).map(function (id) { var d = L.map[id]; return { id: id, exists: true, data: function () { return clone(d); }, metadata: { fromCache: false } }; });
    return { docs: docs, size: docs.length, empty: !docs.length };
  }
  function emit(L) {
    var s = snapOf(L); L.subs.slice().forEach(function (x) { try { x.next(s); } catch (e) { console.error(e); errScrivi(e); } });
    if (L.name === 'barche' || L.name === 'lavori' || L.name === 'posti' || L.name === 'deposito' || L.name === 'impostazioni' || L.name === 'preventivi' || L.name === 'scadenze') schedulePortale();
  }
  function docSnap(id, d) { return { id: id, exists: !!d, data: function () { return d ? clone(d) : undefined; } }; }

  // la scrittura parte subito sul dispositivo; il server conferma dopo (anche senza campo)
  function settle(p, L) {
    return new Promise(function (res, rej) {
      var done = false;
      p.then(function () { if (!done) { done = true; res(); } }, function (e) {
        var x = errOf(e);
        if (!done) { done = true; rej(x); }
        else { toast('Una modifica non è stata salvata (' + x.code + '). Ricarico i dati.'); }
        if (L) { L.full = 0; listen(L); }
      });
      setTimeout(function () { if (!done) { done = true; res(); } }, 1200);
    });
  }
  var DELG = { id: '', t: 0 };
  function write(name, id, kind, data) {
    var L = live(name), r = AC(name).doc(id), ts = FV.serverTimestamp(), p, prev0 = L.map[id] ? clone(L.map[id]) : null;
    L.pend = L.pend || {};
    if (kind === 'set') {
      data = Object.assign({}, data || {});
      // chi l'ha aggiunto: serve per sapere chi può cancellarlo. Si conserva quando si riscrive.
      var prev = L.map[id];
      if (prev && prev.creatoDa) data.creatoDa = prev.creatoDa;
      else if (!prev && L.ready && !data.creatoDa && ME && name !== 'portale') { data.creatoDa = chi(); if (AS) data.via = ME.uid; }
      var x = enc(clone(data)); x._ts = ts; p = r.set(x); L.map[id] = clone(data); L.pend[id] = 'set';
    } else if (kind === 'update') {
      if (L.ready && !L.map[id]) return Promise.reject({ code: 'not_found', message: 'Elemento non trovato' });
      var u = {}, d = data || {};
      Object.keys(d).forEach(function (k) { var v = d[k]; u[k] = (v && v.__delete__) ? FV.delete() : enc(clone(v)); });
      u._ts = ts; p = r.update(u);
      var m = Object.assign({}, L.map[id] || {});
      Object.keys(d).forEach(function (k) { if (d[k] && d[k].__delete__) delete m[k]; else m[k] = clone(d[k]); });
      L.map[id] = m; L.pend[id] = 'set';
    } else {
      var old = L.map[id];
      if (!canDel(name, old)) return Promise.reject({ code: 'permission_denied', message: 'Può cancellarlo solo un amministratore' });
      if (old) { // una copia va nel cestino, nella stessa scrittura
        var b = fs.batch();
        if (Date.now() - DELG.t > 3000) DELG.id = rid('g'); DELG.t = Date.now(); // cancellate di seguito (una barca con i suoi lavori): stesso gruppo
        b.set(AC('cestino').doc(rid('c')), { coll: name, docId: id, dati: enc(clone(old)), gruppo: DELG.id, da: ME.uid, daNome: (ME.nome || '') + (AS ? ' (tablet, ' + ((UT[AS] && UT[AS].nome) || '') + ')' : ''), il: nowISO(), _ts: ts });
        b.set(r, { _del: true, _ts: ts }); p = b.commit();
      } else p = r.set({ _del: true, _ts: ts });
      delete L.map[id]; L.pend[id] = 'del';
    }
    p.then(function () { if (L.pend) delete L.pend[id]; }, function () { if (L.pend) delete L.pend[id]; });
    pendAdd(p);
    attScrittura(name, kind === 'delete' ? 'cancella' : prev0 ? 'modifica' : 'aggiunge', data || prev0);
    emit(L); save(L);
    return settle(p, L);
  }
  // chi può cancellare: l'amministratore tutto; gli altri ciò che hanno aggiunto loro, le proprie mansioni della
  // scheda, le proprie giornate confermate, le proprie richieste di ferie non ancora decise, e i posti al porto.
  // Le stesse regole stanno in firestore.rules.
  // Tablet condiviso: l'account segnato «tablet» lavora a nome di chi ha scritto il suo PIN (AS); quello che aggiunge resta suo, con «via» = il tablet
  var AS = null;
  function chi() { return AS || (ME && ME.uid); }
  function canDel(name, d) {
    if (!ME) return false;
    if (ME.ruolo === 'admin') return true;
    if (!d) return false;
    if (name === 'posti') return true;
    if (name !== 'assenze' && (AS ? d.via === ME.uid : d.creatoDa === ME.uid)) return true; // l'ha aggiunto chi cancella (dal tablet: ciò che è stato aggiunto dal tablet)
    if (name === 'lavori') return d.fonte === 'scheda' && d.utente === chi();
    if (name === 'conferme') return d.utente === chi();
    if (name === 'assenze') return d.utente === chi() && d.stato === 'richiesta';
    return false;
  }
  function ref(name, id) {
    return {
      id: id,
      get: function () {
        var L = live(name);
        return whenReady(L, 8000).then(function () {
          if (L.ready) return docSnap(id, L.map[id] || null);
          return AC(name).doc(id).get().then(function (d) { var x = d.exists ? d.data() : null; return docSnap(id, x && !x._del ? strip(x) : null); }, function (e) { throw errOf(e); });
        });
      },
      set: function (data) { return write(name, id, 'set', data); },
      update: function (data) { return write(name, id, 'update', data); },
      delete: function () { return write(name, id, 'delete'); },
      onSnapshot: function (next, err) { return collection(name).onSnapshot(function () { next(docSnap(id, live(name).map[id] || null)); }, err); }
    };
  }
  function collection(name) {
    return {
      onSnapshot: function (next, err) {
        var L = live(name), s = { next: next, err: err }; L.subs.push(s);
        if (L.ready) setTimeout(function () { if (L.subs.indexOf(s) >= 0) next(snapOf(L)); }, 0);
        return function () { L.subs = L.subs.filter(function (x) { return x !== s; }); };
      },
      get: function () { var L = live(name); return L.start.then(function () { return whenReady(L, 15000); }).then(function () { return snapOf(L); }); },
      doc: function (id) { return ref(name, id || AC(name).doc().id); }
    };
  }
  var DB = {
    collection: collection,
    doc: function (path) { var p = String(path).split('/'); return ref(p[0], p[1]); }
  };

  /* ---------- persone ---------- */
  var USER = {
    id: function () { return Promise.resolve(ME && ME.uid); },
    me: function () { return Promise.resolve({ id: ME.uid, name: ME.nome || '', isOwner: ME.ruolo === 'admin' }); },
    isOwner: function () { return !!ME && ME.ruolo === 'admin'; },
    canEdit: function () { return Promise.resolve(!!ME && (ME.ruolo === 'admin' || ME.ruolo === 'editor')); },
    can: function (n) { return Promise.resolve(n === 'data.write' ? true : null); },
    profiles: function (ids) {
      var o = {}; (ids || []).forEach(function (id) { var u = UT[id]; o[id] = { id: id, name: u ? (u.nome || '') : '', avatarUrl: '' }; });
      return Promise.resolve(o);
    },
    search: function (q) {
      q = String(q || '').toLowerCase();
      return Promise.resolve(Object.keys(UT).filter(function (id) { return UT[id].stato === 'attivo' && (!q || String(UT[id].nome || '').toLowerCase().indexOf(q) >= 0); })
        .map(function (id) { return { id: id, name: UT[id].nome || '' }; }));
    }
  };

  /* ---------- foto: compresse e salvate nel database ---------- */
  var PH = {}, PH_LOADING = {}, PH_MISS = {};
  function blobToDataUrl(b) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(b); }); }
  function shrink(blob, max, q) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || blob); }, 'image/jpeg', q);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(blob); };
      img.src = url;
    });
  }
  function patchImgs(id, url) { // anche le <image> dentro gli svg (la planimetria della mappa), che usano href
    document.querySelectorAll('[data-blob="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]').forEach(function (im) { var a = im.tagName === 'IMG' ? 'src' : 'href'; if (im.getAttribute(a) !== url) im.setAttribute(a, url); });
  }
  function loadPhoto(id) {
    if (PH[id] || PH_LOADING[id] || PH_MISS[id]) return; PH_LOADING[id] = true;
    IDB.get('foto', id).then(function (u) {
      if (u) return u;
      return AC('foto').doc(id).get().then(function (d) { var x = d.exists ? d.data() : null; if (x && x.data && !x._del) { IDB.put('foto', id, x.data); return x.data; } return null; });
    }).then(function (u) { delete PH_LOADING[id]; if (u) { PH[id] = u; patchImgs(id, u); } else PH_MISS[id] = true; }, function () { delete PH_LOADING[id]; PH_MISS[id] = true; });
  }
  var ASSETS = {
    upload: function (blob) {
      return (async function () {
        var b = blob;
        if (b.size > 450 * 1024) b = await shrink(b, 1400, 0.72);
        if (b.size > 650 * 1024) b = await shrink(b, 1100, 0.6);
        if (b.size > 700 * 1024) throw { code: 'too_large', message: 'Foto troppo grande' };
        var url = await blobToDataUrl(b), id = rid('f');
        // con la foto, una scheda leggera in «fotoInfo» (quanto pesa): così lo spazio si conta senza scaricare le foto
        var fb = fs.batch(), cr = nowISO(), da = ME ? chi() : '';
        fb.set(AC('foto').doc(id), { data: url, creato: cr, da: da, _ts: FV.serverTimestamp() });
        fb.set(AC('fotoInfo').doc(id), { kb: Math.ceil(url.length / 1024), creato: cr, da: da, _ts: FV.serverTimestamp() });
        var fp = fb.commit(); pendAdd(fp);
        await settle(fp);
        PH[id] = url; IDB.put('foto', id, url);
        return { id: id, url: url, sizeBytes: b.size, contentType: 'image/jpeg' };
      })();
    },
    delete: function (id) { delete PH[id]; IDB.del('foto', id); return settle(AC('foto').doc(id).set({ _del: true, _ts: FV.serverTimestamp() })); },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  };

  /* ---------- file da salvare (copia dei dati) ---------- */
  var DL = {
    save: function (o) {
      return (async function () {
        var name = o.filename || 'file', data = o.data;
        var type = /\.json$/i.test(name) ? 'application/json' : /\.csv$/i.test(name) ? 'text/csv' : /\.txt$/i.test(name) ? 'text/plain' : 'application/octet-stream';
        var blob = data instanceof Blob ? data : new Blob([data], { type: type });
        var mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (mobile && navigator.canShare) {
          try {
            var file = new File([blob], name, { type: blob.type || type });
            if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return { status: 'saved' }; }
          } catch (e) { if (e && e.name === 'AbortError') throw { code: 'declined', message: 'Annullato' }; }
        }
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
        return { status: 'saved' };
      })();
    }
  };

  /* ---------- accesso, registrazione, attesa ---------- */
  var AUTH_MSG = {
    'auth/invalid-credential': 'Email o password sbagliate.', 'auth/wrong-password': 'Email o password sbagliate.', 'auth/user-not-found': 'Nessun account con questa email: registrati.',
    'auth/invalid-login-credentials': 'Email o password sbagliate.', 'auth/email-already-in-use': 'Esiste già un account con questa email: accedi.',
    'auth/weak-password': 'La password deve avere almeno 6 caratteri.', 'auth/invalid-email': 'Email non valida.', 'auth/missing-password': 'Scrivi la password.',
    'auth/network-request-failed': 'Nessuna connessione. Riprova quando hai campo.', 'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.'
  };
  function authErr(e) { return AUTH_MSG[e && e.code] || ('Non è andata: ' + ((e && (e.code || e.message)) || 'errore')); }
  function busy(form, on) { form.querySelectorAll('button').forEach(function (b) { b.disabled = on; }); }
  // campo password con l'occhio per vederla mentre si scrive
  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';
  function pwField(id, auto, extra) {
    return '<div class="pw"><input id="' + id + '" type="password" autocomplete="' + auto + '" autocapitalize="off" autocorrect="off" spellcheck="false" required' + (extra || '') + '>' +
      '<button type="button" class="eye" data-eye="' + id + '" aria-label="Mostra la password" aria-pressed="false">' + EYE + '</button></div>';
  }
  // tenere il cursore nel campo quando si tocca l'occhio (così la tastiera non si chiude)
  document.addEventListener('pointerdown', function (e) { if (e.target.closest && e.target.closest('#nmfb .eye')) e.preventDefault(); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#nmfb .eye'); if (!b) return;
    var inp = document.getElementById(b.getAttribute('data-eye')); if (!inp) return;
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-label', show ? 'Nascondi la password' : 'Mostra la password');
    b.setAttribute('aria-pressed', String(show));
  });
  function showLogin(msg) {
    var o = overlay('<h2>Accedi</h2><p>Entra con l’email e la password del tuo account del cantiere.</p>' +
      '<form id="nm-login"><label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<label for="nm-pw">Password</label>' + pwField('nm-pw', 'current-password') +
      '<button class="btn" type="submit">Accedi</button><div class="err" id="nm-err">' + esc(msg || '') + '</div></form>' +
      '<button class="lnk" id="nm-goreg">Prima volta? Crea il tuo account</button><button class="lnk" id="nm-goreset">Password dimenticata</button>' +
      '<button class="btn" id="nm-prova" type="button" style="margin-top:22px;background:transparent;border:1px solid rgba(255,255,255,.35)">Prova senza registrarti</button><p class="nm-prova-n" style="font-size:13px;opacity:.75;margin-top:6px;text-align:center">Un cantiere di esempio da toccare e modificare: non si salva nulla e sparisce quando chiudi la finestra.</p>');
    var f = $('#nm-login', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true); $('#nm-err').textContent = '';
      auth.signInWithEmailAndPassword($('#nm-em').value.trim(), $('#nm-pw').value).catch(function (er) { busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-goreg', o).onclick = showRegister; $('#nm-goreset', o).onclick = showReset;
    $('#nm-prova', o).onclick = function () { try { sessionStorage.setItem('nm-prova', '1'); } catch (e) { location.href = location.pathname + '?prova'; return; } location.reload(); };
  }
  // Codice dell'azienda: 8 tra lettere e numeri, senza quelli che si confondono (0 O 1 I L); si mostra come K7P4-M2QX
  var COD_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  function codNuovo() { var a = new Uint32Array(8), c = ''; crypto.getRandomValues(a); for (var i = 0; i < 8; i++) c += COD_ABC[a[i] % COD_ABC.length]; return c; }
  function codPulito(v) { return String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); }
  function codBello(c) { c = codPulito(c); return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c; }
  var PRIV = 'Per l’assistenza, il gestore del servizio vede gli accessi, le azioni e gli errori dell’app, non i vostri dati. Le mappe e gli indirizzi cercati per il percorso del trasporto passano da servizi pubblici gratuiti (OpenStreetMap e OSRM).';
  var COME = '<details class="gd"><summary>Come funziona?</summary><ul>' +
    '<li><b>Un’azienda nuova</b> sceglie «Registro la mia azienda». La richiesta arriva al gestore del servizio: quando la approva, chi l’ha fatta entra come amministratore.</li>' +
    '<li>Ogni azienda ha un suo <b>codice</b> (per esempio K7P4-M2QX). L’amministratore lo trova in Altro › Utenti e permessi e lo manda a colleghi e clienti.</li>' +
    '<li><b>Colleghi e clienti</b> scelgono «Entro nella mia azienda», scrivono il codice e i loro dati, poi aspettano che l’amministratore li approvi.</li>' +
    '<li>Ogni azienda vede solo i suoi dati.</li></ul></details>';
  // u: chi ha già l'account ma non ancora il profilo (registrazione interrotta, codice sbagliato): sceglie solo l'azienda
  function showRegister(modo, u, d, msg) {
    var az = modo === 'azienda'; d = d || {};
    function v(k) { return esc(d[k] || ''); }
    var o = overlay('<h2>' + (u ? 'Scegli la tua azienda' : 'Crea il tuo account') + '</h2>' +
      '<form id="nm-reg"><label class="opt"><input type="radio" name="nm-modo" value="codice"' + (az ? '' : ' checked') + '> Entro nella mia azienda con il suo codice</label>' +
      '<label class="opt"><input type="radio" name="nm-modo" value="azienda"' + (az ? ' checked' : '') + '> Registro la mia azienda</label>' +
      (az ? '<p style="margin-top:14px">Il gestore del servizio controlla la richiesta: appena la approva entri come amministratore e puoi far entrare colleghi e clienti con il codice dell’azienda.</p>' +
        '<label for="nm-az">Nome dell’azienda</label><input id="nm-az" type="text" autocomplete="organization" required maxlength="60" value="' + v('azNome') + '">' +
        '<label for="nm-tel">Telefono</label><input id="nm-tel" type="tel" autocomplete="tel" inputmode="tel" required maxlength="30" value="' + v('tel') + '">'
        : '<p style="margin-top:14px">Il codice te lo dà l’amministratore della tua azienda. Dopo la registrazione ti deve approvare.</p>' +
        '<label for="nm-cod">Codice dell’azienda</label><input id="nm-cod" type="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" required maxlength="12" placeholder="es. K7P4-M2QX" value="' + v('codice') + '">' +
        '<label>Chi sei?</label><label class="opt"><input type="radio" name="nm-tipo" value="staff"' + (d.tipo === 'cliente' ? '' : ' checked') + '> Lavoro in azienda</label>' +
        '<label class="opt"><input type="radio" name="nm-tipo" value="cliente"' + (d.tipo === 'cliente' ? ' checked' : '') + '> Sono un cliente</label>') +
      '<label for="nm-nm">Nome e cognome</label><input id="nm-nm" type="text" autocomplete="name" required maxlength="60" value="' + v('nome') + '">' +
      (u ? '' : '<label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required value="' + v('email') + '">' +
        '<label for="nm-pw">Password (almeno 6 caratteri)</label>' + pwField('nm-pw', 'new-password', ' minlength="6"')) +
      (az ? '<p style="font-size:.85rem;margin:12px 0 0">' + esc(PRIV) + '</p>' : '') +
      '<button class="btn" type="submit">' + (az ? 'Invia la richiesta' : u ? 'Entra nell’azienda' : 'Crea account') + '</button><div class="err" id="nm-err">' + esc(msg || '') + '</div></form>' +
      (u ? '<button class="lnk" id="nm-out">Esci</button>' : '<button class="lnk" id="nm-gologin">Ho già un account: accedi</button>') + COME);
    var f = $('#nm-reg', o);
    function dati() {
      var g = function (id) { var e = $('#' + id, f); return e ? e.value.trim() : ''; };
      return { modo: az ? 'azienda' : 'codice', azNome: g('nm-az'), tel: g('nm-tel'), codice: g('nm-cod'), tipo: (f.querySelector('input[name="nm-tipo"]:checked') || {}).value === 'cliente' ? 'cliente' : 'staff', nome: g('nm-nm'), email: u ? (u.email || '') : g('nm-em') };
    }
    f.addEventListener('change', function (e) { if (e.target.name === 'nm-modo' && (e.target.value === 'azienda') !== az) { var x = dati(); showRegister(e.target.value, u, x); } });
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true); $('#nm-err').textContent = '';
      var x = dati();
      if (!az && codPulito(x.codice).length !== 8) { busy(f, false); $('#nm-err').textContent = 'Il codice ha 8 tra lettere e numeri, per esempio K7P4-M2QX.'; return; }
      registering = true;
      var acc = u ? Promise.resolve({ user: u }) : auth.createUserWithEmailAndPassword(x.email, $('#nm-pw').value);
      acc.then(function (cr) {
        return creaProfilo(cr.user, x).then(function () { registering = false; watchMe(cr.user); }, function (er) {
          registering = false; showRegister(x.modo, cr.user, x, er && er.code === 'codice' ? 'Codice non trovato: controlla di averlo scritto giusto, o chiedine uno nuovo al tuo amministratore.' : 'Non è andata (' + errOf(er).code + '). Riprova.');
        });
      }, function (er) { registering = false; busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    if (u) $('#nm-out', o).onclick = logout; else $('#nm-gologin', o).onclick = function () { showLogin(); };
  }
  async function creaProfilo(u, d) {
    var now = nowISO(), base = { nome: d.nome || (u.email || '').split('@')[0], email: d.email || u.email || '', creato: now, modificato: now, stato: 'in_attesa' };
    if (d.modo === 'azienda') { // l'azienda e il suo amministratore nascono insieme, tutti e due in attesa del gestore
      var ar = fs.collection('aziende').doc(), b = fs.batch();
      b.set(ar, { nome: d.azNome, telefono: d.tel, admin: u.uid, adminNome: base.nome, email: base.email, stato: 'in_attesa', creato: now });
      b.set(fs.collection('utenti').doc(u.uid), Object.assign(base, { tipo: 'staff', ruolo: 'admin', azienda: ar.id }));
      return b.commit();
    }
    var c = codPulito(d.codice), cd = await fs.collection('codici').doc(c).get({ source: 'server' }).catch(function () { return null; });
    if (!cd || !cd.exists || !cd.data().azienda) throw { code: 'codice' };
    return fs.collection('utenti').doc(u.uid).set(Object.assign(base, { tipo: d.tipo === 'cliente' ? 'cliente' : 'staff', ruolo: 'base', azienda: cd.data().azienda, codice: c }));
  }
  function showReset() {
    var o = overlay('<h2>Password dimenticata</h2><p>Ti mandiamo un’email con il link per sceglierne una nuova.</p>' +
      '<form id="nm-rs"><label for="nm-em">Email</label><input id="nm-em" type="email" autocomplete="username" inputmode="email" required>' +
      '<button class="btn" type="submit">Mandami il link</button><div class="err" id="nm-err"></div></form><button class="lnk" id="nm-gologin">Torna all’accesso</button>');
    var f = $('#nm-rs', o);
    f.addEventListener('submit', function (e) {
      e.preventDefault(); busy(f, true);
      auth.sendPasswordResetEmail($('#nm-em').value.trim()).then(function () { $('#nm-err').innerHTML = '<span class="ok">Fatto: controlla la posta (anche lo spam).</span>'; busy(f, false); },
        function (er) { busy(f, false); $('#nm-err').textContent = authErr(er); });
    });
    $('#nm-gologin', o).onclick = function () { showLogin(); };
  }
  function showWait(u, nuova) {
    var o = overlay('<h2>Richiesta inviata</h2><div class="card"><p style="margin:0">Ciao <b>' + esc(u.nome || '') + '</b>, ' +
      (nuova ? 'la richiesta per <b>' + esc((AZD && AZD.nome) || 'la tua azienda') + '</b> è arrivata al gestore del servizio. Appena la approva, l’app si apre da sola e da Altro › Utenti e permessi potrai far entrare colleghi e clienti.'
        : 'il tuo account è in attesa. ' + (AZD && AZD.nome ? 'L’amministratore di <b>' + esc(AZD.nome) + '</b>' : 'L’amministratore della tua azienda') + ' deve approvarlo: appena lo fa, l’app si apre da sola.') + '</p></div>' +
      '<button class="lnk" id="nm-out">Esci</button>');
    $('#nm-out', o).onclick = logout;
  }
  /* ---------- prova e abbonamento: aziende/{az}.scade (ultimo giorno, AAAA-MM-GG) e scadeMs (fine di quel giorno, per le regole) ---------- */
  var PROVA_GG = 30;
  function oggiISO() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function piuGiorni(g, n) { var d = new Date(Date.parse(g + 'T12:00:00Z') + n * 864e5); return d.toISOString().slice(0, 10); }
  function fineGiorno(g) { return Date.parse(g + 'T23:59:59+01:00'); }
  function giorniA(g) { return Math.round((Date.parse(g + 'T12:00:00Z') - Date.parse(oggiISO() + 'T12:00:00Z')) / 864e5); }
  function dataIt(g) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(g || ''); return m ? (+m[3]) + '/' + (+m[2]) + '/' + m[1] : ''; }
  function azScaduta(A) { return !!(A && A.scadeMs && Date.now() > A.scadeMs); }
  setInterval(function () { if (started && AZD && azScaduta(AZD)) location.reload(); }, 10 * 60 * 1000);
  function showScaduto(x) {
    var adm = x.stato === 'attivo' && x.ruolo === 'admin', cosa = AZD && AZD.abbonata ? 'L’abbonamento' : 'Il periodo di prova';
    var o = overlay('<h2>Abbonamento scaduto</h2><p>' + cosa + ' di <b>' + esc((AZD && AZD.nome) || 'la tua azienda') + '</b> è finito il ' + esc(dataIt(AZD && AZD.scade)) + '. ' +
      (adm ? 'I dati restano salvati e non vengono cancellati: per continuare a usare l’app contatta il gestore del servizio. Intanto puoi scaricare una copia di tutti i dati.</p><button class="btn" id="nm-scar">Scarica i dati</button><p id="nm-scar-st" style="margin-top:8px"></p>'
        : 'I dati restano salvati. Per informazioni parla con l’amministratore della tua azienda.</p>') + '<button class="lnk" id="nm-out">Esci</button>');
    $('#nm-out', o).onclick = logout;
    var b = $('#nm-scar', o); if (b) b.onclick = function () { scaricaScaduto(x.azienda, b, $('#nm-scar-st', o)); };
  }
  // la stessa copia di Altro › Copia dei dati (senza foto): si recupera con «Recupera ciò che manca»
  async function scaricaScaduto(az, b, st) {
    b.disabled = true; var ref = fs.collection('aziende').doc(az), coll = {}, conteggi = {}, tot = 0, cs = COLLS.filter(function (c) { return c !== 'foto'; });
    try {
      for (var i = 0; i < cs.length; i++) {
        st.textContent = 'Scarico ' + (i + 1) + ' di ' + cs.length + '…';
        var s = await ref.collection(cs[i]).get(), m = {}, n = 0;
        s.docs.forEach(function (d) { if (cs[i] === 'impostazioni' && d.id === 'backup') return; m[d.id] = d.data(); n++; });
        coll[cs[i]] = m; conteggi[cs[i]] = n; tot += n;
      }
      var file = { app: 'Gestionale cantiere', tipo: 'Copia dei dati', formato: 1, creata: nowISO(), creataDa: (MEX && MEX.nome) || '', voci: tot, conteggi: conteggi, collezioni: coll };
      var blob = new Blob([JSON.stringify(file, function (k, v) { return v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v; }, 1)], { type: 'application/json' }), u = URL.createObjectURL(blob), l = document.createElement('a');
      l.href = u; l.download = (String((AZD && AZD.nome) || 'Gestionale').replace(/[^A-Za-z0-9-]+/g, '') || 'Gestionale') + '-copia-' + oggiISO() + '.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
      st.textContent = 'Scaricato: ' + tot + ' voci.';
    } catch (e) { st.textContent = 'Non riuscito (' + errOf(e).code + '). Riprova.'; }
    b.disabled = false;
  }
  // in Home, agli amministratori: gli ultimi 7 giorni prima della scadenza (si chiude per quel giorno)
  function avvisoAbb() {
    var el = $('#nmabb'), A = AZD, d = A && A.scade && A.scadeMs ? giorniA(A.scade) : null, visto = '';
    try { visto = localStorage.getItem('gr-abb-visto') || ''; } catch (e) { }
    if (!ME || ME.ruolo !== 'admin' || ME.assist || d == null || d > 7 || d < 0 || visto === oggiISO() + A.scade) { if (el) el.remove(); return; }
    ensureCss(); if (!el) { el = document.createElement('div'); el.id = 'nmabb'; document.body.appendChild(el); }
    el.innerHTML = '<div class="it"><b>' + (A.abbonata ? 'L’abbonamento' : 'La prova') + ' finisce ' + (d === 0 ? 'oggi' : d === 1 ? 'domani' : 'tra ' + d + ' giorni') + '</b> (' + esc(dataIt(A.scade)) + ').<br>Dopo, l’app si blocca finché non rinnovi; i dati restano salvati. Per continuare contatta il gestore del servizio.<br><button class="ok">Ho capito</button></div>';
  }
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#nmabb .ok'); if (!b) return; try { localStorage.setItem('gr-abb-visto', oggiISO() + (AZD && AZD.scade)); } catch (x) { } var el = $('#nmabb'); if (el) el.remove(); });

  function showBlocked(perche) {
    var o = overlay('<h2>Accesso sospeso</h2><p>' + (perche === 'azienda' ? 'La tua azienda non è attiva in questo momento. Per informazioni contatta il gestore del servizio.' :
      perche === 'nessuna' ? 'Il tuo account non è collegato a nessuna azienda attiva.' : 'Il tuo account non è attivo. Parla con un amministratore della tua azienda.') + '</p><button class="lnk" id="nm-out">Esci</button>');
    $('#nm-out', o).onclick = logout;
  }
  function logout() {
    var ask = $('#nmfb') ? true : confirm('Vuoi uscire? Su questo telefono verranno tolti i dati salvati per lavorare senza campo.');
    if (!ask) return;
    try { sessionStorage.removeItem('nm-assist'); } catch (e) { }
    Promise.resolve(IDB.clear()).then(function () { return auth.signOut(); }).then(function () {
      try { fs.terminate().then(function () { return fs.clearPersistence(); }).finally(function () { location.reload(); }); } catch (e) { location.reload(); }
    });
  }
  function watchMe(u) {
    if (ME_UNSUB) { ME_UNSUB(); ME_UNSUB = null; }
    overlay('<div class="spin"></div>');
    ME_UNSUB = fs.collection('utenti').doc(u.uid).onSnapshot(function (d) {
      if (!d.exists) { if (!registering && !started) showRegister('codice', u); return; }
      var x = d.data(); x.uid = u.uid; x.email = x.email || u.email;
      if (x.ruolo === 'creatore') { if (x.stato === 'attivo') avviaCreatore(x); else showBlocked(); return; }
      if (!x.azienda) { if (started) location.reload(); else showRegister('codice', u, { nome: x.nome }); return; }
      seguiAzienda(x);
    }, function (e) {
      if (!started) showLogin('Non riesco a leggere il tuo account (' + errOf(e).code + '). Riprova.');
    });
  }
  // la scheda dell'azienda dice se è attiva (approvata dal gestore) e ha il codice e il permesso di assistenza
  function seguiAzienda(x) {
    MEX = x;
    // chi è in attesa con il codice non legge la scheda dell'azienda: quando viene approvato la si riapre
    if (!AZ_UNSUB || AZ_UNSUB.az !== x.azienda || (AZD === null && AZ_UNSUB.st !== x.stato)) {
      if (AZ_UNSUB) AZ_UNSUB();
      AZD = undefined;
      var un = fs.collection('aziende').doc(x.azienda).onSnapshot(function (d) { AZD = d.exists ? d.data() : null; decidi(); if (started) avvisoAbb(); if ($('#nmpan')) renderPanel(); }, function () { AZD = null; decidi(); });
      un.az = x.azienda; un.st = x.stato; AZ_UNSUB = un;
    }
    decidi();
  }
  function decidi() {
    var x = MEX; if (!x || AZD === undefined) return;
    if (!AZD || AZD.stato !== 'attiva') {
      if (started) { location.reload(); return; }
      if (!AZD && x.stato === 'in_attesa' && x.ruolo !== 'admin') { showWait(x); return; }
      if (!AZD && x.stato === 'bloccato') { showBlocked(); return; }
      if (AZD && AZD.stato === 'in_attesa') showWait(x, true); else showBlocked(AZD ? 'azienda' : 'nessuna');
      return;
    }
    if (azScaduta(AZD)) { if (started) { location.reload(); return; } showScaduto(x); return; }
    AZ = x.azienda;
    if (x.stato === 'attivo' && x.ruolo === 'cliente') { if (started) { location.reload(); return; } if (!CLIENTE) { ME = x; showCliente(x); } return; }
    if (CLIENTE) { location.reload(); return; }
    if (x.stato === 'attivo') {
      var was = ME; ME = x;
      if (!started) { started = true; hideOverlay(); READY_RES(); afterStart(); }
      else if (was && (was.ruolo !== x.ruolo || !!was.tablet !== !!x.tablet)) location.reload();
    } else if (started) location.reload();
    else if (x.stato === 'bloccato') showBlocked();
    else showWait(x);
  }
  var DOM = new Promise(function (r) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', r, { once: true }); else r(); });
  auth.onAuthStateChanged(function (u) {
    DOM.then(function () {
      if (!u) { if (started) { location.reload(); return; } if (/^#registra$/.test(location.hash)) { history.replaceState(null, '', location.pathname + location.search); showRegister('azienda'); } else showLogin(); return; } // #registra: arriva dalla pagina di presentazione
      if (!registering) watchMe(u);
    });
  });
  function boot() { if (!started && !$('#nmfb')) overlay('<div class="spin"></div>'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  function afterStart() {
    msgServizio(); avvisoAbb(); setTimeout(novitaMostra, 2500);
    UT_UNSUB = fs.collection('utenti').where('azienda', '==', AZ).onSnapshot(function (s) {
      var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); UT = m; if ($('#nmpan')) renderPanel(); schedulePortale();
    }, function () { });
    // il nome nella scheda lavoro
    var D = live('dipendenti');
    D.start.then(function () { return whenReady(D, 15000); }).then(function () {
      if (ME && !ME.assist && !D.map[ME.uid]) write('dipendenti', ME.uid, 'set', { nome: ME.nome || '', modificato: nowISO() }).catch(function () { });
    });
    if (ME && ME.ruolo === 'admin' && !ME.assist) { setTimeout(purgeCestino, 5000); setTimeout(pulisciSegnaposto, 20000); }
    pendVecchie();
    attEntra(); attAscolta();
    // aperto dal link per portare i dati dall'app di Claude
    if (IMP_KEY) setTimeout(offerImport, 800);
  }

  /* ---------- tablet condiviso: sezione accesa in Altro › Aspetto › Sezioni, PIN di 4 cifre (si salva solo l'impronta) ---------- */
  function tabStr() { var L = LIVE.impostazioni, c = L && L.map && L.map.sezioni; return !!(c && !c._del && (c.conosce || []).indexOf('tablet') >= 0 && (c.spente || []).indexOf('tablet') < 0); }
  function pinDi(uid) { var L = LIVE.pin, x = L && L.map && L.map[uid]; return x && !x._del && x.hash ? x : null; }
  async function pinHash(uid, pin) {
    var b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nm-pin|' + uid + '|' + pin));
    return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
  }
  async function pinSalva(uid, pin) {
    pin = String(pin || '').trim();
    if (!/^\d{4}$/.test(pin)) { toast('Il PIN è di 4 cifre.'); return; }
    if (/^(\d)\1{3}$/.test(pin) || pin === '1234') { toast('Scegli un PIN meno facile da indovinare.'); return; }
    try { await write('pin', uid, 'set', { utente: uid, hash: await pinHash(uid, pin), modificato: nowISO() }); toast('PIN salvato.'); renderPanel(); } catch (e) { toast('Non riuscito: ' + errOf(e).code); }
  }

  /* ---------- pannelli: utenti e permessi, il mio account ---------- */
  var PAN = null;
  function altroRows() {
    if (!ME) return [];
    var rows = [];
    if (ME.assist) rows.push(['assistout', 'out', 'soon', 'Esci dall’assistenza', 'Sei nei dati di ' + ME.assist + ' per assistenza', '']);
    if (ME.ruolo === 'admin') {
      var n = Object.keys(UT).filter(function (id) { return UT[id].stato === 'in_attesa'; }).length;
      rows.push(['utenti', 'users', n ? 'soon' : '', 'Utenti e permessi', 'Approva i colleghi e decidi i permessi', n ? '<span class="pill soon">' + n + (n === 1 ? ' in attesa' : ' in attesa') + '</span>' : '']);
    }
    if (ME.ruolo === 'admin') rows.push(['cestino', 'trash', '', 'Cestino', 'Ciò che è stato cancellato negli ultimi 60 giorni: si può recuperare', '']);
    rows.push(['account', 'out', '', 'Il mio account', (ME.email || '') + ' · ' + (RUOLI[ME.ruolo] || ''), '']);
    return rows;
  }
  function open(k) {
    if (k === 'assistout') { try { sessionStorage.removeItem('nm-assist'); } catch (e) { } Promise.resolve(IDB.clear()).then(function () { location.reload(); }); return; }
    PAN = k; if (k === 'cestino') CEST = null; renderPanel(); }

  /* ---------- cestino (solo amministratori) ---------- */
  var CEST = null, CEST_DAYS = 60;
  var CEST_NOMI = { barche: 'Barca', lavori: 'Lavoro o mansione', scadenze: 'Scadenza', vari: 'Varo o alaggio', magazzino: 'Ricambio', movimenti: 'Movimento di magazzino',
    operazioni: 'Servizio', opModelli: 'Gruppo di servizi', mezzi: 'Mezzo', conferme: 'Giornata confermata', posti: 'Posto al porto', attrezzatura: 'Attrezzatura', deposito: 'Roba in deposito', componenti: 'Componente a bordo', barattoli: 'Barattolo aperto', noteColleghi: 'Nota a un collega', programma: 'Programma',
    cariche: 'Carica batterie', richieste: 'Richiesta', richiesteCliente: 'Richiesta del cliente', verbali: 'Verbale', rifiuti: 'Rifiuto', ritiri: 'Ritiro rifiuti', scadCantiere: 'Scadenza del cantiere', preventivi: 'Preventivo', assenze: 'Ferie o permesso', kit: 'Kit ricambi', inventari: 'Inventario', giri: 'Giro di controllo', cronometri: 'Cronometro', ditte: 'Ditta esterna',
    checklist: 'Checklist', modelli: 'Modello di checklist', checkBarca: 'Lista della barca', dipendenti: 'Dipendente', impostazioni: 'Impostazione' };
  function cestCutoff() { return new Date(Date.now() - CEST_DAYS * 864e5).toISOString(); }
  function purgeCestino() { // toglie per sempre ciò che è nel cestino da più di 60 giorni
    return AC('cestino').where('il', '<', cestCutoff()).limit(200).get().then(function (s) {
      if (!s.size) return; var b = fs.batch(); s.docs.forEach(function (d) { b.delete(d.ref); }); return b.commit();
    }).catch(function () { });
  }
  function loadCestino() {
    CEST = { loading: true, items: [] };
    purgeCestino().then(function () { return AC('cestino').orderBy('il', 'desc').limit(400).get(); }).then(function (s) {
      var cut = cestCutoff(), items = s.docs.map(function (d) { var x = d.data(); x.id = d.id; x.dati = dec(x.dati || {}); return x; }).filter(function (x) { return x.il >= cut; });
      // raggruppo ciò che è stato cancellato insieme
      var groups = [];
      items.forEach(function (x) {
        var g = groups[groups.length - 1];
        if (g && g.da === x.da && (x.gruppo ? x.gruppo === g.gruppo : Date.parse(g.last) - Date.parse(x.il) < 15000)) { g.items.push(x); g.last = x.il; } else groups.push({ da: x.da, daNome: x.daNome, gruppo: x.gruppo, il: x.il, last: x.il, items: [x] });
      });
      CEST = { items: items, groups: groups }; renderPanel();
    }, function (e) { CEST = { err: errOf(e).code, items: [] }; renderPanel(); });
  }
  function cestLabel(x) { var d = x.dati || {}; return String(d.nome || d.titolo || d.tipo || d.descr || d.cliente || d.data || x.docId).slice(0, 80); }
  function cestinoHtml() {
    if (!CEST || CEST.loading) return '<div class="spin" style="width:28px;height:28px;border-radius:50%;border:3px solid #33355a;border-top-color:#2f8ff0;margin:30px auto;animation:nmspin 1s linear infinite"></div>';
    if (CEST.err) return '<p class="note">Non riesco a leggere il cestino (' + esc(CEST.err) + '). Se hai appena aggiornato le regole del database, riprova tra un minuto.</p>';
    if (!CEST.groups.length) return '<p class="note">Il cestino è vuoto.</p>';
    return '<div class="grp">' + CEST.groups.map(function (g, i) {
      var first = g.items[g.items.length - 1], when = new Date(g.il).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      var main = g.items.filter(function (x) { return x.coll === 'barche'; })[0] || first;
      var extra = g.items.length > 1 ? ' e altre ' + (g.items.length - 1) + (g.items.length === 2 ? ' cosa' : ' cose') : '';
      return '<div class="u"><div class="nm">' + esc(cestLabel(main)) + '<span class="pill">' + esc(CEST_NOMI[main.coll] || main.coll) + '</span></div>' +
        '<div class="em">' + esc(extra ? 'Insieme' + extra : '') + (extra ? ' · ' : '') + 'cancellato da ' + esc(g.daNome || (UT[g.da] && UT[g.da].nome) || 'qualcuno') + ' · ' + esc(when) + '</div>' +
        '<div class="acts"><button class="b pri" data-nm="rec" data-id="' + i + '">Recupera</button></div></div>';
    }).join('') + '</div>';
  }
  async function recuperaGruppo(i) {
    var g = CEST && CEST.groups && CEST.groups[i]; if (!g) return;
    var busy = g.items.filter(function (x) { return live(x.coll).map[x.docId]; });
    if (busy.length && !confirm(busy.length === 1 ? 'Nel frattempo è stato creato di nuovo un elemento con lo stesso posto: lo sostituisco con quello recuperato?' : busy.length + ' elementi sono stati ricreati nel frattempo: li sostituisco con quelli recuperati?')) return;
    var ok = 0, fail = 0;
    for (var k = 0; k < g.items.length; k++) {
      var x = g.items[k];
      if (COLLS.indexOf(x.coll) < 0) { fail++; continue; } // si recuperano solo i dati del cantiere, mai profili o impostazioni di sistema
      try { await write(x.coll, x.docId, 'set', x.dati); await settle(AC('cestino').doc(x.id).delete()); ok++; } catch (e) { fail++; }
    }
    toast(fail ? 'Recuperate ' + ok + ', ' + fail + ' non riuscite: riprova.' : ok === 1 ? 'Recuperato' : 'Recuperate ' + ok + ' cose');
    for (var j = 0; j < g.items.length; j++) { var y = g.items[j]; if (y.coll === 'barche' && y.dati && y.dati.unione && live('barche').map[y.docId]) await annullaUnione(y.docId, y.dati); }
    CEST = null; renderPanel();
  }
  // una barca recuperata che era stata unita a un'altra: si rimette tutto com'era prima dell'unione
  async function annullaUnione(dId, d) {
    var u = d.unione, B = live('barche').map, nome = (B[u.in] && B[u.in].nome) || u.nome || 'l’altra barca';
    if (B[u.in] && confirm('«' + (d.nome || 'Questa barca') + '» era stata unita a «' + nome + '». Annullo l’unione? Rimetto qui lavori, scadenze e il resto che le avevo spostato, e riporto la scheda «' + nome + '» com’era prima dell’unione (le modifiche fatte dopo a quella scheda si perdono).')) {
      var ok = 0, fail = 0;
      for (var i = 0; i < (u.spostati || []).length; i++) {
        var m = u.spostati[i]; if (!m || COLLS.indexOf(m.c) < 0) continue;
        var cur = live(m.c).map[m.id], up = {}; if (!cur) continue;
        if ('b' in m) up.barcaId = m.b;
        if (m.ab) up.altreBarche = m.ab;
        if (m.c === 'posti') up.modificato = nowISO();
        try { await write(m.c, m.id, 'update', up); ok++; } catch (e) { fail++; }
      }
      try { await write('barche', u.in, 'set', u.prima); } catch (e) { fail++; }
      (u.clienti || []).forEach(function (uid) { var x = UT[uid]; if (!x) return; var bb = (x.barche || []).slice(); if (bb.indexOf(dId) < 0) bb.push(dId); setUser(uid, { barche: bb }).catch(function () { }); });
      toast(fail ? 'Unione annullata in parte: ' + fail + ' cose non riuscite.' : 'Unione annullata: le due schede sono di nuovo separate.');
    }
    try { await write('barche', dId, 'update', { unione: { __delete__: true } }); } catch (e) { }
  }
  // clienti collegati a una barca (per l'unione di due schede)
  function clientiBarca(bid) { return Object.keys(UT).filter(function (id) { return (UT[id].barche || []).indexOf(bid) >= 0; }); }
  function spostaClienti(da, a) {
    return Promise.all(clientiBarca(da).map(function (id) {
      var bb = []; (UT[id].barche || []).forEach(function (b) { b = b === da ? a : b; if (bb.indexOf(b) < 0) bb.push(b); });
      return setUser(id, { barche: bb });
    }));
  }
  // codice dell'azienda (per far entrare colleghi e clienti) e permesso di assistenza per il gestore del servizio
  function azBox() {
    var a = AZD || {};
    return '<h4>Codice dell’azienda</h4><div class="grp"><div class="u"><div class="nm" style="font-size:1.5rem;letter-spacing:.1em">' + esc(codBello(a.codice) || '—') + '</div>' +
      '<div class="em" style="word-break:normal">Mandalo a colleghi e clienti insieme al link dell’app. Alla registrazione scelgono «Entro nella mia azienda» e scrivono il codice; poi li approvi qui sotto. Se il codice finisce in mani sbagliate cambialo: chi è già dentro resta dentro.</div>' +
      '<div class="acts">' + (a.codice ? '<button class="b pri" data-nm="codcopia">Copia</button>' : '') + '<button class="b" data-nm="codnuovo">' + (a.codice ? 'Cambia codice' : 'Crea il codice') + '</button></div></div></div>' +
      '<h4>Assistenza</h4><div class="grp"><div class="u"><label style="display:flex;gap:10px;align-items:flex-start;cursor:pointer"><input type="checkbox" data-nm="assist"' + (a.assistenza ? ' checked' : '') + ' style="width:20px;height:20px;flex:none;margin-top:2px">' +
      '<span>Permetti al gestore del servizio di entrare nei dati dell’azienda per aiutarvi</span></label>' +
      '<div class="em" style="margin-top:6px;word-break:normal">' + (a.assistenza ? 'Acceso: il gestore può aprire e correggere i vostri dati. Spegnilo quando l’aiuto è finito.' : 'Spento: il gestore non vede barche, clienti, lavori né altri dati. Vede solo accessi, azioni ed errori dell’app, per l’assistenza.') + '</div></div></div>';
  }
  async function codCambia() {
    var a = AZD || {}, old = a.codice;
    if (old && !confirm('Cambio il codice? Quello vecchio non funzionerà più per le nuove registrazioni; chi è già dentro resta dentro.')) return;
    for (var i = 0; i < 4; i++) {
      var c = codNuovo(), b = fs.batch();
      b.set(fs.collection('codici').doc(c), { azienda: AZ, creato: nowISO() });
      if (old) b.delete(fs.collection('codici').doc(old));
      b.update(fs.collection('aziende').doc(AZ), { codice: c, modificato: nowISO() });
      try { await b.commit(); toast('Nuovo codice: ' + codBello(c)); return; } catch (e) { if (i === 3) toast('Non riuscito: ' + errOf(e).code); }
    }
  }
  // barca venduta: i clienti scelti non vedono più questa barca nel portale
  function staccaClienti(bid, ids) {
    return Promise.all((ids || []).filter(function (id) { return UT[id]; }).map(function (id) { return setUser(id, { barche: (UT[id].barche || []).filter(function (b) { return b !== bid; }) }); }));
  }
  function nomeUtente(id) { var u = UT[id] || {}; return u.nome || u.email || id; }
  function closePanel() { PAN = null; var p = $('#nmpan'); if (p) p.remove(); }
  // sul computer il menù a sinistra resta visibile: toccando una sua voce il pannello si chiude
  document.addEventListener('click', function (e) { if ($('#nmpan') && e.target.closest && e.target.closest('#tabs [data-act]')) closePanel(); }, true);
  function oldPeople() {
    var D = LIVE.dipendenti ? LIVE.dipendenti.map : {};
    return Object.keys(D).filter(function (id) { return !UT[id]; }).map(function (id) { return { id: id, nome: D[id].nome || id }; });
  }
  function renderPanel() {
    if (!PAN) return;
    ensureCss();
    var p = $('#nmpan'); if (!p) { p = document.createElement('div'); p.id = 'nmpan'; document.body.appendChild(p); }
    var h = '';
    if (PAN === 'account') {
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Il mio account</h3><span style="min-width:64px"></span></div>' +
        '<div class="grp"><div class="u"><div class="nm">' + esc(ME.nome || '') + '</div><div class="em">' + esc(ME.email || '') + '</div><div class="note" style="margin:6px 0 0">Ruolo: ' + esc(RUOLI[ME.ruolo] || ME.ruolo) + '</div>' +
        '<div class="acts"><button class="b" data-nm="pw">Cambia password</button><button class="b red" data-nm="out">Esci</button></div></div></div>' +
        '<p class="note">«Cambia password» ti manda un’email con il link. Uscendo, da questo telefono vengono tolti i dati salvati per lavorare senza campo.</p>' +
        (tabStr() && ME.ruolo !== 'cliente' && !ME.tablet && !ME.assist ? '<h4>PIN per il tablet</h4><div class="grp"><div class="u"><div class="em">' + (pinDi(ME.uid) ? 'Hai già un PIN: scrivine uno nuovo per cambiarlo.' : 'Sul tablet dell’officina tocchi il tuo nome e scrivi questo PIN.') + '</div>' +
          '<div class="acts"><input id="nm-pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 cifre" style="width:110px"><button class="b pri" data-nm="pin" data-id="' + ME.uid + '">Salva PIN</button>' +
          (pinDi(ME.uid) ? '<button class="b red" data-nm="pin-no" data-id="' + ME.uid + '">Togli</button>' : '') + '</div></div></div>' : '');
    } else if (PAN === 'utenti' && ME.ruolo === 'admin') {
      var ids = Object.keys(UT), by = function (st) { return ids.filter(function (id) { return (UT[id].stato || '') === st; }).sort(function (a, b) { return String(UT[a].nome || '').localeCompare(String(UT[b].nome || ''), 'it'); }); };
      var olds = oldPeople();
      var B = LIVE.barche ? LIVE.barche.map : {};
      var bname = function (bid) { return B[bid] ? (B[bid].nome || 'Barca') : 'Barca eliminata'; };
      var row = function (id) {
        var u = UT[id], self = id === ME.uid, a = '', isCl = u.ruolo === 'cliente';
        if (u.stato === 'in_attesa') a = '<button class="b pri" data-nm="ok" data-id="' + id + '">' + (u.tipo === 'cliente' ? 'Approva come cliente' : 'Approva') + '</button><button class="b red" data-nm="no" data-id="' + id + '">Rifiuta</button>';
        else if (u.stato === 'attivo') a = self ? '<span class="note" style="margin:0">Sei tu</span>' :
          '<select data-nm="ruolo" data-id="' + id + '">' + ['base', 'admin', 'cliente'].map(function (r) { return '<option value="' + r + '"' + ((u.ruolo === 'editor' ? 'base' : u.ruolo) === r ? ' selected' : '') + '>' + RUOLI[r] + '</option>'; }).join('') + '</select>' +
          '<button class="b red" data-nm="block" data-id="' + id + '">Sospendi</button>' +
          (tabStr() && !isCl ? '<button class="b' + (u.tablet ? ' pri' : '') + '" data-nm="tab" data-id="' + id + '">' + (u.tablet ? 'È il tablet condiviso' : 'Usa come tablet condiviso') + '</button>' +
            (u.tablet ? '' : '<button class="b" data-nm="pin-a" data-id="' + id + '">' + (pinDi(id) ? 'Cambia PIN tablet' : 'Metti PIN tablet') + '</button>') : '');
        else a = '<button class="b" data-nm="ok" data-id="' + id + '">Riattiva</button>';
        if (isCl && u.stato === 'attivo') {
          var mine = u.barche || [], others = Object.keys(B).filter(function (b) { return mine.indexOf(b) < 0; }).sort(function (x, y) { return bname(x).localeCompare(bname(y), 'it'); });
          a += '<div class="chips">' + (mine.length ? mine.map(function (b) { return '<span class="chip">' + esc(bname(b)) + '<button data-nm="unb" data-id="' + id + '" data-b="' + esc(b) + '" aria-label="Togli">×</button></span>'; }).join('') : '<span class="note" style="margin:0">Nessuna barca collegata</span>') + '</div>' +
            '<select data-nm="addb" data-id="' + id + '"><option value="">+ Collega una sua barca…</option>' + others.map(function (b) { return '<option value="' + esc(b) + '">' + esc(bname(b) + (B[b].modello ? ' · ' + B[b].modello : '')) + '</option>'; }).join('') + '</select>';
        }
        if (olds.length && u.stato !== 'bloccato' && !isCl && u.tipo !== 'cliente') a += '<select data-nm="link" data-id="' + id + '"><option value="">Collega ai dati vecchi…</option>' + olds.map(function (o) { return '<option value="' + esc(o.id) + '">È ' + esc(o.nome) + '</option>'; }).join('') + '</select>';
        return '<div class="u"><div class="nm">' + esc(u.nome || '(senza nome)') + (u.stato === 'attivo' ? '<span class="pill">' + esc(RUOLI[u.ruolo] || u.ruolo) + '</span>' : u.stato === 'in_attesa' ? '<span class="pill">' + (u.tipo === 'cliente' ? 'Cliente' : 'Lavora al cantiere') + '</span>' : '') + '</div><div class="em">' + esc(u.email || '') + '</div><div class="acts">' + a + '</div></div>';
      };
      var sec = function (t, list) { return list.length ? '<h4>' + t + ' (' + list.length + ')</h4><div class="grp">' + list.map(row).join('') + '</div>' : ''; };
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Utenti e permessi</h3><span style="min-width:64px"></span></div>' + azBox() +
        sec('In attesa di approvazione', by('in_attesa')) + sec('Cantiere', by('attivo').filter(function (id) { return UT[id].ruolo !== 'cliente'; })) +
        sec('Clienti', by('attivo').filter(function (id) { return UT[id].ruolo === 'cliente'; })) + sec('Sospesi', by('bloccato')) +
        '<p class="note"><b>Dipendente</b>: usa tutta l’app; cancella solo ciò che ha aggiunto, modifica solo le proprie mansioni e richieste di ferie. <b>Amministratore</b>: in più cancella tutto, vede il cestino, approva le ferie e i colleghi e cambia i permessi. ' +
        '<b>Cliente</b>: vede solo le barche che gli colleghi, con stato, posto e lavori eseguiti' + (sezAccesa('orecliente', false) ? '; vede anche le ore di lavoro per tipo, con il testo delle mansioni e il nome di chi le ha fatte (solo giornate confermate)' : ', senza ore né nomi dei dipendenti (si accendono dalla sezione «Ore di lavoro al cliente»)') + '.</p>' +
        (olds.length ? '<p class="note"><b>Collega ai dati vecchi</b>: dopo aver ripristinato la copia presa da Claude, scegli chi era quella persona. Mansioni, ore e giornate confermate passano al nuovo account.</p>' : '') +
        '<p class="note">Per far entrare un collega o un cliente mandagli il link dell’app e il codice dell’azienda: sceglie «Entro nella mia azienda», scrive il codice e compare qui sopra, in attesa.</p>';
    } else if (PAN === 'cestino' && ME.ruolo === 'admin') {
      h = '<div class="top"><button class="back" data-nm="close">‹ Indietro</button><h3>Cestino</h3><span style="min-width:64px"></span></div>' + cestinoHtml() +
        '<p class="note">Qui finisce tutto ciò che viene cancellato, con chi l’ha cancellato e quando. Dopo 60 giorni sparisce per sempre. Le cose cancellate insieme (per esempio una barca con i suoi lavori) si recuperano insieme.</p>';
      if (!CEST) loadCestino();
    } else { closePanel(); return; }
    p.innerHTML = h;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmpan [data-nm]'); if (!t || t.tagName === 'SELECT') return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'close') closePanel();
    else if (k === 'rec') { t.disabled = true; recuperaGruppo(+id); }
    else if (k === 'codnuovo') codCambia();
    else if (k === 'codcopia') { var cc = codBello(AZD && AZD.codice); (navigator.clipboard ? navigator.clipboard.writeText(cc) : Promise.reject()).then(function () { toast('Codice copiato: ' + cc); }, function () { prompt('Copia il codice:', cc); }); }
    else if (k === 'out') logout();
    else if (k === 'pw') auth.sendPasswordResetEmail(ME.email).then(function () { toast('Ti ho mandato l’email per cambiare la password.'); }, function (er) { toast(authErr(er)); });
    else if (k === 'ok') {
      var u0 = UT[id] || {}, f0 = { stato: 'attivo' };
      if (u0.stato === 'in_attesa' && u0.tipo === 'cliente') { f0.ruolo = 'cliente'; f0.barche = []; } // le barche le collega l'amministratore
      setUser(id, f0).then(function () { toast(f0.ruolo === 'cliente' ? 'Fatto: ora collega le sue barche qui sotto.' : 'Fatto: ' + (u0.nome || '') + ' può entrare.'); });
    }
    else if (k === 'unb') { var ub = (UT[id].barche || []).filter(function (b) { return b !== t.getAttribute('data-b'); }); setUser(id, { barche: ub }); }
    else if (k === 'no') { if (confirm('Rifiutare la richiesta di ' + (UT[id] && UT[id].nome || '') + '?')) setUser(id, { stato: 'bloccato' }); }
    else if (k === 'tab') { var ut = !UT[id].tablet; if (!ut || confirm('Questo account diventa il tablet condiviso: chi lo apre trova «Chi lavora adesso?» e lavora a nome di chi scrive il suo PIN. Continuo?')) setUser(id, { tablet: ut }).then(function () { toast(ut ? 'Fatto: è il tablet condiviso.' : 'Non è più il tablet condiviso.'); renderPanel(); }); }
    else if (k === 'pin-a') { var pa = prompt('PIN di 4 cifre per il tablet di ' + ((UT[id] && UT[id].nome) || '') + ':'); if (pa != null) pinSalva(id, pa); }
    else if (k === 'pin') pinSalva(id, ($('#nm-pin') || {}).value || '');
    else if (k === 'pin-no') { if (confirm('Togliere il tuo PIN? Sul tablet non comparirai più.')) write('pin', id, 'update', { hash: '', modificato: nowISO() }).then(function () { toast('PIN tolto.'); renderPanel(); }, function () { toast('Non riuscito.'); }); }
    else if (k === 'block') { if (confirm('Sospendere ' + (UT[id] && UT[id].nome || '') + '? Non potrà più entrare finché non lo riattivi.')) setUser(id, { stato: 'bloccato' }); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target; if (!t.closest || !t.closest('#nmpan') || !t.getAttribute('data-nm')) return;
    var k = t.getAttribute('data-nm'), id = t.getAttribute('data-id');
    if (k === 'assist') {
      var on = !!t.checked;
      fs.collection('aziende').doc(AZ).update({ assistenza: on, modificato: nowISO() }).then(function () { toast(on ? 'Assistenza permessa' : 'Assistenza tolta'); }, function (er) { t.checked = !on; toast('Non riuscito: ' + errOf(er).code); });
      return;
    }
    if (k === 'ruolo') {
      if ((t.value === 'cliente') !== (UT[id].ruolo === 'cliente') && !confirm(t.value === 'cliente' ? 'Diventa cliente: non vedrà più l’app del cantiere, solo le sue barche. Continuo?' : 'Non sarà più cliente: vedrà tutta l’app del cantiere. Continuo?')) { t.value = UT[id].ruolo; return; }
      setUser(id, { ruolo: t.value }).then(function () { toast('Permessi aggiornati.'); });
    }
    else if (k === 'addb' && t.value) { var ab = (UT[id].barche || []).concat([t.value]); setUser(id, { barche: ab }).then(function () { toast('Barca collegata.'); }); }
    else if (k === 'link' && t.value) {
      var old = t.value, olds = oldPeople().filter(function (o) { return o.id === old; })[0];
      if (!confirm('Le mansioni, le ore e le giornate di ' + (olds ? olds.nome : old) + ' passano a ' + (UT[id] && UT[id].nome || '') + '. Continuo?')) { t.value = ''; return; }
      t.disabled = true; toast('Sto collegando i dati…');
      relink(old, id).then(function (n) { toast('Fatto: ' + n + ' elementi collegati.'); renderPanel(); }, function () { toast('Collegamento non riuscito. Riprova.'); renderPanel(); });
    }
  });
  function setUser(id, f) { f.modificato = nowISO(); return fs.collection('utenti').doc(id).update(f).catch(function (e) { toast('Non riuscito: ' + errOf(e).code); throw e; }); }
  function swap(v, a, b) {
    if (typeof v === 'string') return v === a ? b : v;
    if (Array.isArray(v)) return v.map(function (x) { return swap(x, a, b); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k.split(a).join(b)] = swap(v[k], a, b); }); return o; }
    return v;
  }
  async function relink(oldId, newId) {
    var n = 0;
    for (var i = 0; i < COLLS.length; i++) {
      var L = live(COLLS[i]); await L.start; await whenReady(L, 20000);
      var ids = Object.keys(L.map);
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j], d = L.map[id], nd = swap(d, oldId, newId), nid = id.split(oldId).join(newId);
        if (nid !== id) {
          if (!(COLLS[i] === 'dipendenti' && L.map[nid])) await write(COLLS[i], nid, 'set', nd);
          await write(COLLS[i], id, 'delete'); n++;
        } else if (JSON.stringify(nd) !== JSON.stringify(d)) { await write(COLLS[i], id, 'set', nd); n++; }
      }
    }
    return n;
  }

  /* ---------- pannello del creatore ----------
     Chi gestisce il servizio (utenti/{uid} con ruolo «creatore», messo da GitHub: vedi .github/workflows/creatore.yml)
     approva le aziende nuove, le sospende, vede di ognuna accessi, azioni ed errori. Nei dati di un'azienda
     (barche, clienti, lavori…) entra solo se l'azienda ha acceso «Permetti assistenza». */
  var CR = { ai: {}, on: false, az: {}, ut: {}, att: {}, vista: null, filtro: 'tutto', q: '', ord: 'nome', avv: [], cons: null, giorni: 7, metr: 'fotoMb', chi: '', msg: null, note: {}, scarico: '' };
  function avviaCreatore(x) {
    var as = ''; try { as = sessionStorage.getItem('nm-assist') || ''; } catch (e) { }
    if (started) return;
    ME = x;
    if (as) {
      fs.collection('aziende').doc(as).get().then(function (d) {
        var a = d.exists ? d.data() : null;
        if (!a || !a.assistenza || a.stato !== 'attiva') { try { sessionStorage.removeItem('nm-assist'); } catch (e) { } toast('Questa azienda non permette più l’assistenza.'); crApri(); return; }
        if (started) return;
        AZ = as; AZD = a; ME = Object.assign({}, x, { ruolo: 'admin', assist: a.nome || 'un’azienda', nome: (x.nome || 'Gestore') + ' (assistenza)' });
        started = true; hideOverlay(); READY_RES(); afterStart(); setTimeout(function () { toast('Assistenza: sei nei dati di ' + ME.assist); }, 800);
      }, function () { crApri(); });
      return;
    }
    crApri();
  }
  function crApri() {
    if (CR.on) { crRender(); return; }
    CR.on = true; ensureCss();
    fs.collection('aziende').onSnapshot(function (s) { var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); CR.az = m; crRender(); crReport(); }, function (e) { CR.err = errOf(e).code; crRender(); });
    fs.collection('utenti').onSnapshot(function (s) { var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); CR.ut = m; crRender(); }, function () { });
    // avvisi per il gestore (li scrive GitHub: aziende nuove, spazio, errori ripetuti, aziende ferme)
    fs.collection('servizio').doc('avvisi').collection('lista').orderBy('il', 'desc').limit(40).onSnapshot(function (s) { CR.avv = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); crRender(); }, function () { });
    fs.collection('creatori').doc(ME.uid).onSnapshot(function (d) { CR.me = d.exists ? d.data() : {}; crRender(); }, function () { });
    fs.collection('messaggioServizio').doc('attuale').onSnapshot(function (d) { CR.msg = d.exists ? d.data() : null; crRender(); }, function () { });
    crConsumi();
    crRender();
  }
  // gli ultimi accessi, azioni ed errori di ogni azienda attiva (le ultime 300 righe)
  function crReport(id) {
    Object.keys(CR.az).forEach(function (k) {
      if ((id && k !== id) || (!id && CR.att[k]) || CR.az[k].stato !== 'attiva') return;
      CR.att[k] = CR.att[k] || { loading: true, list: [] };
      fs.collection('aziende').doc(k).collection('attivita').orderBy('il', 'desc').limit(300).get().then(function (s) {
        CR.att[k] = { list: s.docs.map(function (d) { return d.data(); }) }; crRender();
      }, function (e) { CR.att[k] = { err: errOf(e).code, list: [] }; crRender(); });
    });
  }
  function crTipo(x) { var c = String(x.cosa || ''); return c.indexOf('⚠') === 0 ? 'errori' : /^è entrato/.test(c) ? 'accessi' : /^apre /.test(c) ? 'pagine' : 'azioni'; }
  function crQuando(iso) { var d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function crUltimo(k) { var R = CR.att[k]; return R && R.list ? R.list.filter(function (x) { return crTipo(x) === 'accessi'; })[0] || null : null; }
  function crErr7(k) { var R = CR.att[k]; return R && R.list ? R.list.filter(function (x) { return crTipo(x) === 'errori' && Date.now() - Date.parse(x.il) < 7 * 864e5; }).length : 0; }
  function crPersone(k, st) { return Object.keys(CR.ut).filter(function (u) { return CR.ut[u].azienda === k && CR.ut[u].stato === (st || 'attivo'); }); }

  /* ---------- notifiche sul telefono del gestore (creatori/{uid}.tokens) ---------- */
  function crDevTok() { try { return localStorage.getItem('gr-gestore-token') || ''; } catch (e) { return ''; } }
  function crPushPerche() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'Questo browser non riceve notifiche. Su iPhone: aggiungi il sito alla schermata Home e aprilo da lì.';
    if (!window.NM_VAPID_KEY) return 'Manca la chiave per le notifiche web (NM_VAPID_KEY in config.js): appena la metti, qui compare «Attiva».';
    return '';
  }
  function crScript(src, sri) { return new Promise(function (res, rej) { var s = document.createElement('script'); if (sri) { s.integrity = sri; s.crossOrigin = 'anonymous'; } s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function crPush(on) {
    var ref = fs.collection('creatori').doc(ME.uid), cur = (CR.me && CR.me.tokens) || [], tok = crDevTok();
    try {
      if (!on) {
        await ref.update({ tokens: cur.filter(function (t) { return t !== tok; }), modificato: nowISO() });
        try { localStorage.removeItem('gr-gestore-token'); if (firebase.messaging && tok) await firebase.messaging().deleteToken(); } catch (e) { }
        toast('Notifiche spente su questo telefono'); return;
      }
      if (!firebase.messaging) await crScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js?i=1', 'sha384-HY9kcCUNf5iP55Q7dt4qtyKGMq0L6BbtAwNb4LYA6MXDWUL8DRlsj1xhtwKBZ2BL');
      if (await Notification.requestPermission() !== 'granted') { toast('Hai negato le notifiche: si riattivano dalle impostazioni del telefono.'); return; }
      var t = await firebase.messaging().getToken({ vapidKey: window.NM_VAPID_KEY, serviceWorkerRegistration: await navigator.serviceWorker.ready });
      if (!t) throw new Error('token');
      await ref.update({ tokens: cur.indexOf(t) >= 0 ? cur : cur.concat([t]).slice(-5), modificato: nowISO() });
      try { localStorage.setItem('gr-gestore-token', t); } catch (e) { }
      toast('Notifiche attive: gli avvisi del pannello arrivano su questo telefono');
    } catch (e) { toast('Non sono riuscito: riprova, e controlla di avere internet.'); }
  }

  /* ---------- consumi: solo numeri contati (servizio/consumi/giorni/{giorno}, li scrive GitHub ogni mattina) ---------- */
  function crConsumi() {
    fs.collection('servizio').doc('consumi').collection('giorni').orderBy('giorno', 'desc').limit(30).get()
      .then(function (s) { CR.cons = s.docs.map(function (d) { return d.data(); }).reverse(); crRender(); }, function (e) { CR.cons = { err: errOf(e).code }; crRender(); });
  }
  var CR_METR = [['fotoMb', 'Spazio foto', 'MB'], ['docs', 'Documenti', ''], ['accessi', 'Accessi', ''], ['persone', 'Persone attive', ''], ['errori', 'Errori', ''], ['letture', 'Letture Firestore', ''], ['scritture', 'Scritture Firestore', '']];
  function crValore(g, m, k) {
    if (m === 'letture' || m === 'scritture') return k ? null : g.firestore && typeof g.firestore[m] === 'number' ? g.firestore[m] : null;
    var x = k ? (g.aziende || {})[k] : g.tot; return x && typeof x[m] === 'number' ? x[m] : null;
  }
  function crNum(n, m) { return n == null ? '—' : m === 'fotoMb' ? (Math.round(n * 10) / 10).toLocaleString('it-IT') + ' MB' : Math.round(n).toLocaleString('it-IT'); }
  function crGrafico() {
    if (!CR.cons) return '<p class="note">Carico i consumi…</p>';
    if (CR.cons.err) return '<p class="note">Non riesco a leggere i consumi (' + esc(CR.cons.err) + ').</p>';
    var all = CR.cons, gg = all.slice(-CR.giorni), m = CR.metr, k = CR.chi;
    var h = '<div class="chips">' + [7, 30].map(function (n) { return '<button class="b' + (CR.giorni === n ? ' pri' : '') + '" data-cr="giorni" data-id="' + n + '">' + n + ' giorni</button>'; }).join('') + '</div>' +
      '<div class="chips">' + CR_METR.map(function (x) { return '<button class="b' + (m === x[0] ? ' pri' : '') + '" data-cr="metr" data-id="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      '<div class="chips"><select data-cr="chi" class="b" style="font:inherit;padding:10px 14px;border-radius:12px;background:var(--card,#1c1f24);color:inherit;border:1px solid rgba(255,255,255,.15)">' + '<option value="">Tutte le aziende</option>' + Object.keys(CR.az).filter(function (x) { return CR.az[x].stato === 'attiva'; }).map(function (x) { return '<option value="' + esc(x) + '"' + (k === x ? ' selected' : '') + '>' + esc(CR.az[x].nome || x) + '</option>'; }).join('') + '</select></div>';
    if (!gg.length) return h + '<p class="note">Ancora nessun giorno contato. Il primo conteggio arriva domattina con il giro delle notifiche.</p>';
    if ((m === 'letture' || m === 'scritture') && k) return h + '<p class="note">Letture e scritture Google le conta per tutto il database, non per azienda: scegli «Tutte le aziende».</p>';
    var v = gg.map(function (g) { return crValore(g, m, k); }), max = Math.max.apply(null, v.map(function (x) { return x || 0; }).concat([1])), W = 300, H = 110, bw = W / gg.length;
    var bars = v.map(function (x, i) { var bh = x == null ? 0 : Math.max(1, x / max * (H - 18)); return '<rect x="' + (i * bw + bw * 0.15).toFixed(1) + '" y="' + (H - 14 - bh).toFixed(1) + '" width="' + (bw * 0.7).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.5" fill="' + (x == null ? 'none' : '#2f8ff0') + '"><title>' + esc(gg[i].giorno + ': ' + crNum(x, m)) + '</title></rect>'; }).join('');
    var lab = function (i) { return '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 2) + '" font-size="8" fill="#9a9daa" text-anchor="middle">' + esc(gg[i].giorno.slice(8) + '/' + gg[i].giorno.slice(5, 7)) + '</text>'; };
    var labs = gg.length <= 7 ? gg.map(function (g, i) { return lab(i); }).join('') : [0, Math.floor(gg.length / 2), gg.length - 1].map(lab).join('');
    var ult = v[v.length - 1], miss = (m === 'letture' || m === 'scritture') && gg.every(function (g) { return !g.firestore || g.firestore[m] == null; });
    h += '<div class="grp" style="padding:12px"><div class="nm">' + esc(CR_METR.filter(function (x) { return x[0] === m; })[0][1]) + ' · ultimo giorno: ' + esc(crNum(ult, m)) + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;margin-top:8px" role="img" aria-label="Grafico degli ultimi ' + gg.length + ' giorni">' + bars + labs + '</svg>' +
      '<div class="em">Massimo ' + esc(crNum(max === 1 && !v.some(function (x) { return x; }) ? 0 : max, m)) + ' · ' + gg.length + (gg.length === 1 ? ' giorno contato' : ' giorni contati') + '</div></div>';
    if (miss) h += '<p class="note">Letture e scritture vengono da Google Cloud Monitoring: per leggerle il service account di GitHub deve avere il ruolo «Monitoring Viewer» (Google Cloud › IAM). Senza, qui resta vuoto: nessun numero inventato.</p>';
    h += '<p class="note">Numeri contati davvero ogni mattina: foto (peso salvato di ogni foto), documenti (conteggio di Firestore), accessi, persone ed errori dal registro di ogni azienda; letture e scritture da Google. I limiti gratuiti di Firebase: 1 GB di dati, 50.000 letture e 20.000 scritture al giorno.</p>';
    return h;
  }

  /* ---------- messaggio a tutte le aziende (messaggioServizio/attuale) ---------- */
  // Novità: quelle del file (scritte a ogni pubblicazione) e quelle del gestore; si correggono, si nascondono, se ne aggiungono
  var TA = 'width:100%;box-sizing:border-box;margin-top:8px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5f7;padding:10px;font:inherit';
  function crNovHtml() {
    if (CR.nov === undefined) { CR.nov = null; novitaTutte(true).then(function (l) { CR.nov = l; crRender(); }); }
    if (!CR.nov) return '<p class="note">Carico…</p>';
    var ed = CR.novEd, form = function (x) {
      return '<div class="u"><input id="cr-nov-t" maxlength="60" placeholder="Titolo, es. Novembre 2026" value="' + esc((x && x.titolo) || '') + '" style="' + TA + '">' +
        '<textarea id="cr-nov-r" rows="6" maxlength="2000" placeholder="Una novità per riga" style="' + TA + '">' + esc(((x && x.righe) || []).join('\n')) + '</textarea>' +
        '<div class="acts"><button class="b pri" data-cr="nov-salva" data-id="' + esc(x ? x.id : '') + '">' + (x ? 'Salva' : 'Pubblica la novità') + '</button><button class="b" data-cr="nov-annulla">Annulla</button></div>' +
        '<div class="em">Compare una volta, al prossimo ingresso, a chi lavora nelle aziende (non ai clienti).</div></div>';
    };
    return '<div class="grp">' + (ed === 'nuova' ? form(null) : '') + (CR.nov.length ? CR.nov.slice(0, 6).map(function (x) {
      if (ed === x.id) return form(x);
      return '<div class="u"' + (x.nascosta ? ' style="opacity:.55"' : '') + '><div class="nm">' + esc(x.titolo || x.id) + (x.nascosta ? '<span class="pill">nascosta</span>' : '') + '</div><div class="em">' + (x.righe || []).map(esc).join('<br>') + '</div>' +
        '<div class="acts"><button class="b" data-cr="nov-mod" data-id="' + esc(x.id) + '">Modifica</button>' + (x.nascosta ? '<button class="b" data-cr="nov-vedi" data-id="' + esc(x.id) + '">Rimetti</button>' : '<button class="b red" data-cr="nov-nascondi" data-id="' + esc(x.id) + '">Nascondi</button>') + '</div></div>';
    }).join('') : '<div class="u"><div class="em">Ancora nessuna novità.</div></div>') +
      (ed !== 'nuova' ? '<div class="u"><button class="b pri" data-cr="nov-nuova">+ Nuova novità</button></div>' : '') + '</div>';
  }
  function crNovScrivi(id, data, msg) {
    fs.collection('novita').doc(id).set(Object.assign({ il: nowISO() }, data), { merge: true }).then(function () { CR.novEd = null; CR.nov = undefined; toast(msg); crRender(); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
  }
  /* ---------- Pacchetto di partenza delle aziende nuove (idea N12, pacchetto/attuale) ----------
     Un'azienda nuova parte con categorie, tipi di scadenze, checklist e rifiuti più usati invece che dal vuoto.
     Il gestore lo cambia qui; l'app lo applica una volta sola, al primo ingresso dell'amministratore di un'azienda vuota. */
  var PACK_DEF = {
    categorie: ['Motore', 'Elettrico ed elettronica', 'Impianti di bordo', 'Carena e antivegetativa', 'Carrozzeria e lucidatura', 'Coperta e attrezzatura', 'Varo e alaggio', 'Trasferimento', 'Rimessaggio', 'Gestione cantiere'],
    tipiScadenza: ['Tagliando motore', 'Antivegetativa', 'Sostituzione anodi', 'Girante pompa acqua mare', 'Assicurazione', 'Revisione zattera', 'Estintori', 'Dotazioni di sicurezza', 'Fine contratto rimessaggio', 'Varo programmato'],
    checklist: [
      { nome: 'Tagliando motore entrobordo', voci: ['Olio motore e filtro', 'Filtro gasolio e prefiltro', 'Girante pompa acqua mare', 'Anodi dello scambiatore', 'Cinghie', 'Liquido di raffreddamento', 'Filtro aria', 'Perdite e fascette'] },
      { nome: 'Tagliando fuoribordo', voci: ['Olio motore e filtro', 'Olio del piede', 'Girante', 'Candele', 'Anodi', 'Filtro benzina', 'Ingrassaggio', 'Elica e copiglia'] },
      { nome: 'Rimessaggio invernale', voci: ['Lavaggio carena', 'Antigelo nel circuito', 'Batterie scollegate e in carica', 'Acqua dolce svuotata', 'Serbatoio pieno con additivo', 'Cuscini e vele a terra', 'Telo di copertura', 'Foto della barca'] },
      { nome: 'Preparazione al varo', voci: ['Antivegetativa', 'Anodi nuovi', 'Prese a mare e passascafo', 'Batterie montate e cariche', 'Motore in moto e scarico acqua', 'Pompe di sentina', 'Luci di navigazione', 'Dotazioni di sicurezza a bordo'] },
      { nome: 'Consegna al cliente', voci: ['Pulizia interna ed esterna', 'Prova motore', 'Strumenti accesi', 'Chiavi consegnate', 'Roba in deposito restituita'] }
    ],
    rifiuti: [
      { id: 'contenitori', nome: 'Contenitori vuoti di sostanze pericolose', cer: '15 01 10*', cont: 'Big bag', unita: 'pz', kgU: 0.5, ditta: 'd1', es: 'latte di antivegetativa, barattoli di vernice, taniche' },
      { id: 'spray', nome: 'Bombolette spray', cer: '15 01 11*', cont: 'Big bag', unita: 'pz', kgU: 0.25, ditta: 'd1' },
      { id: 'stracci', nome: 'Carta e stracci sporchi', cer: '15 02 02*', cont: 'Big bag', unita: 'sacchetto', kgU: 2, ditta: 'd1', es: 'stracci, carta assorbente, panni sporchi d’olio o vernice' },
      { id: 'filtri-aria', nome: 'Filtri aria', cer: '15 02 02*', cont: 'Big bag', unita: 'pz', kgU: 0.5, ditta: 'd1' },
      { id: 'filtri-olio', nome: 'Filtri olio e gasolio', cer: '16 01 07*', cont: 'Fusto ermetico filtri', unita: 'pz', kgU: 0.7, ditta: 'd1' },
      { id: 'antigelo', nome: 'Liquidi antigelo', cer: '16 01 14*', cont: 'Fusto ermetico antigelo', unita: 'l', kgU: 1.1, ditta: 'd1' },
      { id: 'batterie', nome: 'Batterie al piombo', cer: '16 06 01*', cont: 'Batterie', unita: 'pz', kgU: 22, dare: true, ditta: 'd1' },
      { id: 'zinco', nome: 'Zinco (anodi)', cer: '17 04 04', cont: 'Zinco', unita: 'pz', kgU: 1, dare: true, ditta: 'd1', es: 'anodi sostituiti' },
      { id: 'olio', nome: 'Olio motore esausto', cer: '13 02 05*', cont: 'Cisternetta olio', unita: 'l', kgU: 0.9, ditta: 'olio' }
    ]
  };
  function pacchetto() {
    return fs.collection('pacchetto').doc('attuale').get().then(function (d) { var x = d.exists ? d.data() : null; return x && !x._del ? Object.assign({}, PACK_DEF, x) : PACK_DEF; }, function () { return PACK_DEF; });
  }
  function righe(s) { return String(s || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean); }
  function crPackHtml() {
    if (CR.pack === undefined) { CR.pack = null; pacchetto().then(function (p) { CR.pack = p; crRender(); }); }
    var P = CR.pack; if (!P) return '<p class="note">Carico…</p>';
    if (!CR.packEd) return '<div class="grp"><div class="u"><div class="em">' + P.categorie.length + ' categorie · ' + P.tipiScadenza.length + ' tipi di scadenze · ' + P.checklist.length + ' checklist (' + esc(P.checklist.map(function (c) { return c.nome; }).join(', ')) + ') · ' + P.rifiuti.length + ' rifiuti</div>' +
      '<div class="acts"><button class="b pri" data-cr="pack-mod">Modifica</button></div><div class="em">Lo ricevono le aziende nuove al primo ingresso dell’amministratore; quelle che hanno già dati non cambiano.</div></div></div>';
    return '<div class="grp"><div class="u"><div class="nm">Categorie dei lavori, una per riga</div><textarea id="cr-pk-c" rows="6" style="' + TA + '">' + esc(P.categorie.join('\n')) + '</textarea>' +
      '<div class="nm" style="margin-top:10px">Tipi di scadenze, uno per riga</div><textarea id="cr-pk-s" rows="6" style="' + TA + '">' + esc(P.tipiScadenza.join('\n')) + '</textarea>' +
      '<div class="nm" style="margin-top:10px">Checklist: una riga con # e il nome, sotto le voci</div><textarea id="cr-pk-k" rows="12" style="' + TA + '">' + esc(P.checklist.map(function (c) { return '# ' + c.nome + '\n' + c.voci.join('\n'); }).join('\n\n')) + '</textarea>' +
      '<div class="nm" style="margin-top:10px">Rifiuti: nome | codice CER | unità (pz, l, kg, sacchetto)</div><textarea id="cr-pk-r" rows="8" style="' + TA + '">' + esc(P.rifiuti.map(function (r) { return [r.nome, r.cer || '', r.unita || 'pz'].join(' | '); }).join('\n')) + '</textarea>' +
      '<div class="acts"><button class="b pri" data-cr="pack-salva">Salva</button><button class="b" data-cr="pack-annulla">Annulla</button>' + (P !== PACK_DEF ? '<button class="b red" data-cr="pack-def">Torna a quello di partenza</button>' : '') + '</div></div></div>';
  }
  function crPackSalva() {
    var cat = righe(($('#cr-pk-c') || {}).value).filter(function (x) { return x !== 'Altro'; }), sc = righe(($('#cr-pk-s') || {}).value), ck = [], cur = null, old = {};
    righe(($('#cr-pk-k') || {}).value).forEach(function (r) { if (r.charAt(0) === '#') { cur = { nome: r.replace(/^#+\s*/, ''), voci: [] }; if (cur.nome) ck.push(cur); } else if (cur) cur.voci.push(r); });
    (CR.pack.rifiuti || []).forEach(function (r) { old[r.nome] = r; });
    var rf = righe(($('#cr-pk-r') || {}).value).map(function (r, i) {
      var p = r.split('|').map(function (x) { return x.trim(); }), o = old[p[0]] || {};
      return Object.assign({}, o, { id: o.id || ('r' + i), nome: p[0], cer: p[1] || '', unita: /^(pz|l|kg|sacchetto)$/.test(p[2] || '') ? p[2] : (o.unita || 'pz'), cont: o.cont || 'Altro', kgU: o.kgU || 1, ditta: o.ditta || (/olio/i.test(p[0]) ? 'olio' : 'd1') });
    }).filter(function (r) { return r.nome; });
    if (!cat.length) { toast('Scrivi almeno una categoria'); return; }
    ck = ck.filter(function (c) { return c.voci.length; });
    fs.collection('pacchetto').doc('attuale').set({ categorie: cat, tipiScadenza: sc, checklist: ck, rifiuti: rf, modificato: nowISO() })
      .then(function () { CR.pack = undefined; CR.packEd = false; toast('Pacchetto salvato'); crRender(); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
  }
  /* ---------- Segnala o suggerisci (idea X12) ----------
     Dall'app chi lavora in un'azienda manda un problema o un'idea (con una foto facoltativa): arriva qui con azienda,
     persona, pagina, versione e dispositivo. Il gestore risponde, la segna risolta o la mette ai voti (ideeVoto):
     le idee ai voti le vedono e votano tutti, così si capisce cosa chiedono davvero. */
  var SG = { list: null, idee: null, risp: null };
  function sgAvvia() {
    if (SG.list !== null) return; SG.list = [];
    fs.collection('segnalazioni').orderBy('creato', 'desc').limit(60).onSnapshot(function (s) { SG.list = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); crRender(); }, function () { });
    fs.collection('ideeVoto').onSnapshot(function (s) { SG.idee = s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); crRender(); }, function () { });
  }
  function sgVoti(x) { return Object.keys(x.voti || {}).filter(function (k) { return x.voti[k]; }).length; }
  function crSegnHtml() {
    sgAvvia();
    var L = SG.list || [], aperte = L.filter(function (x) { return x.stato !== 'risolta'; }), idee = (SG.idee || []).slice().sort(function (a, b) { return sgVoti(b) - sgVoti(a); });
    var h = '<div class="grp">' + (aperte.length ? aperte.slice(0, 20).map(function (x) {
      return '<div class="u"><div class="nm">' + esc(x.tipo === 'idea' ? '💡 Idea' : '⚠ Problema') + ' · ' + esc(x.nomeAzienda || '') + '<span class="pill">' + esc(crQuando(x.creato)) + '</span></div>' +
        '<div class="em" style="white-space:pre-wrap">' + esc(x.testo || '') + '</div><div class="em">' + esc([x.nome, x.pagina ? 'pagina ' + x.pagina : '', x.versione ? 'versione ' + x.versione : '', x.dispositivo].filter(Boolean).join(' · ')) + '</div>' +
        (x.foto ? '<img alt="Foto allegata" src="' + esc(x.foto) + '" style="max-width:100%;max-height:220px;border-radius:10px;margin-top:6px">' : '') +
        (x.risposta ? '<div class="em">La tua risposta: ' + esc(x.risposta) + '</div>' : '') +
        (SG.risp === x.id ? '<textarea id="cr-sg-r" rows="3" maxlength="1000" style="' + TA + '" placeholder="La risposta che vede chi l’ha mandata">' + esc(x.risposta || '') + '</textarea><div class="acts"><button class="b pri" data-cr="sg-risp-ok" data-id="' + esc(x.id) + '">Invia la risposta</button><button class="b" data-cr="sg-risp-no">Annulla</button></div>'
          : '<div class="acts"><button class="b" data-cr="sg-risp" data-id="' + esc(x.id) + '">Rispondi</button><button class="b" data-cr="sg-ok" data-id="' + esc(x.id) + '">Risolta</button>' + (x.tipo === 'idea' && !x.idea ? '<button class="b" data-cr="sg-voti" data-id="' + esc(x.id) + '">Metti ai voti</button>' : '') + '</div>') + '</div>';
    }).join('') : '<div class="u"><div class="em">Nessuna segnalazione da guardare.</div></div>') + '</div>';
    h += '<h4>Idee ai voti (' + idee.length + ')</h4><div class="grp">' + (idee.length ? idee.map(function (x) {
      return '<div class="u"><div class="nm">' + esc(x.testo || '') + '<span class="pill">' + sgVoti(x) + (sgVoti(x) === 1 ? ' voto' : ' voti') + '</span></div><div class="acts"><button class="b red" data-cr="sg-togli" data-id="' + esc(x.id) + '">Togli dai voti</button></div></div>';
    }).join('') : '<div class="u"><div class="em">Nessuna idea ai voti: con «Metti ai voti» su un’idea la vedono e votano tutte le aziende (senza nome di chi l’ha mandata).</div></div>') + '</div>';
    return h;
  }
  // per l'app: manda, le proprie, le idee ai voti, vota
  var SEGN = {
    invia: function (d) {
      if (!ME || !AZ) return Promise.reject({ code: 'no' });
      var x = { uid: ME.uid, azienda: AZ, nomeAzienda: String((AZD && AZD.nome) || '').slice(0, 80), nome: String(ME.nome || ME.email || '').slice(0, 80), tipo: d.tipo === 'idea' ? 'idea' : 'problema',
        testo: String(d.testo || '').slice(0, 2000), pagina: String(d.pagina || '').slice(0, 40), versione: String(d.versione || '').slice(0, 40), dispositivo: String(navigator.userAgent || '').slice(0, 200), stato: 'nuova', creato: nowISO() };
      if (d.foto) x.foto = d.foto;
      return fs.collection('segnalazioni').doc(rid('s')).set(x);
    },
    mie: function () { if (!ME) return Promise.resolve([]); return fs.collection('segnalazioni').where('uid', '==', ME.uid).get().then(function (s) { return s.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).sort(function (a, b) { return String(b.creato).localeCompare(String(a.creato)); }); }); },
    idee: function () { return fs.collection('ideeVoto').get().then(function (s) { return s.docs.map(function (d) { var x = d.data(); return { id: d.id, testo: x.testo || '', voti: sgVoti(x), mio: !!(ME && x.voti && x.voti[ME.uid]) }; }); }); },
    vota: function (id, on) { var u = {}; u['voti.' + ME.uid] = on ? true : firebase.firestore.FieldValue.delete(); return fs.collection('ideeVoto').doc(id).update(u); },
    shrink: function (file) { return shrink(file, 1100, 0.6).then(function (b) { return b.size > 280 * 1024 ? shrink(b, 800, 0.5) : b; }).then(blobToDataUrl); }
  };
  function crMsgHtml() {
    var m = CR.msg && CR.msg.attivo ? CR.msg : null;
    return '<div class="grp"><div class="u">' + (m ? '<div class="nm">In Home di tutte le aziende dal ' + esc(crQuando(m.il)) + '</div><div class="em">' + esc(m.testo) + '</div>' : '<div class="em">Nessun messaggio attivo.</div>') +
      '<textarea id="cr-msg" maxlength="300" rows="3" style="width:100%;box-sizing:border-box;margin-top:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5f7;padding:10px;font:inherit" placeholder="es. Sabato dalle 8 alle 10 il gestionale resta fermo per manutenzione"></textarea>' +
      '<div class="acts"><button class="b pri" data-cr="msg-pub">Pubblica a tutte</button>' + (m ? '<button class="b red" data-cr="msg-tog">Togli il messaggio</button>' : '') + '</div></div></div>';
  }

  /* ---------- scarica tutti i dati di un'azienda (solo con «Permetti assistenza» acceso) ---------- */
  async function crScarica(k) {
    var a = CR.az[k]; if (!a) return;
    if (!a.assistenza) { toast('Serve «Permetti assistenza» acceso dall’azienda. In alternativa il loro amministratore scarica tutto da Altro › Copia dei dati.'); return; }
    var foto = confirm('Includo anche le foto? Il file diventa molto più pesante.\nOK = con le foto · Annulla = solo i dati'), ref = fs.collection('aziende').doc(k), out = { azienda: Object.assign({ id: k }, a), scaricato: nowISO(), da: ME.email || '', persone: {}, dati: {} };
    crPersone(k).concat(crPersone(k, 'in_attesa'), crPersone(k, 'bloccato')).forEach(function (u) { out.persone[u] = CR.ut[u]; });
    var cs = COLLS.concat(foto ? ['foto', 'fotoInfo'] : ['fotoInfo']);
    try {
      for (var i = 0; i < cs.length; i++) {
        CR.scarico = 'Scarico ' + (i + 1) + ' di ' + cs.length + ' (' + cs[i] + ')…'; crRender();
        var s = await ref.collection(cs[i]).get(), m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); out.dati[cs[i]] = m;
      }
      var blob = new Blob([JSON.stringify(out, function (key, v) { return v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v; }, 1)], { type: 'application/json' }), u = URL.createObjectURL(blob), l = document.createElement('a');
      l.href = u; l.download = 'dati-' + String(a.nome || k).replace(/[^\w-]+/g, '_') + '-' + nowISO().slice(0, 10) + '.json'; document.body.appendChild(l); l.click(); l.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
      toast('Scaricato: ' + Math.round(blob.size / 1024) + ' KB');
    } catch (e) { toast('Non riuscito: ' + errOf(e).code); }
    CR.scarico = ''; crRender();
  }

  function crRender() {
    if (!CR.on || started) return;
    var o = $('#nmcr'); if (!o) { hideOverlay(); o = document.createElement('div'); o.id = 'nmcr'; document.body.appendChild(o); }
    var ae = document.activeElement, fid = ae && o.contains(ae) && ae.id ? ae.id : '', sel = fid && ae.selectionStart != null ? [ae.selectionStart, ae.selectionEnd] : null, keep = {};
    ['cr-msg', 'cr-nota', 'cr-sg-r', 'cr-nov-t', 'cr-nov-r', 'cr-pk-c', 'cr-pk-s', 'cr-pk-k', 'cr-pk-r'].forEach(function (id) { var el = document.getElementById(id); if (el) keep[id] = el.value; });
    var ids = Object.keys(CR.az).sort(function (a, b) { return String(CR.az[b].creato || '').localeCompare(String(CR.az[a].creato || '')); });
    var h = '<div class="in">';
    if (CR.vista && CR.vista.indexOf('rep:') === 0 && CR.az[CR.vista.slice(4)]) {
      var rk = CR.vista.slice(4), a = CR.az[rk], R = CR.att[rk] || { loading: true, list: [] }, F = CR.filtro;
      var list = R.list.filter(function (x) { return F === 'tutto' || crTipo(x) === F; });
      var n = function (t) { return R.list.filter(function (x) { return crTipo(x) === t; }).length; };
      h += '<div class="top"><button class="back" data-cr="scheda" data-id="' + rk + '">‹ ' + esc(a.nome || 'Azienda') + '</button><h3>Report</h3><span style="min-width:64px"></span></div>' +
        '<div class="chips">' + [['tutto', 'Tutto', R.list.length], ['accessi', 'Accessi', n('accessi')], ['azioni', 'Azioni', n('azioni')], ['errori', 'Errori', n('errori')], ['pagine', 'Pagine aperte', n('pagine')]].map(function (c) {
          return '<button class="b' + (F === c[0] ? ' pri' : '') + '" data-cr="filtro" data-id="' + c[0] + '">' + c[1] + ' ' + c[2] + '</button>'; }).join('') + '</div>' +
        (R.loading ? '<p class="note">Carico…</p>' : R.err ? '<p class="note">Non riesco a leggere il report (' + esc(R.err) + ').</p>' : !list.length ? '<p class="note">Niente da mostrare.</p>' :
          '<div class="grp">' + list.map(function (x) { return '<div class="u"><div class="nm"' + (crTipo(x) === 'errori' ? ' style="color:#ff8a80"' : '') + '>' + esc(x.cosa || '') + '</div><div class="em">' + esc((x.nome || '') + ' · ' + (x.disp || '') + ' · ' + crQuando(x.il)) + '</div></div>'; }).join('') + '</div>') +
        '<p class="note">Le ultime 300 righe degli ultimi 60 giorni. L’azienda non vede questo report.</p>';
    } else if (CR.vista && CR.vista.indexOf('az:') === 0 && CR.az[CR.vista.slice(3)]) {
      // scheda dell'azienda: l'essenziale
      var k = CR.vista.slice(3), A = CR.az[k], last = crUltimo(k), e7 = crErr7(k), nota = CR.note[k];
      var ult = {}; ((CR.att[k] || {}).list || []).forEach(function (x) { if (crTipo(x) === 'accessi' && !ult[x.uid]) ult[x.uid] = x.il; });
      h += '<div class="top"><button class="back" data-cr="home">‹ Aziende</button><h3>' + esc(A.nome || 'Azienda') + '</h3><span style="min-width:64px"></span></div>' +
        '<div class="grp"><div class="u"><div class="nm">' + esc(A.adminNome || 'Amministratore') + '</div><div class="em">' + esc((A.stato || '') + ' · codice ' + (codBello(A.codice) || '—') + ' · ' + (A.assistenza ? 'assistenza permessa' : 'assistenza non permessa')) + '<br>' + crAbb(A) + '<br>' + crSpazio(A) + '<br>' + crAi(k, A) +
        '<br>Ultimo accesso: ' + esc(last ? (last.nome || '') + ', ' + crQuando(last.il) : 'nessuno') + (e7 ? ' · <span style="color:#ff8a80">' + e7 + (e7 === 1 ? ' errore' : ' errori') + ' in 7 giorni</span>' : '') + '</div>' +
        '<div class="acts">' + (A.telefono ? '<a class="b" style="text-decoration:none;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 12px" href="tel:' + esc(String(A.telefono).replace(/[^\d+]/g, '')) + '">Chiama</a>' : '') +
        (A.email ? '<a class="b" style="text-decoration:none;color:inherit;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 12px" href="mailto:' + esc(A.email) + '">Email</a>' : '') +
        '<button class="b pri" data-cr="rep" data-id="' + k + '">Report</button><button class="b" data-cr="pagato" data-id="' + k + '">Segna pagato</button>' + (!A.abbonata ? '<button class="b" data-cr="prova" data-id="' + k + '">Giorni di prova</button>' : '') + '<button class="b" data-cr="quota" data-id="' + k + '">Quota spazio</button><button class="b" data-cr="aimax" data-id="' + k + '">Limite AI</button>' +
        (A.assistenza ? '<button class="b" data-cr="entra" data-id="' + k + '">Entra per assistenza</button>' : '') +
        '<button class="b" data-cr="scarica" data-id="' + k + '"' + (CR.scarico ? ' disabled' : '') + '>Scarica i dati</button><button class="b red" data-cr="sosp" data-id="' + k + '">Sospendi</button></div>' +
        (CR.scarico ? '<div class="em" style="margin-top:8px">' + esc(CR.scarico) + '</div>' : '') + '</div></div>' +
        '<h4>Persone (' + crPersone(k).length + ')</h4><div class="grp">' + (crPersone(k).length ? crPersone(k).sort(function (x, y) { return String(CR.ut[x].nome || '').localeCompare(String(CR.ut[y].nome || ''), 'it'); }).map(function (u) {
          var p = CR.ut[u]; return '<div class="u"><div class="nm">' + esc(p.nome || '(senza nome)') + '<span class="pill">' + esc(RUOLI[p.ruolo] || p.ruolo || '') + '</span>' + (p.tablet ? '<span class="pill">tablet</span>' : '') + '</div><div class="em">Ultimo accesso: ' + esc(ult[u] ? crQuando(ult[u]) : 'non nelle ultime 300 righe') + '</div></div>';
        }).join('') : '<div class="u"><div class="em">Nessuno.</div></div>') + '</div>' +
        '<h4>Nota privata</h4><div class="grp"><div class="u"><textarea id="cr-nota" rows="3" maxlength="1000" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5f7;padding:10px;font:inherit" placeholder="Solo per te: accordi, prezzo, cose da ricordare">' + esc(nota == null ? '' : nota) + '</textarea>' +
        '<div class="acts"><button class="b pri" data-cr="nota" data-id="' + k + '">Salva nota</button></div></div></div>' +
        '<p class="note">«Scarica i dati» funziona solo se l’azienda ha acceso «Permetti assistenza». Il file contiene persone e tutte le raccolte; le foto solo se le scegli.</p>';
      if (nota === undefined) { CR.note[k] = null; fs.collection('servizio').doc('note').collection('aziende').doc(k).get().then(function (d) { CR.note[k] = d.exists ? d.data().testo || '' : ''; crRender(); }, function () { CR.note[k] = ''; }); }
    } else {
      CR.vista = null;
      var by = function (st) { return ids.filter(function (kk) { return (CR.az[kk].stato || '') === st; }); };
      var row = function (kk) {
        var a = CR.az[kk], st = a.stato, acts = '', info = '';
        if (st === 'in_attesa') {
          info = esc((a.adminNome || '') + ' · ' + (a.email || '') + ' · tel. ' + (a.telefono || '—')) + '<br>Richiesta del ' + esc(crQuando(a.creato));
          acts = '<button class="b pri" data-cr="ok" data-id="' + kk + '">Approva</button><button class="b red" data-cr="no" data-id="' + kk + '">Rifiuta</button>';
        } else if (st === 'attiva') {
          var last = crUltimo(kk), e7 = crErr7(kk), R = CR.att[kk], np = crPersone(kk).length, na = crPersone(kk, 'in_attesa').length;
          info = crAbb(a) + '<br>' + esc(np + (np === 1 ? ' persona' : ' persone') + (na ? ' (+' + na + ' in attesa)' : '')) + ' · ' + crSpazio(a) + '<br>' +
            esc('Ultimo accesso: ' + (R && R.loading ? '…' : last ? crQuando(last.il) : 'nessuno')) + (e7 ? ' · <span style="color:#ff8a80">' + e7 + (e7 === 1 ? ' errore' : ' errori') + ' in 7 giorni</span>' : '');
          acts = '<button class="b pri" data-cr="scheda" data-id="' + kk + '">Apri</button><button class="b" data-cr="rep" data-id="' + kk + '">Report</button>';
        } else {
          info = esc((a.adminNome || '') + ' · ' + (a.email || ''));
          acts = '<button class="b" data-cr="riatt" data-id="' + kk + '">' + (st === 'rifiutata' ? 'Approva' : 'Riattiva') + '</button>';
        }
        return '<div class="u"><div class="nm">' + esc(a.nome || 'Azienda') + (st === 'attiva' && a.assistenza ? '<span class="pill">assistenza</span>' : '') + '</div><div class="em">' + info + '</div><div class="acts">' + acts + '</div></div>';
      };
      var sec = function (t, l) { return l.length ? '<h4>' + t + ' (' + l.length + ')</h4><div class="grp">' + l.map(row).join('') + '</div>' : ''; };
      // aziende attive: ricerca e ordine
      var q = CR.q.trim().toLowerCase(), att = by('attiva').filter(function (kk) { var a = CR.az[kk]; return !q || [a.nome, a.adminNome, a.email].join(' ').toLowerCase().indexOf(q) >= 0; });
      var key = { nome: function (kk) { return String(CR.az[kk].nome || '').toLowerCase(); }, spazio: function (kk) { var a = CR.az[kk]; return -((a.spazioMb || 0) / crQuota(a)); }, accesso: function (kk) { var l = crUltimo(kk); return l ? -Date.parse(l.il) : 0; }, errori: function (kk) { return -crErr7(kk); } }[CR.ord];
      att.sort(function (x, y) { var a = key(x), b = key(y); return a < b ? -1 : a > b ? 1 : String(CR.az[x].nome || '').localeCompare(String(CR.az[y].nome || ''), 'it'); });
      var nuovi = CR.avv.filter(function (x) { return !x.letto; });
      var pt = crDevTok(), pOn = !!(pt && CR.me && (CR.me.tokens || []).indexOf(pt) >= 0), pW = crPushPerche();
      h += '<div class="top"><span style="min-width:64px"></span><h3>Pannello del gestore</h3><button class="back" data-cr="out" style="text-align:right">Esci</button></div>' +
        (CR.err ? '<p class="note">Non riesco a leggere le aziende (' + esc(CR.err) + ').</p>' : '') +
        '<h4>Avvisi' + (nuovi.length ? ' (' + nuovi.length + ' nuovi)' : '') + '</h4><div class="grp">' +
        (CR.avv.length ? CR.avv.slice(0, CR.tuttiAvv ? 40 : 6).map(function (x) {
          return '<div class="u"' + (x.letto ? ' style="opacity:.6"' : '') + '><div class="nm"' + (x.tipo === 'errori' || (x.tipo === 'spazio' && /finito/.test(x.titolo || '')) ? ' style="color:#ff8a80"' : '') + '>' + esc(x.titolo || '') + '</div><div class="em">' + esc((x.testo ? x.testo + ' · ' : '') + crQuando(x.il)) + '</div>' +
            '<div class="acts">' + (x.azienda && CR.az[x.azienda] ? '<button class="b" data-cr="scheda" data-id="' + esc(x.azienda) + '">Apri l’azienda</button>' : '') + (!x.letto ? '<button class="b" data-cr="letto" data-id="' + esc(x.id) + '">Letto</button>' : '') + '</div></div>';
        }).join('') + (CR.avv.length > 6 && !CR.tuttiAvv ? '<div class="u"><button class="b" data-cr="tuttiavv">Vedi tutti</button></div>' : '') : '<div class="u"><div class="em">Nessun avviso. Qui arrivano le aziende nuove, lo spazio quasi pieno, gli errori ripetuti e le aziende ferme da 30 giorni.</div></div>') +
        '<div class="u"><div class="nm">Notifiche su questo telefono: ' + (pOn ? 'attive' : 'spente') + '</div>' + (pW && !pOn ? '<div class="em">' + esc(pW) + '</div>' : '<div class="acts"><button class="b' + (pOn ? '' : ' pri') + '" data-cr="push" data-id="' + (pOn ? 'off' : 'on') + '">' + (pOn ? 'Spegni' : 'Attiva') + '</button>' + (nuovi.length ? '<button class="b" data-cr="tuttiletti">Segna tutti letti</button>' : '') + '</div>') +
        '<div class="em">Senza telefono iscritto gli avvisi arrivano come segnalazione su GitHub (email).</div></div></div>' +
        sec('Richieste da approvare', by('in_attesa')) +
        '<h4>Consumi</h4>' + crSpazioTot() + crGrafico() +
        '<h4>Aziende attive (' + by('attiva').length + ')</h4>' +
        (by('attiva').length > 1 ? '<input id="cr-q" type="search" placeholder="Cerca per nome, amministratore o email" value="' + esc(CR.q) + '" style="width:100%;box-sizing:border-box;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#f4f5f7;padding:10px;font:inherit">' +
          '<div class="chips">' + [['nome', 'Nome'], ['spazio', 'Spazio'], ['accesso', 'Ultimo accesso'], ['errori', 'Errori']].map(function (c) { return '<button class="b' + (CR.ord === c[0] ? ' pri' : '') + '" data-cr="ord" data-id="' + c[0] + '">' + c[1] + '</button>'; }).join('') + '</div>' : '') +
        (att.length ? '<div class="grp" style="margin-top:10px">' + att.map(row).join('') + '</div>' : by('attiva').length ? '<p class="note">Nessuna azienda trovata.</p>' : '') +
        sec('Sospese', by('sospesa')) + sec('Rifiutate', by('rifiutata')) +
        '<h4>Segnalazioni e idee dalle aziende' + ((SG.list || []).filter(function (x) { return x.stato !== 'risolta'; }).length ? ' (' + SG.list.filter(function (x) { return x.stato !== 'risolta'; }).length + ')' : '') + '</h4>' + crSegnHtml() +
        '<h4>Novità in app</h4>' + crNovHtml() +
        '<h4>Messaggio a tutte le aziende</h4>' + crMsgHtml() +
        '<h4>Pacchetto di partenza delle aziende nuove</h4>' + crPackHtml() +
        (!ids.length && !CR.err ? '<p class="note">Ancora nessuna azienda. Quando un’azienda si registra dal sito, la sua richiesta compare qui.</p>' : '') +
        '<p class="note">Approvando un’azienda, chi l’ha registrata diventa il suo amministratore e l’azienda riceve il suo codice per far entrare colleghi e clienti. Nei dati di un’azienda entri solo se ha acceso «Permetti assistenza» in Altro › Utenti e permessi.</p>';
    }
    o.innerHTML = h + '</div>';
    Object.keys(keep).forEach(function (id) { var el = document.getElementById(id); if (el && keep[id]) el.value = keep[id]; });
    if (fid) { var f = document.getElementById(fid); if (f) { f.focus(); try { if (sel) f.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
  }
  async function crApprova(k) {
    var a = CR.az[k]; if (!a) return;
    for (var i = 0; i < 4; i++) {
      var c = a.codice || codNuovo(), b = fs.batch(), now = nowISO();
      if (!a.codice) b.set(fs.collection('codici').doc(c), { azienda: k, creato: now });
      var up = { stato: 'attiva', codice: c, approvata: now, modificato: now };
      if (!a.scade) { up.scade = piuGiorni(oggiISO(), PROVA_GG); up.scadeMs = fineGiorno(up.scade); up.abbonata = false; } // prova di 30 giorni dall'approvazione
      b.update(fs.collection('aziende').doc(k), up);
      if (a.admin && CR.ut[a.admin]) b.update(fs.collection('utenti').doc(a.admin), { stato: 'attivo', modificato: now });
      try { await b.commit(); toast((a.nome || 'Azienda') + ' approvata. Codice: ' + codBello(c) + (a.scade ? '' : ' · prova di ' + PROVA_GG + ' giorni')); return; } catch (e) { if (a.codice || i === 3) { toast('Non riuscito: ' + errOf(e).code); return; } }
    }
  }
  // Spazio di ogni azienda: lo misura ogni mattina l'invio delle notifiche (aziende/{az}.spazioMb); la quota la decide il gestore (100 MB se non scritta)
  var QUOTA0 = 100;
  // prova e abbonamento, una riga: in prova / abbonata fino al…, in rosso se scaduta, in giallo negli ultimi 7 giorni
  function crAbb(a) {
    if (!a.scade) return 'Senza scadenza';
    var d = giorniA(a.scade), t = (a.abbonata ? 'Abbonata' : 'In prova') + ' fino al ' + dataIt(a.scade);
    if (azScaduta(a)) return '<span style="color:#ff8a80">' + (a.abbonata ? 'Abbonamento scaduto' : 'Prova finita') + ' il ' + esc(dataIt(a.scade)) + ': app bloccata</span>';
    return '<span' + (d <= 7 ? ' style="color:#ffb020"' : '') + '>' + esc(t + (d <= 7 ? ' (' + (d === 0 ? 'oggi' : d === 1 ? 'domani' : 'tra ' + d + ' giorni') + ')' : '')) + '</span>';
  }
  // AI di oggi: quante richieste su quante (si legge quando si apre la scheda dell'azienda)
  function crAi(k, a) {
    var max = aiMaxDi(a), u = CR.ai[k];
    if (u === undefined) { CR.ai[k] = null; fs.collection('aziende').doc(k).collection('aiUso').doc(oggiISO()).get().then(function (d) { CR.ai[k] = d.exists ? d.data().n || 0 : 0; crRender(); }, function () { CR.ai[k] = -1; crRender(); }); }
    return esc('AI oggi: ' + (u == null ? '…' : u < 0 ? '?' : u) + ' richieste su ' + max);
  }
  function crScade(k, g, abb, msg) {
    var up = g ? { scade: g, scadeMs: fineGiorno(g), abbonata: abb, modificato: nowISO() } : { scade: FV.delete(), scadeMs: FV.delete(), abbonata: abb, modificato: nowISO() };
    fs.collection('aziende').doc(k).update(up).then(function () { toast(msg); }, function (e) { toast('Non riuscito: ' + errOf(e).code); });
  }
  function leggiData(v) {
    var m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\s*$/.exec(v || ''); if (!m) return null;
    var y = +m[3] < 100 ? 2000 + +m[3] : +m[3], g = y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2), d = new Date(g + 'T12:00:00Z');
    return isNaN(d) || d.getUTCDate() !== +m[1] ? null : g;
  }
  function crQuota(a) { return a.quotaMb > 0 ? a.quotaMb : QUOTA0; }
  function crSpazio(a) {
    if (a.spazioMb == null) return 'Spazio: non ancora misurato';
    var q = crQuota(a), p = Math.round(a.spazioMb / q * 100), col = p >= 95 ? '#ff8a80' : p >= 80 ? '#ffb020' : '';
    return '<span' + (col ? ' style="color:' + col + '"' : '') + '>Spazio: ' + Math.round(a.spazioMb) + ' MB su ' + q + ' MB (' + p + '%)</span>';
  }
  function crSpazioTot() {
    var mb = 0, n = 0; Object.keys(CR.az).forEach(function (k) { if (CR.az[k].spazioMb != null) { mb += CR.az[k].spazioMb; n++; } });
    if (!n) return '';
    var p = Math.round(mb / 1024 * 100), col = p >= 95 ? '#ff8a80' : p >= 80 ? '#ffb020' : '';
    return '<p class="note"' + (col ? ' style="color:' + col + '"' : '') + '>Spazio del servizio (foto di tutte le aziende): ' + Math.round(mb) + ' MB su 1024 MB del piano gratuito (' + p + '%). Si misura ogni mattina; all’80% e al 95% ti arriva un avviso.</p>';
  }
  function crStato(k, st, msg) { fs.collection('aziende').doc(k).update({ stato: st, modificato: nowISO() }).then(function () { toast(msg); }, function (e) { toast('Non riuscito: ' + errOf(e).code); }); }
  document.addEventListener('input', function (e) { if (e.target && e.target.id === 'cr-q') { CR.q = e.target.value; crRender(); } });
  document.addEventListener('change', function (e) { var t = e.target; if (t && t.closest && t.closest('#nmcr') && t.getAttribute('data-cr') === 'chi') { CR.chi = t.value; crRender(); } });
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmcr [data-cr]'); if (!t || t.tagName === 'SELECT') return;
    var k = t.getAttribute('data-cr'), id = t.getAttribute('data-id'), a = CR.az[id] || {};
    if (k === 'out') logout();
    else if (k === 'home') { CR.vista = null; crRender(); window.scrollTo(0, 0); }
    else if (k === 'scheda') { CR.vista = 'az:' + id; crReport(id); crRender(); window.scrollTo(0, 0); }
    else if (k === 'rep') { CR.vista = 'rep:' + id; CR.filtro = 'tutto'; CR.att[id] = null; crReport(id); crRender(); window.scrollTo(0, 0); }
    else if (k === 'filtro') { CR.filtro = id; crRender(); }
    else if (k === 'ord') { CR.ord = id; crRender(); }
    else if (k === 'giorni') { CR.giorni = +id; crRender(); }
    else if (k === 'metr') { CR.metr = id; crRender(); }
    else if (k === 'tuttiavv') { CR.tuttiAvv = true; crRender(); }
    else if (k === 'letto') fs.collection('servizio').doc('avvisi').collection('lista').doc(id).update({ letto: true }).catch(function () { });
    else if (k === 'tuttiletti') { var b = fs.batch(); CR.avv.filter(function (x) { return !x.letto; }).forEach(function (x) { b.update(fs.collection('servizio').doc('avvisi').collection('lista').doc(x.id), { letto: true }); }); b.commit().catch(function () { }); }
    else if (k === 'push') crPush(id === 'on');
    else if (k === 'nota') { var tx = (($('#cr-nota') || {}).value || '').trim(); fs.collection('servizio').doc('note').collection('aziende').doc(id).set({ testo: tx, modificato: nowISO() }).then(function () { CR.note[id] = tx; toast('Nota salvata'); crRender(); }, function (er) { toast('Non riuscito: ' + errOf(er).code); }); }
    else if (k === 'scarica') crScarica(id);
    else if (k === 'pack-mod') { CR.packEd = true; crRender(); }
    else if (k === 'pack-annulla') { CR.packEd = false; crRender(); }
    else if (k === 'pack-salva') crPackSalva();
    else if (k === 'pack-def') { if (confirm('Rimettere il pacchetto di partenza preparato all’inizio?')) fs.collection('pacchetto').doc('attuale').delete().then(function () { CR.pack = undefined; CR.packEd = false; toast('Pacchetto rimesso come all’inizio'); crRender(); }); }
    else if (k === 'msg-pub') {
      var mt = (($('#cr-msg') || {}).value || '').trim(); if (!mt) { toast('Scrivi il messaggio'); return; }
      if (!confirm('Pubblicare questo messaggio in Home a tutte le aziende?\n\n' + mt)) return;
      fs.collection('messaggioServizio').doc('attuale').set({ testo: mt, il: nowISO(), attivo: true }).then(function () { var el = $('#cr-msg'); if (el) el.value = ''; toast('Messaggio pubblicato'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
    }
    else if (k === 'msg-tog') fs.collection('messaggioServizio').doc('attuale').update({ attivo: false, tolto: nowISO() }).then(function () { toast('Messaggio tolto'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
    else if (k === 'ok' || (k === 'riatt' && a.stato === 'rifiutata')) { t.disabled = true; crApprova(id); }
    else if (k === 'riatt') crStato(id, 'attiva', 'Azienda riattivata');
    else if (k === 'no') { if (confirm('Rifiutare la richiesta di ' + (a.nome || 'questa azienda') + '?')) crStato(id, 'rifiutata', 'Richiesta rifiutata'); }
    else if (k === 'sosp') { if (confirm('Sospendere ' + (a.nome || 'questa azienda') + '? Nessuno dell’azienda potrà entrare finché non la riattivi. I dati restano.')) crStato(id, 'sospesa', 'Azienda sospesa'); }
    else if (k === 'nov-nuova') { CR.novEd = 'nuova'; crRender(); }
    else if (k === 'nov-mod') { CR.novEd = id; crRender(); }
    else if (k === 'nov-annulla') { CR.novEd = null; crRender(); }
    else if (k === 'nov-nascondi') { if (confirm('Nascondere questa novità? Chi non l’ha ancora vista non la vedrà.')) crNovScrivi(id, { nascosta: true }, 'Novità nascosta'); }
    else if (k === 'nov-vedi') crNovScrivi(id, { nascosta: false }, 'Novità rimessa');
    else if (k === 'sg-risp') { SG.risp = id; crRender(); }
    else if (k === 'sg-risp-no') { SG.risp = null; crRender(); }
    else if (k === 'sg-risp-ok') { var rv = String(($('#cr-sg-r') || {}).value || '').trim().slice(0, 1000); fs.collection('segnalazioni').doc(id).update({ risposta: rv, rispostaIl: nowISO(), stato: 'risposta' }).then(function () { SG.risp = null; toast('Risposta inviata'); crRender(); }, function (er) { toast('Non riuscito: ' + errOf(er).code); }); }
    else if (k === 'sg-ok') fs.collection('segnalazioni').doc(id).update({ stato: 'risolta', risoltaIl: nowISO() }).then(function () { toast('Segnata come risolta'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
    else if (k === 'sg-voti') { var sx = (SG.list || []).find(function (x) { return x.id === id; }); if (sx) fs.collection('ideeVoto').doc(rid('i')).set({ testo: String(sx.testo || '').slice(0, 300), creato: nowISO(), voti: {} }).then(function () { return fs.collection('segnalazioni').doc(id).update({ idea: true }); }).then(function () { toast('Messa ai voti: la vedono tutte le aziende'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); }); }
    else if (k === 'sg-togli') { if (confirm('Togliere questa idea dai voti?')) fs.collection('ideeVoto').doc(id).delete().then(function () { toast('Tolta dai voti'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); }); }
    else if (k === 'nov-salva') {
      var tt = (($('#cr-nov-t') || {}).value || '').trim(), rr = (($('#cr-nov-r') || {}).value || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12);
      if (!rr.length) { toast('Scrivi almeno una novità'); return; }
      crNovScrivi(id || new Date().toISOString(), { titolo: tt, righe: rr, nascosta: false }, id ? 'Novità salvata' : 'Novità pubblicata');
    }
    else if (k === 'aimax') {
      var vm = prompt('Richieste all’AI al giorno per ' + (a.nome || 'questa azienda') + ' (oggi ' + aiMaxDi(a) + '; 0 = AI spenta). La quota gratuita del servizio è in comune tra tutte le aziende.', String(aiMaxDi(a)));
      if (vm == null) return; var nm = Math.round(parseFloat(String(vm).replace(',', '.')));
      if (!(nm >= 0 && nm <= 500)) { toast('Scrivi un numero tra 0 e 500'); return; }
      fs.collection('aziende').doc(id).update({ aiMax: nm, modificato: nowISO() }).then(function () { toast('AI: ' + nm + ' richieste al giorno'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
    }
    else if (k === 'prova') {
      var base = String(a.approvata || nowISO()).slice(0, 10), gg0 = a.scade ? giorniA(a.scade) - giorniA(base) : PROVA_GG;
      var v = prompt('Giorni di prova per ' + (a.nome || 'questa azienda') + ', contati dall’approvazione del ' + dataIt(base) + ' (oggi ' + gg0 + ').', String(gg0));
      if (v == null) return; var n = Math.round(parseFloat(String(v).replace(',', '.')));
      if (!(n >= 1 && n <= 365)) { toast('Scrivi un numero di giorni tra 1 e 365'); return; }
      var g = piuGiorni(base, n); crScade(id, g, false, 'In prova fino al ' + dataIt(g));
    }
    else if (k === 'pagato') {
      var prop = dataIt(piuGiorni(a.scade && !azScaduta(a) ? a.scade : oggiISO(), 365));
      var v2 = prompt('Pagato: abbonata fino al giorno (GG/MM/AAAA).\nLascia vuoto per togliere la scadenza (l’azienda non si blocca mai).', prop);
      if (v2 == null) return;
      if (!v2.trim()) { if (confirm('Togliere la scadenza a ' + (a.nome || 'questa azienda') + '? Non si bloccherà mai.')) crScade(id, null, true, 'Senza scadenza'); return; }
      var g2 = leggiData(v2); if (!g2) { toast('Scrivi la data come 31/12/2027'); return; }
      if (g2 < oggiISO()) { toast('La data è già passata'); return; }
      crScade(id, g2, true, 'Abbonata fino al ' + dataIt(g2));
    }
    else if (k === 'quota') {
      var v = prompt('Spazio per le foto di ' + (a.nome || 'questa azienda') + ', in MB (oggi ' + crQuota(a) + '). Tutte le aziende insieme stanno in 1024 MB.', String(crQuota(a)));
      if (v == null) return; var q = Math.round(parseFloat(String(v).replace(',', '.')));
      if (!(q >= 10 && q <= 1024)) { toast('Scrivi un numero tra 10 e 1024'); return; }
      fs.collection('aziende').doc(id).update({ quotaMb: q, modificato: nowISO() }).then(function () { toast('Quota: ' + q + ' MB'); }, function (er) { toast('Non riuscito: ' + errOf(er).code); });
    }
    else if (k === 'entra') { try { sessionStorage.setItem('nm-assist', id); } catch (x) { } location.reload(); }
  });

  /* ---------- messaggio del gestore in Home di ogni azienda: si chiude con «Ho letto» (ricordato su questo telefono) ---------- */
  function msgServizio() {
    fs.collection('messaggioServizio').doc('attuale').onSnapshot(function (d) {
      var m = d.exists ? d.data() : null, el = $('#nmmsg'), visto = ''; try { visto = localStorage.getItem('gr-msg-visto') || ''; } catch (e) { }
      if (!m || !m.attivo || !m.testo || visto === m.il) { if (el) el.remove(); return; }
      ensureCss(); if (!el) { el = document.createElement('div'); el.id = 'nmmsg'; document.body.appendChild(el); }
      el.innerHTML = '<div class="it"><b>Dal gestore del servizio</b><br>' + esc(m.testo) + '<br><button class="ok" data-il="' + esc(m.il) + '">Ho letto</button></div>';
    }, function () { });
  }
  document.addEventListener('click', function (e) { var im = e.target.closest && e.target.closest('#nmfb .dfo img'); if (im) im.classList.toggle('big'); });
  document.addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('#nmmsg .ok'); if (!b) return; try { localStorage.setItem('gr-msg-visto', b.getAttribute('data-il')); } catch (x) { } var el = $('#nmmsg'); if (el) el.remove(); });

  /* ---------- Cosa c'è di nuovo: dopo una pubblicazione compare una volta a ogni persona (utenti/{uid}.novitaVista) ----------
     Le righe le scrive chi pubblica, in novita.json; il gestore le corregge o ne aggiunge dal suo pannello
     (raccolta «novita»: stesso id = sostituisce quella del file). Chi entra dopo una novità non la vede. */
  function novitaTutte(anche) {
    var file = fetch('novita.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    var db = fs.collection('novita').get().then(function (s) { var o = []; s.forEach(function (d) { o.push(Object.assign({ id: d.id, mia: true }, d.data())); }); return o; }).catch(function () { return []; });
    return Promise.all([file, db]).then(function (r) {
      var m = {}; (Array.isArray(r[0]) ? r[0] : []).forEach(function (x) { if (x && x.id) m[x.id] = Object.assign({ file: true }, x); });
      r[1].forEach(function (x) { m[x.id] = Object.assign({}, m[x.id] || {}, x); });
      return Object.keys(m).map(function (k) { return m[k]; }).filter(function (x) { return anche || (!x.nascosta && (x.righe || []).length); }).sort(function (a, b) { return String(b.id).localeCompare(String(a.id)); });
    });
  }
  function novitaVista(id) { if (!ME) return; ME.novitaVista = id; fs.collection('utenti').doc(ME.uid).update({ novitaVista: id, modificato: nowISO() }).catch(function () { }); }
  function novitaMostra() {
    if (!ME || ME.ruolo === 'cliente' || ME.assist || $('#nmnov')) return;
    var LI = live('impostazioni');
    LI.start.then(function () { return whenReady(LI, 15000); }).then(novitaTutte).then(function (l) {
      if (!l.length || !ME || !sezAccesa('novita', true)) return; // spenta in Aspetto dell'app
      var vista = ME.novitaVista || '', ultima = String(l[0].id);
      if (!vista && String(ME.creato || '').slice(0, 10) >= ultima.slice(0, 10)) { novitaVista(ultima); return; } // arrivato dopo: si parte da qui
      var nuove = l.filter(function (x) { return String(x.id) > vista; }).slice(0, 3);
      if (!nuove.length) return;
      ensureCss(); var el = document.createElement('div'); el.id = 'nmnov'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Cosa c’è di nuovo');
      el.innerHTML = '<div class="it"><h3>Cosa c’è di nuovo</h3>' + nuove.map(function (x) { return (x.titolo ? '<h4>' + esc(x.titolo) + '</h4>' : '') + '<ul>' + x.righe.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>'; }).join('') + '<button class="ok">Ho capito</button></div>';
      document.body.appendChild(el);
      el.querySelector('.ok').onclick = function () { el.remove(); novitaVista(ultima); };
    });
  }

  /* ---------- area cliente ---------- */
  var CL = { unsubs: [], docs: {}, all: {}, req: [], oy: {}, oc: {}, tab: '' };
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  function dataCorta(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return ''; var y = +m[1], cy = new Date().getFullYear(); return (+m[3]) + ' ' + MESI[+m[2] - 1] + (y !== cy ? ' ’' + String(y).slice(2) : ''); }
  function dataLunga(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + MESI[+m[2] - 1] + ' ' + m[1] : ''; }
  function quando(iso) { var t = new Date(iso); if (isNaN(t)) return ''; var p2 = function (n) { return (n < 10 ? '0' : '') + n; }; return t.getDate() + ' ' + MESI[t.getMonth()] + ' ' + t.getFullYear() + ' alle ' + p2(t.getHours()) + ':' + p2(t.getMinutes()); }
  function showCliente(x) {
    CLIENTE = true; ME = ME || x; attEntra();
    var ids = (x.barche || []).slice(0, 20);
    CL.unsubs.forEach(function (f) { f(); }); CL.unsubs = []; CL.ids = ids;
    ids.forEach(function (id) {
      CL.unsubs.push(AC('portale').doc(id).onSnapshot(function (d) { CL.docs[id] = d.exists ? d.data() : null; renderCliente(); },
        function () { CL.docs[id] = null; renderCliente(); }));
    });
    // le proprie richieste al cantiere (idea 4): le regole fanno leggere solo quelle con cliente = me
    CL.unsubs.push(AC('richiesteCliente').where('cliente', '==', ME.uid).onSnapshot(function (q) {
      CL.req = q.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }).filter(function (r) { return !r._del; }).sort(function (a, b) { return String(b.creato || '').localeCompare(String(a.creato || '')); });
      renderCliente();
    }, function () { CL.req = []; }));
    renderCliente();
  }
  /* ---------- Richieste del cliente dal portale (idea 4, Aspetto dell’app › sezioni) ----------
     «Vorrei il varo il…» e «Segnala un problema» (con foto): vanno in richiesteCliente; il cantiere le vede in
     Altro › Richieste dei clienti e risponde. Il cliente vede inviata → ricevuta → confermata (o non possibile). */
  var RQ_ST = { inviata: ['Inviata', ''], vista: ['Ricevuta', 'lav'], confermata: ['Confermata', 'acqua'], no: ['Non possibile', ''] };
  function rqCard(bid) {
    var mie = CL.req.filter(function (r) { return r.barcaId === bid && r.tipo !== 'lavoro'; }).slice(0, 6);
    return '<h5>Chiedi al cantiere</h5><div class="rqb"><button class="rqbtn" data-cl="rq" data-t="varo" data-id="' + esc(bid) + '">Vorrei il varo il…</button><button class="rqbtn" data-cl="rq" data-t="problema" data-id="' + esc(bid) + '">Segnala un problema</button></div>' +
      mie.map(function (r) {
        var st = RQ_ST[r.stato] || RQ_ST.inviata;
        return '<div class="lv" style="align-items:flex-start"><span style="flex:1">' + esc(r.tipo === 'varo' ? 'Varo il ' + dataLunga(r.data) : r.tipo === 'lavoro' ? 'Lavoro: ' + String(r.testo || '').slice(0, 60) : 'Problema: ' + String(r.testo || '').slice(0, 60)) +
          (r.risposta ? '<br><small>Il cantiere: ' + esc(r.risposta) + '</small>' : '') + '</span><span class="st ' + st[1] + '">' + st[0] + '</span></div>';
      }).join('');
  }
  function scCard(bid, d) {
    var L = d.scadenze || []; if (!L.length) return '';
    var mie = CL.req.filter(function (r) { return r.barcaId === bid && r.tipo === 'lavoro'; });
    return '<h5>Scadenze della tua barca</h5>' + L.map(function (s) {
      var gia = mie.find(function (r) { return r.scadId === s.id && r.stato !== 'no'; }), st = gia ? RQ_ST[gia.stato] || RQ_ST.inviata : null;
      return '<div class="lv" style="align-items:center"><span style="flex:1">' + esc(s.tipo) + (s.modello ? ' <small>(' + esc(s.modello) + ')</small>' : '') + '<br><small' + (s.scaduta ? ' style="color:#ff8a80"' : '') + '>' + esc((s.scaduta ? 'Scaduta il ' : 'Scade il ') + dataLunga(s.data)) + '</small>' + (gia && gia.risposta ? '<br><small>Il cantiere: ' + esc(gia.risposta) + '</small>' : '') + '</span>' +
        (gia ? '<span class="st ' + st[1] + '">' + st[0] + '</span>' : '<button class="rqbtn" style="flex:0 0 auto;min-width:0" data-cl="rqs" data-id="' + esc(bid) + '" data-s="' + esc(s.id) + '">Richiedi il lavoro</button>') + '</div>';
    }).join('');
  }
  async function rqScad(bid, sid, btn) {
    var d = CL.docs[bid] || {}, s = (d.scadenze || []).find(function (x) { return x.id === sid; }); if (!s) return;
    btn.disabled = true; btn.textContent = 'Invio…';
    try {
      await fs.collection('richiesteCliente').doc(rid('r')).set({ cliente: ME.uid, nome: ME.nome || '', barcaId: bid, tipo: 'lavoro', data: s.data, testo: s.tipo + (s.modello ? ' (' + s.modello + ')' : ''), scadId: sid, foto: [], stato: 'inviata', creato: nowISO() });
      toast('Richiesta inviata al cantiere');
    } catch (e) { btn.disabled = false; btn.textContent = 'Richiedi il lavoro'; toast('Non sono riuscito a inviarla: controlla la connessione e riprova.'); }
  }
  function rqForm(bid, tipo) {
    var d = CL.docs[bid] || {}, o = document.createElement('div'); o.id = 'nmrc'; var x = $('#nmrc'); if (x) x.remove();
    var oggi = new Date().toISOString().slice(0, 10);
    o.innerHTML = '<div class="box"><h3>' + esc(tipo === 'varo' ? 'Vorrei il varo' : 'Segnala un problema') + ' · ' + esc(d.nome || 'Barca') + '</h3>' +
      (tipo === 'varo' ? '<label>Il giorno<input id="rq-d" type="date" min="' + oggi + '"></label>' : '') +
      '<label>' + (tipo === 'varo' ? 'Note (facoltative)' : 'Cosa succede') + '<textarea id="rq-t" rows="4" maxlength="1500" placeholder="' + (tipo === 'varo' ? 'es. mattina presto, serve anche il pieno' : 'es. la pompa di sentina parte da sola') + '"></textarea></label>' +
      (tipo === 'problema' ? '<label>Foto (fino a 3, facoltative)<input id="rq-f" type="file" accept="image/*" multiple></label>' : '') +
      '<p id="rq-e" class="err" hidden></p><div class="row2"><button class="lnk" data-rq="x">Annulla</button><button class="pri" data-rq="ok">Invia</button></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click', async function (e) {
      var t = e.target.closest && e.target.closest('[data-rq]'); if (!t && e.target !== o) return;
      if (!t || t.getAttribute('data-rq') === 'x') { o.remove(); return; }
      var er = $('#rq-e'), dt = tipo === 'varo' ? ($('#rq-d').value || '') : '', tx = String($('#rq-t').value || '').trim().slice(0, 1500), fi = $('#rq-f');
      if (tipo === 'varo' && !dt) { er.textContent = 'Scegli il giorno.'; er.hidden = false; return; }
      if (tipo === 'problema' && !tx) { er.textContent = 'Scrivi cosa succede.'; er.hidden = false; return; }
      t.disabled = true; t.textContent = 'Invio…';
      try {
        var foto = [], files = fi && fi.files ? Array.prototype.slice.call(fi.files, 0, 3) : [];
        for (var i = 0; i < files.length; i++) {
          var b = await shrink(files[i], 1400, 0.72); if (b.size > 650 * 1024) b = await shrink(b, 1100, 0.6); if (b.size > 700 * 1024) continue;
          var fid = rid('f'); await AC('foto').doc(fid).set({ data: await blobToDataUrl(b), creato: nowISO(), da: ME.uid, portale: bid }); foto.push(fid);
        }
        await AC('richiesteCliente').doc(rid('r')).set({ cliente: ME.uid, nome: ME.nome || '', barcaId: bid, tipo: tipo, data: dt, testo: tx, foto: foto, stato: 'inviata', creato: nowISO() });
        o.remove(); toast('Richiesta inviata al cantiere');
      } catch (err) { t.disabled = false; t.textContent = 'Invia'; er.textContent = 'Non sono riuscito a inviarla: controlla la connessione e riprova.'; er.hidden = false; }
    });
  }
  // dove si trova la barca, con la sua icona (5/11/2026): stessa scelta della scheda barca nel gestionale
  var DOVE_I = { msv: '<svg aria-hidden="true" viewBox="0 0 48 48"><g fill="currentColor"><path d="M22.6 5.5v27H10.3c-.6 0-.9-.6-.6-1.1z"/><path d="M25.4 10.5v22H36c.6 0 .9-.6.6-1.1z"/><path d="M7.6 35h32.8c.7 0 1.1.8.6 1.3l-3.2 3.7c-.4.5-1 .7-1.6.7H11.8c-.6 0-1.2-.3-1.6-.7L7 36.3c-.5-.5-.1-1.3.6-1.3z"/></g><path fill="none" stroke="currentColor" stroke-width="1.6" d="M24 4v31"/><g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.9" d="M5 43.6c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6"/><path stroke-width="1.5" opacity=".55" d="M11 46.8c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3"/></g></svg>', nm: '<svg aria-hidden="true" viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="M4.5 20.8 23.2 7.7c.5-.3 1.1-.3 1.6 0l18.7 13.1c.4.3.5.7.5 1.2v18.5c0 .8-.6 1.5-1.4 1.5H5.9c-.8 0-1.4-.7-1.4-1.5V22c0-.5.1-.9.5-1.2zM13 42V28.6c0-.8.6-1.4 1.4-1.4h19.2c.8 0 1.4.6 1.4 1.4V42z"/><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".75"><path d="M15 31h18M15 35h18M15 39h18"/></g><path fill="currentColor" d="M2 43h44v2.2H2z" opacity=".55"/></svg>', porto: '<svg aria-hidden="true" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="24" cy="6.4" r="3.2" stroke-width="2.4"/><path stroke-width="2.8" d="M24 9.6v27"/><path stroke-width="2.6" d="M17.6 15.2h12.8"/><path stroke-width="2.8" d="M11 26.4c.6 6.4 6.3 10.4 13 10.4s12.4-4 13-10.4"/></g><g fill="currentColor"><path d="M8.2 28.2l2.6-5.4 3.4 5z"/><path d="M39.8 28.2l-2.6-5.4-3.4 5z"/></g><g fill="none" stroke="currentColor" stroke-linecap="round"><path stroke-width="1.9" d="M5 43.6c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6 2-1.6 4-1.6"/><path stroke-width="1.5" opacity=".55" d="M11 46.8c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.2 1.3"/></g></svg>', terzi: '<svg aria-hidden="true" viewBox="0 0 48 48"><path fill="currentColor" fill-rule="evenodd" d="M4.5 40.5V24.2C4.5 13.6 13.2 6 24 6s19.5 7.6 19.5 18.2v16.3c0 .8-.6 1.5-1.4 1.5H5.9c-.8 0-1.4-.7-1.4-1.5zM12.5 42V27.2c0-.8.6-1.4 1.4-1.4h20.2c.8 0 1.4.6 1.4 1.4V42z"/><g fill="none" stroke="currentColor" stroke-width="1.5" opacity=".75"><path d="M14.5 30h19M14.5 34h19M14.5 38h19"/></g><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".45" d="M9.6 19.4C12.4 13.6 17.8 10.4 24 10.4s11.6 3.2 14.4 9"/><path fill="currentColor" d="M2 43h44v2.2H2z" opacity=".55"/></svg>' }, DOVE_N = 0;
  function doveIcoCl(k) { var m = 'dvc' + (++DOVE_N); return '<span class="dv-ic ' + k + '">' + DOVE_I[k].replace(/MSK/g, m) + '</span>'; }
  function doveCl(d) {
    var st = d.stato || 'In rimessaggio', terra = st === 'In rimessaggio' || st === 'In lavorazione';
    var k = ['msv', 'nm', 'porto', 'terzi'].indexOf(d.dove) >= 0 ? d.dove : (st === 'In acqua' || (d.porto && !terra)) ? 'msv' : 'nm';
    var pz = (d.porto && d.porto.posto) || d.posto || '', t, sub = '';
    if (k === 'msv') {
      t = 'Al porto' + (pz ? ' · posto ' + pz : '');
      if (d.porto && (d.porto.contratto || d.porto.fino)) sub = 'Contratto ' + [d.porto.contratto, d.porto.fino ? 'fino al ' + dataLunga(d.porto.fino) : ''].filter(Boolean).join(' · ');
    } else if (k === 'nm') { var az = nomeAz(); t = /cantier/i.test(az) ? az : 'Al cantiere ' + az; sub = st === 'In lavorazione' ? 'In lavorazione' : st === 'In rimessaggio' ? 'A terra, in rimessaggio' : st === 'Consegnata' ? 'Consegnata' : ''; }
    else { t = [d.doveNome, d.doveLuogo].filter(Boolean).join(' · ') || (k === 'porto' ? 'Altro porto' : 'Cantiere di altri'); sub = k === 'porto' ? 'In un altro porto' : 'In un altro cantiere'; }
    return '<div class="where ' + k + '">' + doveIcoCl(k) + '<div><b>' + esc(t) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div></div>';
  }
  function renderCliente() {
    if (!CLIENTE || !ME) return;
    var h = '<h2>Ciao ' + esc(String(ME.nome || '').split(' ')[0]) + '</h2><p>La tua barca al cantiere ' + esc(nomeAz()) + ', sempre aggiornata.</p>';
    var rpOggi = nowISO().slice(0, 10), rpL = []; CL.ids.forEach(function (id) { var d = CL.docs[id]; if (d && (d.reperibili || []).length && !rpL.length) rpL = d.reperibili; });
    var rp = rpL.filter(function (t) { return t.dal <= rpOggi && t.al >= rpOggi; })[0] || rpL.filter(function (t) { return t.dal > rpOggi && t.dal <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10); })[0];
    if (rp) h += '<div class="card"><p style="margin:0">' + (rp.dal <= rpOggi ? 'Reperibile per le urgenze' : 'Reperibile per le urgenze da ' + esc(dataLunga(rp.dal))) + (rp.al > rp.dal ? ' fino a ' + esc(dataLunga(rp.al)) : '') + ': <b>' + esc(rp.nome || 'il cantiere') + '</b> · <a href="tel:' + esc(String(rp.tel).replace(/[^\d+]/g, '')) + '">' + esc(rp.tel) + '</a></p></div>';
    if (!CL.ids.length) h += '<div class="card"><p style="margin:0">Il cantiere sta collegando la tua barca al tuo account. Appena fatto, la trovi qui.</p></div>';
    // computer e tablet: una scheda per barca in alto e sotto i riquadri; sul telefono le barche restano una sotto l'altra
    var tab = CL.ids.indexOf(CL.tab) >= 0 ? CL.tab : CL.ids[0];
    if (CL.ids.length > 1) h += '<div class="btabs" role="tablist">' + CL.ids.map(function (id) {
      var d = CL.docs[id] || {}, st = d.stato || '', sub = [st, d.porto ? 'posto ' + d.porto.posto : ''].filter(Boolean).join(' · ');
      return '<button role="tab" data-cl="tab" data-id="' + esc(id) + '" aria-selected="' + (id === tab) + '">' + esc(d.nome || 'Barca') + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    }).join('') + '</div>';
    CL.ids.forEach(function (id) {
      var d = CL.docs[id], on = id === tab ? ' on' : '';
      var cs = function (x, c) { return x ? '<div class="cs' + (c ? ' ' + c : '') + '">' + x + '</div>' : ''; };
      if (d === undefined) { h += '<div class="card bc' + on + '"><div class="spin" style="margin:10px auto"></div></div>'; return; }
      if (!d) { h += '<div class="card bc' + on + '"><p style="margin:0">Stiamo preparando i dati di questa barca: tra poco li vedi qui.</p></div>'; return; }
      var st = d.stato || 'In rimessaggio', cls = st === 'In acqua' ? 'acqua' : st === 'In lavorazione' ? 'lav' : '';
      var lav = d.lavori || [], open = CL.all[id], show = open ? lav : lav.slice(0, 8);
      h += '<div class="card bc full' + on + '"><div class="bt"><div class="bh"><div><div class="bn">' + esc(d.nome || 'Barca') + '</div><div class="bm">' + esc([d.modello, d.lunghezza ? String(d.lunghezza).replace('.', ',') + ' m' : ''].filter(Boolean).join(' · ')) + '</div></div>' +
        '<span class="st ' + cls + '">' + esc(st) + '</span></div>' +
        doveCl(d) + '</div><div class="cg">' +
        cs((d.deposito || []).length ? '<h5>In deposito al cantiere</h5>' + d.deposito.map(function (x) {
          return '<div class="lv" style="align-items:center"><span style="flex:1">' + esc(x.cosa) + (x.quanti > 1 ? ' ×' + x.quanti : '') + '</span>' +
            ((x.foto || []).length ? '<span class="dfo">' + x.foto.map(function (f) { if (!PH[f]) setTimeout(function () { loadPhoto(f); }, 0); return '<img alt="" data-blob="' + esc(f) + '" src="' + esc(PH[f] || 'data:image/gif;base64,R0lGODlhAQABAAAAACw=') + '">'; }).join('') + '</span>' : '') + '</div>';
        }).join('') : '') +
        (d.avanzamento || []).map(function (a) {
          var f = a.voci.filter(function (v) { return v.s === 'fatto'; }).length, pc = Math.round(f / a.voci.length * 100);
          return cs('<h5>' + esc(a.fine ? 'Lavori finiti' : 'Lavori in corso') + ': ' + esc(a.titolo) + (a.numero ? ' (n. ' + esc(a.numero) + ')' : '') + '</h5>' +
            '<div class="avb" aria-label="' + pc + '% fatto"><i style="width:' + pc + '%"></i></div><div class="upd" style="margin:4px 0 6px">Fatti ' + f + ' su ' + a.voci.length + ' (' + pc + '%)</div>' +
            a.voci.map(function (v) { return '<div class="lv"><span class="d">' + (v.s === 'fatto' ? '✅' : v.s === 'in_corso' ? '🔧' : '⬜') + '</span><span>' + esc(v.t) + (v.s === 'in_corso' ? ' <small>(in corso)</small>' : '') + '</span></div>'; }).join(''));
        }).join('') +
        cs(scCard(id, d)) +
        cs(d.richieste ? rqCard(id) : '') +
        cs(oreCard(id, d), 'cso') +
        cs('<h5>Lavori eseguiti</h5>' +
        (lav.length ? show.map(function (l) { return '<div class="lv"><span class="d">' + esc(dataCorta(l.data)) + '</span><span>' + esc(l.titolo) + '</span></div>'; }).join('') +
          (lav.length > 8 ? '<button class="more" data-cl="more" data-id="' + esc(id) + '">' + (open ? 'Mostra meno' : 'Mostra tutti (' + lav.length + ')') + '</button>' : '')
          : '<p style="margin:4px 0 0">Ancora nessun lavoro registrato.</p>')) + '</div>' +
        (d.aggiornato ? '<div class="upd">Aggiornato il ' + esc(quando(d.aggiornato)) + '</div>' : '') + '</div>';
    });
    h += '<details class="gd"><summary>? Come funziona questa pagina</summary><ul>' +
      '<li>Per ogni tua barca vedi lo stato (in rimessaggio, in lavorazione, in acqua, consegnata) e dove si trova: al cantiere o al suo posto in porto.</li>' +
      '<li>Sotto ci sono le cose tue che il cantiere tiene in deposito (tender, cuscini, tendalini…), con le foto, e i lavori eseguiti, con la data.</li>' +
      (CL.ids.some(function (id) { return CL.docs[id] && CL.docs[id].ore; }) ? '<li>In «Ore di lavoro» vedi quante ore ha lavorato il cantiere sulla tua barca, divise per tipo di lavoro: tocca un tipo per leggere giorno per giorno cosa è stato fatto, come l’ha scritto chi ci ha lavorato, con il suo nome. Ci sono le giornate già confermate dal dipendente. Sopra scegli l’anno.</li>' : '') +
      '<li>Se il cantiere sta facendo i lavori di un preventivo, vedi quali sono fatti e quali mancano.</li>' +
      '<li>Con «Chiedi al cantiere» puoi chiedere il varo per un giorno o segnalare un problema con le foto: sotto vedi se è stata ricevuta e confermata.</li>' +
      '<li>Se il cantiere li mostra, vedi anche le scadenze della barca (tagliando, antivegetativa, zattera…): con «Richiedi il lavoro» lo chiedi al cantiere senza telefonare.</li>' +
      '<li>Se il cantiere ha un reperibile per il fine settimana o i festivi, in alto vedi chi è e il numero da chiamare per le urgenze.</li>' +
      '<li>La pagina si aggiorna da sola pochi secondi dopo ogni modifica del cantiere.</li>' +
      '<li>Se manca una barca o qualcosa non torna, chiama il cantiere.</li></ul></details>';
    h += '<button class="lnk" data-cl="pw">Cambia password</button><button class="lnk" data-cl="out">Esci</button>';
    var o = $('#nmfb'), y = o ? o.scrollTop : 0;
    o = overlay(h); if (o) { o.classList.add('cli'); o.scrollTop = y; }
  }
  // ore di lavoro: torta per tipo di lavoro (categoria) e, toccando un tipo, le sue mansioni con le ore
  var OCOL = { 'Motore': '#ffb547', 'Elettrico ed elettronica': '#ff7a90', 'Impianti di bordo': '#c08cff', 'Carena e antivegetativa': '#2f8ff0', 'Carrozzeria e lucidatura': '#2ec4a6',
    'Coperta e attrezzatura': '#e8d75a', 'Varo e alaggio': '#6fd3ff', 'Trasferimento': '#ff9a5c', 'Rimessaggio': '#9fe07f', 'Gestione cantiere': '#d48cc8', 'Altro': '#8a8db0' };
  function oreH(n) { return String(Math.round(n * 10) / 10).replace('.', ',') + ' h'; }
  function oreCard(id, d) {
    var all = d.ore; if (!all) return '';
    if (!all.length) return '<h5>Ore di lavoro</h5><p style="margin:4px 0 0">Ancora nessuna ora di lavoro segnata.</p>';
    var anni = []; all.forEach(function (r) { var a = String(r.d).slice(0, 4); if (anni.indexOf(a) < 0) anni.push(a); }); anni.sort().reverse();
    var y = CL.oy[id]; if (y !== 'tutto' && anni.indexOf(y) < 0) y = anni[0];
    var rs = y === 'tutto' ? all : all.filter(function (r) { return String(r.d).slice(0, 4) === y; });
    var g = {}, tot = 0; rs.forEach(function (r) { var c = OCOL[r.c] ? r.c : 'Altro'; (g[c] = g[c] || { c: c, h: 0, r: [] }).h += r.h; g[c].r.push(r); tot += r.h; });
    var cats = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.h - a.h || a.c.localeCompare(b.c, 'it'); });
    var R = 52, C = 2 * Math.PI * R, off = 0, gap = cats.length > 1 ? 2 : 0;
    var arcs = cats.map(function (x) { var l = x.h / tot * C, s = '<circle r="' + R + '" cx="70" cy="70" fill="none" stroke="' + OCOL[x.c] + '" stroke-width="22" stroke-dasharray="' + Math.max(l - gap, 0.5).toFixed(2) + ' ' + C.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)"/>'; off += l; return s; }).join('');
    var aperta = CL.oc[id];
    var h = '<h5>Ore di lavoro</h5>' +
      (anni.length > 1 ? '<div class="oy">' + anni.slice(0, 4).map(function (a) { return '<button data-cl="oy" data-id="' + esc(id) + '" data-y="' + a + '" aria-pressed="' + (y === a) + '">' + a + '</button>'; }).join('') +
        '<button data-cl="oy" data-id="' + esc(id) + '" data-y="tutto" aria-pressed="' + (y === 'tutto') + '">Tutto</button></div>' : '') +
      '<div class="odn"><svg width="150" height="150" viewBox="0 0 140 140" role="img" aria-label="' + esc(oreH(tot)) + ' di lavoro"><circle r="' + R + '" cx="70" cy="70" fill="none" stroke="#23245a" stroke-width="22"/>' + arcs +
      '<text x="70" y="68" text-anchor="middle" fill="#fff" font-size="21" font-weight="700">' + esc(oreH(tot)) + '</text><text x="70" y="87" text-anchor="middle" fill="#9a9dc0" font-size="12">' + (y === 'tutto' ? 'in tutto' : 'nel ' + y) + '</text></svg></div>' +
      cats.map(function (x) {
        var op = aperta === x.c;
        return '<button class="oc" data-cl="oc" data-id="' + esc(id) + '" data-c="' + esc(x.c) + '" aria-expanded="' + op + '"><small>' + (op ? '▾' : '▸') + '</small><i style="background:' + OCOL[x.c] + '"></i><span>' + esc(x.c) + '</span><b>' + esc(oreH(x.h)) + '</b></button>' +
          (op ? '<div class="ors" style="border-color:' + OCOL[x.c] + '">' + x.r.map(function (r) { return '<div class="lv"><span class="d">' + esc(dataCorta(r.d)) + '</span><span>' + esc(r.t) + (r.n ? '<small class="on">' + esc(r.n) + '</small>' : '') + '</span><span class="oh">' + esc(oreH(r.h)) + '</span></div>'; }).join('') + '</div>' : '');
      }).join('') +
      '<div class="otot"><span>' + (y === 'tutto' ? 'Totale' : 'Totale ' + y) + '</span><span>' + esc(oreH(tot)) + '</span></div>' +
      '<div class="upd" style="margin-top:4px">Tocca un tipo di lavoro per vedere giorno per giorno cosa è stato fatto.</div>';
    return h;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('#nmfb [data-cl]'); if (!t) return;
    var k = t.getAttribute('data-cl');
    if (k === 'out') logout();
    else if (k === 'pw') auth.sendPasswordResetEmail(ME.email).then(function () { toast('Ti ho mandato l’email per cambiare la password.'); }, function (er) { toast(authErr(er)); });
    else if (k === 'tab') { CL.tab = t.getAttribute('data-id'); renderCliente(); var b0 = $('#nmfb .btabs'); if (b0) b0.scrollIntoView({ block: 'nearest' }); }
    else if (k === 'more') { var id = t.getAttribute('data-id'); CL.all[id] = !CL.all[id]; renderCliente(); }
    else if (k === 'oy') { CL.oy[t.getAttribute('data-id')] = t.getAttribute('data-y'); CL.oc[t.getAttribute('data-id')] = null; renderCliente(); }
    else if (k === 'oc') { var oi = t.getAttribute('data-id'), oc = t.getAttribute('data-c'); CL.oc[oi] = CL.oc[oi] === oc ? null : oc; renderCliente(); }
    else if (k === 'rq') rqForm(t.getAttribute('data-id'), t.getAttribute('data-t'));
    else if (k === 'rqs') rqScad(t.getAttribute('data-id'), t.getAttribute('data-s'), t);
  });

  // Il cantiere prepara per ogni barca collegata a un cliente un riepilogo (ore e nomi dei dipendenti solo con la sezione «Ore di lavoro al cliente» accesa)
  var PT_T = null;
  function schedulePortale() { if (!started || !ME || ME.ruolo === 'cliente') return; clearTimeout(PT_T); PT_T = setTimeout(syncPortale, 4000); }
  function stable(x) {
    if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
    if (x && typeof x === 'object') return '{' + Object.keys(x).sort().filter(function (k) { return x[k] !== undefined; }).map(function (k) { return JSON.stringify(k) + ':' + stable(x[k]); }).join(',') + '}';
    return JSON.stringify(x === undefined ? null : x);
  }
  function linkedBoats() {
    var s = {}; Object.keys(UT).forEach(function (id) { var u = UT[id]; if (u.ruolo === 'cliente' && u.stato === 'attivo') (u.barche || []).forEach(function (b) { s[b] = 1; }); });
    return Object.keys(s);
  }
  function portaleOf(bid) {
    var b = (LIVE.barche ? LIVE.barche.map : {})[bid]; if (!b) return null;
    var L = LIVE.lavori ? LIVE.lavori.map : {}, P = LIVE.posti ? LIVE.posti.map : {};
    var ore = orePortale(bid); // con le ore accese le mansioni della scheda lavoro stanno lì, con le loro ore, e non si ripetono nei lavori eseguiti
    var lav = Object.keys(L).map(function (k) { return L[k]; }).filter(function (l) { return (l.barcaId === bid || (l.altreBarche || []).indexOf(bid) >= 0) && l.stato === 'fatto' && !l.annullata && !(ore && l.fonte === 'scheda'); })
      .sort(function (a, c) { return String(c.data || '').localeCompare(String(a.data || '')) || String(c.creato || '').localeCompare(String(a.creato || '')); })
      .slice(0, 100).map(function (l) { return { data: l.data || '', titolo: l.titolo || 'Lavoro' }; });
    var pid = Object.keys(P).filter(function (k) { return P[k].barcaId === bid; })[0], p = pid ? P[pid] : null;
    return { nome: b.nome || '', modello: b.modello || '', lunghezza: b.lunghezza || null, stato: b.stato || '', posto: b.posto || '',
      dove: ['msv', 'nm', 'porto', 'terzi'].indexOf(b.dove) >= 0 ? b.dove : '', doveNome: b.doveNome || '', doveLuogo: b.doveLuogo || '',
      porto: p ? { posto: pid, contratto: p.contratto || '', fino: p.fino || '' } : null, lavori: lav, ore: ore, deposito: depoPortale(bid), avanzamento: avPortale(bid), richieste: sezAccesa('richieste', false), scadenze: scadPortale(bid), reperibili: repPortale() };
  }
  // ore di lavoro al cliente (sezione orecliente, spenta di base): le mansioni della scheda lavoro
  // con il testo come l'ha scritto il dipendente, la categoria, le ore e il nome di chi l'ha fatta.
  // Solo le giornate già confermate dal dipendente (conferme/{utente}_{giorno}); contano solo sulla barca
  // principale della mansione (le «altre barche coinvolte» non ricevono le ore).
  function orePortale(bid) {
    if (!sezAccesa('orecliente', false)) return null;
    var L = LIVE.lavori ? LIVE.lavori.map : {}, CF = LIVE.conferme ? LIVE.conferme.map : {};
    var conf = function (l) { var c = CF[l.utente + '_' + String(l.data).slice(0, 10)]; return !!(c && !c._del); };
    var h = function (l) { var n = parseFloat(String(l.oreLavoro == null ? '' : l.oreLavoro).replace(',', '.')); return isFinite(n) ? n : 0; };
    return Object.keys(L).map(function (k) { return L[k]; }).filter(function (l) { return l.fonte === 'scheda' && l.barcaId === bid && !l.annullata && !l.daSegnare && !l._del && /^\d{4}-\d{2}-\d{2}/.test(l.data || '') && h(l) > 0 && l.utente && conf(l); })
      .sort(function (a, c) { return String(c.data).localeCompare(String(a.data)) || String(c.creato || '').localeCompare(String(a.creato || '')); })
      .slice(0, 800).map(function (l) { return { d: String(l.data).slice(0, 10), t: String(l.titolo || 'Lavoro').slice(0, 300), c: l.categoria || 'Altro', h: Math.round(h(l) * 100) / 100, n: String((UT[l.utente] || {}).nome || '').slice(0, 60) }; });
  }
  // scadenze ricordate al cliente (idea X63, sezione scadcliente): solo tipo, modello e data,
  // quelle scadute da meno di 90 giorni e quelle dei prossimi 60
  function scadPortale(bid) {
    if (!sezAccesa('scadcliente', false)) return [];
    var SC = LIVE.scadenze ? LIVE.scadenze.map : {}, oggi = nowISO().slice(0, 10), da = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), a = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    return Object.keys(SC).map(function (k) { return Object.assign({ id: k }, SC[k]); }).filter(function (s) { return s.barcaId === bid && !s.fatta && !s._del && s.data && s.data >= da && s.data <= a; })
      .sort(function (x, y) { return String(x.data).localeCompare(String(y.data)); }).slice(0, 12)
      .map(function (s) { return { id: s.id, tipo: s.tipo || 'Scadenza', modello: s.modello || '', data: s.data, scaduta: s.data < oggi }; });
  }
  // reperibilità (sezione reperibilita, spenta di base): nome e numero dei turni da oggi in poi, il portale mostra quello in corso
  function repPortale() {
    if (!sezAccesa('reperibilita', false)) return [];
    var I = LIVE.impostazioni ? LIVE.impostazioni.map : {}, c = I.reperibilita, oggi = nowISO().slice(0, 10);
    if (!c || c._del || !Array.isArray(c.turni)) return [];
    return c.turni.filter(function (t) { return t && t.al >= oggi && t.tel; }).sort(function (a, b) { return String(a.dal).localeCompare(String(b.dal)); }).slice(0, 6)
      .map(function (t) { return { dal: t.dal, al: t.al, nome: String((UT[t.uid] && UT[t.uid].nome) || '').split(' ')[0], tel: t.tel }; });
  }
  // avanzamento dei lavori dei preventivi accettati (idea P5, Aspetto dell’app › sezioni): solo titoli e fatto/non fatto
  function avPortale(bid) {
    if (!sezAccesa('avanzamento', false)) return [];
    var PV = LIVE.preventivi ? LIVE.preventivi.map : {}, L = LIVE.lavori ? LIVE.lavori.map : {}, lim = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    return Object.keys(PV).map(function (k) { return PV[k]; }).filter(function (p) { return p.barcaId === bid && p.stato === 'accettato' && (p.lavIds || []).length; })
      .map(function (p) {
        var vs = p.lavIds.map(function (id) { return L[id]; }).filter(function (l) { return l && !l.annullata; });
        var ultimo = vs.reduce(function (m, l) { return l.stato === 'fatto' && (l.data || '') > m ? l.data : m; }, '');
        return { titolo: p.titolo || 'Lavori', numero: p.numero || '', voci: vs.map(function (l) { return { t: l.titolo || 'Lavoro', s: l.stato === 'fatto' ? 'fatto' : l.stato === 'in_corso' ? 'in_corso' : 'da_fare' }; }), fine: vs.every(function (l) { return l.stato === 'fatto'; }) ? ultimo : '' };
      })
      .filter(function (a) { return a.voci.length && (!a.fine || a.fine >= lim); }).slice(0, 10);
  }
  // roba del cliente in deposito: cosa, quanti e foto (dove è riposta e le note restano al cantiere)
  // sezioni accese in Aspetto dell'app (impostazioni/sezioni): «deposito» è spenta di base, «novita» accesa
  function sezAccesa(k, base) {
    var I = LIVE.impostazioni ? LIVE.impostazioni.map : {}, c = I.sezioni;
    if (!c || c._del || !Array.isArray(c.spente)) return base;
    if (c.spente.indexOf(k) >= 0) return false;
    return base || (c.conosce || []).indexOf(k) >= 0;
  }
  function depoPortale(bid) {
    if (!sezAccesa('deposito', false)) return [];
    var D = LIVE.deposito ? LIVE.deposito.map : {};
    return Object.keys(D).map(function (k) { return D[k]; }).filter(function (x) { return x.barcaId === bid && x.stato !== 'restituito'; })
      .sort(function (a, c) { return String(a.cosa || '').localeCompare(String(c.cosa || ''), 'it'); })
      .slice(0, 40).map(function (x) { return { cosa: x.cosa || '', quanti: x.quanti || null, foto: (x.foto || []).slice(0, 4) }; });
  }
  function fotoDi(s) { var o = []; (s && s.deposito || []).forEach(function (x) { (x.foto || []).forEach(function (f) { o.push(f); }); }); return o; }
  async function syncPortale() {
    var ids = linkedBoats(); if (!ids.length) return;
    var need = ['barche', 'lavori', 'posti', 'deposito', 'impostazioni', 'portale', 'preventivi', 'scadenze', 'conferme'];
    for (var i = 0; i < need.length; i++) { var L = live(need[i]); await L.start; await whenReady(L, 15000); }
    var cur = LIVE.portale.map;
    ids.forEach(function (bid) {
      var s = portaleOf(bid); if (!s) return;
      var c = cur[bid] ? Object.assign({}, cur[bid]) : null; if (c) delete c.aggiornato;
      if (c && stable(c) === stable(s)) return;
      s.aggiornato = nowISO();
      write('portale', bid, 'set', s).catch(function () { });
      // le foto del portale le può aprire il cliente di questa barca (regole: foto.portale tra le sue barche)
      var prima = fotoDi(c);
      fotoDi(s).forEach(function (f) { if (prima.indexOf(f) < 0) AC('foto').doc(f).update({ portale: bid }).catch(function () { }); });
    });
  }

  /* ---------- dati portati dall'app di Claude: link con la chiave, una volta sola ----------
     Il pacchetto sul sito è cifrato (AES-GCM): senza la chiave, che sta solo nel link, non si legge.
     Aggiunge solo ciò che nel sito non c'è e non c'è mai stato; quello che c'è non viene toccato. */
  var IMP_FILE = 'dati-claude.enc', IMP_ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
  var IMP_NOMI = { barche: ['barca', 'barche'], lavori: ['lavorazione o mansione', 'lavorazioni e mansioni'], scadenze: ['scadenza', 'scadenze'], vari: ['varo o alaggio', 'vari e alaggi'],
    magazzino: ['voce di magazzino', 'voci di magazzino'], movimenti: ['carico o scarico', 'carichi e scarichi'], operazioni: ['servizio di cantiere', 'servizi di cantiere'],
    opModelli: ['gruppo dei servizi', 'gruppi dei servizi'], mezzi: ['mezzo o carrello', 'mezzi e carrelli'], conferme: ['giornata confermata', 'giornate confermate'],
    dipendenti: ['nome dei dipendenti', 'nomi dei dipendenti'], impostazioni: ['misure della mappa', 'misure della mappa'], posti: ['posto al porto', 'posti al porto'],
    attrezzatura: ['attrezzatura di bordo', 'attrezzature di bordo'], deposito: ['cosa in deposito', 'cose in deposito'], componenti: ['componente a bordo', 'componenti a bordo'], barattoli: ['barattolo aperto', 'barattoli aperti'], noteColleghi: ['nota a un collega', 'note ai colleghi'], programma: ['voce del programma', 'voci del programma'], cariche: ['carica delle batterie', 'cariche delle batterie'],
    richieste: ['richiesta', 'richieste'], checklist: ['checklist', 'checklist'], checkBarca: ['lista per barca', 'liste per barca'], modelli: ['modello di checklist', 'modelli di checklist'],
    giri: ['giro di controllo', 'giri di controllo'], cronometri: ['cronometro', 'cronometri'], ditte: ['ditta esterna', 'ditte esterne'] };
  var IMP_KEY = null, IMP = null;
  function impHash() {
    var m = /[#&]importa=([A-Za-z0-9_-]{40,})/.exec(location.hash || '');
    try {
      if (m) { IMP_KEY = m[1]; sessionStorage.setItem('nm-importa', IMP_KEY); history.replaceState(null, '', location.pathname + location.search); }
      else IMP_KEY = IMP_KEY || sessionStorage.getItem('nm-importa');
    } catch (e) { if (m) IMP_KEY = m[1]; }
    return !!m;
  }
  impHash();
  // link aperto con l'app già aperta nella stessa scheda
  window.addEventListener('hashchange', function () { if (impHash() && started && ME && !CLIENTE) offerImport(); });
  function impForget() { IMP_KEY = null; try { sessionStorage.removeItem('nm-importa'); } catch (e) { } }
  function b64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  async function impLoad() {
    var r; try { r = await fetch(IMP_FILE, { cache: 'no-store' }); } catch (e) { throw { code: 'rete' }; }
    if (r.status === 404) throw { code: 'manca' };
    if (!r.ok) throw { code: 'rete' };
    var buf = new Uint8Array(await r.arrayBuffer()), plain;
    try {
      var key = await crypto.subtle.importKey('raw', b64u(IMP_KEY), { name: 'AES-GCM' }, false, ['decrypt']);
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    } catch (e) { throw { code: 'chiave' }; }
    var data = JSON.parse(new TextDecoder().decode(plain));
    if (!data || (data.app !== 'Gestionale cantiere' && data.app !== 'Nautica Mare') || !data.collezioni) throw { code: 'chiave' }; // le copie fatte prima si chiamavano «Nautica Mare»
    return data;
  }
  async function impMissing(data) {
    var list = [];
    COLLS.forEach(function (name) {
      var src = data.collezioni[name]; if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (id) {
        var d = src[id];
        if (IMP_ID.test(id) && d && typeof d === 'object' && !Array.isArray(d) && !(name === 'impostazioni' && id !== 'mappa')) list.push({ c: name, id: id });
      });
    });
    var out = [];
    for (var i = 0; i < list.length; i += 10) {
      var part = await Promise.all(list.slice(i, i + 10).map(function (x) {
        return AC(x.c).doc(x.id).get({ source: 'server' }).then(function (d) { return d.exists ? null : x; });
      }));
      part.forEach(function (x) { if (x) out.push(x); });
    }
    return out;
  }
  function impCount(list) {
    var n = {}; list.forEach(function (x) { n[x.c] = (n[x.c] || 0) + 1; });
    return COLLS.filter(function (c) { return n[c]; }).map(function (c) { var w = IMP_NOMI[c] || [c, c]; return n[c] + ' ' + (n[c] === 1 ? w[0] : w[1]); });
  }
  function impScreen(html) {
    var o = overlay('<h2>Dati dall’app di Claude</h2>' + html);
    if (o) o.onclick = function (e) {
      var t = e.target.closest && e.target.closest('[data-imp]'); if (!t) return;
      var k = t.getAttribute('data-imp');
      if (k === 'chiudi') { hideOverlay(); }
      else if (k === 'fine') { impForget(); hideOverlay(); }
      else if (k === 'riprova') offerImport();
      else if (k === 'via') runImport();
    };
    return o;
  }
  async function offerImport() {
    if (!IMP_KEY || !ME) return;
    if (ME.ruolo !== 'admin') { toast('Solo un amministratore può importare i dati dall’app di Claude.'); return; }
    impScreen('<div class="spin"></div><p style="text-align:center">Apro i dati…</p>');
    try {
      var data = await impLoad();
      var fatto = await AC('impostazioni').doc('importClaude').get({ source: 'server' });
      var list = await impMissing(data);
      IMP = { data: data, list: list };
      var qd = data.creata ? quando(data.creata) : '';
      if (!list.length) {
        impScreen('<div class="card"><p style="margin:0">' + (fatto.exists ? 'L’importazione è già stata fatta: ' : '') + 'nel sito c’è già tutto quello che c’era nell’app di Claude.</p></div>' +
          '<button class="btn" data-imp="fine">Apri l’app</button>');
        return;
      }
      var io = data.io && data.io.id && data.io.id !== ME.uid && !UT[data.io.id] ? data.io : null;
      impScreen('<p>Copia presa dall’app di Claude' + (qd ? (/^(8|11) /.test(qd) ? ' l’' : ' il ') + esc(qd) : '') + '. Nel sito mancano:</p>' +
        '<div class="card">' + impCount(list).map(function (s) { return '<div class="kv" style="border-top:0;padding:4px 0"><b style="text-align:left">' + esc(s) + '</b></div>'; }).join('') + '</div>' +
        '<p style="margin-top:14px">Quello che c’è già nel sito non viene toccato.' + (io ? ' Le mansioni, le ore e le giornate di <b>' + esc(io.nome || 'chi usava l’app') + '</b> passano al tuo account.' : '') + '</p>' +
        '<button class="btn" data-imp="via">Importa</button><button class="lnk" data-imp="chiudi">Non ora</button>');
    } catch (e) {
      var c = e && e.code;
      if (c === 'manca') { impForget(); impScreen('<div class="card"><p style="margin:0">Il pacchetto con i dati non è più sul sito: l’importazione è già stata fatta.</p></div><button class="btn" data-imp="fine">Apri l’app</button>'); }
      else if (c === 'chiave') { impForget(); impScreen('<div class="card"><p style="margin:0">Il link non è completo, quindi i dati non si aprono. Riapri il link intero.</p></div><button class="btn" data-imp="fine">Apri l’app</button>'); }
      else impScreen('<div class="card"><p style="margin:0">Serve internet per importare i dati. Riprova quando hai campo.</p></div><button class="btn" data-imp="riprova">Riprova</button><button class="lnk" data-imp="chiudi">Non ora</button>');
    }
  }
  async function runImport() {
    if (!IMP) return;
    var data = IMP.data, list = IMP.list, done = 0, fail = 0;
    var prog = function (t) { var p = $('#nm-imp-p'); if (p) p.textContent = t; };
    impScreen('<div class="spin"></div><p style="text-align:center" id="nm-imp-p">Importo…</p>');
    for (var i = 0; i < list.length; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(function (x) {
        return write(x.c, x.id, 'set', data.collezioni[x.c][x.id]).then(function () { done++; }, function () { fail++; });
      }));
      prog('Importo ' + (done + fail) + ' di ' + list.length + '…');
    }
    var linked = 0, io = data.io && data.io.id && data.io.id !== ME.uid && !UT[data.io.id] ? data.io : null;
    if (io && !fail) { prog('Collego i dati al tuo account…'); try { linked = await relink(io.id, ME.uid); } catch (e) { fail++; } }
    if (!fail) { try { await write('impostazioni', 'importClaude', 'set', { il: nowISO(), da: ME.uid, voci: done, collegati: linked, copia: data.creata || '' }); } catch (e) { } }
    IMP = null;
    impScreen(fail
      ? '<div class="card"><p style="margin:0">Importate ' + done + ' voci, ' + fail + ' non riuscite. Riapri il link per riprovare: rimette solo quelle che mancano.</p></div><button class="btn" data-imp="chiudi">Apri l’app</button>'
      : '<div class="card"><p style="margin:0" class="ok"><b>Fatto!</b></p><p style="margin:6px 0 0">Ho importato ' + done + (done === 1 ? ' voce' : ' voci') + ' dall’app di Claude' + (io ? ' e le ho collegate al tuo account' : '') + '.</p></div>' +
        '<button class="btn" data-imp="fine">Apri l’app</button>');
  }


  /* ---------- attività: chi entra e cosa fa ----------
     Ognuno scrive le proprie azioni in «attivita»; le leggono solo gli amministratori (firestore.rules).
     Gli avvisi arrivano solo all'amministratore che ha registrato l'azienda, mentre ha l'app aperta;
     quando la riapre vede chi è entrato mentre non c'era. Si tiene 60 giorni. */
  var ATT = { entrato: false, vista: '', last: {}, uns: null, voci: {} }, ATT_DAYS = 60;
  // gli avvisi vanno all'amministratore che ha registrato l'azienda (o all'email di NM_AVVISI_A in config.js, se c'è)
  function attIo() { var a = window.NM_AVVISI_A; return !!(ME && ME.ruolo === 'admin' && !ME.assist && (a ? String(ME.email || '').toLowerCase() === String(a).trim().toLowerCase() : AZD && AZD.admin === ME.uid)); }
  function attDisp() { return /iPhone|iPad|Android|Mobi/i.test(navigator.userAgent) ? 'telefono' : 'computer'; }
  function attScrivi(cosa) {
    if (!ME || !ME.uid || (attIo() && window.NM_AVVISI_A)) return; // con più aziende si scrive tutto: serve anche al report del gestore
    var k = cosa, t = Date.now();
    if (ATT.last[k] && t - ATT.last[k] < 60000) return; // la stessa cosa ripetuta subito (salvataggi di fila) conta una volta
    ATT.last[k] = t;
    AC('attivita').add({ uid: ME.uid, nome: (ME.nome || ME.email || '') + (AS ? ' come ' + ((UT[AS] && UT[AS].nome) || '?') : ''), cosa: String(cosa).slice(0, 200), il: nowISO(), disp: attDisp(), _ts: FV.serverTimestamp() }).catch(function () { });
  }
  function attEntra() { if (ATT.entrato || !ME) return; ATT.entrato = true; attScrittura.ok = true; attScrivi(CLIENTE ? 'è entrato nell’area clienti' : 'è entrato nell’app'); }
  function attVista(n) { if (!started || !n || n === ATT.vista) return; ATT.vista = n; attScrivi('apre ' + n); }
  function attScrittura(name, verbo, d) {
    if (!attScrittura.ok || name === 'dipendenti' || name === 'portale') return;
    d = d || {};
    var nome = d.nome || d.titolo || d.descrizione || d.testo || d.cliente || '';
    attScrivi(verbo + ' ' + (CEST_NOMI[name] || name).toLowerCase() + (nome ? ' «' + String(nome).slice(0, 60) + '»' : ''));
  }
  function attOra(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function attSoloOra(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }); }
  function attAscolta() {
    if (!attIo() || ATT.uns) return;
    var KEY = 'nm-att-visto-' + ME.uid, visto = null;
    try { visto = localStorage.getItem(KEY); } catch (e) { }
    var cut = new Date(Date.now() - ATT_DAYS * 864e5).toISOString();
    if (!visto || visto < cut) visto = new Date(Date.now() - 864e5).toISOString(); // la prima volta: le ultime 24 ore
    setTimeout(function () { AC('attivita').where('il', '<', cut).limit(300).get().then(function (s) { if (!s.size) return; var b = fs.batch(); s.docs.forEach(function (d) { b.delete(d.ref); }); return b.commit(); }).catch(function () { }); }, 8000);
    var primo = true;
    if (window.Notification && Notification.permission === 'default') try { Notification.requestPermission(); } catch (e) { }
    ATT.uns = AC('attivita').where('il', '>', visto).orderBy('il').onSnapshot(function (s) {
      var nuove = [];
      s.docChanges().forEach(function (c) { if (c.type === 'added') { var x = c.doc.data(); if (x.uid !== ME.uid) nuove.push(x); } });
      if (nuove.length) { try { localStorage.setItem(KEY, nuove[nuove.length - 1].il); } catch (e) { } }
      if (primo) { primo = false; if (nuove.length) attRiepilogo(nuove); return; }
      nuove.forEach(attAvvisa);
    }, function () { ATT.uns = null; });
  }
  // avviso in diretta: uno per persona, con le sue ultime azioni
  function attAvvisa(x) {
    var v = ATT.voci[x.uid] = (ATT.voci[x.uid] || []).concat(attSoloOra(x.il) + ' ' + x.cosa).slice(-4);
    var tit = x.nome + (x.disp ? ' · ' + x.disp : ''), body = v.slice().reverse().join('\n');
    ensureCss();
    var box = $('#nmatt'); if (!box) { box = document.createElement('div'); box.id = 'nmatt'; document.body.appendChild(box); }
    var el = box.querySelector('[data-u="' + x.uid + '"]');
    if (!el) { el = document.createElement('div'); el.className = 'it'; el.setAttribute('data-u', x.uid);  box.appendChild(el); }
    el.innerHTML = '<button type="button" class="x" aria-label="Chiudi">×</button><b>' + esc(tit) + '</b><span>' + esc(attSoloOra(x.il) + ' · ' + x.cosa) + '</span>';
    el.querySelector('.x').onclick = function () { clearTimeout(el._t); el.remove(); };
    clearTimeout(el._t); el._t = setTimeout(function () { el.remove(); }, 60000); // resta un minuto
    if (document.hidden && window.Notification && Notification.permission === 'granted' && navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration().then(function (r) {
        if (r) r.showNotification(tit, { body: body, tag: 'nm-att-' + x.uid, renotify: true, icon: './icon-192.png', badge: './icon-192.png', data: { url: './' } });
        else new Notification(tit, { body: body, tag: 'nm-att-' + x.uid });
      }).catch(function () { });
    }
  }
  // all'apertura: chi è entrato mentre non c'eri, una riga per persona
  function attRiepilogo(list) {
    var per = {}, ord = [];
    list.forEach(function (x) { var p = per[x.uid]; if (!p) { p = per[x.uid] = { nome: x.nome, disp: {}, da: x.il, a: x.il, cose: [] }; ord.push(x.uid); } p.a = x.il; p.disp[x.disp] = 1; p.cose.push(attSoloOra(x.il) + ' ' + x.cosa); });
    ord.sort(function (a, b) { return per[b].a < per[a].a ? -1 : 1; });
    var h = '<h3 style="margin:0 0 4px;align-self:flex-start">Mentre non c’eri</h3><p style="margin:0 0 10px;color:#9a9dc0;align-self:flex-start">Chi è entrato nell’app e cosa ha fatto.</p><div id="nmattv">' + ord.map(function (u) {
      var p = per[u], c = p.cose.slice(-12), more = p.cose.length - c.length;
      return '<div class="ar"><b>' + esc(p.nome) + '</b><div>' + esc(attOra(p.da) + (p.da !== p.a ? ' – ' + attSoloOra(p.a) : '') + ' · ' + Object.keys(p.disp).filter(Boolean).join(', ')) + '</div>' +
        '<div>' + (more > 0 ? esc('…e altre ' + more + ' azioni prima') + '<br>' : '') + c.map(esc).join('<br>') + '</div></div>';
    }).join('') + '</div><button class="btn" id="nmattok" style="margin-top:14px">Ho visto</button>';
    var o = overlay(h); if (!o) return;
    $('#nmattok').onclick = hideOverlay;
  }

  /* ---------- errori dell'app: arrivano all'amministratore insieme alle attività ----------
     Se l'app si blocca sul telefono di qualcuno, l'errore finisce in «attivita» (avviso in diretta e «Mentre non c'eri»).
     Solo errori del nostro codice, ognuno una volta per apertura, al massimo 5. */
  var ERR = { visti: {}, n: 0 };
  function errScrivi(e, dove) {
    try {
      if (!ME || !started || ERR.n >= 5) return;
      var msg = String((e && (e.message || e.code)) || e || '').slice(0, 120); if (!msg) return;
      var riga = /(index\.html|nm-fb\.js):(\d+)/.exec(String((e && e.stack) || dove || ''));
      var k = msg + (riga ? riga[0] : ''); if (ERR.visti[k]) return; ERR.visti[k] = true; ERR.n++;
      attScrivi('⚠ errore nell’app' + (ATT.vista ? ' (in ' + ATT.vista + ')' : '') + ': ' + msg + (riga ? ' · ' + riga[1] + ' riga ' + riga[2] : ''));
    } catch (x) { }
  }
  window.addEventListener('error', function (ev) {
    if (!ev || !ev.filename || ev.filename.indexOf(location.origin) !== 0) return; // estensioni del browser e librerie esterne: non nostri
    errScrivi(ev.error || ev.message, ev.filename.split('/').pop() + ':' + ev.lineno);
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    if (r instanceof Error && /index\.html|nm-fb\.js/.test(String(r.stack || ''))) errScrivi(r); // i rifiuti di Firebase (rete, permessi) li gestisce già l'app
  });

  /* ---------- modifiche in attesa di rete ----------
     Senza campo le modifiche restano sul telefono e partono da sole: una piccola icona in alto a destra con il numero
     di quelle che mancano. Con il campo compare solo se l'invio dura più di 3 secondi (campo debole). */
  var PEND = { n: 0, vecchie: false, t: null, fatto: 0 };
  var PEND_IC = { // icone: senza rete, da inviare, inviate
    off: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/>',
    su: '<path d="M12 13v8"/><path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24"/><path d="m8 17 4-4 4 4"/>',
    ok: '<path d="m17 15-5.5 5.5L9 18"/><path d="M5 17.74A7 7 0 1 1 15.71 10h1.79a4.5 4.5 0 0 1 1.5 8.74"/>'
  };
  function pendIc(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + PEND_IC[k] + '</svg>'; }
  function pendAdd(p) {
    PEND.n++; pendShow();
    var fine = function () { PEND.n = Math.max(0, PEND.n - 1); if (!PEND.n) PEND.fatto = Date.now(); pendShow(); };
    p.then(fine, fine);
  }
  // modifiche rimaste dall'ultima volta (app chiusa senza campo): Firebase le manda appena può
  function pendVecchie() {
    var ok = false;
    try { fs.waitForPendingWrites().then(function () { ok = true; if (PEND.vecchie) { PEND.vecchie = false; PEND.fatto = Date.now(); pendShow(); } }, function () { }); } catch (e) { return; }
    setTimeout(function () { if (!ok) { PEND.vecchie = true; pendShow(); } }, 3000);
  }
  function pendShow() {
    clearTimeout(PEND.t);
    // le modifiche con il campo partono in un attimo: l'icona compare solo se aspettano più di 3 secondi
    PEND.t = setTimeout(pendDraw, PEND.n || PEND.vecchie ? (navigator.onLine === false ? 300 : 3000) : 0);
  }
  function pendDraw() {
    if (!document.body) return;
    var el = $('#nmpend'), off = navigator.onLine === false, n = PEND.n;
    if (!n && !PEND.vecchie) {
      if (el && el.getAttribute('data-s') !== 'ok' && Date.now() - PEND.fatto < 4000) {
        el.setAttribute('data-s', 'ok'); el.innerHTML = pendIc('ok'); el.setAttribute('aria-label', 'Modifiche inviate'); el.title = 'Modifiche inviate';
        setTimeout(function () { var e2 = $('#nmpend'); if (e2 && e2.getAttribute('data-s') === 'ok') e2.remove(); }, 2500);
      } else if (el && el.getAttribute('data-s') !== 'ok') el.remove();
      return;
    }
    ensureCss();
    if (!el) {
      el = document.createElement('button'); el.type = 'button'; el.id = 'nmpend'; document.body.appendChild(el);
      el.onclick = function () {
        var k = el.getAttribute('data-s');
        toast(k === 'ok' ? 'Tutte le modifiche sono state inviate.' : (k === 'off' ? 'Sei senza rete. ' : 'Il campo è debole: le modifiche stanno partendo. ') + 'Restano salvate sul telefono, anche se chiudi l’app, e partono da sole appena torna il campo.');
      };
    }
    var t = (off ? 'Senza rete' : 'Invio in corso') + (n ? ': ' + n + (n === 1 ? ' modifica da inviare' : ' modifiche da inviare') : ': modifiche da inviare');
    el.setAttribute('data-s', off ? 'off' : 'su'); el.setAttribute('aria-label', t); el.title = t;
    el.innerHTML = pendIc(off ? 'off' : 'su') + (n ? '<b>' + n + '</b>' : '');
  }
  window.addEventListener('online', pendShow); window.addEventListener('offline', pendShow);

  /* ---------- segnaposto delle voci cancellate ----------
     Cancellare scrive { _del: true } al posto della voce, così gli altri telefoni lo sanno. Dopo 60 giorni
     tutti l'hanno saputo (chi resta fuori più a lungo rilegge tutto comunque, vedi FULL_EVERY): si toglie del tutto.
     Lo fa l'amministratore, una volta a settimana, senza che si veda. */
  async function pulisciSegnaposto() {
    try {
      var K = 'nm-segnaposto', last = 0; try { last = +localStorage.getItem(K) || 0; } catch (e) { }
      if (Date.now() - last < 7 * 864e5) return;
      var cut = Date.now() - CEST_DAYS * 864e5, tolte = 0;
      for (var i = 0; i < COLLS.length + 1; i++) {
        var c = COLLS[i] || 'foto';
        var s = await AC(c).where('_del', '==', true).limit(400).get();
        var vecchi = s.docs.filter(function (d) { var t = d.get('_ts'); return t && t.toMillis && t.toMillis() < cut; });
        for (var j = 0; j < vecchi.length; j += 400) {
          var b = fs.batch(); vecchi.slice(j, j + 400).forEach(function (d) { b.delete(d.ref); }); await b.commit();
        }
        tolte += vecchi.length;
      }
      try { localStorage.setItem(K, String(Date.now())); } catch (e) { }
      var prima = await AC('impostazioni').doc('pulizia').get();
      await write('impostazioni', 'pulizia', 'set', { il: nowISO(), tolte: tolte, totale: ((prima.exists && prima.get('totale')) || 0) + tolte });
    } catch (e) { }
  }

  /* ---------- spazio e foto (solo amministratori, in «Copia dei dati») ----------
     Le foto stanno nel database (raccolta «foto»): il piano gratuito di Firebase ha 1 GB in tutto.
     «fotoInfo» tiene quanto pesa ogni foto. Le foto di prima si contano una volta scaricandole (giroFoto).
     Una foto è «non più usata» se nessuna voce, nemmeno nel cestino, la nomina più. */
  var FOTO_GB = 1;
  async function fotoInfoAll() { var s = await AC('fotoInfo').get(); var m = {}; s.docs.forEach(function (d) { m[d.id] = d.data(); }); return m; }
  async function fotoSpazio() {
    var info = await fotoInfoAll(), conta = await AC('impostazioni').doc('fotoConta').get(), n = 0, kb = 0;
    Object.keys(info).forEach(function (id) { n++; kb += info[id].kb || 0; });
    var dati = 0; COLLS.forEach(function (c) { var L = LIVE[c]; if (L) dati += JSON.stringify(L.map).length; });
    return { n: n, mb: kb / 1024, datiMb: dati / 1048576, limiteMb: FOTO_GB * 1024, contate: conta.exists ? conta.data() : null };
  }
  // ogni testo scritto nei dati, compreso il cestino: le foto si nominano con il loro codice
  async function testiUsati() {
    var ok = await Promise.all(COLLS.map(function (c) { var L = live(c); return L.start.then(function () { return whenReady(L, 20000); }).then(function () { return L.ready; }); }));
    if (ok.indexOf(false) >= 0) throw { code: 'non_pronto', message: 'Dati non ancora caricati' };
    var set = {}, dove = {};
    function giro(v, etichetta) {
      if (typeof v === 'string') { if (v.length < 40) { set[v] = true; if (etichetta && !dove[v]) dove[v] = etichetta; } }
      else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { giro(v[k], etichetta); });
    }
    function nomeBarca(id) { var b = LIVE.barche.map[id]; return b ? b.nome || 'Barca senza nome' : ''; }
    COLLS.forEach(function (c) {
      Object.keys(LIVE[c].map).forEach(function (id) {
        var d = LIVE[c].map[id];
        giro(d, c === 'barche' ? d.nome || 'Barca senza nome' : d.barcaId ? nomeBarca(d.barcaId) || (CEST_NOMI[c] || c) : (CEST_NOMI[c] || c));
      });
    });
    var cs = await AC('cestino').get();
    cs.docs.forEach(function (d) { giro(dec(d.get('dati') || {}), 'Nel cestino'); });
    return { set: set, dove: dove };
  }
  async function fotoNonUsate() {
    var info = await fotoInfoAll(), u = await testiUsati(), cut = new Date(Date.now() - 2 * 864e5).toISOString(), list = [];
    // le foto degli ultimi 2 giorni restano: potrebbero essere in una scheda non ancora salvata
    Object.keys(info).forEach(function (id) { if (!u.set[id] && String(info[id].creato || '') < cut) list.push({ id: id, kb: info[id].kb || 0 }); });
    return list;
  }
  async function fotoPulisci(list, prog) {
    var fatte = 0;
    for (var i = 0; i < list.length; i += 200) {
      var b = fs.batch();
      list.slice(i, i + 200).forEach(function (x) { b.delete(AC('foto').doc(x.id)); b.delete(AC('fotoInfo').doc(x.id)); IDB.del('foto', x.id); delete PH[x.id]; });
      await b.commit(); fatte = Math.min(list.length, i + 200); if (prog) prog(fatte, list.length);
    }
    return fatte;
  }
  // passa tutte le foto una per volta (a gruppi di 8): scrive quanto pesano e, se serve, le tiene per il file da scaricare
  async function giroFoto(prog, tieni) {
    var info = await fotoInfoAll(), visti = {}, last = null, n = 0, kb = 0, out = [], ID = firebase.firestore.FieldPath.documentId();
    for (;;) {
      var q = AC('foto').orderBy(ID).limit(8); if (last) q = q.startAfter(last);
      var s = await q.get(); if (!s.size) break;
      var b = fs.batch(), nb = 0;
      s.docs.forEach(function (d) {
        var x = d.data();
        if (x._del || !x.data) { b.delete(d.ref); nb++; return; } // segnaposto di foto già tolte
        n++; visti[d.id] = true; var k = Math.ceil(String(x.data).length / 1024); kb += k;
        if (!info[d.id]) { b.set(AC('fotoInfo').doc(d.id), { kb: k, creato: x.creato || '', da: x.da || '', _ts: FV.serverTimestamp() }); nb++; }
        if (tieni) out.push({ id: d.id, data: x.data, creato: x.creato || '' });
      });
      if (nb) await b.commit();
      last = s.docs[s.docs.length - 1];
      if (prog) prog(n, kb / 1024);
    }
    // schede di foto che non ci sono più: via, così il conto torna preciso
    var orfane = Object.keys(info).filter(function (id) { return !visti[id]; });
    for (var i = 0; i < orfane.length; i += 400) { var bo = fs.batch(); orfane.slice(i, i + 400).forEach(function (id) { bo.delete(AC('fotoInfo').doc(id)); }); await bo.commit(); }
    await write('impostazioni', 'fotoConta', 'set', { il: nowISO(), n: n, mb: Math.round(kb / 102.4) / 10 });
    return out;
  }
  // il file zip, senza comprimere (le foto sono già compresse): a parti da 150 MB per non riempire la memoria del telefono
  var CRC_T = null;
  function crc32(u) {
    if (!CRC_T) { CRC_T = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC_T[n] = c >>> 0; } }
    var r = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) r = CRC_T[(r ^ u[i]) & 255] ^ (r >>> 8); return (r ^ 0xFFFFFFFF) >>> 0;
  }
  function dosOra(iso) { var d = new Date(iso); if (isNaN(d) || d.getFullYear() < 1980) d = new Date(); return [(d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()]; }
  function zip(files) { // files: [{ nome, dati: Uint8Array, il }]
    var parti = [], dir = [], off = 0, te = new TextEncoder();
    files.forEach(function (f) {
      var nm = te.encode(f.nome), crc = crc32(f.dati), t = dosOra(f.il), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, t[0], true); h.setUint16(12, t[1], true); h.setUint32(14, crc, true);
      h.setUint32(18, f.dati.length, true); h.setUint32(22, f.dati.length, true); h.setUint16(26, nm.length, true);
      parti.push(h.buffer, nm, f.dati);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, t[0], true); c.setUint16(14, t[1], true); c.setUint32(16, crc, true);
      c.setUint32(20, f.dati.length, true); c.setUint32(24, f.dati.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      dir.push(c.buffer, nm); off += 30 + nm.length + f.dati.length;
    });
    var dl = dir.reduce(function (a, x) { return a + x.byteLength; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, dl, true); e.setUint32(16, off, true);
    return new Blob(parti.concat(dir, [e.buffer]), { type: 'application/zip' });
  }
  async function fotoFile(prog) {
    var u = await testiUsati(), foto = await giroFoto(prog, true), MAX = 150 * 1048576, parti = [], cur = [], tot = 0, usati = {};
    function chiudi() { if (cur.length) { parti.push({ blob: zip(cur), n: cur.length }); cur = []; tot = 0; } }
    foto.forEach(function (f) {
      var b64 = String(f.data).replace(/^data:[^,]*,/, ''), bin = atob(b64), dati = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) dati[i] = bin.charCodeAt(i);
      var cart = String(u.dove[f.id] || 'Senza barca').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Senza nome';
      var base = cart + '/' + (String(f.creato).slice(0, 10) || 'senza-data') + '_' + f.id, nome = base + '.jpg';
      for (var k = 2; usati[nome]; k++) nome = base + '-' + k + '.jpg'; usati[nome] = true;
      if (tot + dati.length > MAX) chiudi();
      cur.push({ nome: nome, dati: dati, il: f.creato }); tot += dati.length; f.data = null;
    });
    chiudi();
    return parti.map(function (p, i) { return { blob: p.blob, n: p.n, mb: p.blob.size / 1048576, nome: 'Foto-Nautica-Mare-' + nowISO().slice(0, 10) + (parti.length > 1 ? '-parte-' + (i + 1) : '') + '.zip' }; });
  }
  var FOTO = {
    spazio: function () { return ME && ME.ruolo === 'admin' ? fotoSpazio() : Promise.reject({ code: 'permission_denied' }); },
    conta: function (prog) { return ME && ME.ruolo === 'admin' ? giroFoto(prog, false).then(function () { }) : Promise.reject({ code: 'permission_denied' }); },
    nonUsate: function () { return ME && ME.ruolo === 'admin' ? fotoNonUsate() : Promise.reject({ code: 'permission_denied' }); },
    pulisci: function (list, prog) { return ME && ME.ruolo === 'admin' ? fotoPulisci(list, prog) : Promise.reject({ code: 'permission_denied' }); },
    file: function (prog) { return ME && ME.ruolo === 'admin' ? fotoFile(prog) : Promise.reject({ code: 'permission_denied' }); },
    salva: function (p) { return DL.save({ filename: p.nome, data: p.blob }); },
    pulizia: function () { var L = live('impostazioni'); return L.map.pulizia || null; }
  };

  /* ---------- tetto dell'AI: ogni azienda ha AI_MAX richieste al giorno (aziende/{az}.aiMax, lo cambia il gestore),
     contate in aziende/{az}/aiUso/{giorno}. Le regole fanno salire il conto solo di uno alla volta e non oltre il tetto. ---------- */
  var AI_MAX = 30;
  function aiMaxDi(a) { return a && typeof a.aiMax === 'number' && a.aiMax >= 0 ? a.aiMax : AI_MAX; }
  function aiConta() {
    var max = aiMaxDi(AZD), r = AC('aiUso').doc(oggiISO());
    return fs.runTransaction(function (t) {
      return t.get(r).then(function (d) {
        var n = d.exists ? (d.data().n || 0) : 0;
        if (n >= max) throw { code: 'ai_finita' };
        if (d.exists) t.update(r, { n: n + 1, il: nowISO() }); else t.set(r, { n: 1, il: nowISO() });
      });
    }).catch(function (e) {
      if (e && e.code === 'ai_finita') throw e;
      if (e && /permission/.test(e.code || '')) throw { code: 'ai_finita' }; // oltre il tetto le regole rifiutano
      throw { code: 'rete' };
    });
  }

  /* ---------- quello che vede l'app ---------- */
  window.__NM_FB = {
    aiConta: aiConta,
    use: function (name) {
      return READY.then(function () { return name === 'db' ? DB : name === 'user' ? USER : name === 'assets' ? ASSETS : name === 'downloads' ? DL : null; });
    },
    photoSrc: function (id) { if (PH[id]) return PH[id]; if (started) loadPhoto(id); else READY.then(function () { loadPhoto(id); }); return GIF0; },
    altroRows: altroRows,
    appCheckToken: appCheckToken,
    open: open,
    vista: attVista,
    clientiBarca: clientiBarca,
    spostaClienti: spostaClienti,
    staccaClienti: staccaClienti,
    nomeUtente: nomeUtente,
    foto: FOTO,
    tablet: {
      si: function () { return !!(ME && ME.tablet && ME.stato === 'attivo' && ME.ruolo !== 'cliente' && !ME.assist) && tabStr(); },
      come: function (uid) { AS = uid || null; attScrivi(uid ? 'sul tablet lavora ' + ((UT[uid] && UT[uid].nome) || '') : 'sul tablet: ha finito'); },
      chi: chi,
      prova: function (uid, pin) { var x = pinDi(uid); return x ? pinHash(uid, pin).then(function (h) { return h === x.hash; }) : Promise.resolve(false); },
      persone: function () { var L = LIVE.pin, m = (L && L.map) || {}; return Object.keys(m).filter(function (id) { return pinDi(id) && UT[id] && UT[id].stato === 'attivo' && UT[id].ruolo !== 'cliente' && !UT[id].tablet; }).map(function (id) { return { id: id, nome: UT[id].nome || '' }; }); }
    },
    pacchetto: pacchetto,
    segnala: SEGN,
    azienda: function () { return { nome: (AZD && AZD.nome) || '', assist: !!(ME && ME.assist) }; } // l'azienda in uso (per la procedura guidata)
  };
})();
