/* =========================================================
CONFIGURACIÓN
========================================================= */

const API_URL = "https://script.google.com/macros/s/AKfycbzte3EJt98RjQY_nvQLFyKyNy0jxoDc81rOCtesUT233-q5XoFnhLOd7-rhnnOvIVnc/exec";

/* =========================================================
VARIABLES GLOBALES
========================================================= */

let datosLiga = null;

/* =========================================================
INICIO
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
cargarDatos();
});

/* =========================================================
CARGAR DATOS DE GOOGLE SHEETS
========================================================= */

async function cargarDatos() {

 
actualizarEstadoConexion("Cargando...", "loading");

try {

    const respuesta = await fetch(API_URL);

    if (!respuesta.ok) {
        throw new Error("No se pudo conectar con la API");
    }

    datosLiga = await respuesta.json();

    console.log("Datos recibidos:", datosLiga);

    procesarDatos();

    actualizarEstadoConexion("Conectado", "online");

    document.getElementById("ultimaActualizacion").textContent =
        "Actualizado: " + obtenerHoraActual();

} catch (error) {

    console.error("Error:", error);

    actualizarEstadoConexion("Error de conexión", "error");

    mostrarError();

}
 

}

/* =========================================================
PROCESAR DATOS
========================================================= */

function procesarDatos() {

 
if (!datosLiga) {
    return;
}

cargarResumen();
cargarJugadores();
cargarSelectorJornadas();
 

}

/* =========================================================
RESUMEN GENERAL
========================================================= */

function cargarResumen() {

 
const resumen = datosLiga.resumen;

if (!resumen || resumen.length === 0) {
    return;
}

/*
 * En nuestra hoja:
 *
 * fila 0 → vacía
 * fila 1 → título
 * fila 2 → cabeceras
 * filas 3-10 → jugadores
 * fila 13 → TOTAL
 */

const filaTotal = resumen.find(
    fila => fila[0] === "TOTAL"
);

if (filaTotal) {

    document.getElementById("dineroTotal").textContent =
        limpiarCantidad(filaTotal[1]) + " €";

    document.getElementById("dineroActual").textContent =
        limpiarCantidad(filaTotal[2]) + " €";

    document.getElementById("dineroPendiente").textContent =
        limpiarCantidad(filaTotal[3]) + " €";
}


/*
 * Calculamos cuántas jornadas tienen datos.
 */

const jornadas = datosLiga.jornadas || [];

let jornadasCompletadas = 0;

jornadas.slice(1).forEach(fila => {

    const numeroJornada = fila[0];

    if (!numeroJornada) {
        return;
    }

    const tieneDatos = fila
        .slice(1)
        .some(valor => valor !== "");

    if (tieneDatos) {
        jornadasCompletadas++;
    }

});

document.getElementById("jornadasCompletadas").textContent =
    `${jornadasCompletadas} / 38`;
 

}

/* =========================================================
TABLA DE JUGADORES
========================================================= */

function cargarJugadores() {

 
const resumen = datosLiga.resumen;

if (!resumen || resumen.length === 0) {
    return;
}

const tabla = document.getElementById("tablaJugadores");

tabla.innerHTML = "";


/*
 * Buscamos la fila donde están las cabeceras.
 */

const indiceCabeceras = resumen.findIndex(
    fila => fila[0] === "Jugador"
);

if (indiceCabeceras === -1) {
    mostrarMensajeTabla(
        tabla,
        "No se encontraron los datos de jugadores."
    );

    return;
}


/*
 * Los jugadores están después de las cabeceras
 * hasta encontrar una fila vacía o TOTAL.
 */

for (
    let i = indiceCabeceras + 1;
    i < resumen.length;
    i++
) {

    const jugador = resumen[i];

    if (!jugador[0] || jugador[0] === "TOTAL") {
        continue;
    }

    const nombre = jugador[0];

    const totalDebe = limpiarCantidad(jugador[1]);
    const totalPagado = limpiarCantidad(jugador[2]);
    const pendiente = limpiarCantidad(jugador[3]);

    const jornadasPagadas = jugador[4] || "0";
    const jornadasPendientes = jugador[5] || "0";

    const saldo = limpiarCantidad(jugador[7]);


    const fila = document.createElement("tr");


    /*
     * Estado del jugador
     */

    let estado;
    let claseEstado;
    let iconoEstado;

    if (parseFloat(pendiente) === 0) {

        estado = "Al día";
        claseEstado = "paid";
        iconoEstado = "bi-check-circle-fill";

    } else if (parseFloat(totalPagado) > 0) {

        estado = "Pendiente";
        claseEstado = "partial";
        iconoEstado = "bi-exclamation-circle-fill";

    } else {

        estado = "Sin pagar";
        claseEstado = "pending";
        iconoEstado = "bi-x-circle-fill";
    }


    /*
     * Iniciales del jugador
     */

    const iniciales = obtenerIniciales(nombre);


    fila.innerHTML = `
        <td>
            <div class="player-name">
                <span class="player-avatar">
                    ${iniciales}
                </span>

                <span>
                    ${escaparHTML(nombre)}
                </span>
            </div>
        </td>

        <td>
            <span class="amount">
                ${totalDebe} €
            </span>
        </td>

        <td>
            <span class="amount amount-positive">
                ${totalPagado} €
            </span>
        </td>

        <td>
            <span class="amount ${
                parseFloat(pendiente) > 0
                    ? "amount-negative"
                    : "amount-positive"
            }">
                ${pendiente} €
            </span>
        </td>

        <td>
            <strong>${jornadasPagadas}</strong>
            <span class="text-muted">
                / ${jornadasPendientes}
            </span>
        </td>

        <td>
            <span class="amount ${
                parseFloat(saldo) > 0
                    ? "amount-positive"
                    : "amount-neutral"
            }">
                ${saldo} €
            </span>
        </td>

        <td>
            <span class="status-badge ${claseEstado}">
                <i class="bi ${iconoEstado}"></i>
                ${estado}
            </span>
        </td>
    `;


    tabla.appendChild(fila);
}
 

}

/* =========================================================
SELECTOR DE JORNADAS
========================================================= */

function cargarSelectorJornadas() {

 
const selector = document.getElementById("selectorJornada");

const jornadas = datosLiga.jornadas || [];

selector.innerHTML = `
    <option value="">
        Seleccionar jornada
    </option>
`;


jornadas.slice(1).forEach(fila => {

    const numero = fila[0];

    if (!numero) {
        return;
    }

    const opcion = document.createElement("option");

    opcion.value = numero;
    opcion.textContent = `Jornada ${numero}`;

    selector.appendChild(opcion);
});


selector.addEventListener(
    "change",
    mostrarJornada
);
 

}

/* =========================================================
MOSTRAR JORNADA
========================================================= */

function mostrarJornada(evento) {

 
const jornadaSeleccionada = evento.target.value;

const contenedor = document.getElementById("jornadaInfo");
const detalle = document.getElementById("detalleJornada");
const tabla = document.getElementById("tablaJornada");


if (!jornadaSeleccionada) {

    detalle.classList.add("d-none");

    contenedor.innerHTML = `
        <div class="empty-state">

            <i class="bi bi-calendar3"></i>

            <h3>Selecciona una jornada</h3>

            <p>
                Selecciona una jornada para consultar
                quién ha pagado y cuánto debía pagar.
            </p>

        </div>
    `;

    return;
}


/*
 * Buscamos la jornada en las dos hojas.
 */

const pagos = buscarJornada(
    datosLiga.pagosPorJornada,
    jornadaSeleccionada
);

const control = buscarJornada(
    datosLiga.controlPagos,
    jornadaSeleccionada
);

const posiciones = buscarJornada(
    datosLiga.jornadas,
    jornadaSeleccionada
);


if (!pagos) {

    detalle.classList.add("d-none");

    contenedor.innerHTML = `
        <div class="empty-state">

            <i class="bi bi-calendar-x"></i>

            <h3>Jornada sin datos</h3>

            <p>
                Todavía no hay información disponible
                para la jornada ${jornadaSeleccionada}.
            </p>

        </div>
    `;

    return;
}


/*
 * La primera fila contiene los nombres.
 */

const nombres = datosLiga.jornadas[0];

tabla.innerHTML = "";


/*
 * Creamos una fila por jugador.
 */

for (let i = 1; i < pagos.length; i++) {

    const nombre = nombres[i];

    if (!nombre) {
        continue;
    }

    const cantidad = pagos[i] || "0 €";

    const posicion = posiciones
        ? posiciones[i]
        : "-";

    const haPagado =
        control &&
        control[i] === "✓";


    const fila = document.createElement("tr");


    let estadoHTML;

    if (haPagado) {

        estadoHTML = `
            <span class="status-badge paid">
                <i class="bi bi-check-circle-fill"></i>
                Pagado
            </span>
        `;

    } else {

        estadoHTML = `
            <span class="status-badge pending">
                <i class="bi bi-x-circle-fill"></i>
                Pendiente
            </span>
        `;
    }


    fila.innerHTML = `
        <td>
            <div class="player-name">

                <span class="player-avatar">
                    ${obtenerIniciales(nombre)}
                </span>

                <span>
                    ${escaparHTML(nombre)}
                </span>

            </div>
        </td>

        <td>
            <strong>${posicion || "-"}</strong>
        </td>

        <td>
            <span class="amount">
                ${escaparHTML(cantidad)}
            </span>
        </td>

        <td>
            ${haPagado ? "Sí" : "No"}
        </td>

        <td>
            ${estadoHTML}
        </td>
    `;

    tabla.appendChild(fila);
}


/*
 * Información superior de la jornada.
 */

const totalJugadores = nombres.length - 1;

let jugadoresPagados = 0;

if (control) {

    for (let i = 1; i < control.length; i++) {

        if (control[i] === "✓") {
            jugadoresPagados++;
        }

    }
}


contenedor.innerHTML = `
    <div class="p-4">

        <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">

            <div>
                <span class="section-subtitle">
                    JORNADA
                </span>

                <h3 class="mb-0">
                    Jornada ${jornadaSeleccionada}
                </h3>
            </div>

            <span class="status-badge ${
                jugadoresPagados === totalJugadores
                    ? "paid"
                    : "partial"
            }">

                <i class="bi ${
                    jugadoresPagados === totalJugadores
                        ? "bi-check-circle-fill"
                        : "bi-clock-fill"
                }"></i>

                ${jugadoresPagados} / ${totalJugadores} pagados

            </span>

        </div>

    </div>
`;


detalle.classList.remove("d-none");
 

}

/* =========================================================
BUSCAR JORNADA
========================================================= */

function buscarJornada(datos, numeroJornada) {

 
if (!datos) {
    return null;
}

return datos.find(
    fila => String(fila[0]) === String(numeroJornada)
);
 

}

/* =========================================================
ESTADO DE CONEXIÓN
========================================================= */

function actualizarEstadoConexion(
texto,
estado
) {

 
const elemento =
    document.getElementById("estadoConexion");

if (!elemento) {
    return;
}


let icono = "bi-arrow-repeat";

if (estado === "online") {
    icono = "bi-cloud-check-fill";
}

if (estado === "error") {
    icono = "bi-cloud-slash";
}


elemento.innerHTML = `
    <i class="bi ${icono}"></i>
    ${texto}
`;
 

}

/* =========================================================
ERROR DE CONEXIÓN
========================================================= */

function mostrarError() {

 
const tabla =
    document.getElementById("tablaJugadores");

tabla.innerHTML = `
    <tr>

        <td colspan="7" class="loading-cell">

            <i class="bi bi-exclamation-triangle"></i>

            No se pudieron cargar los datos.

            <br>

            <small>
                Comprueba la conexión con Google Sheets.
            </small>

        </td>

    </tr>
`;
 

}

/* =========================================================
MENSAJE TABLA
========================================================= */

function mostrarMensajeTabla(
tabla,
mensaje
) {

 
tabla.innerHTML = `
    <tr>
        <td colspan="7" class="loading-cell">
            ${escaparHTML(mensaje)}
        </td>
    </tr>
`;
 

}

/* =========================================================
LIMPIAR CANTIDADES
========================================================= */

function limpiarCantidad(valor) {

 
if (valor === null || valor === undefined) {
    return "0,00";
}

let texto = String(valor)
    .replace("€", "")
    .replace(/\s/g, "")
    .trim();

if (!texto) {
    return "0,00";
}

/*
 * Convertimos formato español:
 *
 * 1.234,56 → 1234.56
 * 12,00 → 12.00
 */

texto = texto
    .replace(/\./g, "")
    .replace(",", ".");

const numero = parseFloat(texto);

if (isNaN(numero)) {
    return "0,00";
}

return numero.toFixed(2).replace(".", ",");
 

}

/* =========================================================
INICIALES
========================================================= */

function obtenerIniciales(nombre) {

 
if (!nombre) {
    return "?";
}

const partes = nombre
    .trim()
    .split(/\s+/);

if (partes.length === 1) {
    return partes[0]
        .substring(0, 2)
        .toUpperCase();
}

return (
    partes[0][0] +
    partes[partes.length - 1][0]
).toUpperCase();
 

}

/* =========================================================
SEGURIDAD HTML
========================================================= */

function escaparHTML(texto) {

 
const div = document.createElement("div");

div.textContent =
    texto === null || texto === undefined
        ? ""
        : String(texto);

return div.innerHTML;
 

}

/* =========================================================
HORA ACTUAL
========================================================= */

function obtenerHoraActual() {

 
const ahora = new Date();

return ahora.toLocaleTimeString(
    "es-ES",
    {
        hour: "2-digit",
        minute: "2-digit"
    }
);
 

}

/* =========================================================
ACTUALIZACIÓN AUTOMÁTICA
========================================================= */

/*

* Actualizamos los datos cada 5 minutos.
*
* Así, si cambias Google Sheets,
* la web terminará reflejando los cambios
* automáticamente.
  */

setInterval(
cargarDatos,
5 * 60 * 1000
);
