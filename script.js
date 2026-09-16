/* =========================================================
   CONFIGURACIÓN
========================================================= */

const API_URL =
    "https://script.google.com/macros/s/AKfycbzte3EJt98RjQY_nvQLFyKyNy0jxoDc81rOCtesUT233-q5XoFnhLOd7-rhnnOvIVnc/exec";

const MAX_INTENTOS = 3;
const TIEMPO_ENTRE_INTENTOS = 2000;
const INTERVALO_ACTUALIZACION = 5 * 60 * 1000;


/* =========================================================
   VARIABLES GLOBALES
========================================================= */

let datosGlobales = null;
let jugadoresGlobales = [];
let jornadaSeleccionada = 0;
let ordenActual = "pendiente";
let cargando = false;


/* =========================================================
   INICIO
========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    cargarDatos();

    const selectorOrden = document.getElementById("ordenJugadores");

    if (selectorOrden) {
        selectorOrden.addEventListener("change", () => {
            ordenActual = selectorOrden.value;
            cargarJugadores();
        });
    }

    const selectorJornada = document.getElementById("selectorJornada");

    if (selectorJornada) {
        selectorJornada.addEventListener("change", () => {
            jornadaSeleccionada = parseInt(selectorJornada.value, 10) || 0;
            actualizarJornadaSeleccionada();
        });
    }

    setInterval(() => {
        cargarDatos(true);
    }, INTERVALO_ACTUALIZACION);
});


/* =========================================================
   CARGAR DATOS
========================================================= */

async function cargarDatos(actualizacionAutomatica = false) {

    if (cargando) return;

    cargando = true;

    if (!actualizacionAutomatica) {
        mostrarEstadoConexion("loading");
    }

    try {

        const datos = await obtenerDatosConReintentos();

        datosGlobales = datos;

        procesarDatos(datos);

        mostrarEstadoConexion("online");

    } catch (error) {

        console.error("Error cargando datos:", error);

        mostrarEstadoConexion("offline");

        mostrarError();

    } finally {

        cargando = false;

    }
}


/* =========================================================
   OBTENER DATOS CON REINTENTOS
========================================================= */

async function obtenerDatosConReintentos() {

    let ultimoError = null;

    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {

        try {

            const respuesta = await fetch(API_URL, {
                method: "GET",
                cache: "no-store"
            });

            if (!respuesta.ok) {
                throw new Error(
                    `Error HTTP ${respuesta.status}`
                );
            }

            const datos = await respuesta.json();

            return datos;

        } catch (error) {

            ultimoError = error;

            console.warn(
                `Intento ${intento} de ${MAX_INTENTOS} fallido`,
                error
            );

            if (intento < MAX_INTENTOS) {
                await esperar(TIEMPO_ENTRE_INTENTOS);
            }
        }
    }

    throw ultimoError;
}


/* =========================================================
   PROCESAR DATOS
========================================================= */

function procesarDatos(datos) {

    if (!datos) {
        throw new Error("No se recibieron datos.");
    }

    cargarResumen(datos);

    cargarJugadores(datos);

    cargarSelectorJornadas(datos);

    actualizarJornadaSeleccionada(datos);

    actualizarUltimaActualizacion();

}


/* =========================================================
   RESUMEN
========================================================= */

function cargarResumen(datos = datosGlobales) {

    if (!datos || !datos.resumen) return;

    const filas = datos.resumen;

    if (filas.length < 2) return;

    const cabeceras = filas[0];

    const indiceJugador = cabeceras.indexOf("Jugador");

    if (indiceJugador === -1) return;

    jugadoresGlobales = [];

    for (let i = 1; i < filas.length; i++) {

        const fila = filas[i];

        if (!fila[indiceJugador]) continue;

        const jugador = {};

        cabeceras.forEach((cabecera, index) => {
            jugador[cabecera] = fila[index];
        });

        jugadoresGlobales.push(jugador);
    }
}


/* =========================================================
   CARGAR JUGADORES
========================================================= */

function cargarJugadores(datos = datosGlobales) {

    const tbody = document.querySelector(
        ".players-table tbody"
    );

    if (!tbody) return;

    if (!datos || !datos.resumen || datos.resumen.length < 2) {

        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="loading-cell">
                    No hay datos disponibles.
                </td>
            </tr>
        `;

        return;
    }

    const filas = datos.resumen;

    const cabeceras = filas[0];

    const indiceJugador = cabeceras.indexOf("Jugador");
    const indiceDebe = cabeceras.indexOf("Total que debe");
    const indicePagado = cabeceras.indexOf("Total pagado");
    const indicePendiente = cabeceras.indexOf("Pendiente");
    const indiceJornadas = cabeceras.indexOf("Jornadas pagadas");
    const indicePendientes = cabeceras.indexOf("Jornadas pendientes");
    const indiceSaldo = cabeceras.indexOf("Saldo disponible");
    const indiceMultas = cabeceras.indexOf("Multas");

    if (indiceJugador === -1) {
        console.error(
            "No se encuentra la columna Jugador."
        );
        return;
    }

    const jugadores = [];

    for (let i = 1; i < filas.length; i++) {

        const filaDatos = filas[i];

        const nombre = filaDatos[indiceJugador];

        if (!nombre) continue;

        const totalDebe =
            convertirNumero(
                filaDatos[indiceDebe]
            ).toFixed(2).replace(".", ",");

        const totalPagado =
            convertirNumero(
                filaDatos[indicePagado]
            ).toFixed(2).replace(".", ",");

        const pendiente =
            convertirNumero(
                filaDatos[indicePendiente]
            ).toFixed(2).replace(".", ",");

        const jornadasPagadas =
            convertirNumero(
                filaDatos[indiceJornadas]
            );

        const jornadasPendientes =
            convertirNumero(
                filaDatos[indicePendientes]
            );

        const saldo =
            convertirNumero(
                filaDatos[indiceSaldo]
            ).toFixed(2).replace(".", ",");

        const multas =
            convertirNumero(
                filaDatos[indiceMultas]
            ).toFixed(2).replace(".", ",");


        /* =====================================================
           ESTADO DEL JUGADOR
        ===================================================== */

        let estado = "Al día";
        let claseEstado = "status-paid";
        let iconoEstado = "bi-check-circle-fill";

        const valorPendiente =
            convertirNumero(filaDatos[indicePendiente]);

        const valorMultas =
            convertirNumero(filaDatos[indiceMultas]);

        const valorSaldo =
            convertirNumero(filaDatos[indiceSaldo]);


        if (valorPendiente > 0) {

            estado = "Pendiente";
            claseEstado = "status-pending";
            iconoEstado = "bi-exclamation-circle-fill";

        } else if (valorMultas > 0) {

            estado = "Con multas";
            claseEstado = "status-warning";
            iconoEstado = "bi-exclamation-triangle-fill";

        } else if (valorSaldo > 0) {

            estado = "Con saldo";
            claseEstado = "status-paid";
            iconoEstado = "bi-wallet2";

        }


        jugadores.push({
            nombre,
            totalDebe,
            totalPagado,
            pendiente,
            jornadasPagadas,
            jornadasPendientes,
            saldo,
            multas,
            estado,
            claseEstado,
            iconoEstado
        });

    }


    /* =====================================================
       ORDENAR JUGADORES
    ===================================================== */

    jugadores.sort((a, b) => {

        switch (ordenActual) {

            case "nombre":
                return a.nombre.localeCompare(
                    b.nombre,
                    "es",
                    { sensitivity: "base" }
                );

            case "pendiente":
                return (
                    convertirNumero(b.pendiente) -
                    convertirNumero(a.pendiente)
                );

            case "pagado":
                return (
                    convertirNumero(b.totalPagado) -
                    convertirNumero(a.totalPagado)
                );

            case "saldo":
                return (
                    convertirNumero(b.saldo) -
                    convertirNumero(a.saldo)
                );

            case "multas":
                return (
                    convertirNumero(b.multas) -
                    convertirNumero(a.multas)
                );

            default:
                return 0;
        }

    });


    /* =====================================================
       GENERAR TABLA
    ===================================================== */

    tbody.innerHTML = "";


    jugadores.forEach(jugador => {

        const fila = document.createElement("tr");

        const {
            nombre,
            totalDebe,
            totalPagado,
            pendiente,
            jornadasPagadas,
            jornadasPendientes,
            saldo,
            multas,
            estado,
            claseEstado,
            iconoEstado
        } = jugador;


        fila.innerHTML = `

            <!-- JUGADOR -->
            <td>

                <div class="player-name">

                    ${crearAvatarHTML(nombre)}

                    <span>
                        ${escaparHTML(nombre)}
                    </span>

                </div>

            </td>


            <!-- TOTAL QUE DEBE -->
            <td>

                <span class="amount">
                    ${totalDebe} €
                </span>

            </td>


            <!-- TOTAL PAGADO -->
            <td>

                <span class="amount amount-positive">
                    ${totalPagado} €
                </span>

            </td>


            <!-- PENDIENTE -->
            <td>

                <span class="amount ${
                    convertirNumero(pendiente) > 0
                        ? "amount-negative"
                        : "amount-positive"
                }">

                    ${pendiente} €

                </span>

            </td>


            <!-- JORNADAS -->
            <td>

                <strong>
                    ${jornadasPagadas}
                </strong>

                <span class="text-muted">
                    / ${jornadasPendientes}
                </span>

            </td>


            <!-- SALDO -->
            <td>

                <span class="amount ${
                    convertirNumero(saldo) > 0
                        ? "amount-positive"
                        : "amount-neutral"
                }">

                    ${saldo} €

                </span>

            </td>


            <!-- MULTAS -->
            <td class="campo-multas">

                <span class="campo-label">
                    Multas
                </span>

                <span class="amount ${
                    convertirNumero(multas) > 0
                        ? "amount-negative"
                        : "amount-neutral"
                }">

                    ${multas} €

                </span>

            </td>


            <!-- ESTADO -->
            <td class="campo-estado">

                <span class="campo-label">
                    Estado
                </span>

                <span class="status-badge ${claseEstado}">

                    <i class="bi ${iconoEstado}"></i>

                    ${estado}

                </span>

            </td>

        `;

        tbody.appendChild(fila);

    });


    /* =====================================================
       ANIMACIÓN DE CANTIDADES
    ===================================================== */

    animarContadores();

}


/* =========================================================
   SELECTOR DE JORNADAS
========================================================= */

function cargarSelectorJornadas(datos = datosGlobales) {

    const selector =
        document.getElementById("selectorJornada");

    if (!selector) return;

    if (!datos || !datos.jornadas) return;

    const filas = datos.jornadas;

    if (filas.length < 2) return;

    const jornadasDisponibles = [];

    for (let i = 1; i < filas.length; i++) {

        const numero =
            parseInt(filas[i][0], 10);

        if (isNaN(numero)) continue;

        const posiciones =
            filas[i].slice(1);

        const hayDatos =
            posiciones.some(
                valor =>
                    valor !== "" &&
                    valor !== null
            );

        if (hayDatos) {
            jornadasDisponibles.push(numero);
        }
    }

    selector.innerHTML = "";

    if (jornadasDisponibles.length === 0) {

        const opcion =
            document.createElement("option");

        opcion.value = "0";
        opcion.textContent = "Sin jornadas";

        selector.appendChild(opcion);

        jornadaSeleccionada = 0;

        return;
    }


    jornadasDisponibles.forEach(numero => {

        const opcion =
            document.createElement("option");

        opcion.value = numero;
        opcion.textContent = `Jornada ${numero}`;

        selector.appendChild(opcion);

    });


    if (
        jornadaSeleccionada === 0 ||
        !jornadasDisponibles.includes(
            jornadaSeleccionada
        )
    ) {

        jornadaSeleccionada =
            jornadasDisponibles[
                jornadasDisponibles.length - 1
            ];

    }

    selector.value =
        jornadaSeleccionada;

}


/* =========================================================
   ACTUALIZAR JORNADA
========================================================= */

function actualizarJornadaSeleccionada(
    datos = datosGlobales
) {

    if (!datos || !datos.jornadas) return;

    const elemento =
        document.getElementById("jornadaActual");

    if (!elemento) return;

    if (!jornadaSeleccionada) {

        elemento.textContent =
            "Sin jornada seleccionada";

        return;
    }

    elemento.textContent =
        `Jornada ${jornadaSeleccionada}`;

}


/* =========================================================
   COMPARAR JUGADORES
========================================================= */

function compararJugadores() {

    if (!jugadoresGlobales.length) return;

    const jugadoresOrdenados =
        [...jugadoresGlobales].sort((a, b) => {

            return (
                convertirNumero(
                    b["Pendiente"]
                ) -
                convertirNumero(
                    a["Pendiente"]
                )
            );

        });

    return jugadoresOrdenados;
}


/* =========================================================
   CONVERTIR NÚMEROS
========================================================= */

function convertirNumero(valor) {

    if (
        valor === null ||
        valor === undefined ||
        valor === ""
    ) {
        return 0;
    }

    if (typeof valor === "number") {
        return valor;
    }

    let texto =
        String(valor)
            .trim()
            .replace("€", "")
            .replace(/\s/g, "");

    /*
       Si viene en formato español:
       1.234,56
    */

    if (
        texto.includes(".") &&
        texto.includes(",")
    ) {

        texto =
            texto.replace(/\./g, "")
                 .replace(",", ".");

    } else if (texto.includes(",")) {

        texto =
            texto.replace(",", ".");

    }

    const numero =
        parseFloat(texto);

    return isNaN(numero)
        ? 0
        : numero;
}


/* =========================================================
   CREAR AVATAR
========================================================= */

function crearAvatarHTML(nombre) {

    const nombreSeguro =
        escaparHTML(nombre);

    const archivo =
        nombre
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/\s+/g, "")
            .trim();

    const ruta =
        `jugadores/${archivo}.jpg`;

    const iniciales =
        obtenerIniciales(nombre);

    return `

        <img
            src="${ruta}"
            alt="${nombreSeguro}"
            class="player-avatar"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
        >

        <span
            class="player-avatar player-avatar-fallback"
            style="display:none;"
            aria-hidden="true"
        >
            ${iniciales}
        </span>

    `;
}


/* =========================================================
   OBTENER INICIALES
========================================================= */

function obtenerIniciales(nombre) {

    if (!nombre) return "?";

    const partes =
        nombre
            .trim()
            .split(/\s+/);

    if (partes.length === 1) {
        return partes[0]
            .substring(0, 2)
            .toUpperCase();
    }

    return (
        partes[0].charAt(0) +
        partes[partes.length - 1].charAt(0)
    ).toUpperCase();
}


/* =========================================================
   ESCAPAR HTML
========================================================= */

function escaparHTML(texto) {

    if (
        texto === null ||
        texto === undefined
    ) {
        return "";
    }

    return String(texto)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   ESTADO DE CONEXIÓN
========================================================= */

function mostrarEstadoConexion(estado) {

    const elemento =
        document.getElementById(
            "estadoConexion"
        );

    if (!elemento) return;


    if (estado === "loading") {

        elemento.innerHTML = `
            <i class="bi bi-arrow-repeat"></i>
            Conectando...
        `;

        elemento.className =
            "connection-status loading";

    } else if (estado === "online") {

        elemento.innerHTML = `
            <i class="bi bi-wifi"></i>
            Conectado
        `;

        elemento.className =
            "connection-status online";

    } else {

        elemento.innerHTML = `
            <i class="bi bi-wifi-off"></i>
            Sin conexión
        `;

        elemento.className =
            "connection-status offline";

    }

}


/* =========================================================
   MOSTRAR ERROR
========================================================= */

function mostrarError() {

    const tbody =
        document.querySelector(
            ".players-table tbody"
        );

    if (!tbody) return;

    if (
        datosGlobales &&
        datosGlobales.resumen
    ) {
        return;
    }

    tbody.innerHTML = `

        <tr>

            <td
                colspan="8"
                class="loading-cell"
            >

                <i class="bi bi-exclamation-triangle"></i>

                No se han podido cargar los datos.

            </td>

        </tr>

    `;

}


/* =========================================================
   ÚLTIMA ACTUALIZACIÓN
========================================================= */

function actualizarUltimaActualizacion() {

    const elemento =
        document.getElementById(
            "ultimaActualizacion"
        );

    if (!elemento) return;

    const ahora =
        new Date();

    elemento.textContent =
        `Actualizado a las ${ahora.toLocaleTimeString(
            "es-ES",
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        )}`;

}


/* =========================================================
   ANIMACIÓN DE CONTADORES
========================================================= */

function animarContadores() {

    const elementos =
        document.querySelectorAll(
            ".players-table .amount"
        );

    elementos.forEach(elemento => {

        elemento.classList.remove(
            "counter-updated"
        );

        void elemento.offsetWidth;

        elemento.classList.add(
            "counter-updated"
        );

    });

}


/* =========================================================
   ESPERAR
========================================================= */

function esperar(ms) {

    return new Promise(
        resolve => setTimeout(
            resolve,
            ms
        )
    );

}