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
    cambios: {},       // { "NombreJugador": { posicion, pagado, multaPagada } }
    guardando: false,
    panel: "jornadas"  // "jornadas" | "bote"
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
    $("#formAportacion").addEventListener("submit", manejarNuevaAportacion);
    $("#listaAportaciones").addEventListener("click", manejarClicAportacion);

    $$(".admin-tab").forEach((tab) => {
        tab.addEventListener("click", () => cambiarPanel(tab.dataset.panel));
    });

    registrarServiceWorker();

    /* Si ya se ha introducido la clave en esta pestaña, no la pedimos otra vez. */
    const claveGuardada = sessionStorage.getItem(CLAVE_SESION);

    if (claveGuardada) {
        entrar(claveGuardada);
    }

});


function cambiarPanel(nombre) {

    estado.panel = nombre;

    $$(".admin-tab").forEach((tab) => {
        tab.classList.toggle("admin-tab-activo", tab.dataset.panel === nombre);
    });

    $("#contenido").hidden = nombre !== "jornadas";
    $("#panelBote").hidden = nombre !== "bote";

}


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
        poblarSelectJugadores();
        pintarSelectorJornadas();
        pintarAportaciones();

        sessionStorage.setItem(CLAVE_SESION, clave);

        $("#pantallaAcceso").hidden = true;
        $("#topbar").hidden = false;
        $("#adminTabs").hidden = false;
        cambiarPanel("jornadas");

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
    const filaMultas = buscarFila(estado.datos.multas, numero);
    const filaMultasPagadas = buscarFila(estado.datos.multasPagadas, numero);

    const nombresJornadas = (estado.datos.jornadas && estado.datos.jornadas[0]) || [];
    const nombresControl = (estado.datos.controlPagos && estado.datos.controlPagos[3]) || [];
    const nombresMultas = (estado.datos.multas && estado.datos.multas[0]) || [];
    const nombresMultasPagadas = (estado.datos.multasPagadas && estado.datos.multasPagadas[0]) || [];

    contenedor.innerHTML = estado.jugadores.map((nombre) => {

        const columnaPos = nombresJornadas.indexOf(nombre);
        const columnaPago = nombresControl.indexOf(nombre);
        const columnaMulta = nombresMultas.indexOf(nombre);
        const columnaMultaPagada = nombresMultasPagadas.indexOf(nombre);

        const posicion = (filaPosiciones && columnaPos > -1) ? filaPosiciones[columnaPos] : "";
        const pagado = (filaPagos && columnaPago > -1) ? String(filaPagos[columnaPago]).trim() === "✓" : false;

        const importeMulta = (filaMultas && columnaMulta > -1) ? aNumero(filaMultas[columnaMulta]) : 0;
        const multaPagada = (filaMultasPagadas && columnaMultaPagada > -1)
            ? String(filaMultasPagadas[columnaMultaPagada]).trim() === "✓"
            : false;

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

                ${importeMulta > 0 ? `
                    <label class="fila-editar-multa">
                        <span>Multa ${euros(importeMulta)}</span>
                        <span class="interruptor">
                            <input type="checkbox"
                                   data-nombre="${escapar(nombre)}"
                                   data-campo="multa"
                                   ${multaPagada ? "checked" : ""}
                                   aria-label="Multa de ${escapar(nombre)} pagada">
                            <span class="interruptor-pista"></span>
                        </span>
                    </label>
                ` : ""}

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
    } else if (campo.dataset.campo === "multa") {
        estado.cambios[nombre].multaPagada = campo.checked;
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
    const multas = {};

    for (const nombre in estado.cambios) {

        const cambio = estado.cambios[nombre];

        if ("posicion" in cambio) {
            posiciones[nombre] = cambio.posicion;
        }

        if ("pagado" in cambio) {
            pagos[nombre] = cambio.pagado;
        }

        if ("multaPagada" in cambio) {
            multas[nombre] = cambio.multaPagada;
        }

    }

    const cuerpo = {
        clave: estado.clave,
        accion: "guardarJornada",
        jornada: estado.jornadaActiva,
        posiciones,
        pagos,
        multas
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

        // El propio guardado ya devuelve los datos actualizados:
        // no hace falta pedirlos otra vez por separado.
        estado.datos = resultado.datos;
        estado.jugadores = leerNombresJugadores();

        pintarSelectorJornadas();
        pintarAportaciones();

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
   BOTE / APORTACIONES
========================================================= */

function poblarSelectJugadores() {

    const select = $("#campoJugadorAportacion");

    const opciones = estado.jugadores
        .map((nombre) => `<option value="${escapar(nombre)}">${escapar(nombre)}</option>`)
        .join("");

    select.innerHTML = `<option value="" disabled selected>Jugador…</option>${opciones}`;

}


function pintarAportaciones() {

    const filas = ((estado.datos && estado.datos.aportaciones) || []).slice(1);

    const total = filas.reduce((suma, fila) => suma + aNumero(fila[3]), 0);
    $("#boteTotalCifra").textContent = euros(total);

    const lista = $("#listaAportaciones");

    if (!filas.length) {

        lista.innerHTML = `
            <div class="vacio">
                <i class="bi bi-piggy-bank"></i>
                <h3>Todavía no hay aportaciones</h3>
                <p>Añade la primera con el formulario de arriba.</p>
            </div>
        `;

        return;

    }

    /* Las más recientes primero: en la hoja se añaden al final. */
    lista.innerHTML = filas.slice().reverse().map((fila) => {

        const [id, fecha, jugador, importe, nota] = fila;

        return `
            <div class="fila-aportacion">

                <span class="fila-aportacion-datos">
                    <span class="fila-aportacion-nombre">${escapar(jugador)}</span>
                    <span class="fila-aportacion-sub">
                        ${escapar(fecha)}${nota ? " · " + escapar(nota) : ""}
                    </span>
                </span>

                <span class="fila-aportacion-importe">+${euros(aNumero(importe))}</span>

                <button type="button"
                        class="boton-borrar"
                        data-id="${escapar(id)}"
                        aria-label="Borrar aportación de ${escapar(jugador)}">
                    <i class="bi bi-trash3"></i>
                </button>

            </div>
        `;

    }).join("");

}


async function manejarNuevaAportacion(evento) {

    evento.preventDefault();

    const jugador = $("#campoJugadorAportacion").value;
    const importe = parseFloat($("#campoImporteAportacion").value);
    const nota = $("#campoNotaAportacion").value.trim();

    if (!jugador) {
        avisar("Elige un jugador.");
        return;
    }

    if (!importe || importe <= 0) {
        avisar("Escribe un importe válido.");
        return;
    }

    const boton = $("#botonAnadirAportacion");
    boton.disabled = true;
    boton.classList.add("girando");

    try {

        const respuesta = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                clave: estado.clave,
                accion: "agregarAportacion",
                jugador,
                importe,
                nota
            })
        });

        const resultado = await respuesta.json();

        if (!resultado.ok) {
            throw new Error(resultado.error || "No se pudo añadir la aportación.");
        }

        estado.datos = resultado.datos;
        pintarAportaciones();

        $("#formAportacion").reset();
        avisar("Aportación añadida");

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);

    } finally {

        boton.disabled = false;
        boton.classList.remove("girando");

    }

}


async function manejarClicAportacion(evento) {

    const boton = evento.target.closest(".boton-borrar");

    if (!boton) {
        return;
    }

    const confirmado = confirm("¿Borrar esta aportación? No se puede deshacer.");

    if (!confirmado) {
        return;
    }

    boton.disabled = true;

    try {

        const respuesta = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({
                clave: estado.clave,
                accion: "eliminarAportacion",
                id: boton.dataset.id
            })
        });

        const resultado = await respuesta.json();

        if (!resultado.ok) {
            throw new Error(resultado.error || "No se pudo borrar.");
        }

        estado.datos = resultado.datos;
        pintarAportaciones();

        avisar("Aportación borrada");

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);
        boton.disabled = false;

    }

}


/* =========================================================
   UTILIDADES
========================================================= */

const formateadorEuros = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});


function euros(valor) {

    const numero = Number(valor) || 0;

    if (Number.isInteger(numero)) {
        return numero.toLocaleString("es-ES") + " €";
    }

    return formateadorEuros.format(numero);

}


function aNumero(valor) {

    if (valor === null || valor === undefined || valor === "") {
        return 0;
    }

    if (typeof valor === "number") {
        return valor;
    }

    const texto = String(valor)
        .replace(/[€\s]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");

    const numero = parseFloat(texto);

    return isNaN(numero) ? 0 : numero;

}


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
