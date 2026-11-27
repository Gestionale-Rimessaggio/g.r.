/* Pagine «Condizioni d'uso» e «Privacy»: riempie i dati del fornitore (window.KARDAN_FORNITORE in config.js)
   e la versione dei testi. Finché un dato manca si vede «da completare». */
(function () {
  var F = window.KARDAN_FORNITORE || {}, V = window.KARDAN_COND_VER || '';
  function riempi() {
    document.querySelectorAll('[data-f]').forEach(function (el) {
      var k = el.getAttribute('data-f'), v = String(F[k] || '').trim();
      if (!v) { el.textContent = 'da completare'; el.className = (el.className + ' manca').trim(); return; }
      if (k === 'email' || k === 'pec') { el.innerHTML = ''; var a = document.createElement('a'); a.href = 'mailto:' + v; a.textContent = v; el.appendChild(a); }
      else el.textContent = v;
    });
    document.querySelectorAll('[data-ver]').forEach(function (el) {
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(V);
      el.textContent = m ? (+m[3]) + ' ' + ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'][+m[2] - 1] + ' ' + m[1] : V;
    });
    var b = document.getElementById('bozza');
    if (b) b.hidden = !window.KARDAN_TESTI_BOZZA;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', riempi); else riempi();
})();
