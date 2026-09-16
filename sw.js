/*
 * Service worker do Ariel Tomateiro.
 *
 * Objetivo único: fazer o APP em si (o HTML/CSS/JS e os scripts do Firebase)
 * carregar mesmo com o aparelho totalmente sem sinal — a sincronização dos
 * DADOS já é resolvida pelo próprio Firestore (persistência offline, ativada
 * no app), então este arquivo não mexe com dados, só com "o app abre ou não".
 *
 * Estratégia:
 *  - Documento principal (a página em si): network-first. Sempre tenta buscar
 *    a versão mais nova quando há conexão (pra nunca travar numa versão
 *    antiga do app); só usa o que está em cache quando não há rede.
 *  - Demais arquivos do próprio app + Firebase SDK + fontes: cache-first,
 *    atualizando o cache em segundo plano quando possível.
 *  - Nunca intercepta chamadas do Firebase (Firestore/Auth) — essas sempre
 *    vão direto pra rede, do jeitinho que o SDK já sabe fazer offline.
 *
 * IMPORTANTE: sempre que publicar uma nova versão do site, aumente o número
 * do CACHE_NAME abaixo. Isso garante que o service worker antigo é
 * substituído e o app não fica "preso" numa versão velha em cache.
 */
var CACHE_VERSION = "v2";
var CACHE_NAME = "ariel-tomateiro-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js"
];

// hosts cujos arquivos podem ser guardados em cache (app + SDK do Firebase +
// fontes). Qualquer outra origem (ex: chamadas do próprio Firestore/Auth pra
// *.googleapis.com, firebaseio.com etc.) nunca passa pelo cache deste
// service worker — é deixada 100% por conta do navegador/SDK.
var CACHEABLE_HOSTS = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", self.location.hostname];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return fetch(url, { cache: "no-store" })
            .then(function (resp) {
              if (resp && resp.ok) return cache.put(url, resp);
            })
            .catch(function () {
              /* sem rede na instalação — sem problema, o cache-first em
                 runtime tenta de novo assim que houver conexão */
            });
        })
      );
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names
            .filter(function (n) {
              return n !== CACHE_NAME;
            })
            .map(function (n) {
              return caches.delete(n);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (CACHEABLE_HOSTS.indexOf(url.hostname) === -1) return; // deixa o navegador cuidar (Firestore/Auth etc.)

  var isDocument = req.mode === "navigate" || req.destination === "document";

  if (isDocument) {
    // network-first: a página mais nova sempre ganha quando há conexão
    event.respondWith(
      fetch(req)
        .then(function (resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return resp;
        })
        .catch(function () {
          return caches.match(req).then(function (cached) {
            return cached || caches.match("./index.html") || caches.match("./");
          });
        })
    );
    return;
  }

  // demais recursos: cache-first, atualiza em segundo plano quando der
  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req)
        .then(function (resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, copy);
            });
          }
          return resp;
        })
        .catch(function () {
          return cached;
        });
      return cached || networkFetch;
    })
  );
});
