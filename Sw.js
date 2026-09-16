/* =========================================================
   Service worker de Fuera de Juego

   Guarda la app en el móvil para que abra sin conexión.
   Sube el número de versión cada vez que cambies el diseño:
   así los móviles descargan la versión nueva.
========================================================= */

const VERSION = "fdj-v1";

const ARCHIVOS = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.webmanifest",
    "./favicon.svg",
    "./icons/icon-180.png",
    "./icons/icon-192.png",
    "./icons/icon-512.png"
];


/* Instalación: guardamos la app */
self.addEventListener("install", (evento) => {

    evento.waitUntil(
        caches.open(VERSION)
            .then((cache) => cache.addAll(ARCHIVOS))
            .then(() => self.skipWaiting())
    );

});


/* Activación: borramos versiones antiguas */
self.addEventListener("activate", (evento) => {

    evento.waitUntil(
        caches.keys()
            .then((claves) => Promise.all(
                claves
                    .filter((clave) => clave !== VERSION)
                    .map((clave) => caches.delete(clave))
            ))
            .then(() => self.clients.claim())
    );

});


self.addEventListener("fetch", (evento) => {

    const peticion = evento.request;

    if (peticion.method !== "GET") {
        return;
    }

    const url = new URL(peticion.url);

    /*
     * Los datos de Google Sheets nunca se cachean:
     * siempre queremos las cifras reales.
     */
    if (url.hostname.includes("script.google.com")) {
        return;
    }

    /*
     * Navegación: primero la red, y si falla, la copia guardada.
     */
    if (peticion.mode === "navigate") {

        evento.respondWith(
            fetch(peticion).catch(() => caches.match("./index.html"))
        );

        return;
    }

    /*
     * Resto de archivos (CSS, JS, fotos, iconos, tipografías):
     * primero la copia guardada, y la refrescamos de fondo.
     */
    evento.respondWith(
        caches.match(peticion).then((guardado) => {

            const red = fetch(peticion)
                .then((respuesta) => {

                    if (respuesta && respuesta.status === 200) {

                        const copia = respuesta.clone();
                        caches.open(VERSION).then((cache) => cache.put(peticion, copia));

                    }

                    return respuesta;

                })
                .catch(() => guardado);

            return guardado || red;

        })
    );

});