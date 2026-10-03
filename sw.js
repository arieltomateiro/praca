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
 *  - Quando uma versão nova é baixada em segundo plano, ela simplesmente passa
 *    a valer na próxima abertura do app. A página NUNCA é avisada e nenhuma
 *    faixa de "atualizar agora" aparece — a pessoa não é interrompida no meio
 *    de um lançamento.
 *  - Nunca intercepta chamadas do Firebase (Firestore/Auth) — essas sempre
 *    vão direto pra rede, do jeitinho que o SDK já sabe fazer offline.
 *
 *  - Lembretes do financeiro: recebe a notificação enviada pelo servidor
 *    (função agendada no Firebase) e mostra no celular; tocar nela abre o
 *    app na aba Financeiro.
 *
 * IMPORTANTE: sempre que publicar uma nova versão do site, aumente o número
 * do CACHE_NAME abaixo. Isso garante que o service worker antigo é
 * substituído e o app não fica "preso" numa versão velha em cache.
 */
var CACHE_VERSION = "v15";
var CACHE_NAME = "ariel-tomateiro-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo-dark.webp",
  "./logo-light.webp",
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

// A versão nova é baixada em segundo plano. Nenhum aviso é enviado para a
// tela: a própria página, se ainda estiver nos primeiros segundos de abertura
// e sem ninguém mexendo, reabre sozinha na versão nova; senão ela vale na
// próxima abertura.

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

  // a página é uma só: links com parâmetros (ex: ?convite=...) usam a mesma
  // cópia salva, em vez de cada link virar uma cópia nova no cache
  var cacheKey = isDocument ? new Request(url.origin + url.pathname) : req;

  // stale-while-revalidate pra tudo que este service worker cuida (documento
  // incluso): responde na hora com o cache quando existe, e atualiza o cache
  // em segundo plano — a próxima abertura já vem com a versão nova.
  event.respondWith(
    caches.match(cacheKey).then(function (cached) {
      var networkFetch = fetch(req)
        .then(function (resp) {
          if (resp && resp.ok && resp.type !== "opaque") {
            var copy = resp.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(cacheKey, copy);
            });
          }
          return resp;
        })
        .catch(function () {
          if (cached) return cached;
          if (!isDocument) return Response.error();
          // sem rede e sem cópia deste endereço exato: cai na página salva
          return caches.match("./index.html").then(function (r) {
            return r || caches.match("./");
          }).then(function (r) {
            return r || Response.error();
          });
        });
      // com cache: responde na hora e deixa a rede atualizar por trás.
      // sem cache (primeiríssima visita): precisa esperar a rede mesmo.
      return cached || networkFetch;
    })
  );
});

/* ---- lembretes do financeiro (notificações) ---- */
self.addEventListener("push", function (event) {
  var d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { titulo: "Ariel Tomateiro", texto: event.data ? event.data.text() : "" }; }
  var titulo = d.titulo || "Ariel Tomateiro";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: d.texto || "",
      tag: d.tag || undefined,       // um aviso por operação: tags diferentes não se substituem
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: { url: d.url || "./index.html?aba=financeiro", aba: d.aba || "financeiro" }
    })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var info = event.notification.data || {};
  var alvo = new URL(info.url || "./index.html?aba=financeiro", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (lista) {
      for (var i = 0; i < lista.length; i++) {
        var c = lista[i];
        if (c.url.indexOf(self.registration.scope) === 0 && "focus" in c) {
          c.postMessage({ tipo: "abrir-aba", aba: info.aba || "financeiro" });
          return c.focus();
        }
      }
      return self.clients.openWindow(alvo);
    })
  );
});
