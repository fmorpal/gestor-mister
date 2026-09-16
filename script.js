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
    "https://script.google.com/macros/s/AKfycbzte3EJt98RjQY_nvQLFyKyNy0jxoDc81rOCtesUT233-q5XoFnhLOd7-rhnnOvIVnc/exec";

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

        jugadores.push({
            nombre: String(fila[0]).trim(),
            totalDebe,
            totalPagado,
            pendiente,
            jornadasPagadas: aNumero(fila[4]),
            jornadasPendientes: aNumero(fila[5]),
            saldo: aNumero(fila[7]),
            multas: aNumero(fila[8]),
            progreso: totalDebe > 0
                ? Math.max(0, Math.min(1, totalPagado / totalDebe))
                : 1
        });

    }

    return jugadores;

}


function leerTotales() {

    const resumen = (estado.datos && estado.datos.resumen) || [];
    const fila = resumen.find((f) => f[0] === "TOTAL");

    if (!fila) {
        return { total: 0, cobrado: 0, pendiente: 0 };
    }

    return {
        total: aNumero(fila[1]),
        cobrado: aNumero(fila[2]),
        pendiente: aNumero(fila[3])
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
    pintarJugadores();
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
    const multas = jugadores.reduce((suma, j) => suma + j.multas, 0);
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
                <span>Multas</span>
                <strong class="${jugador.multas > 0 ? "importe-deuda" : ""}">
                    ${euros(jugador.multas)}
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

        </div>
    `;

    $("#sheetFondo").hidden = false;
    $("#sheet").hidden = false;

    document.body.style.overflow = "hidden";

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
    jornadas: "Jornadas"
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

    window.scrollTo(0, 0);

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