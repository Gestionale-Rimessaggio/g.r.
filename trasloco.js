/* Trasloco: g.r. vive su un indirizzo nuovo. Se una pagina si apre dal vecchio indirizzo (GitHub Pages),
   porta subito a quello nuovo e tiene il resto del link: per esempio «#barca=…» dei QR già stampati sulle barche
   o «?prova». Prima spegne la copia dell'app salvata sul telefono dal vecchio indirizzo, così non riapre la versione vecchia.
   Sul nuovo indirizzo non fa niente. Finché NUOVO è vuoto non fa niente da nessuna parte. */
(function () {
  var NUOVO = ''; // l'indirizzo nuovo, per esempio 'https://kardan.web.app' (senza «/» in fondo)
  if (!NUOVO || !/\.github\.io$/i.test(location.hostname)) return;
  var pag = location.pathname.replace(/^\/g\.r\.(\/|$)/i, '/');
  var dove = NUOVO + pag + location.search + location.hash;
  window.GR_TRASLOCO = dove;
  try { window.stop(); } catch (e) { } // il resto della pagina vecchia non serve: niente accesso né caricamenti
  var fatto = false, via = function () { if (!fatto) { fatto = true; location.replace(dove); } };
  setTimeout(via, 1500);
  try {
    navigator.serviceWorker.getRegistrations()
      .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
      .then(via, via);
  } catch (e) { via(); }
})();
