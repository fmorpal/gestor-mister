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
    panel: "jornadas"  // "jornadas" | "multas" | "bote" | "anuncios"
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
    $("#formMulta").addEventListener("submit", manejarNuevaMulta);
    $("#listaMultasManuales").addEventListener("change", manejarCambioMulta);
    $("#listaMultasManuales").addEventListener("click", manejarBorrarMulta);
    $("#formAnuncio").addEventListener("submit", manejarNuevoAnuncio);
    $("#listaAnuncios").addEventListener("change", manejarCambioAnuncio);
    $("#listaAnuncios").addEventListener("click", manejarBorrarAnuncio);

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
    $("#panelMultas").hidden = nombre !== "multas";
    $("#panelBote").hidden = nombre !== "bote";
    $("#panelAnuncios").hidden = nombre !== "anuncios";

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
        pintarMultasManuales();
        pintarAnuncios();

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
            ficha.scrollIntoView({ behavior: comportamientoScroll(), inline: "center", block: "nearest" });
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

let temporizadorBarra;

function actualizarBarraGuardado() {

    const barra = $("#barraGuardar");
    const cantidad = Object.keys(estado.cambios).length;

    if (cantidad === 0) {

        $("#estadoGuardado").textContent = "Sin cambios";

        /* Baja con animación y se oculta cuando ya terminó. */
        if (!barra.hidden) {
            barra.classList.remove("visible");

            clearTimeout(temporizadorBarra);
            temporizadorBarra = setTimeout(() => {
                barra.hidden = true;
            }, 220);
        }

        return;
    }

    clearTimeout(temporizadorBarra);

    if (barra.hidden) {
        barra.hidden = false;

        /* Recalculamos para que la subida arranque desde abajo. */
        void barra.offsetHeight;
    }

    barra.classList.add("visible");

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
        pintarMultasManuales();
        pintarAnuncios();

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
   MULTAS MANUALES
========================================================= */

/* Envía una acción al Apps Script y devuelve la respuesta ya validada. */
async function enviarAccion(cuerpo) {

    const respuesta = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ clave: estado.clave, ...cuerpo })
    });

    const resultado = await respuesta.json();

    if (!resultado.ok) {
        throw new Error(resultado.error || "No se pudo completar la acción.");
    }

    return resultado;

}


/* Filas de la hoja "Multas manuales" sin la cabecera. */
function leerMultasManuales() {

    return ((estado.datos && estado.datos.multasManuales) || []).slice(1)
        .filter((fila) => fila[0]);

}


/* Multas automáticas (jornadas sin pagar): hojas "Multas" y "Multas pagadas". */
function leerMultasAutomaticas() {

    const multas = (estado.datos && estado.datos.multas) || [];
    const pagadas = (estado.datos && estado.datos.multasPagadas) || [];

    const cabecera = multas[0] || [];
    const cabeceraPagadas = pagadas[0] || [];
    const lista = [];

    for (let i = 1; i < multas.length; i++) {

        const jornada = String(multas[i][0]);
        const filaPagada = pagadas.find((f) => String(f[0]) === jornada);

        for (let c = 1; c < cabecera.length; c++) {

            const importe = aNumero(multas[i][c]);

            if (importe <= 0 || !cabecera[c]) {
                continue;
            }

            const colPagada = cabeceraPagadas.indexOf(cabecera[c]);

            lista.push({
                automatica: true,
                jornada,
                jugador: String(cabecera[c]).trim(),
                importe,
                pagada: !!filaPagada && colPagada > -1
                    && String(filaPagada[colPagada]).trim() === "✓"
            });

        }

    }

    /* Jornadas más recientes primero. */
    return lista.sort((x, y) => Number(y.jornada) - Number(x.jornada));

}


function filaMultaManual(fila) {

    const [id, fecha, jugador, importe, motivo, pagada] = fila;

    return filaMulta({
        automatica: false,
        id,
        jugador,
        importe: aNumero(importe),
        pagada: String(pagada).trim() === "✓",
        sub: fecha + (motivo ? " · " + motivo : "")
    });

}


function filaMulta(m) {

    const estaPagada = m.pagada;
    const sub = m.automatica ? "Multa automática jornadas · J" + m.jornada : m.sub;

    const atributos = m.automatica
        ? `data-jornada="${escapar(m.jornada)}" data-jugador="${escapar(m.jugador)}"`
        : `data-id="${escapar(m.id)}"`;

    return `
        <div class="fila-multa ${estaPagada ? "pagada" : ""}">

            <span class="fila-aportacion-datos">
                <span class="fila-aportacion-nombre">${escapar(m.jugador)}</span>
                <span class="fila-aportacion-sub">${escapar(sub)}</span>
            </span>

            <span class="fila-multa-importe">${euros(m.importe)}</span>

            <label class="fila-multa-pago">
                <span class="interruptor">
                    <input type="checkbox"
                           ${atributos}
                           ${estaPagada ? "checked" : ""}
                           aria-label="Multa de ${escapar(m.jugador)} pagada">
                    <span class="interruptor-pista"></span>
                </span>
                ${estaPagada ? "Pagada" : "Pendiente"}
            </label>

            ${m.automatica ? `
                <span class="boton-borrar boton-borrar-vacio" aria-hidden="true"></span>
            ` : `
                <button type="button"
                        class="boton-borrar"
                        data-id="${escapar(m.id)}"
                        aria-label="Borrar multa de ${escapar(m.jugador)}">
                    <i class="bi bi-trash3"></i>
                </button>
            `}

        </div>
    `;

}


function pintarMultasManuales() {

    const manuales = leerMultasManuales().map((f) => ({
        manual: true,
        pagada: String(f[5]).trim() === "✓",
        importe: aNumero(f[3]),
        html: filaMultaManual(f)
    })).reverse();

    const automaticas = leerMultasAutomaticas().map((m) => ({
        pagada: m.pagada,
        importe: m.importe,
        html: filaMulta(m)
    }));

    const todas = manuales.concat(automaticas);

    const pendientes = todas.filter((m) => !m.pagada);
    const pagadas = todas.filter((m) => m.pagada);

    const totalPendiente = pendientes.reduce((suma, m) => suma + m.importe, 0);
    $("#multasPendientesCifra").textContent = euros(totalPendiente);

    const lista = $("#listaMultasManuales");

    if (!todas.length) {

        lista.innerHTML = `
            <div class="vacio">
                <i class="bi bi-exclamation-octagon"></i>
                <h3>No hay multas</h3>
                <p>Pon la primera con el formulario de arriba.</p>
            </div>
        `;

        return;

    }

    const grupo = (titulo, items) => items.length
        ? `<h3 class="titulo-grupo">${titulo} (${items.length})</h3>`
            + items.map((m) => m.html).join("")
        : "";

    lista.innerHTML = grupo("Pendientes", pendientes) + grupo("Pagadas", pagadas);

}


async function manejarNuevaMulta(evento) {

    evento.preventDefault();

    const jugador = $("#campoJugadorMulta").value;
    const importe = parseFloat($("#campoImporteMulta").value);
    const motivo = $("#campoMotivoMulta").value.trim();

    if (!jugador) {
        avisar("Elige un jugador.");
        return;
    }

    if (!importe || importe <= 0) {
        avisar("Escribe un importe válido.");
        return;
    }

    const boton = $("#botonAnadirMulta");
    boton.disabled = true;
    boton.classList.add("girando");

    try {

        const resultado = await enviarAccion({
            accion: "agregarMultaManual",
            jugador,
            importe,
            motivo
        });

        estado.datos = resultado.datos;
        pintarMultasManuales();

        $("#formMulta").reset();
        avisar("Multa puesta a " + jugador);

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);

    } finally {

        boton.disabled = false;
        boton.classList.remove("girando");

    }

}


/* Interruptor de pagada: se guarda al momento, sin barra de guardado. */
async function manejarCambioMulta(evento) {

    const campo = evento.target;

    const esAutomatica = !!campo.dataset.jornada;

    if (!campo.dataset.id && !esAutomatica) {
        return;
    }

    const pagada = campo.checked;
    campo.disabled = true;

    try {

        const resultado = await enviarAccion(esAutomatica
            ? {
                accion: "marcarMultaAutomatica",
                jornada: Number(campo.dataset.jornada),
                jugador: campo.dataset.jugador,
                pagada
            }
            : {
                accion: "marcarMultaManual",
                id: campo.dataset.id,
                pagada
            });

        estado.datos = resultado.datos;
        pintarMultasManuales();

        avisar(pagada ? "Multa marcada como pagada" : "Multa marcada como pendiente");

    } catch (error) {

        console.error(error);

        /* Si falla, devolvemos el interruptor a como estaba. */
        campo.checked = !pagada;
        campo.disabled = false;

        avisar("Error: " + error.message);

    }

}


async function manejarBorrarMulta(evento) {

    const boton = evento.target.closest(".boton-borrar");

    if (!boton) {
        return;
    }

    if (!confirm("¿Borrar esta multa? Desaparecerá también de la web de los jugadores.")) {
        return;
    }

    boton.disabled = true;

    try {

        const resultado = await enviarAccion({
            accion: "eliminarMultaManual",
            id: boton.dataset.id
        });

        estado.datos = resultado.datos;
        pintarMultasManuales();

        avisar("Multa borrada");

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);
        boton.disabled = false;

    }

}


/* =========================================================
   TABLÓN DE ANUNCIOS
========================================================= */

const ETIQUETAS_ANUNCIO = {
    info: "Información",
    importante: "Importante",
    urgente: "Urgente"
};

/* Filas de la hoja "Anuncios" sin la cabecera. */
function leerAnuncios() {

    return ((estado.datos && estado.datos.anuncios) || []).slice(1)
        .filter((fila) => fila[0]);

}


function filaAnuncio(fila) {

    const [id, fecha, titulo, mensaje, tipoBruto, fijadoBruto, visibleBruto] = fila;

    const tipo = ETIQUETAS_ANUNCIO[tipoBruto] ? tipoBruto : "info";
    const fijado = String(fijadoBruto).trim() === "✓";
    const visible = String(visibleBruto).trim() === "✓";

    const interruptor = (campo, activo, texto) => `
        <label class="fila-multa-pago">
            <span class="interruptor">
                <input type="checkbox"
                       data-id="${escapar(id)}"
                       data-campo="${campo}"
                       ${activo ? "checked" : ""}
                       aria-label="${texto}">
                <span class="interruptor-pista"></span>
            </span>
            ${texto}
        </label>
    `;

    return `
        <article class="fila-anuncio fila-anuncio-${tipo} ${visible ? "" : "oculto"}">

            <div class="fila-anuncio-cabecera">
                <span class="etiqueta-anuncio etiqueta-anuncio-${tipo}">
                    ${ETIQUETAS_ANUNCIO[tipo]}
                </span>
                ${fijado ? '<span class="etiqueta-fijado"><i class="bi bi-pin-angle-fill"></i> Fijado</span>' : ""}
                <span class="fila-anuncio-fecha">${escapar(fecha)}</span>
            </div>

            ${titulo ? `<h4 class="fila-anuncio-titulo">${escapar(titulo)}</h4>` : ""}
            ${mensaje ? `<p class="fila-anuncio-mensaje">${escapar(mensaje)}</p>` : ""}

            <div class="fila-anuncio-acciones">
                ${interruptor("visible", visible, "Visible")}
                ${interruptor("fijado", fijado, "Fijado")}
                <button type="button"
                        class="boton-borrar"
                        data-id="${escapar(id)}"
                        aria-label="Borrar anuncio">
                    <i class="bi bi-trash3"></i>
                </button>
            </div>

        </article>
    `;

}


function pintarAnuncios() {

    const filas = leerAnuncios();
    const lista = $("#listaAnuncios");

    if (!filas.length) {

        lista.innerHTML = `
            <div class="vacio">
                <i class="bi bi-megaphone"></i>
                <h3>No hay anuncios</h3>
                <p>Publica el primero con el formulario de arriba.</p>
            </div>
        `;

        return;

    }

    lista.innerHTML = filas.slice().reverse().map(filaAnuncio).join("");

}


async function manejarNuevoAnuncio(evento) {

    evento.preventDefault();

    const titulo = $("#campoTituloAnuncio").value.trim();
    const mensaje = $("#campoMensajeAnuncio").value.trim();

    if (!titulo && !mensaje) {
        avisar("Escribe un título o un mensaje.");
        return;
    }

    const boton = $("#botonAnadirAnuncio");
    boton.disabled = true;
    boton.classList.add("girando");

    try {

        const resultado = await enviarAccion({
            accion: "agregarAnuncio",
            titulo,
            mensaje,
            tipo: $("#campoTipoAnuncio").value,
            fijado: $("#campoFijarAnuncio").checked
        });

        estado.datos = resultado.datos;
        pintarAnuncios();

        $("#formAnuncio").reset();
        avisar("Anuncio publicado");

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);

    } finally {

        boton.disabled = false;
        boton.classList.remove("girando");

    }

}


/* Los interruptores de visible/fijado se guardan al momento. */
async function manejarCambioAnuncio(evento) {

    const campo = evento.target;

    if (!campo.dataset.id || !campo.dataset.campo) {
        return;
    }

    const valor = campo.checked;
    campo.disabled = true;

    try {

        const resultado = await enviarAccion({
            accion: "marcarAnuncio",
            id: campo.dataset.id,
            campo: campo.dataset.campo,
            valor
        });

        estado.datos = resultado.datos;
        pintarAnuncios();

        avisar("Anuncio actualizado");

    } catch (error) {

        console.error(error);

        campo.checked = !valor;
        campo.disabled = false;

        avisar("Error: " + error.message);

    }

}


async function manejarBorrarAnuncio(evento) {

    const boton = evento.target.closest(".boton-borrar");

    if (!boton) {
        return;
    }

    if (!confirm("¿Borrar este anuncio? Desaparecerá de la web de los jugadores.")) {
        return;
    }

    boton.disabled = true;

    try {

        const resultado = await enviarAccion({
            accion: "eliminarAnuncio",
            id: boton.dataset.id
        });

        estado.datos = resultado.datos;
        pintarAnuncios();

        avisar("Anuncio borrado");

    } catch (error) {

        console.error(error);
        avisar("Error: " + error.message);
        boton.disabled = false;

    }

}


/* =========================================================
   BOTE / APORTACIONES
========================================================= */

function poblarSelectJugadores() {

    const opciones = estado.jugadores
        .map((nombre) => `<option value="${escapar(nombre)}">${escapar(nombre)}</option>`)
        .join("");

    const html = `<option value="" disabled selected>Jugador…</option>${opciones}`;

    $("#campoJugadorAportacion").innerHTML = html;
    $("#campoJugadorMulta").innerHTML = html;

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


/* Desplazamiento suave, salvo para quien pidió reducir el movimiento. */
function comportamientoScroll() {

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";

}


let temporizadorAviso;
let temporizadorOcultarAviso;

function avisar(texto) {

    const aviso = $("#aviso");

    clearTimeout(temporizadorAviso);
    clearTimeout(temporizadorOcultarAviso);

    aviso.textContent = texto;
    aviso.hidden = false;

    /* Recalculamos para que la entrada arranque desde "escondido". */
    void aviso.offsetWidth;
    aviso.classList.add("visible");

    temporizadorAviso = setTimeout(() => {

        aviso.classList.remove("visible");

        temporizadorOcultarAviso = setTimeout(() => {
            aviso.hidden = true;
        }, 220);

    }, 3200);

}