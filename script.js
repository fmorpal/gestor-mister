/* =========================================================
   FUERA DE JUEGO — Lógica de la aplicación

   Los datos vienen de una hoja de Google publicada como
   API mediante Google Apps Script.
========================================================= */

"use strict";

/* ---------------------------------------------------------
   CONFIGURACIÓN
--------------------------------------------------------- */

const API_URL =
    "https://script.google.com/macros/s/AKfycbyYp9d0TdPSK0O_dclAv6i-XE29LDkcKcUO1NJEfZqqm42FYCprLgzdGG7-C5Ft_Rwt/exec";

/*
 * Fotos de los jugadores.
 *
 * El archivo debe llamarse igual que el jugador en la hoja:
 *   jugadores/Juan Pérez.jpg
 *
 * Si no existe, se muestran sus iniciales.
 */
const CARPETA_FOTOS = "jugadores/";
const EXTENSIONES_FOTO = ["jpg", "jpeg", "png", "webp"];

const TOTAL_JORNADAS = 38;

/* Minutos entre actualizaciones automáticas */
const MINUTOS_REFRESCO = 5;

/* Clave del guardado local */
const CLAVE_CACHE = "fdj-datos-v2";


/* ---------------------------------------------------------
   ESTADO
--------------------------------------------------------- */

const estado = {
    datos: null,
    jugadores: [],
    jornadaActiva: null,
    orden: "pendiente",
    busqueda: "",
    cargando: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));


/* ---------------------------------------------------------
   ARRANQUE
--------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {

    montarNavegacion();
    montarBuscador();
    montarOrden();
    montarFicha();
    montarTirarParaActualizar();
    montarTablon();
    montarEstadisticas();

    $("#botonRecargar").addEventListener("click", () => cargarDatos(true));

    /* Pintamos primero lo último guardado: la app abre al instante. */
    const guardado = leerCache();

    if (guardado) {
        estado.datos = guardado.datos;
        pintarTodo();
        mostrarUltimaActualizacion(guardado.fecha, true);
    }

    cargarDatos();

    /* Al volver a la app desde segundo plano, refrescamos. */
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
            cargarDatos();
        }
    });

    window.addEventListener("online", () => cargarDatos(true));

    setInterval(() => cargarDatos(), MINUTOS_REFRESCO * 60 * 1000);

    registrarServiceWorker();

});


/* =========================================================
   DATOS
========================================================= */

async function cargarDatos(manual = false) {

    if (estado.cargando) {
        return;
    }

    estado.cargando = true;

    const boton = $("#botonRecargar");
    boton.classList.add("girando");

    if (!estado.datos) {
        marcarConexion("Cargando", "cargando");
    }

    try {

        const datos = await pedirConReintentos(API_URL);

        estado.datos = datos;

        guardarCache(datos);
        pintarTodo();

        marcarConexion("Al día", "online");
        mostrarUltimaActualizacion(Date.now(), false);

        if (manual) {
            avisar("Datos actualizados");
        }

    } catch (error) {

        console.error("No se pudo conectar con la hoja:", error);

        marcarConexion("Sin conexión", "error");

        if (estado.datos) {
            avisar("Sin conexión. Se muestran los últimos datos guardados.");
        } else {
            pintarErrorInicial();
        }

    } finally {

        estado.cargando = false;
        boton.classList.remove("girando");

    }

}


/*
 * Tres intentos con espera creciente: la primera llamada a
 * Apps Script a veces tarda en despertar.
 */
async function pedirConReintentos(url, intentos = 3) {

    let ultimoError;

    for (let intento = 1; intento <= intentos; intento++) {

        try {

            const control = new AbortController();
            const tiempo = setTimeout(() => control.abort(), 15000);

            const respuesta = await fetch(url, {
                signal: control.signal,
                cache: "no-store"
            });

            clearTimeout(tiempo);

            if (!respuesta.ok) {
                throw new Error("HTTP " + respuesta.status);
            }

            return await respuesta.json();

        } catch (error) {

            ultimoError = error;

            if (intento < intentos) {
                await esperar(intento * 900);
            }

        }

    }

    throw ultimoError;

}


const esperar = (ms) => new Promise((listo) => setTimeout(listo, ms));


/* ---------------------------------------------------------
   GUARDADO LOCAL
--------------------------------------------------------- */

function guardarCache(datos) {
    try {
        localStorage.setItem(
            CLAVE_CACHE,
            JSON.stringify({ fecha: Date.now(), datos })
        );
    } catch (error) {
        /* Modo privado de Safari: no pasa nada, seguimos sin caché. */
    }
}


function leerCache() {
    try {
        const crudo = localStorage.getItem(CLAVE_CACHE);
        return crudo ? JSON.parse(crudo) : null;
    } catch (error) {
        return null;
    }
}


/* =========================================================
   INTERPRETAR LA HOJA
========================================================= */

function leerJugadores() {

    const resumen = estado.datos && estado.datos.resumen;

    if (!resumen || !resumen.length) {
        return [];
    }

    const inicio = resumen.findIndex((fila) => fila[0] === "Jugador");

    if (inicio === -1) {
        return [];
    }

    const jugadores = [];

    for (let i = inicio + 1; i < resumen.length; i++) {

        const fila = resumen[i];

        if (!fila[0] || fila[0] === "TOTAL") {
            continue;
        }

        const totalDebe = aNumero(fila[1]);
        const totalPagado = aNumero(fila[2]);
        const pendiente = aNumero(fila[3]);
        const nombre = String(fila[0]).trim();

        const multasInfo = calcularMultasJugador(nombre);

        jugadores.push({
            nombre,
            totalDebe,
            totalPagado,
            pendiente,
            jornadasPagadas: aNumero(fila[4]),
            jornadasPendientes: aNumero(fila[5]),
            saldo: aNumero(fila[7]),
            multas: multasInfo.pendiente,           // lo que aún debe de multas
            multasTotal: multasInfo.total,
            multasPagadas: multasInfo.pagado,
            aportado: calcularAportado(nombre),
            progreso: totalDebe > 0
                ? Math.max(0, Math.min(1, totalPagado / totalDebe))
                : 1
        });

    }

    return jugadores;

}


/*
 * Multas manuales de la hoja "Multas manuales"
 * (Id, Fecha, Jugador, Importe, Motivo, Pagada).
 */
function leerMultasManualesWeb() {

    const filas = ((estado.datos && estado.datos.multasManuales) || []).slice(1);

    return filas
        .filter((fila) => fila[0] && fila[2])
        .map((fila) => ({
            id: String(fila[0]),
            fecha: String(fila[1] || ""),
            jugador: String(fila[2]).trim(),
            importe: aNumero(fila[3]),
            motivo: String(fila[4] || "").trim(),
            pagada: String(fila[5]).trim() === "✓"
        }))
        .filter((m) => m.importe > 0);

}


/*
 * Multas automáticas (jornadas sin pagar): una por cada importe
 * de la hoja "Multas", con su estado en "Multas pagadas".
 */
function leerMultasAutomaticasWeb() {

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
                jugador: String(cabecera[c]).trim(),
                importe,
                jornada,
                motivo: "Multa automática jornadas",
                etiqueta: "J" + jornada,
                pagada: !!filaPagada && colPagada > -1
                    && String(filaPagada[colPagada]).trim() === "✓"
            });

        }

    }

    return lista;

}


/*
 * Suma las multas de un jugador jornada a jornada, separando
 * lo que ya ha pagado de lo que todavía debe.
 */
function calcularMultasJugador(nombre) {

    const multas = (estado.datos && estado.datos.multas) || [];
    const pagadas = (estado.datos && estado.datos.multasPagadas) || [];

    const cabeceraMultas = multas[0] || [];
    const cabeceraPagadas = pagadas[0] || [];

    const columnaMultas = cabeceraMultas.indexOf(nombre);
    const columnaPagadas = cabeceraPagadas.indexOf(nombre);

    let total = 0;
    let pagado = 0;

    if (columnaMultas > -1) {

        for (let i = 1; i < multas.length; i++) {

            const importe = aNumero(multas[i][columnaMultas]);

            if (importe <= 0) {
                continue;
            }

            total += importe;

            const numeroJornada = multas[i][0];

            const filaPagada = columnaPagadas > -1
                ? pagadas.find((f) => String(f[0]) === String(numeroJornada))
                : null;

            const estaPagada = filaPagada
                ? String(filaPagada[columnaPagadas]).trim() === "✓"
                : false;

            if (estaPagada) {
                pagado += importe;
            }

        }

    }

    /*
     * Multas puestas a mano por el administrador: cuentan igual
     * que las automáticas (total, pagado y pendiente).
     */
    leerMultasManualesWeb()
        .filter((m) => m.jugador === nombre)
        .forEach((m) => {

            total += m.importe;

            if (m.pagada) {
                pagado += m.importe;
            }

        });

    return { total, pagado, pendiente: total - pagado };

}


/*
 * Suma lo que un jugador ha aportado al bote común,
 * fuera de las cuotas normales de las jornadas.
 */
function calcularAportado(nombre) {

    const aportaciones = (estado.datos && estado.datos.aportaciones) || [];

    let total = 0;

    for (let i = 1; i < aportaciones.length; i++) {

        if (String(aportaciones[i][2] || "").trim() === nombre) {
            total += aNumero(aportaciones[i][3]);
        }

    }

    return total;

}


function leerTotales() {

    const resumen = (estado.datos && estado.datos.resumen) || [];
    const fila = resumen.find((f) => f[0] === "TOTAL");

    const base = fila
        ? { total: aNumero(fila[1]), cobrado: aNumero(fila[2]), pendiente: aNumero(fila[3]) }
        : { total: 0, cobrado: 0, pendiente: 0 };

    const aportaciones = (estado.datos && estado.datos.aportaciones) || [];

    let sumaAportaciones = 0;

    for (let i = 1; i < aportaciones.length; i++) {
        sumaAportaciones += aNumero(aportaciones[i][3]);
    }

    /*
     * Las multas sí son dinero que la liga tiene que acabar
     * cobrando, así que aquí funcionan distinto al bote:
     * - lo pagado se suma a "cobrado"
     * - el total (pagado + pendiente) se suma a "total"
     * - lo que aún falta se suma a "pendiente"
     *
     * Reutilizamos lo que ya se calculó por jugador para no
     * volver a recorrer las hojas de multas otra vez.
     */
    const multasPendientes = estado.jugadores.reduce((suma, j) => suma + j.multas, 0);
    const multasPagadas = estado.jugadores.reduce((suma, j) => suma + j.multasPagadas, 0);
    const sumaMultas = multasPendientes + multasPagadas;

    /*
     * El bote se suma al total y a lo cobrado por igual, así que
     * no cambia lo pendiente: es dinero aparte, no un pago de la
     * cuota de nadie.
     */
    return {
        total: base.total + sumaAportaciones + sumaMultas,
        cobrado: base.cobrado + sumaAportaciones + multasPagadas,
        pendiente: base.pendiente + multasPendientes,
        aportaciones: sumaAportaciones,
        multas: sumaMultas
    };

}


/* Jornadas con algún dato cargado */
function leerJornadas() {

    const jornadas = (estado.datos && estado.datos.jornadas) || [];
    const control = (estado.datos && estado.datos.controlPagos) || [];

    const total = jornadas.length ? jornadas[0].length - 1 : 0;

    return jornadas.slice(1)
        .filter((fila) => fila[0] !== "" && fila[0] !== null && fila[0] !== undefined)
        .map((fila) => {

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

            return { numero, pagados, total, conDatos };

        });

}


/* =========================================================
   PINTAR
========================================================= */

function pintarTodo() {

    estado.jugadores = leerJugadores();

    pintarResumen();
    pintarTablon();
    pintarMultasManualesWeb();
    pintarJugadores();
    pintarEstadisticas();
    pintarSelectorJornadas();

    if (estado.jornadaActiva) {
        pintarJornada(estado.jornadaActiva);
    } else {
        pintarJornadaVacia();
    }

}


/* ---------------------------------------------------------
   RESUMEN
--------------------------------------------------------- */

function pintarResumen() {

    const totales = leerTotales();
    const jugadores = estado.jugadores;

    animarEuros("#dineroPendiente", totales.pendiente);
    animarEuros("#dineroActual", totales.cobrado);
    animarEuros("#dineroTotal", totales.total);

    const proporcion = totales.total > 0 ? totales.cobrado / totales.total : 0;
    $("#barraBote").style.width = Math.round(proporcion * 100) + "%";

    const notas = [];

    if (totales.multas > 0) {
        notas.push(euros(totales.multas) + " en multas");
    }

    if (totales.aportaciones > 0) {
        notas.push(euros(totales.aportaciones) + " aportados al bote");
    }

    if (notas.length) {
        $("#notaBote").hidden = false;
        $("#notaBoteTexto").textContent = "Incluye " + notas.join(" y ") + ".";
    } else {
        $("#notaBote").hidden = true;
    }

    /* Jornadas jugadas */
    const jornadas = leerJornadas();
    const jugadas = jornadas.filter((j) => j.conDatos).length;

    $("#jornadasCompletadas").textContent = jugadas;
    $("#jornadasCompletadas").nextElementSibling.textContent = "de " + TOTAL_JORNADAS;

    /* Jugadores al día */
    const alDia = jugadores.filter((j) => j.pendiente <= 0).length;

    $("#jugadoresAlDia").textContent = alDia;
    $("#jugadoresTotales").textContent = "de " + jugadores.length + " jugadores";

    /* Multas */
    /* Acumuladas = todas las multas, pagadas o no. */
    const multas = jugadores.reduce((suma, j) => suma + j.multasTotal, 0);
    $("#multasTotales").textContent = euros(multas);

    /* Mayor deuda */
    const deudor = jugadores
        .slice()
        .sort((a, b) => b.pendiente - a.pendiente)[0];

    if (deudor && deudor.pendiente > 0) {
        $("#mayorDeuda").textContent = euros(deudor.pendiente);
        $("#mayorDeudaNombre").textContent = deudor.nombre;
    } else {
        $("#mayorDeuda").textContent = "0 €";
        $("#mayorDeudaNombre").textContent = "Nadie debe nada";
    }

    /* Ranking de morosos */
    const morosos = jugadores
        .filter((j) => j.pendiente > 0)
        .sort((a, b) => b.pendiente - a.pendiente)
        .slice(0, 5);

    const lista = $("#listaMorosos");

    if (!morosos.length) {
        lista.innerHTML = plantillaVacio(
            "bi-emoji-sunglasses",
            "Todo cobrado",
            "Ningún jugador tiene pagos pendientes."
        );
        return;
    }

    lista.innerHTML = morosos.map((j) => filaJugador(j, "pendiente")).join("");

}


/*
 * Lista pública de multas manuales: primero las pendientes y,
 * debajo, las últimas pagadas.
 */
function pintarMultasManualesWeb() {

    const bloque = $("#bloqueMultasManuales");
    const lista = $("#listaMultasManualesWeb");

    /* Manuales (de más antigua a más nueva) y automáticas (por jornada). */
    const todas = leerMultasManualesWeb().concat(leerMultasAutomaticasWeb());

    if (!todas.length) {
        bloque.hidden = true;
        return;
    }

    const pendientes = todas.filter((m) => !m.pagada).reverse();
    const pagadas = todas.filter((m) => m.pagada).reverse().slice(0, 5);

    bloque.hidden = false;

    lista.innerHTML = pendientes.concat(pagadas).map(filaMultaManualWeb).join("");

}


function filaMultaManualWeb(multa) {

    return `
        <div class="fila">

            ${avatar(multa.jugador)}

            <span class="fila-datos">
                <span class="fila-nombre">${escapar(multa.jugador)}</span>
                <span class="fila-sub">
                    ${multa.motivo ? escapar(multa.motivo) : "Multa"}
                    ${multa.etiqueta ? " · " + escapar(multa.etiqueta) : (multa.fecha ? " · " + escapar(multa.fecha.split(" ")[0]) : "")}
                </span>
            </span>

            <span class="fila-cifra">
                <span class="fila-importe ${multa.pagada ? "importe-ok" : "importe-deuda"}">
                    ${euros(multa.importe)}
                </span>
                <span class="distintivo ${multa.pagada ? "distintivo-ok" : "distintivo-no"}">
                    ${multa.pagada ? "Pagada" : "Pendiente"}
                </span>
            </span>

        </div>
    `;

}


/* ---------------------------------------------------------
   JUGADORES
--------------------------------------------------------- */

function pintarJugadores() {

    const lista = $("#listaJugadores");
    const texto = estado.busqueda.trim().toLowerCase();

    let jugadores = estado.jugadores.slice();

    if (texto) {
        jugadores = jugadores.filter((j) =>
            normalizar(j.nombre).includes(normalizar(texto))
        );
    }

    jugadores.sort(compararJugadores);

    if (!jugadores.length) {

        lista.innerHTML = texto
            ? plantillaVacio(
                "bi-search",
                "Sin resultados",
                "Ningún jugador coincide con «" + escapar(texto) + "»."
            )
            : plantillaVacio(
                "bi-people",
                "Todavía no hay jugadores",
                "Comprueba que la hoja de cálculo tiene datos."
            );

        return;
    }

    lista.innerHTML = jugadores
        .map((j) => filaJugador(j, estado.orden))
        .join("");

}


function compararJugadores(a, b) {

    if (estado.orden === "nombre") {
        return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
    }

    return b[estado.orden] - a[estado.orden];

}


/*
 * Una fila de jugador. El campo destacado a la derecha
 * cambia según el orden elegido.
 */
function filaJugador(jugador, destacado) {

    const campos = {
        pendiente: { etiqueta: "pendiente", valor: jugador.pendiente },
        totalPagado: { etiqueta: "pagado", valor: jugador.totalPagado },
        multas: { etiqueta: "multas", valor: jugador.multas },
        saldo: { etiqueta: "saldo", valor: jugador.saldo },
        nombre: { etiqueta: "pendiente", valor: jugador.pendiente }
    };

    const campo = campos[destacado] || campos.pendiente;

    let clase = "importe-neutro";

    if (campo.etiqueta === "pendiente" || campo.etiqueta === "multas") {
        clase = campo.valor > 0 ? "importe-deuda" : "importe-ok";
    } else if (campo.valor > 0) {
        clase = "importe-ok";
    }

    return `
        <button type="button" class="fila" data-jugador="${escapar(jugador.nombre)}">

            ${avatar(jugador.nombre)}

            <span class="fila-datos">
                <span class="fila-nombre">${escapar(jugador.nombre)}</span>
                <span class="fila-sub">
                    ${jugador.jornadasPagadas} jornadas pagadas
                </span>
                <span class="progreso">
                    <span style="width:${Math.round(jugador.progreso * 100)}%"></span>
                </span>
            </span>

            <span class="fila-cifra">
                <span class="fila-importe ${clase}">${euros(campo.valor)}</span>
                <span class="fila-etiqueta">${campo.etiqueta}</span>
            </span>

        </button>
    `;

}


/* ---------------------------------------------------------
   JORNADAS
--------------------------------------------------------- */

function pintarSelectorJornadas() {

    const selector = $("#selectorJornada");
    const jornadas = leerJornadas();

    if (!jornadas.length) {
        selector.innerHTML = "";
        return;
    }

    selector.innerHTML = jornadas.map((j) => {

        let clase = "";

        if (j.conDatos && j.total > 0 && j.pagados === j.total) {
            clase = "completa";
        } else if (j.pagados > 0) {
            clase = "parcial";
        }

        const activa = String(j.numero) === String(estado.jornadaActiva)
            ? " activa"
            : "";

        return `
            <button type="button"
                    class="jornada-pill ${clase}${activa}"
                    role="tab"
                    aria-selected="${activa ? "true" : "false"}"
                    data-jornada="${escapar(j.numero)}">
                <small>J</small>
                <b>${escapar(j.numero)}</b>
                <span class="punto"></span>
            </button>
        `;

    }).join("");

    selector.onclick = (evento) => {

        const ficha = evento.target.closest(".jornada-pill");

        if (ficha) {
            elegirJornada(ficha.dataset.jornada);
        }

    };

    /* Si no hay ninguna elegida, abrimos la última con datos. */
    if (!estado.jornadaActiva) {

        const conDatos = jornadas.filter((j) => j.conDatos);

        if (conDatos.length) {
            elegirJornada(conDatos[conDatos.length - 1].numero);
        }

    }

}


function elegirJornada(numero, desplazar = true) {

    estado.jornadaActiva = String(numero);

    $$(".jornada-pill").forEach((ficha) => {

        const activa = ficha.dataset.jornada === estado.jornadaActiva;

        ficha.classList.toggle("activa", activa);
        ficha.setAttribute("aria-selected", activa ? "true" : "false");

        if (activa && desplazar) {
            ficha.scrollIntoView({
                behavior: "smooth",
                inline: "center",
                block: "nearest"
            });
        }

    });

    pintarJornada(estado.jornadaActiva);

}


function pintarJornada(numero) {

    const info = $("#jornadaInfo");
    const lista = $("#listaJornada");

    const datos = estado.datos || {};

    const pagos = buscarFila(datos.pagosPorJornada, numero);
    const control = buscarFila(datos.controlPagos, numero);
    const posiciones = buscarFila(datos.jornadas, numero);
    const nombres = (datos.jornadas && datos.jornadas[0]) || [];

    if (!pagos) {

        info.innerHTML = "";
        lista.innerHTML = plantillaVacio(
            "bi-calendar-x",
            "Jornada " + escapar(numero) + " sin datos",
            "Esta jornada aún no se ha registrado en la hoja."
        );

        return;
    }

    /* Montamos la lista de la jornada */
    const filas = [];

    for (let i = 1; i < nombres.length; i++) {

        const nombre = nombres[i];

        if (!nombre) {
            continue;
        }

        const puesto = parseInt(
            String(posiciones ? posiciones[i] : "").replace(/[^\d]/g, ""),
            10
        );

        filas.push({
            nombre: String(nombre).trim(),
            cantidad: aNumero(pagos[i]),
            puesto: isNaN(puesto) ? 99 : puesto,
            pagado: control ? String(control[i]).trim() === "✓" : false
        });

    }

    filas.sort((a, b) => a.puesto - b.puesto);

    const pagados = filas.filter((f) => f.pagado).length;
    const completa = pagados === filas.length && filas.length > 0;

    info.innerHTML = `
        <div class="jornada-resumen">
            <div>
                <h2>Jornada ${escapar(numero)}</h2>
                <p>${euros(filas.reduce((s, f) => s + f.cantidad, 0))} en juego</p>
            </div>
            <span class="distintivo ${completa ? "distintivo-ok" : "distintivo-parcial"}">
                <i class="bi ${completa ? "bi-check-circle-fill" : "bi-clock-fill"}"></i>
                ${pagados}/${filas.length} pagado${filas.length === 1 ? "" : "s"}
            </span>
        </div>
    `;

    lista.innerHTML = filas.map((f) => `
        <div class="fila">

            <span class="puesto ${f.puesto <= 3 ? "puesto-" + f.puesto : ""}">
                ${f.puesto === 99 ? "–" : f.puesto + "º"}
            </span>

            ${avatar(f.nombre)}

            <span class="fila-datos">
                <span class="fila-nombre">${escapar(f.nombre)}</span>
                <span class="fila-sub">${euros(f.cantidad)}</span>
            </span>

            <span class="distintivo ${f.pagado ? "distintivo-ok" : "distintivo-no"}">
                <i class="bi ${f.pagado ? "bi-check-lg" : "bi-x-lg"}"></i>
                ${f.pagado ? "Pagado" : "Debe"}
            </span>

        </div>
    `).join("");

}


function pintarJornadaVacia() {

    $("#jornadaInfo").innerHTML = "";

    $("#listaJornada").innerHTML = plantillaVacio(
        "bi-calendar3",
        "Elige una jornada",
        "Toca un número de arriba para ver quién ha pagado."
    );

}


function buscarFila(tabla, numero) {

    if (!tabla) {
        return null;
    }

    return tabla.find((fila) => String(fila[0]) === String(numero));

}


/* =========================================================
   FICHA DEL JUGADOR
========================================================= */

function montarFicha() {

    /* Un solo listener para todas las listas */
    $("#contenido").addEventListener("click", (evento) => {

        const fila = evento.target.closest("[data-jugador]");

        if (fila) {
            abrirFicha(fila.dataset.jugador);
        }

    });

    $("#sheetFondo").addEventListener("click", cerrarFicha);
    $("#sheetCerrar").addEventListener("click", cerrarFicha);

    document.addEventListener("keydown", (evento) => {
        if (evento.key === "Escape") {
            cerrarFicha();
        }
    });

}


function abrirFicha(nombre) {

    const jugador = estado.jugadores.find((j) => j.nombre === nombre);

    if (!jugador) {
        return;
    }

    let etiqueta = "Al día";
    let clase = "distintivo-ok";

    if (jugador.pendiente > 0 && jugador.totalPagado > 0) {
        etiqueta = "Pago parcial";
        clase = "distintivo-parcial";
    } else if (jugador.pendiente > 0) {
        etiqueta = "Sin pagar";
        clase = "distintivo-no";
    }

    $("#sheetCuerpo").innerHTML = `

        <div class="sheet-cabecera">
            ${avatar(jugador.nombre, true)}
            <div>
                <h2 id="sheetNombre">${escapar(jugador.nombre)}</h2>
                <p><span class="distintivo ${clase}">${etiqueta}</span></p>
            </div>
        </div>

        <div class="sheet-datos">

            <div class="sheet-dato">
                <span>Pendiente</span>
                <strong class="${jugador.pendiente > 0 ? "importe-deuda" : "importe-ok"}">
                    ${euros(jugador.pendiente)}
                </strong>
            </div>

            <div class="sheet-dato">
                <span>Ya pagado</span>
                <strong class="importe-ok">${euros(jugador.totalPagado)}</strong>
            </div>

            <div class="sheet-dato">
                <span>Total acumulado</span>
                <strong>${euros(jugador.totalDebe)}</strong>
            </div>

            <div class="sheet-dato">
                <span>Saldo</span>
                <strong>${euros(jugador.saldo)}</strong>
            </div>

            <div class="sheet-dato">
                <span>Multas pendientes</span>
                <strong class="${jugador.multas > 0 ? "importe-deuda" : "importe-ok"}">
                    ${euros(jugador.multas)}
                </strong>
            </div>

            <div class="sheet-dato">
                <span>Multas pagadas</span>
                <strong class="${jugador.multasPagadas > 0 ? "importe-ok" : ""}">
                    ${euros(jugador.multasPagadas)}
                </strong>
            </div>

            <div class="sheet-dato">
                <span>Jornadas</span>
                <strong>${jugador.jornadasPagadas}
                    <small style="font-size:.7rem;opacity:.6">
                        / ${jugador.jornadasPagadas + jugador.jornadasPendientes}
                    </small>
                </strong>
            </div>

            <div class="sheet-dato">
                <span>Aportado al bote</span>
                <strong class="${jugador.aportado > 0 ? "importe-ok" : ""}">
                    ${euros(jugador.aportado)}
                </strong>
            </div>

        </div>

        ${fichaMultasManuales(jugador.nombre)}
    `;

    $("#sheetFondo").hidden = false;
    $("#sheet").hidden = false;

    document.body.style.overflow = "hidden";

}


/* Detalle de las multas manuales de un jugador, dentro de su ficha. */
function fichaMultasManuales(nombre) {

    const multas = leerMultasManualesWeb()
        .concat(leerMultasAutomaticasWeb())
        .filter((m) => m.jugador === nombre)
        .sort((a, b) => Number(a.pagada) - Number(b.pagada));

    if (!multas.length) {
        return "";
    }

    return `
        <h3 class="sheet-subtitulo">Multas</h3>

        <div class="sheet-multas">
            ${multas.map((m) => `
                <div class="sheet-multa">
                    <span class="sheet-multa-texto">
                        <b>${m.motivo ? escapar(m.motivo) : "Multa"}</b>
                        <small>${escapar(m.etiqueta || m.fecha.split(" ")[0])}</small>
                    </span>
                    <span class="importe-${m.pagada ? "ok" : "deuda"}">${euros(m.importe)}</span>
                    <span class="distintivo ${m.pagada ? "distintivo-ok" : "distintivo-no"}">
                        ${m.pagada ? "Pagada" : "Pendiente"}
                    </span>
                </div>
            `).join("")}
        </div>
    `;

}


function cerrarFicha() {

    $("#sheetFondo").hidden = true;
    $("#sheet").hidden = true;

    document.body.style.overflow = "";

}


/* =========================================================
   NAVEGACIÓN ENTRE VISTAS
========================================================= */

const TITULOS = {
    resumen: "Resumen",
    jugadores: "Jugadores",
    jornadas: "Jornadas",
    estadisticas: "Estadísticas"
};


function montarNavegacion() {

    $$(".tab").forEach((tab) => {

        tab.addEventListener("click", () => abrirVista(tab.dataset.vista));

    });

}


function abrirVista(nombre) {

    $$(".vista").forEach((vista) => {

        const activa = vista.id === "vista-" + nombre;

        vista.hidden = !activa;
        vista.classList.toggle("vista-activa", activa);

    });

    $$(".tab").forEach((tab) => {

        const activa = tab.dataset.vista === nombre;

        tab.classList.toggle("tab-activo", activa);

        if (activa) {
            tab.setAttribute("aria-current", "page");
        } else {
            tab.removeAttribute("aria-current");
        }

    });

    $("#tituloVista").textContent = TITULOS[nombre] || "";

    if (nombre === "estadisticas") {
        pintarGrafica();
    }

    window.scrollTo(0, 0);

}


/* =========================================================
   TABLÓN DE ANUNCIOS
========================================================= */

const CLAVE_ANUNCIOS_VISTOS = "fdj-anuncios-vistos";
const ANUNCIOS_VISIBLES = 3;

const ICONOS_ANUNCIO = {
    info: "bi-info-circle-fill",
    importante: "bi-exclamation-circle-fill",
    urgente: "bi-exclamation-triangle-fill"
};

const ETIQUETAS_TIPO_ANUNCIO = {
    info: "Información",
    importante: "Importante",
    urgente: "Urgente"
};

let tablonExpandido = false;


function leerAnunciosVistos() {

    try {
        return JSON.parse(localStorage.getItem(CLAVE_ANUNCIOS_VISTOS) || "[]");
    } catch (error) {
        return [];
    }

}


function guardarAnuncioVisto(id) {

    try {
        const vistos = leerAnunciosVistos();

        if (!vistos.includes(id)) {
            vistos.push(id);
            localStorage.setItem(CLAVE_ANUNCIOS_VISTOS, JSON.stringify(vistos.slice(-100)));
        }
    } catch (error) {
        /* Sin almacenamiento: el anuncio simplemente volverá a salir. */
    }

}


/* Anuncios visibles: primero los fijados, luego los más nuevos. */
function leerAnuncios() {

    const filas = ((estado.datos && estado.datos.anuncios) || []).slice(1);

    const lista = filas
        .filter((f) => f[0] && String(f[6]).trim() === "✓")
        .map((f, orden) => ({
            id: String(f[0]),
            fecha: String(f[1] || ""),
            titulo: String(f[2] || ""),
            mensaje: String(f[3] || ""),
            tipo: ICONOS_ANUNCIO[f[4]] ? f[4] : "info",
            fijado: String(f[5]).trim() === "✓",
            orden
        }));

    /* Los que se pueden descartar y ya se descartaron, fuera. */
    const vistos = leerAnunciosVistos();

    return lista
        .filter((a) => a.fijado || a.tipo === "urgente" || !vistos.includes(a.id))
        .sort((a, b) => (Number(b.fijado) - Number(a.fijado)) || (b.orden - a.orden));

}


function pintarTablon() {

    const caja = $("#tablon");
    const anuncios = leerAnuncios();

    if (!anuncios.length) {
        caja.hidden = true;
        caja.innerHTML = "";
        return;
    }

    const mostrados = tablonExpandido ? anuncios : anuncios.slice(0, ANUNCIOS_VISIBLES);
    const restantes = anuncios.length - ANUNCIOS_VISIBLES;

    caja.hidden = false;

    caja.innerHTML = `
        <div class="tablon-cabecera">
            <i class="bi bi-megaphone-fill"></i>
            <h2>Tablón de anuncios</h2>
        </div>

        ${mostrados.map(tarjetaAnuncio).join("")}

        ${restantes > 0 ? `
            <button type="button" class="tablon-mas" data-mas>
                ${tablonExpandido ? "Ver menos" : `Ver ${restantes} más`}
                <i class="bi bi-chevron-${tablonExpandido ? "up" : "down"}"></i>
            </button>
        ` : ""}
    `;

}


function tarjetaAnuncio(a) {

    const descartable = !a.fijado && a.tipo !== "urgente";
    const dia = a.fecha.split(" ")[0];

    return `
        <article class="anuncio anuncio-${a.tipo}">

            <i class="bi ${ICONOS_ANUNCIO[a.tipo]} anuncio-icono" aria-hidden="true"></i>

            <div class="anuncio-cuerpo">

                <div class="anuncio-meta">
                    <span class="anuncio-tipo">${ETIQUETAS_TIPO_ANUNCIO[a.tipo]}</span>
                    ${a.fijado ? '<span class="anuncio-fijado"><i class="bi bi-pin-angle-fill"></i> Fijado</span>' : ""}
                    ${dia ? `<span class="anuncio-fecha">${escapar(dia)}</span>` : ""}
                </div>

                ${a.titulo ? `<h3 class="anuncio-titulo">${escapar(a.titulo)}</h3>` : ""}
                ${a.mensaje ? `<p class="anuncio-texto">${escapar(a.mensaje)}</p>` : ""}

            </div>

            ${descartable ? `
                <button type="button"
                        class="anuncio-cerrar"
                        data-cerrar="${escapar(a.id)}"
                        aria-label="Ocultar este anuncio">
                    <i class="bi bi-x-lg"></i>
                </button>
            ` : ""}

        </article>
    `;

}


function montarTablon() {

    $("#tablon").addEventListener("click", (evento) => {

        const cerrar = evento.target.closest("[data-cerrar]");

        if (cerrar) {
            guardarAnuncioVisto(cerrar.dataset.cerrar);
            pintarTablon();
            return;
        }

        if (evento.target.closest("[data-mas]")) {
            tablonExpandido = !tablonExpandido;
            pintarTablon();
        }

    });

}


/* =========================================================
   ESTADÍSTICAS
========================================================= */

const MAX_RESALTADOS = 4;

estado.statsSel = [];
estado.statsIdx = null;
estado.stats = null;


function leerPosicion(valor) {

    const n = parseInt(String(valor === undefined || valor === null ? "" : valor).replace(/[^\d]/g, ""), 10);

    return n > 0 ? n : 0;

}


/*
 * Calcula todo a partir de la hoja "Jornadas":
 * puntos acumulados, puesto tras cada jornada, medias, rachas…
 * Devuelve null si todavía no se ha jugado ninguna jornada.
 */
function calcularEstadisticas() {

    const filas = (estado.datos && estado.datos.jornadas) || [];

    if (filas.length < 2) {
        return null;
    }

    const cabecera = filas[0];
    const columnas = [];

    for (let c = 1; c < cabecera.length; c++) {
        const nombre = String(cabecera[c] || "").trim();
        if (nombre) {
            columnas.push({ nombre, col: c });
        }
    }

    const N = columnas.length;

    if (N < 2) {
        return null;
    }

    const jugadas = [];

    for (let r = 1; r < filas.length; r++) {

        const fila = filas[r];
        const numero = parseInt(String(fila[0]).replace(/[^\d]/g, ""), 10);
        const pos = columnas.map((c) => leerPosicion(fila[c.col]));

        if (numero && pos.some((p) => p > 0)) {
            jugadas.push({ numero, pos });
        }

    }

    if (!jugadas.length) {
        return null;
    }

    const jugadores = columnas.map((c) => ({
        nombre: c.nombre,
        puntos: 0,
        acumulado: [],
        puestos: [],
        victorias: 0,
        ultimos: 0,
        posiciones: [],
        mediaPos: 0,
        regularidad: 0
    }));

    const victoriasAcum = jugadores.map(() => 0);

    jugadas.forEach((j, k) => {

        jugadores.forEach((p, i) => {

            const pos = j.pos[i];

            if (pos >= 1 && pos <= N) {
                p.puntos += N - pos + 1;
                p.posiciones.push(pos);
                if (pos === 1) { p.victorias++; victoriasAcum[i]++; }
                if (pos === N) { p.ultimos++; }
            }

            p.acumulado.push(p.puntos);

        });

        /* Puesto tras esta jornada: puntos, luego victorias, luego nombre. */
        const orden = jugadores
            .map((p, i) => ({ i, puntos: p.acumulado[k], vic: victoriasAcum[i] }))
            .sort((a, b) => (b.puntos - a.puntos) || (b.vic - a.vic) || (a.i - b.i));

        orden.forEach((o, lugar) => jugadores[o.i].puestos.push(lugar + 1));

    });

    jugadores.forEach((p) => {

        const n = p.posiciones.length;

        if (n) {
            p.mediaPos = p.posiciones.reduce((a, b) => a + b, 0) / n;
            p.regularidad = Math.sqrt(
                p.posiciones.reduce((a, b) => a + Math.pow(b - p.mediaPos, 2), 0) / n
            );
        }

    });

    const ultima = jugadas.length - 1;

    jugadores.forEach((p) => {
        p.puesto = p.puestos[ultima];
        p.cambio = ultima > 0 ? p.puestos[ultima - 1] - p.puestos[ultima] : 0;
    });

    const clasificacion = jugadores.slice().sort((a, b) => a.puesto - b.puesto);

    return {
        N,
        jugadas,
        jugadores,
        clasificacion,
        numeros: jugadas.map((j) => j.numero)
    };

}


function pintarEstadisticas() {

    const stats = calcularEstadisticas();
    estado.stats = stats;

    const vacio = $("#statsVacio");
    const contenido = $("#statsContenido");

    if (!stats) {

        vacio.hidden = false;
        vacio.innerHTML = plantillaVacio(
            "bi-bar-chart-line",
            "Aún no hay estadísticas",
            "Aparecerán en cuanto se registre la primera jornada."
        );
        contenido.hidden = true;
        return;

    }

    vacio.hidden = true;
    contenido.hidden = false;

    /* Selección inicial (o si cambian los jugadores): los 3 primeros. */
    const nombres = stats.jugadores.map((p) => p.nombre);

    estado.statsSel = estado.statsSel.filter((n) => nombres.includes(n));

    if (!estado.statsSel.length) {
        estado.statsSel = stats.clasificacion.slice(0, 3).map((p) => p.nombre);
    }

    if (estado.statsIdx === null || estado.statsIdx >= stats.jugadas.length) {
        estado.statsIdx = stats.jugadas.length - 1;
    }

    pintarClasificacion(stats);
    pintarChipsGrafica();
    pintarGrafica();
    pintarStatsExtra(stats);

}


function decimal(n) {

    return n.toLocaleString("es-ES", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

}


function pintarClasificacion(stats) {

    $("#listaClasificacion").innerHTML = stats.clasificacion.map((p) => {

        const cambio = p.cambio > 0
            ? `<span class="cambio cambio-sube"><i class="bi bi-caret-up-fill"></i>${p.cambio}</span>`
            : p.cambio < 0
                ? `<span class="cambio cambio-baja"><i class="bi bi-caret-down-fill"></i>${-p.cambio}</span>`
                : `<span class="cambio cambio-igual">=</span>`;

        const detalle = [
            "media " + (p.posiciones.length ? decimal(p.mediaPos) + "º" : "—"),
            p.victorias + (p.victorias === 1 ? " victoria" : " victorias")
        ].join(" · ");

        return `
            <div class="fila fila-clasif">

                <span class="puesto puesto-${p.puesto <= 3 ? p.puesto : "x"}">${p.puesto}</span>

                ${avatar(p.nombre)}

                <span class="fila-datos">
                    <span class="fila-nombre">${escapar(p.nombre)}</span>
                    <span class="fila-sub">${detalle}</span>
                </span>

                <span class="fila-cifra">
                    <span class="fila-importe">${p.puntos} pts</span>
                    ${cambio}
                </span>

            </div>
        `;

    }).join("");

}


function colorSerie(nombre) {

    const i = estado.statsSel.indexOf(nombre);

    return i === -1 ? null : "var(--serie-" + (i + 1) + ")";

}


function pintarChipsGrafica() {

    if (!estado.stats) {
        return;
    }

    $("#graficaChips").innerHTML = estado.stats.clasificacion.map((p) => {

        const color = colorSerie(p.nombre);

        return `
            <button type="button"
                    class="grafica-chip ${color ? "grafica-chip-on" : ""}"
                    data-serie="${escapar(p.nombre)}"
                    aria-pressed="${color ? "true" : "false"}">
                <span class="grafica-punto" style="${color ? "background:" + color : ""}"></span>
                ${escapar(p.nombre)}
            </button>
        `;

    }).join("");

}


function montarEstadisticas() {

    $("#graficaChips").addEventListener("click", (evento) => {

        const boton = evento.target.closest("[data-serie]");

        if (!boton) {
            return;
        }

        const nombre = boton.dataset.serie;
        const sel = estado.statsSel;
        const pos = sel.indexOf(nombre);

        if (pos !== -1) {
            if (sel.length > 1) {
                sel.splice(pos, 1);
            }
        } else {
            sel.push(nombre);
            if (sel.length > MAX_RESALTADOS) {
                sel.shift();
            }
        }

        pintarChipsGrafica();
        pintarGrafica();

    });

    const lienzo = $("#graficaLienzo");

    const mover = (evento) => {

        if (!estado.stats || !lienzo.dataset.x0) {
            return;
        }

        const caja = lienzo.getBoundingClientRect();
        const x0 = parseFloat(lienzo.dataset.x0);
        const paso = parseFloat(lienzo.dataset.paso);
        const n = estado.stats.jugadas.length;

        let idx = n === 1 ? 0 : Math.round((evento.clientX - caja.left - x0) / paso);
        idx = Math.max(0, Math.min(n - 1, idx));

        if (idx !== estado.statsIdx) {
            estado.statsIdx = idx;
            pintarGrafica();
        }

    };

    lienzo.addEventListener("pointerdown", mover);
    lienzo.addEventListener("pointermove", mover);

    /* Redibujar si cambia el ancho (girar el móvil, redimensionar). */
    let anterior = 0;

    window.addEventListener("resize", () => {

        const ancho = lienzo.clientWidth;

        if (ancho && ancho !== anterior) {
            anterior = ancho;
            pintarGrafica();
        }

    });

}


/*
 * Gráfica de evolución: puesto (1 arriba) tras cada jornada.
 * SVG a mano, al ancho real del contenedor, para que el texto
 * se vea igual de grande en cualquier pantalla.
 */
function pintarGrafica() {

    const stats = estado.stats;
    const lienzo = $("#graficaLienzo");

    if (!stats) {
        return;
    }

    const ancho = Math.floor(lienzo.clientWidth);

    if (!ancho) {
        return;   /* La pestaña está oculta: se dibuja al abrirla. */
    }

    const N = stats.N;
    const n = stats.jugadas.length;

    const mi = 30, md = 14, ms = 14, mb = 26;
    const alto = Math.max(230, Math.min(420, N * 24 + ms + mb));
    const x0 = mi;
    const anchoUtil = ancho - mi - md;
    const paso = n > 1 ? anchoUtil / (n - 1) : 0;
    const dy = (alto - ms - mb) / (N - 1);

    const X = (k) => n > 1 ? x0 + k * paso : x0 + anchoUtil / 2;
    const Y = (puesto) => ms + (puesto - 1) * dy;

    const partes = [];

    /* Rejilla y eje Y (puestos) */
    const saltoY = N > 12 ? 2 : 1;

    for (let r = 1; r <= N; r++) {

        if ((r - 1) % saltoY !== 0 && r !== N) {
            continue;
        }

        partes.push(`<line class="g-rejilla" x1="${x0}" x2="${ancho - md}" y1="${Y(r)}" y2="${Y(r)}"/>`);
        partes.push(`<text class="g-eje" x="${x0 - 8}" y="${Y(r) + 4}" text-anchor="end">${r}º</text>`);

    }

    /* Eje X (jornadas) */
    const minSep = 30;
    const saltoX = paso ? Math.max(1, Math.ceil(minSep / paso)) : 1;

    stats.numeros.forEach((num, k) => {

        if (k % saltoX !== 0 && k !== n - 1) {
            return;
        }

        /* Evita que la última etiqueta pise a la anterior. */
        if (k === n - 1 && k % saltoX !== 0 && paso && (k % saltoX) * paso < minSep) {
            return;
        }

        partes.push(`<text class="g-eje" x="${X(k)}" y="${alto - 8}" text-anchor="middle">${num}</text>`);

    });

    /* Línea vertical de la jornada seleccionada */
    const idx = estado.statsIdx;

    partes.push(`<line class="g-cursor" x1="${X(idx)}" x2="${X(idx)}" y1="${ms - 4}" y2="${alto - mb + 2}"/>`);

    const trazo = (p) => p.puestos
        .map((r, k) => (k ? "L" : "M") + X(k).toFixed(1) + " " + Y(r).toFixed(1))
        .join(" ");

    /* Primero los no resaltados (de fondo), luego los resaltados. */
    stats.jugadores
        .filter((p) => !estado.statsSel.includes(p.nombre))
        .forEach((p) => {
            partes.push(`<path class="g-linea-muda" d="${trazo(p)}"/>`);
        });

    estado.statsSel.forEach((nombre) => {

        const p = stats.jugadores.find((j) => j.nombre === nombre);

        if (!p) {
            return;
        }

        const color = colorSerie(nombre);

        partes.push(`<path class="g-linea" style="stroke:${color}" d="${trazo(p)}"/>`);

        /* Punto en la jornada seleccionada */
        partes.push(
            `<circle class="g-punto" style="fill:${color}" cx="${X(idx)}" cy="${Y(p.puestos[idx])}" r="5"/>`
        );

    });

    const resumenAria = "Gráfica de evolución de puestos. " + estado.statsSel.map((nombre) => {
        const p = stats.jugadores.find((j) => j.nombre === nombre);
        return p ? `${p.nombre} va ${p.puesto}º` : "";
    }).join(", ");

    lienzo.dataset.x0 = x0;
    lienzo.dataset.paso = paso;

    lienzo.innerHTML = `
        <svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="${escapar(resumenAria)}">
            ${partes.join("")}
        </svg>
    `;

    /* Lectura de la jornada seleccionada */
    const lectura = estado.statsSel.map((nombre) => {

        const p = stats.jugadores.find((j) => j.nombre === nombre);

        if (!p) {
            return "";
        }

        return `
            <span class="lectura-item">
                <span class="grafica-punto" style="background:${colorSerie(nombre)}"></span>
                <b>${escapar(p.nombre)}</b> ${p.puestos[idx]}º · ${p.acumulado[idx]} pts
            </span>
        `;

    }).join("");

    $("#graficaLectura").innerHTML =
        `<span class="lectura-jornada">Jornada ${stats.numeros[idx]}</span>${lectura}`;

}


function pintarStatsExtra(stats) {

    const { jugadores, jugadas } = stats;

    const mejorPor = (lista, clave, mayor = true) => {
        let mejor = null;
        lista.forEach((p) => {
            if (mejor === null || (mayor ? clave(p) > clave(mejor) : clave(p) < clave(mejor))) {
                mejor = p;
            }
        });
        return mejor;
    };

    const tarjetas = [];

    const lider = stats.clasificacion[0];

    tarjetas.push({
        icono: "bi-trophy-fill",
        etiqueta: "Líder",
        valor: lider.nombre,
        pie: lider.puntos + " puntos"
    });

    const masVic = mejorPor(jugadores, (p) => p.victorias);

    if (masVic.victorias > 0) {
        tarjetas.push({
            icono: "bi-award-fill",
            etiqueta: "Más victorias",
            valor: masVic.nombre,
            pie: masVic.victorias + (masVic.victorias === 1 ? " jornada ganada" : " jornadas ganadas")
        });
    }

    const masUlt = mejorPor(jugadores, (p) => p.ultimos);

    if (masUlt.ultimos > 0) {
        tarjetas.push({
            icono: "bi-emoji-frown-fill",
            etiqueta: "Más veces último",
            valor: masUlt.nombre,
            pie: masUlt.ultimos + (masUlt.ultimos === 1 ? " vez último" : " veces último")
        });
    }

    const conDatos = jugadores.filter((p) => p.posiciones.length);

    if (conDatos.length) {

        const mejorMedia = mejorPor(conDatos, (p) => p.mediaPos, false);

        tarjetas.push({
            icono: "bi-graph-up-arrow",
            etiqueta: "Mejor media",
            valor: mejorMedia.nombre,
            pie: "puesto medio " + decimal(mejorMedia.mediaPos) + "º"
        });

        if (jugadas.length >= 3) {

            const regular = mejorPor(conDatos, (p) => p.regularidad, false);

            tarjetas.push({
                icono: "bi-bullseye",
                etiqueta: "Más regular",
                valor: regular.nombre,
                pie: "variación de " + decimal(regular.regularidad) + " puestos"
            });

        }

    }

    const sube = mejorPor(jugadores, (p) => p.cambio);

    if (sube.cambio > 0) {
        tarjetas.push({
            icono: "bi-rocket-takeoff-fill",
            etiqueta: "Mayor subida",
            valor: sube.nombre,
            pie: "+" + sube.cambio + " puestos en la última jornada"
        });
    }

    /* Mejor racha: jornadas seguidas entre los 3 primeros. */
    let rachaMax = 0;
    let rachaDe = null;

    jugadores.forEach((p) => {

        let actual = 0;

        jugadas.forEach((j, k) => {

            const pos = j.pos[jugadores.indexOf(p)];

            actual = pos >= 1 && pos <= 3 ? actual + 1 : 0;

            if (actual > rachaMax) {
                rachaMax = actual;
                rachaDe = p;
            }

        });

    });

    if (rachaMax >= 2) {
        tarjetas.push({
            icono: "bi-fire",
            etiqueta: "Mejor racha",
            valor: rachaDe.nombre,
            pie: rachaMax + " jornadas seguidas en el podio"
        });
    }

    $("#statsExtra").innerHTML = tarjetas.map((t) => `
        <article class="dato dato-stat">
            <span class="dato-etiqueta"><i class="bi ${t.icono}"></i> ${t.etiqueta}</span>
            <strong class="dato-valor dato-valor-texto">${escapar(t.valor)}</strong>
            <span class="dato-pie">${escapar(t.pie)}</span>
        </article>
    `).join("");

}


/* =========================================================
   BUSCADOR Y ORDEN
========================================================= */

function montarBuscador() {

    const campo = $("#buscadorJugadores");
    const limpiar = $("#limpiarBusqueda");

    campo.addEventListener("input", () => {

        estado.busqueda = campo.value;
        limpiar.hidden = campo.value === "";

        pintarJugadores();

    });

    limpiar.addEventListener("click", () => {

        campo.value = "";
        estado.busqueda = "";
        limpiar.hidden = true;

        pintarJugadores();
        campo.focus();

    });

}


function montarOrden() {

    $$("#chipsOrden .chip").forEach((chip) => {

        chip.addEventListener("click", () => {

            estado.orden = chip.dataset.orden;

            $$("#chipsOrden .chip").forEach((c) =>
                c.classList.toggle("chip-activo", c === chip)
            );

            chip.scrollIntoView({
                behavior: "smooth",
                inline: "center",
                block: "nearest"
            });

            pintarJugadores();

        });

    });

}


/* =========================================================
   TIRAR PARA ACTUALIZAR
========================================================= */

function montarTirarParaActualizar() {

    const indicador = $("#ptr");

    let inicioY = 0;
    let tirando = false;
    let distancia = 0;

    const UMBRAL = 70;

    document.addEventListener("touchstart", (evento) => {

        if (window.scrollY > 0 || evento.touches.length !== 1) {
            return;
        }

        inicioY = evento.touches[0].clientY;
        tirando = true;

    }, { passive: true });


    document.addEventListener("touchmove", (evento) => {

        if (!tirando) {
            return;
        }

        distancia = evento.touches[0].clientY - inicioY;

        if (distancia <= 0) {
            indicador.style.height = "0px";
            return;
        }

        /* Resistencia: cuanto más tiras, menos se mueve. */
        const altura = Math.min(distancia * 0.45, 90);

        indicador.style.height = altura + "px";
        indicador.classList.toggle("listo", distancia > UMBRAL);

    }, { passive: true });


    document.addEventListener("touchend", () => {

        if (!tirando) {
            return;
        }

        tirando = false;

        if (distancia > UMBRAL) {

            indicador.classList.add("cargando");
            indicador.style.height = "48px";

            cargarDatos(true).finally(() => {
                indicador.classList.remove("cargando", "listo");
                indicador.style.height = "0px";
            });

        } else {

            indicador.classList.remove("listo");
            indicador.style.height = "0px";

        }

        distancia = 0;

    });

}


/* =========================================================
   AVATARES
========================================================= */

function iniciales(nombre) {

    if (!nombre) {
        return "?";
    }

    const partes = String(nombre).trim().split(/\s+/);

    if (partes.length === 1) {
        return partes[0].substring(0, 2).toUpperCase();
    }

    return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();

}


function rutaFoto(nombre, indice) {
    return CARPETA_FOTOS + encodeURIComponent(nombre) + "." + EXTENSIONES_FOTO[indice];
}


function avatar(nombre, grande = false) {

    return `
        <span class="avatar ${grande ? "avatar-l" : ""}">
            ${iniciales(nombre)}
            <img src="${rutaFoto(nombre, 0)}"
                 alt=""
                 loading="lazy"
                 decoding="async"
                 data-nombre="${escapar(nombre)}"
                 data-intento="0"
                 onerror="siguienteFoto(this)">
        </span>
    `;

}


/* Prueba la siguiente extensión; si no hay ninguna, deja las iniciales. */
function siguienteFoto(img) {

    const intento = parseInt(img.dataset.intento, 10) + 1;

    if (intento < EXTENSIONES_FOTO.length) {
        img.dataset.intento = intento;
        img.src = rutaFoto(img.dataset.nombre, intento);
        return;
    }

    img.remove();

}

window.siguienteFoto = siguienteFoto;


/* =========================================================
   UTILIDADES
========================================================= */

const formateador = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});


function euros(valor) {

    const numero = Number(valor) || 0;

    /* Sin decimales si son cero: queda más limpio en móvil. */
    if (Number.isInteger(numero)) {
        return numero.toLocaleString("es-ES") + " €";
    }

    return formateador.format(numero);

}


function aNumero(valor) {

    if (valor === null || valor === undefined || valor === "") {
        return 0;
    }

    if (typeof valor === "number") {
        return valor;
    }

    let texto = String(valor)
        .replace(/[€\s]/g, "")
        .replace(/\./g, "")
        .replace(",", ".");

    const numero = parseFloat(texto);

    return isNaN(numero) ? 0 : numero;

}


function normalizar(texto) {

    return String(texto)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

}


function escapar(texto) {

    return String(texto === null || texto === undefined ? "" : texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}


function plantillaVacio(icono, titulo, texto) {

    return `
        <div class="vacio">
            <i class="bi ${icono}"></i>
            <h3>${titulo}</h3>
            <p>${texto}</p>
        </div>
    `;

}


/* Contador animado para las cifras grandes */
function animarEuros(selector, valorFinal) {

    const elemento = $(selector);

    if (!elemento) {
        return;
    }

    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducido) {
        elemento.textContent = euros(valorFinal);
        return;
    }

    const inicio = performance.now();
    const duracion = 650;

    function paso(ahora) {

        const avance = Math.min((ahora - inicio) / duracion, 1);
        const suave = 1 - Math.pow(1 - avance, 3);

        elemento.textContent = euros(valorFinal * suave);

        if (avance < 1) {
            requestAnimationFrame(paso);
        }

    }

    requestAnimationFrame(paso);

}


function marcarConexion(texto, tipo) {

    const elemento = $("#estadoConexion");

    elemento.className = "conexion conexion-" + tipo;
    $("#estadoConexionTexto").textContent = texto;

}


function mostrarUltimaActualizacion(fecha, esCache) {

    const hora = new Date(fecha).toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit"
    });

    $("#ultimaActualizacion").textContent = esCache
        ? "Guardado a las " + hora
        : "Actualizado a las " + hora;

}


function pintarErrorInicial() {

    const error = plantillaVacio(
        "bi-cloud-slash",
        "No se pudieron cargar los datos",
        "Revisa tu conexión y vuelve a intentarlo."
    );

    $("#listaMorosos").innerHTML = error;
    $("#listaJugadores").innerHTML = error;

}


let temporizadorAviso;

function avisar(texto) {

    const aviso = $("#aviso");

    aviso.textContent = texto;
    aviso.hidden = false;

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => {
        aviso.hidden = true;
    }, 2600);

}


/* =========================================================
   SERVICE WORKER (funcionamiento sin conexión)
========================================================= */

function registrarServiceWorker() {

    if (!("serviceWorker" in navigator)) {
        return;
    }

    /* Solo funciona sobre HTTPS, como en GitHub Pages. */
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
        return;
    }

    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("sw.js")
            .catch((error) => console.warn("Service worker no registrado:", error));
    });

}