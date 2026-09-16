/* =========================================================
   ADMINISTRACIÓN — lógica del panel

   Misma URL de Apps Script que la web pública:
   - Peticiones GET  → leer datos (como en script.js)
   - Peticiones POST → guardar cambios (solo con contraseña)
========================================================= */

"use strict";

const API_URL =
    "https://script.google.com/macros/s/AKfycbyYp9d0TdPSK0O_dclAv6i-XE29LDkcKcUO1NJEfZqqm42FYCprLgzdGG7-C5Ft_Rwt/exec";


/* La contraseña solo se guarda mientras dura la pestaña. */
const CLAVE_SESION = "fdj-admin-clave";


const estado = {
    clave: null,
    datos: null,
    jugadores: [],
    jornadaActiva: null,
    cambios: {},       // { "NombreJugador": { posicion, pagado } }
    guardando: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));


/* ---------------------------------------------------------
   ARRANQUE
--------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {

    $("#formAcceso").addEventListener("submit", (evento) => {
        evento.preventDefault();
        intentarEntrar($("#campoClave").value);
    });

    $("#botonSalir").addEventListener("click", salir);
    $("#botonGuardar").addEventListener("click", guardarCambios);

    registrarServiceWorker();

    /* Si ya se ha introducido la clave en esta pestaña, no la pedimos otra vez. */
    const claveGuardada = sessionStorage.getItem(CLAVE_SESION);

    if (claveGuardada) {
        entrar(claveGuardada);
    }

});


/* Mismo service worker que la web pública: así Chrome también
 * ofrece instalar el panel como aplicación aparte. */
function registrarServiceWorker() {

    if (!("serviceWorker" in navigator)) {
        return;
    }

    if (location.protocol !== "https:" && location.hostname !== "localhost") {
        return;
    }

    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("sw.js")
            .catch((error) => console.warn("Service worker no registrado:", error));
    });

}


function intentarEntrar(clave) {

    if (!clave.trim()) {
        return;
    }

    entrar(clave.trim());

}


async function entrar(clave) {

    estado.clave = clave;

    $("#errorAcceso").hidden = true;

    const boton = $("#pantallaAcceso").querySelector("button");
    const textoOriginal = boton.textContent;

    boton.disabled = true;
    boton.textContent = "Comprobando…";

    try {

        const resultado = await comprobarClave(clave);

        if (!resultado.ok) {

            $("#errorAcceso").textContent = resultado.error || "Contraseña incorrecta.";
            $("#errorAcceso").hidden = false;

            estado.clave = null;
            return;

        }

        estado.datos = resultado.datos;
        estado.jugadores = leerNombresJugadores();
        pintarSelectorJornadas();

        sessionStorage.setItem(CLAVE_SESION, clave);

        $("#pantallaAcceso").hidden = true;
        $("#topbar").hidden = false;
        $("#contenido").hidden = false;

    } catch (error) {

        console.error(error);

        $("#errorAcceso").textContent =
            "No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.";
        $("#errorAcceso").hidden = false;

        estado.clave = null;

    } finally {

        boton.disabled = false;
        boton.textContent = textoOriginal;

    }

}


/*
 * Comprueba la contraseña contra el servidor y, en el mismo viaje,
 * trae ya los datos de la liga (una sola llamada en vez de dos).
 */
async function comprobarClave(clave) {

    const respuesta = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ clave, accion: "comprobarClave" })
    });

    if (!respuesta.ok) {
        throw new Error("HTTP " + respuesta.status);
    }

    return await respuesta.json();

}


function salir() {

    sessionStorage.removeItem(CLAVE_SESION);
    location.reload();

}


/* =========================================================
   CARGAR DATOS (lectura pública, igual que la web principal)
========================================================= */

async function cargarDatos() {

    const respuesta = await fetch(API_URL, { cache: "no-store" });

    if (!respuesta.ok) {
        throw new Error("HTTP " + respuesta.status);
    }

    estado.datos = await respuesta.json();
    estado.jugadores = leerNombresJugadores();

    pintarSelectorJornadas();

}


function leerNombresJugadores() {

    const jornadas = (estado.datos && estado.datos.jornadas) || [];
    const cabecera = jornadas[0] || [];

    return cabecera.slice(1).filter((nombre) => nombre && String(nombre).trim() !== "");

}


/* =========================================================
   SELECTOR DE JORNADAS
========================================================= */

function pintarSelectorJornadas() {

    const jornadas = (estado.datos.jornadas || []).slice(1)
        .filter((fila) => fila[0] !== "" && fila[0] !== null && fila[0] !== undefined);

    const control = estado.datos.controlPagos || [];

    const selector = $("#selectorJornada");

    selector.innerHTML = jornadas.map((fila) => {

        const numero = String(fila[0]);

        const filaControl = control.find((c) => String(c[0]) === numero);
        let pagados = 0;

        if (filaControl) {
            for (let i = 1; i < filaControl.length; i++) {
                if (String(filaControl[i]).trim() === "✓") {
                    pagados++;
                }
            }
        }

        const conDatos = fila.slice(1).some((v) => v !== "" && v !== null);

        let clase = "";
        if (conDatos && pagados === estado.jugadores.length) {
            clase = "completa";
        } else if (pagados > 0) {
            clase = "parcial";
        }

        const activa = numero === estado.jornadaActiva ? " activa" : "";

        return `
            <button type="button"
                    class="jornada-pill ${clase}${activa}"
                    role="tab"
                    data-jornada="${numero}">
                <small>J</small>
                <b>${numero}</b>
                <span class="punto"></span>
            </button>
        `;

    }).join("");

    selector.onclick = (evento) => {

        const ficha = evento.target.closest(".jornada-pill");

        if (!ficha) {
            return;
        }

        if (Object.keys(estado.cambios).length > 0) {

            const seguir = confirm(
                "Tienes cambios sin guardar en esta jornada. " +
                "Si cambias de jornada, se perderán. ¿Continuar?"
            );

            if (!seguir) {
                return;
            }

        }

        elegirJornada(ficha.dataset.jornada);

    };

    if (!estado.jornadaActiva && jornadas.length) {
        elegirJornada(String(jornadas[0][0]));
    }

}


function elegirJornada(numero) {

    estado.jornadaActiva = numero;
    estado.cambios = {};

    $$(".jornada-pill").forEach((ficha) => {

        const activa = ficha.dataset.jornada === numero;

        ficha.classList.toggle("activa", activa);

        if (activa) {
            ficha.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }

    });

    pintarEdicionJornada();
    actualizarBarraGuardado();

}


/* =========================================================
   LISTA DE EDICIÓN
========================================================= */

function pintarEdicionJornada() {

    const contenedor = $("#listaEdicion");
    const numero = estado.jornadaActiva;

    const filaPosiciones = buscarFila(estado.datos.jornadas, numero);
    const filaPagos = buscarFila(estado.datos.controlPagos, numero);
    const nombresJornadas = (estado.datos.jornadas && estado.datos.jornadas[0]) || [];
    const nombresControl = (estado.datos.controlPagos && estado.datos.controlPagos[3]) || [];

    contenedor.innerHTML = estado.jugadores.map((nombre) => {

        const columnaPos = nombresJornadas.indexOf(nombre);
        const columnaPago = nombresControl.indexOf(nombre);

        const posicion = (filaPosiciones && columnaPos > -1) ? filaPosiciones[columnaPos] : "";
        const pagado = (filaPagos && columnaPago > -1) ? String(filaPagos[columnaPago]).trim() === "✓" : false;

        return `
            <div class="fila-editar" data-fila="${escapar(nombre)}">

                <span class="fila-editar-nombre">${escapar(nombre)}</span>

                <select class="campo-posicion"
                        data-nombre="${escapar(nombre)}"
                        data-campo="posicion"
                        aria-label="Posición de ${escapar(nombre)}">
                    <option value="">–</option>
                    ${opcionesPosicion(estado.jugadores.length, posicion)}
                </select>

                <label class="interruptor">
                    <input type="checkbox"
                           data-nombre="${escapar(nombre)}"
                           data-campo="pagado"
                           ${pagado ? "checked" : ""}
                           aria-label="${escapar(nombre)} ha pagado">
                    <span class="interruptor-pista"></span>
                </label>

            </div>
        `;

    }).join("");

    contenedor.addEventListener("change", manejarCambioCampo);

}


function opcionesPosicion(total, seleccionada) {

    let html = "";

    for (let i = 1; i <= total; i++) {

        const marcado = String(i) === String(seleccionada) ? " selected" : "";
        html += `<option value="${i}"${marcado}>${i}º</option>`;

    }

    return html;

}


function manejarCambioCampo(evento) {

    const campo = evento.target;

    if (!campo.dataset.nombre) {
        return;
    }

    const nombre = campo.dataset.nombre;

    if (!estado.cambios[nombre]) {
        estado.cambios[nombre] = {};
    }

    if (campo.dataset.campo === "posicion") {
        estado.cambios[nombre].posicion = campo.value;
    } else {
        estado.cambios[nombre].pagado = campo.checked;
    }

    campo.closest(".fila-editar").classList.add("modificada");

    resaltarDuplicados();
    actualizarBarraGuardado();

}


function resaltarDuplicados() {

    const selects = $$(".campo-posicion");
    const cuenta = {};

    selects.forEach((s) => {
        if (s.value) {
            cuenta[s.value] = (cuenta[s.value] || 0) + 1;
        }
    });

    selects.forEach((s) => {
        s.classList.toggle("duplicada", s.value && cuenta[s.value] > 1);
    });

}


function buscarFila(tabla, numero) {

    if (!tabla) {
        return null;
    }

    return tabla.find((fila) => String(fila[0]) === String(numero));

}


/* =========================================================
   BARRA DE GUARDADO
========================================================= */

function actualizarBarraGuardado() {

    const barra = $("#barraGuardar");
    const cantidad = Object.keys(estado.cambios).length;

    if (cantidad === 0) {
        barra.hidden = true;
        $("#estadoGuardado").textContent = "Sin cambios";
        return;
    }

    barra.hidden = false;

    $("#resumenCambios").textContent = cantidad === 1
        ? "1 jugador modificado"
        : cantidad + " jugadores modificados";

    $("#estadoGuardado").textContent = "Cambios sin guardar";

}


async function guardarCambios() {

    if (estado.guardando || Object.keys(estado.cambios).length === 0) {
        return;
    }

    estado.guardando = true;

    const boton = $("#botonGuardar");
    boton.disabled = true;
    boton.classList.add("girando");

    const posiciones = {};
    const pagos = {};

    for (const nombre in estado.cambios) {

        const cambio = estado.cambios[nombre];

        if ("posicion" in cambio) {
            posiciones[nombre] = cambio.posicion;
        }

        if ("pagado" in cambio) {
            pagos[nombre] = cambio.pagado;
        }

    }

    const cuerpo = {
        clave: estado.clave,
        accion: "guardarJornada",
        jornada: estado.jornadaActiva,
        posiciones,
        pagos
    };

    try {

        /*
         * Content-Type "text/plain" evita que el navegador mande
         * una petición previa (preflight) que Apps Script no sabe
         * responder. El script de Google lo interpreta igualmente
         * como JSON.
         */
        const respuesta = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify(cuerpo)
        });

        const resultado = await respuesta.json();

        if (!resultado.ok) {
            throw new Error(resultado.error || "No se pudo guardar.");
        }

        avisar("Guardado correctamente");

        estado.cambios = {};

        await cargarDatos();

        /* Volvemos a la misma jornada tras recargar. */
        const numero = estado.jornadaActiva;
        estado.jornadaActiva = null;
        elegirJornada(numero);

    } catch (error) {

        console.error(error);
        avisar("Error al guardar: " + error.message);

    } finally {

        estado.guardando = false;
        boton.disabled = false;
        boton.classList.remove("girando");

        actualizarBarraGuardado();

    }

}


/* =========================================================
   UTILIDADES
========================================================= */

function escapar(texto) {

    return String(texto === null || texto === undefined ? "" : texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}


let temporizadorAviso;

function avisar(texto) {

    const aviso = $("#aviso");

    aviso.textContent = texto;
    aviso.hidden = false;

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
        aviso.hidden = true;
    }, 3200);

}