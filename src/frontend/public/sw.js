/*
 * public/sw.js - Pulse participant app-shell service worker (mobile-tablet story 10).
 * ---------------------------------------------------------------------------
 * HAND-WRITTEN, no dependency, no importScripts. Served from the site root so its
 * scope is "/". It caches the BUILT STATIC SHELL ONLY: index.html + the hashed
 * /assets/* bundle. It never caches, stores or answers anything else.
 *
 * Decision table (everything not listed is NETWORK-ONLY passthrough - the worker
 * simply does not call respondWith, so the browser does its normal request):
 *   - non-GET, cross-origin                         -> passthrough
 *   - /api/*, /hubs/* (SignalR), media, /join*,
 *     /staff/*, /sw.js, anything else               -> passthrough (XC-001: no exercise
 *                                                       data or join token ever on-device)
 *   - same-origin GET /assets/*  (hashed, immutable)-> cache-first, filled lazily
 *   - same-origin navigation (HTML) on a participant
 *     path                                          -> network-first; ONLY if the network
 *                                                       fails do we answer the cached
 *                                                       /index.html shell (the app then shows
 *                                                       its normal "can't reach server" states).
 *                                                       The navigation response itself is never
 *                                                       stored (it could be per-session).
 *   Offline page decision: we reuse the app shell instead of a separate offline page, so
 *   the fiction/brand is intact and no "Pulse by Dynamis" text can leak.
 *
 * Versioning: the build stamps __PULSE_BUILD_ID__ and the precache list into this file
 * (vite.config.ts `pulseSwStamp`), so every deploy changes sw.js bytes -> the browser
 * installs a new worker -> it waits (NO skipWaiting at install) until the participant
 * accepts the in-fiction "update ready" banner, which posts {type:'SKIP_WAITING'}.
 * On activate, every `pulse-shell-*` cache other than the current one is deleted.
 *
 * Tested through a harness: src/features/pwa/serviceWorker/sw.test.ts.
 * Registration (production only, participant subtree only): serviceWorker/register.ts.
 */
'use strict'

var BUILD_ID = '__PULSE_BUILD_ID__'
var PRECACHE_JSON = '__PULSE_PRECACHE__'
var CACHE_PREFIX = 'pulse-shell-'
var CACHE_NAME = CACHE_PREFIX + BUILD_ID
var SHELL_URL = '/index.html'
var NAV_DENY = ['/api', '/hubs', '/join', '/staff', '/media', '/sw.js']

function precacheList() {
  try {
    var list = JSON.parse(PRECACHE_JSON)
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

function underPrefix(pathname, prefix) {
  return pathname === prefix || pathname.indexOf(prefix + '/') === 0
}

/** 'asset' | 'navigation' | 'passthrough' for a request. Pure. */
function classify(request, origin) {
  if (request.method !== 'GET') return 'passthrough'
  // Range requests (media seeking etc.) are never ours; 206s must not reach the cache.
  if (request.headers && request.headers.get && request.headers.get('range')) return 'passthrough'
  var url = new URL(request.url)
  if (url.origin !== origin) return 'passthrough'
  var path = url.pathname
  if (/^\/assets\/[\w.-]+$/.test(path)) return 'asset' // hashed files only
  if (request.mode === 'navigate') {
    for (var i = 0; i < NAV_DENY.length; i++) {
      if (underPrefix(path, NAV_DENY[i])) {
        return 'passthrough'
      }
    }
    return 'navigation'
  }
  return 'passthrough'
}

self.addEventListener('install', function (event) {
  var urls = precacheList()
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        urls.map(function (u) {
          // No credentials: the shell is public static content, never session-specific.
          return fetch(new Request(u, { credentials: 'omit', cache: 'reload' })).then(function (res) {
            if (!res.ok) throw new Error('precache failed: ' + u)
            return cache.put(u, res)
          })
        }),
      )
    }),
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE_NAME })
            .map(function (k) { return caches.delete(k) }),
        )
      })
      .then(function () { return self.clients.claim() }),
  )
})

self.addEventListener('message', function (event) {
  var data = event.data
  if (data && data.type === 'SKIP_WAITING') self.skipWaiting()
  // Lets the page tell whether a waiting worker is actually a newer build than the running one.
  if (data && data.type === 'GET_BUILD_ID' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ buildId: BUILD_ID })
  }
})

self.addEventListener('fetch', function (event) {
  var kind = classify(event.request, self.location.origin)
  if (kind === 'asset') {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(event.request).then(function (hit) {
          if (hit) return hit
          return fetch(event.request).then(function (res) {
            if (res.status === 200 && res.type === 'basic') {
              event.waitUntil(cache.put(event.request, res.clone()))
            }
            return res
          })
        })
      }),
    )
  } else if (kind === 'navigation') {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.open(CACHE_NAME).then(function (cache) {
          return cache.match(SHELL_URL).then(function (shell) {
            return shell || Response.error()
          })
        })
      }),
    )
  }
  // else: no respondWith -> network-only passthrough.
})
