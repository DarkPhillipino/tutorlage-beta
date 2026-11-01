// Old github.io links carry /tutorlage-beta/ in front of the page; GitHub forwards them to tutorlage.com with that prefix kept,
// so drop it before the app starts. (Was an inline script in index.html until the Content-Security-Policy, which allows only our own files.)
(function () {
  var p = location.pathname;
  if (p === '/tutorlage-beta' || p.indexOf('/tutorlage-beta/') === 0) {
    history.replaceState(null, '', (p.slice('/tutorlage-beta'.length) || '/') + location.search + location.hash);
  }
})();
