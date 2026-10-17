/*
 * public/sw-killswitch.js - emergency retirement of the Pulse PWA service worker.
 * ---------------------------------------------------------------------------
 * NOT registered by the app. To retire the worker in production, copy this file over
 * public/sw.js and deploy (see docs/OPERATE.md "Retire the PWA service worker"). Every
 * installed client fetches the new /sw.js on its next visit, installs it, and this worker:
 *   1. takes over immediately (skipWaiting),
 *   2. deletes every `pulse-shell-*` cache,
 *   3. unregisters itself,
 *   4. reloads each open window so it comes back uncached and uncontrolled.
 * It has NO fetch handler, so it never answers or caches anything. It is not stamped by
 * the build (the vite `pulseSwStamp` plugin only touches dist/sw.js). Keep deployed >= 30 days.
 */
'use strict'

self.addEventListener('install', function () {
  self.skipWaiting()
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k.indexOf('pulse-shell-') === 0 })
            .map(function (k) { return caches.delete(k) }),
        )
      })
      .then(function () { return self.registration.unregister() })
      .then(function () { return self.clients.matchAll({ type: 'window' }) })
      .then(function (clients) {
        return Promise.all(
          clients.map(function (client) { return client.navigate(client.url) }),
        )
      }),
  )
})
