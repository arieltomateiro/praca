/*
 * Service worker do Ariel Tomateiro.
 *
 * Objetivo único: fazer o APP em si (o HTML/CSS/JS e os scripts do Firebase)
 * carregar mesmo com o aparelho totalmente sem sinal — a sincronização dos
 * DADOS já é resolvida pelo próprio Firestore (persistência offline, ativada
 * no app), então este arquivo não mexe com dados, só com "o app abre ou não".
 *
 * Estratégia:
 *  - Documento principal (a página em si) e demais arquivos do app: cache
 *    primeiro (stale-while-revalidate) — responde IMEDIATAMENTE com a cópia
 *    salva localmente (abertura instantânea, mesmo com internet lenta) e, em
 *    paralelo, busca a versão nova em segundo plano pra já deixar pronta na
 *    próxima abertura. Antes o documento era "network-first" (esperava a rede
 *    responder pra mostrar qualquer coisa), o que deixava a abertura lenta
 *    toda vez que o sinal estava ruim — exatamente o cenário de uso deste app.
 *  - Se uma versão nova do app for baixada em segundo plano, avisa a página
 *    (postMessage) pra ela poder oferecer "atualizar agora" sem precisar
 *    travar a abertura esperando essa checagem.
 *  - Nunca intercepta chamadas do Firebase (Firestore/Auth) — essas sempre
 *    vão direto pra rede, do jeitinho que o SDK já sabe fazer offline.
 *
 * IMPORTANTE: sempre que publicar uma nova versão do site, aumente o número
 * do CACHE_NAME abaixo. Isso garante que o service worker antigo é
 * substituído e o app não fica "preso" numa versão velha em cache.
 */
var CACHE_VERSION = "v3";
var CACHE_NAME = "ariel-tomateiro-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo.jpg",
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

// avisa as abas abertas que uma versão mais nova do app já foi baixada e
// está pronta (só passa a valer na próxima abertura/recarregamento).
function avisarNovaVersao() {
  self.clients.matchAll({ type: "window" }).then(function (clients) {
    clients.forEach(function (client) {
      client.postMessage({ type: "nova-versao-disponivel" });
    });
  });
}

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

  // stale-while-revalidate pra tudo que este service worker cuida (documento
  // incluso): responde na hora com o cache quando existe, e atualiza o cache
  // em segundo plano — a próxima abertura já vem com a versão nova.
  event.respondWith(
    caches.match(req).then(function (cached) {
      var networkFetch = fetch(req)
        .then(function (resp) {
          if (resp && resp.ok) {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(req, copy);
              if (isDocument && cached) avisarNovaVersao();
            });
          }
          return resp;
        })
        .catch(function () {
          return cached || (isDocument ? caches.match("./index.html") || caches.match("./") : undefined);
        });
      // com cache: responde na hora e deixa a rede atualizar por trás.
      // sem cache (primeiríssima visita): precisa esperar a rede mesmo.
      return cached || networkFetch;
    })
  );
});
