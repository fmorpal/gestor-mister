/* =========================================================
   CONFIGURACIÓN
========================================================= */

const API_URL = "https://script.google.com/macros/s/AKfycbzte3EJt98RjQY_nvQLFyKyNy0jxoDc81rOCtesUT233-q5XoFnhLOd7-rhnnOvIVnc/exec";

/*
 * Carpeta donde se buscan las fotos de los jugadores.
 *
 * El archivo debe llamarse exactamente igual que el
 * jugador en Google Sheets, por ejemplo:
 *
 * jugadores/Juan Pérez.jpg
 * jugadores/Ana.png
 *
 * Si no existe ninguna foto para ese nombre (o falla la
 * carga), se muestra automáticamente un círculo con sus
 * iniciales en su lugar.
 */
const CARPETA_FOTOS_JUGADORES = "jugadores/";
const EXTENSIONES_FOTO = ["jpg", "jpeg", "png", "webp"];


/* =========================================================
   VARIABLES GLOBALES
========================================================= */

let datosLiga = null;

let jornadaActiva = null;

let ordenJugadores = {
    campo: "totalPagado",
    direccion: "desc"
};


/* =========================================================
   INICIO
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    cargarDatos();

});


/* =========================================================
   CARGAR DATOS DE GOOGLE SHEETS
========================================================= */

/*
 * Realiza hasta 3 intentos para conectar con la API.
 *
 * Intento 1 → inmediato
 * Si falla → espera 1 segundo
 * Intento 2 → espera 2 segundos si vuelve a fallar
 * Intento 3 → si falla, devuelve el error.
 */

async function obtenerDatosConReintentos(url, intentos = 3) {

    for (let intento = 1; intento <= intentos; intento++) {

        try {

            console.log(
                `Intento de conexión ${intento}/${intentos}...`
            );

            const respuesta = await fetch(url);

            if (!respuesta.ok) {

                throw new Error(
                    "No se pudo conectar con la API. Código HTTP: " +
                    respuesta.status
                );

            }

            const datos = await respuesta.json();

            console.log(
                `Conexión realizada correctamente en el intento ${intento}.`
            );

            return datos;

        } catch (error) {

            console.error(
                `Error en el intento ${intento}:`,
                error
            );

            if (intento === intentos) {

                throw error;

            }

            /*
             * Esperamos:
             * intento 1 → 1 segundo
             * intento 2 → 2 segundos
             */

            await new Promise(resolve => {

                setTimeout(
                    resolve,
                    intento * 1000
                );

            });

        }

    }

}


/* =========================================================
   CARGAR DATOS DE GOOGLE SHEETS
========================================================= */

async function cargarDatos() {

    actualizarEstadoConexion(
        "Cargando...",
        "loading"
    );

    try {

        datosLiga =
            await obtenerDatosConReintentos(
                API_URL
            );

        console.log(
            "Datos recibidos:",
            datosLiga
        );

        procesarDatos();

        actualizarEstadoConexion(
            "Conectado",
            "online"
        );

        const ultimaActualizacion =
            document.getElementById(
                "ultimaActualizacion"
            );

        if (ultimaActualizacion) {

            ultimaActualizacion.textContent =
                "Actualizado: " +
                obtenerHoraActual();

        }

    } catch (error) {

        console.error(
            "Error definitivo de conexión:",
            error
        );

        actualizarEstadoConexion(
            "Error de conexión",
            "error"
        );

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

    const resumen =
        datosLiga.resumen;

    if (
        !resumen ||
        resumen.length === 0
    ) {
        return;
    }

    /*
     * En nuestra hoja:
     *
     * fila 0 → vacía
     * fila 1 → título
     * fila 2 → cabeceras
     * filas 3-10 → jugadores
     * fila TOTAL → totales
     */

    const filaTotal =
        resumen.find(
            fila => fila[0] === "TOTAL"
        );

    if (filaTotal) {

        animarImporte(
            "dineroTotal",
            limpiarCantidad(filaTotal[1])
        );

        animarImporte(
            "dineroActual",
            limpiarCantidad(filaTotal[2])
        );

        animarImporte(
            "dineroPendiente",
            limpiarCantidad(filaTotal[3])
        );

    }

    /*
     * Calculamos cuántas jornadas tienen datos.
     */

    const jornadas =
        datosLiga.jornadas || [];

    let jornadasCompletadas = 0;

    jornadas.slice(1).forEach(
        fila => {

            const numeroJornada =
                fila[0];

            if (!numeroJornada) {
                return;
            }

            const tieneDatos =
                fila
                    .slice(1)
                    .some(
                        valor => valor !== ""
                    );

            if (tieneDatos) {
                jornadasCompletadas++;
            }

        }
    );

    animarContadorEntero(
        "jornadasCompletadas",
        jornadasCompletadas,
        " / 38"
    );

}


/* =========================================================
   TABLA DE JUGADORES
========================================================= */

function cargarJugadores() {

    const resumen =
        datosLiga.resumen;

    if (
        !resumen ||
        resumen.length === 0
    ) {
        return;
    }

    const tabla =
        document.getElementById(
            "tablaJugadores"
        );

    if (!tabla) {
        return;
    }

    /*
     * Buscamos la fila donde están las cabeceras.
     */

    const indiceCabeceras =
        resumen.findIndex(
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
     * Creamos el control de ordenación.
     */

    crearControlOrdenacion();

    /*
     * Guardamos los jugadores en objetos para poder
     * ordenarlos fácilmente.
     */

    const jugadores = [];

    for (
        let i = indiceCabeceras + 1;
        i < resumen.length;
        i++
    ) {

        const jugador =
            resumen[i];

        if (
            !jugador[0] ||
            jugador[0] === "TOTAL"
        ) {
            continue;
        }

        const nombre =
            jugador[0];

        const totalDebe =
            limpiarCantidad(
                jugador[1]
            );

        const totalPagado =
            limpiarCantidad(
                jugador[2]
            );

        const pendiente =
            limpiarCantidad(
                jugador[3]
            );

        const jornadasPagadas =
            jugador[4] || "0";

        const jornadasPendientes =
            jugador[5] || "0";

        const saldo =
            limpiarCantidad(
                jugador[7]
            );

        /*
         * Columna I de Resumen = Multas
         */

        const multas =
            limpiarCantidad(
                jugador[8]
            );

        jugadores.push({

            nombre,

            totalDebe,

            totalPagado,

            pendiente,

            jornadasPagadas,

            jornadasPendientes,

            saldo,

            multas

        });

    }

    /*
     * Ordenamos según la opción seleccionada.
     */

    jugadores.sort(
        compararJugadores
    );

    /*
     * Limpiamos la tabla antes de volver a pintarla.
     */

    tabla.innerHTML = "";

    /*
     * Creamos las filas.
     */

    jugadores.forEach(
        (jugador, indice) => {

            const nombre =
                jugador.nombre;

            const totalDebe =
                jugador.totalDebe;

            const totalPagado =
                jugador.totalPagado;

            const pendiente =
                jugador.pendiente;

            const jornadasPagadas =
                jugador.jornadasPagadas;

            const jornadasPendientes =
                jugador.jornadasPendientes;

            const saldo =
                jugador.saldo;

            const multas =
                jugador.multas;

            const fila =
                document.createElement(
                    "tr"
                );


            /* =================================================
               ESTADO DEL JUGADOR
            ================================================= */

            let estado;

            let claseEstado;

            let iconoEstado;


            if (
                parseFloat(
                    pendiente.replace(
                        ",",
                        "."
                    )
                ) === 0
            ) {

                estado = "Al día";

                claseEstado = "paid";

                iconoEstado =
                    "bi-check-circle-fill";

            } else if (
                parseFloat(
                    totalPagado.replace(
                        ",",
                        "."
                    )
                ) > 0
            ) {

                estado = "Pendiente";

                claseEstado = "partial";

                iconoEstado =
                    "bi-exclamation-circle-fill";

            } else {

                estado = "Sin pagar";

                claseEstado = "pending";

                iconoEstado =
                    "bi-x-circle-fill";

            }


            /* =================================================
               CONTENIDO DE LA FILA
            ================================================= */

            fila.innerHTML = `

                <td>

                    <div class="player-name">

                        ${crearAvatarHTML(nombre)}

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
                        parseFloat(
                            pendiente.replace(
                                ",",
                                "."
                            )
                        ) > 0
                            ? "amount-negative"
                            : "amount-positive"
                    }">

                        ${pendiente} €

                    </span>

                </td>


                <td>

                    <strong>

                        ${jornadasPagadas}

                    </strong>

                    <span class="text-muted">

                        / ${jornadasPendientes}

                    </span>

                </td>


                <td>

                    <span class="amount ${
                        parseFloat(
                            saldo.replace(
                                ",",
                                "."
                            )
                        ) > 0
                            ? "amount-positive"
                            : "amount-neutral"
                    }">

                        ${saldo} €

                    </span>

                </td>


                <!-- MULTAS -->

                <td>

                    <span class="amount ${
                        parseFloat(
                            multas.replace(
                                ",",
                                "."
                            )
                        ) > 0
                            ? "amount-negative"
                            : "amount-neutral"
                    }">

                        ${multas} €

                    </span>

                </td>


                <!-- ESTADO -->

                <td>

                    <span class="status-badge ${claseEstado}">

                        <i class="bi ${iconoEstado}"></i>

                        ${estado}

                    </span>

                </td>

            `;


            /*
             * Entrada escalonada.
             */

            fila.style.animationDelay =
                `${indice * 55}ms`;


            tabla.appendChild(
                fila
            );

        }
    );

}


/* =========================================================
   CONTROL DE ORDENACIÓN
========================================================= */

function crearControlOrdenacion() {

    const tabla =
        document.getElementById(
            "tablaJugadores"
        );

    if (!tabla) {
        return;
    }

    /*
     * Evitamos crear el control varias veces.
     */

    if (
        document.getElementById(
            "controlOrdenJugadores"
        )
    ) {

        actualizarControlOrdenacion();

        return;

    }

    /*
     * Contenedor principal.
     */

    const contenedor =
        document.createElement(
            "div"
        );

    contenedor.id =
        "controlOrdenJugadores";

    contenedor.className =
        "control-orden-jugadores";


    /*
     * Etiqueta.
     */

    const etiqueta =
        document.createElement(
            "label"
        );

    etiqueta.setAttribute(
        "for",
        "ordenJugadores"
    );

    etiqueta.innerHTML =
        '<i class="bi bi-sort-down"></i> Ordenar por';


    /*
     * Select.
     */

    const select =
        document.createElement(
            "select"
        );

    select.id =
        "ordenJugadores";

    select.className =
        "form-select";


    const opciones = [

        {
            valor: "nombre",
            texto: "Jugador"
        },

        {
            valor: "totalDebe",
            texto: "Total que debe"
        },

        {
            valor: "totalPagado",
            texto: "Total pagado"
        },

        {
            valor: "pendiente",
            texto: "Pendiente"
        },

        {
            valor: "jornadasPagadas",
            texto: "Jornadas pagadas"
        },

        {
            valor: "saldo",
            texto: "Saldo"
        },

        {
            valor: "multas",
            texto: "Multas"
        }

    ];


    opciones.forEach(
        opcion => {

            const option =
                document.createElement(
                    "option"
                );

            option.value =
                opcion.valor;

            option.textContent =
                opcion.texto;

            if (
                opcion.valor ===
                ordenJugadores.campo
            ) {

                option.selected =
                    true;

            }

            select.appendChild(
                option
            );

        }
    );


    /*
     * Botón de dirección.
     */

    const boton =
        document.createElement(
            "button"
        );

    boton.type = "button";

    boton.id =
        "direccionOrdenJugadores";

    boton.className =
        "btn btn-outline-secondary";

    boton.title =
        "Cambiar orden";


    /*
     * Cambio de campo.
     */

    select.addEventListener(
        "change",
        () => {

            ordenJugadores.campo =
                select.value;

            /*
             * Para nombre usamos ascendente
             * por defecto.
             */

            if (
                ordenJugadores.campo ===
                "nombre"
            ) {

                ordenJugadores.direccion =
                    "asc";

            } else {

                ordenJugadores.direccion =
                    "desc";

            }

            actualizarIconoOrdenacion();

            cargarJugadores();

        }
    );


    /*
     * Cambio de dirección.
     */

    boton.addEventListener(
        "click",
        () => {

            ordenJugadores.direccion =
                ordenJugadores.direccion ===
                "asc"
                    ? "desc"
                    : "asc";

            actualizarIconoOrdenacion();

            cargarJugadores();

        }
    );


    contenedor.appendChild(
        etiqueta
    );

    contenedor.appendChild(
        select
    );

    contenedor.appendChild(
        boton
    );


    /*
     * IMPORTANTE:
     *
     * tablaJugadores normalmente es un <tbody>.
     *
     * NO debemos meter un <div> dentro de la tabla.
     *
     * Buscamos la tabla HTML y colocamos el control
     * justo antes de ella.
     */

    const tablaHTML =
        tabla.closest("table");

    if (
        tablaHTML &&
        tablaHTML.parentElement
    ) {

        tablaHTML.parentElement.insertBefore(
            contenedor,
            tablaHTML
        );

    } else {

        /*
         * Fallback por si la tabla no tiene
         * un padre válido.
         */

        tabla.parentElement.insertBefore(
            contenedor,
            tabla
        );

    }


    actualizarIconoOrdenacion();

}


/* =========================================================
   ACTUALIZAR CONTROL DE ORDENACIÓN
========================================================= */

function actualizarControlOrdenacion() {

    const select =
        document.getElementById(
            "ordenJugadores"
        );

    if (select) {

        select.value =
            ordenJugadores.campo;

    }

    actualizarIconoOrdenacion();

}


/* =========================================================
   ICONO DE ORDENACIÓN
========================================================= */

function actualizarIconoOrdenacion() {

    const boton =
        document.getElementById(
            "direccionOrdenJugadores"
        );

    if (!boton) {
        return;
    }

    if (
        ordenJugadores.direccion ===
        "asc"
    ) {

        boton.innerHTML =
            '<i class="bi bi-sort-up"></i>';

        boton.title =
            "Orden ascendente";

    } else {

        boton.innerHTML =
            '<i class="bi bi-sort-down"></i>';

        boton.title =
            "Orden descendente";

    }

}


/* =========================================================
   COMPARAR JUGADORES
========================================================= */

function compararJugadores(
    a,
    b
) {

    const campo =
        ordenJugadores.campo;

    const direccion =
        ordenJugadores.direccion ===
        "asc"
            ? 1
            : -1;


    /*
     * Ordenar por nombre.
     */

    if (campo === "nombre") {

        return (
            a.nombre.localeCompare(
                b.nombre,
                "es",
                {
                    sensitivity: "base"
                }
            ) * direccion
        );

    }


    /*
     * Convertimos valores numéricos.
     */

    let valorA = 0;

    let valorB = 0;


    if (
        campo === "totalDebe"
    ) {

        valorA =
            convertirNumero(
                a.totalDebe
            );

        valorB =
            convertirNumero(
                b.totalDebe
            );

    } else if (
        campo === "totalPagado"
    ) {

        valorA =
            convertirNumero(
                a.totalPagado
            );

        valorB =
            convertirNumero(
                b.totalPagado
            );

    } else if (
        campo === "pendiente"
    ) {

        valorA =
            convertirNumero(
                a.pendiente
            );

        valorB =
            convertirNumero(
                b.pendiente
            );

    } else if (
        campo === "jornadasPagadas"
    ) {

        valorA =
            convertirNumero(
                a.jornadasPagadas
            );

        valorB =
            convertirNumero(
                b.jornadasPagadas
            );

    } else if (
        campo === "saldo"
    ) {

        valorA =
            convertirNumero(
                a.saldo
            );

        valorB =
            convertirNumero(
                b.saldo
            );

    } else if (
        campo === "multas"
    ) {

        valorA =
            convertirNumero(
                a.multas
            );

        valorB =
            convertirNumero(
                b.multas
            );

    }


    return (
        (valorA - valorB) *
        direccion
    );

}


/* =========================================================
   CONVERTIR A NÚMERO
========================================================= */

function convertirNumero(
    valor
) {

    if (
        valor === null ||
        valor === undefined
    ) {

        return 0;

    }


    let texto =
        String(valor)
            .replace("€", "")
            .replace(/\s/g, "")
            .trim();


    if (!texto) {
        return 0;
    }


    texto = texto
        .replace(/\./g, "")
        .replace(",", ".");


    const numero =
        parseFloat(texto);


    return isNaN(numero)
        ? 0
        : numero;

}


/* =========================================================
   SELECTOR DE JORNADAS
========================================================= */

function cargarSelectorJornadas() {

    const selector =
        document.getElementById(
            "selectorJornada"
        );

    const jornadas =
        datosLiga.jornadas || [];


    if (!selector) {
        return;
    }


    selector.innerHTML = "";


    jornadas.slice(1).forEach(
        fila => {

            const numero =
                fila[0];

            if (!numero) {
                return;
            }


            const ficha =
                document.createElement(
                    "button"
                );

            ficha.type = "button";

            ficha.className =
                "jornada-pill";

            ficha.textContent =
                numero;

            ficha.dataset.jornada =
                numero;

            ficha.setAttribute(
                "role",
                "tab"
            );

            ficha.setAttribute(
                "aria-selected",
                "false"
            );

            selector.appendChild(
                ficha
            );

        }
    );


    /*
     * Usamos onclick para evitar que cada
     * actualización de 5 minutos añada
     * otro listener.
     */

    selector.onclick = evento => {

        const ficha =
            evento.target.closest(
                ".jornada-pill"
            );

        if (!ficha) {
            return;
        }

        seleccionarJornada(
            ficha.dataset.jornada
        );

    };


    /*
     * Recuperamos la jornada activa si existía.
     */

    if (jornadaActiva) {

        const fichaActiva =
            selector.querySelector(
                `[data-jornada="${jornadaActiva}"]`
            );

        if (fichaActiva) {

            fichaActiva.classList.add(
                "activa"
            );

            fichaActiva.setAttribute(
                "aria-selected",
                "true"
            );

        }

    }

}


/* =========================================================
   SELECCIONAR JORNADA
========================================================= */

function seleccionarJornada(
    numeroJornada
) {

    jornadaActiva =
        numeroJornada;


    /*
     * Marcamos visualmente la ficha activa.
     */

    document
        .querySelectorAll(
            ".jornada-pill"
        )
        .forEach(
            ficha => {

                const esActiva =
                    ficha.dataset.jornada ===
                    String(
                        numeroJornada
                    );


                ficha.classList.toggle(
                    "activa",
                    esActiva
                );


                ficha.setAttribute(
                    "aria-selected",
                    esActiva
                        ? "true"
                        : "false"
                );


                if (esActiva) {

                    ficha.scrollIntoView({

                        behavior: "smooth",

                        inline: "center",

                        block: "nearest"

                    });

                }

            }
        );


    mostrarJornada(
        numeroJornada
    );

}


/* =========================================================
   MOSTRAR JORNADA
========================================================= */

function mostrarJornada(
    jornadaSeleccionada
) {

    const contenedor =
        document.getElementById(
            "jornadaInfo"
        );

    const detalle =
        document.getElementById(
            "detalleJornada"
        );

    const tabla =
        document.getElementById(
            "tablaJornada"
        );


    if (
        !contenedor ||
        !detalle ||
        !tabla
    ) {

        return;

    }


    if (!jornadaSeleccionada) {

        detalle.classList.add(
            "d-none"
        );


        contenedor.innerHTML = `

            <div class="empty-state">

                <i class="bi bi-calendar3"></i>

                <h3>
                    Selecciona una jornada
                </h3>

                <p>
                    Selecciona una jornada para consultar
                    quién ha pagado y cuánto debía pagar.
                </p>

            </div>

        `;

        return;

    }


    /*
     * Buscamos la jornada en las hojas.
     */

    const pagos =
        buscarJornada(
            datosLiga.pagosPorJornada,
            jornadaSeleccionada
        );

    const control =
        buscarJornada(
            datosLiga.controlPagos,
            jornadaSeleccionada
        );

    const posiciones =
        buscarJornada(
            datosLiga.jornadas,
            jornadaSeleccionada
        );


    if (!pagos) {

        detalle.classList.add(
            "d-none"
        );


        contenedor.innerHTML = `

            <div class="empty-state">

                <i class="bi bi-calendar-x"></i>

                <h3>
                    Jornada sin datos
                </h3>

                <p>
                    Todavía no hay información disponible
                    para la jornada ${escaparHTML(
                        jornadaSeleccionada
                    )}.
                </p>

            </div>

        `;

        return;

    }


    /*
     * La primera fila contiene los nombres.
     */

    const nombres =
        datosLiga.jornadas[0];


    tabla.innerHTML = "";


    /*
     * =====================================================
     * CREAMOS LA LISTA DE JUGADORES
     * =====================================================
     */

    const jugadoresJornada = [];


    for (
        let i = 1;
        i < pagos.length;
        i++
    ) {

        const nombre =
            nombres[i];

        if (!nombre) {
            continue;
        }


        const cantidad =
            pagos[i] || "0 €";


        const posicion =
            posiciones
                ? posiciones[i]
                : "-";


        const haPagado =
            control &&
            control[i] === "✓";


        const posicionNumero =
            parseInt(
                String(posicion).replace(
                    /[^\d]/g,
                    ""
                ),
                10
            );


        jugadoresJornada.push({

            nombre,

            cantidad,

            posicion,

            posicionNumero:
                isNaN(
                    posicionNumero
                )
                    ? 999
                    : posicionNumero,

            haPagado

        });

    }


    /*
     * =====================================================
     * ORDENAR POR POSICIÓN
     * =====================================================
     */

    jugadoresJornada.sort(
        (a, b) =>
            a.posicionNumero -
            b.posicionNumero
    );


    /*
     * =====================================================
     * CREAMOS LAS FILAS
     * =====================================================
     */

    jugadoresJornada.forEach(
        (
            jugador,
            indice
        ) => {

            const {
                nombre,
                cantidad,
                posicion,
                haPagado
            } = jugador;


            const fila =
                document.createElement(
                    "tr"
                );


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

                        ${crearAvatarHTML(nombre)}

                        <span>

                            ${escaparHTML(nombre)}

                        </span>

                    </div>

                </td>


                <td>

                    <strong>

                        ${posicion || "-"}

                    </strong>

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


            /*
             * Animación escalonada.
             */

            fila.style.animationDelay =
                `${indice * 55}ms`;


            tabla.appendChild(
                fila
            );

        }
    );


    /*
     * =====================================================
     * INFORMACIÓN SUPERIOR DE LA JORNADA
     * =====================================================
     */

    const totalJugadores =
        nombres.length - 1;


    let jugadoresPagados = 0;


    if (control) {

        for (
            let i = 1;
            i < control.length;
            i++
        ) {

            if (
                control[i] === "✓"
            ) {

                jugadoresPagados++;

            }

        }

    }


    contenedor.innerHTML = `

        <div class="p-4">

            <div class="
                d-flex
                flex-wrap
                justify-content-between
                align-items-center
                gap-3
            ">

                <div>

                    <span class="section-subtitle">
                        Jornada
                    </span>

                    <h3 class="mb-0">

                        Jornada
                        ${escaparHTML(
                            jornadaSeleccionada
                        )}

                    </h3>

                </div>


                <span class="status-badge ${
                    jugadoresPagados ===
                    totalJugadores
                        ? "paid"
                        : "partial"
                }">

                    <i class="bi ${
                        jugadoresPagados ===
                        totalJugadores
                            ? "bi-check-circle-fill"
                            : "bi-clock-fill"
                    }"></i>

                    ${jugadoresPagados}
                    /
                    ${totalJugadores}
                    pagados

                </span>

            </div>

        </div>

    `;


    detalle.classList.remove(
        "d-none"
    );

}


/* =========================================================
   BUSCAR JORNADA
========================================================= */

function buscarJornada(
    datos,
    numeroJornada
) {

    if (!datos) {
        return null;
    }


    return datos.find(
        fila =>
            String(fila[0]) ===
            String(numeroJornada)
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
        document.getElementById(
            "estadoConexion"
        );


    if (!elemento) {
        return;
    }


    let icono =
        "bi-arrow-repeat";


    if (
        estado === "online"
    ) {

        icono =
            "bi-cloud-check-fill";

    }


    if (
        estado === "error"
    ) {

        icono =
            "bi-cloud-slash";

    }


    elemento.classList.remove(

        "status-loading",

        "status-online",

        "status-error"

    );


    elemento.classList.add(
        `status-${estado}`
    );


    elemento.innerHTML = `

        <i class="bi ${icono}"></i>

        ${escaparHTML(texto)}

    `;

}


/* =========================================================
   ERROR DE CONEXIÓN
========================================================= */

function mostrarError() {

    const tabla =
        document.getElementById(
            "tablaJugadores"
        );


    if (!tabla) {
        return;
    }


    tabla.innerHTML = `

        <tr>

            <td
                colspan="8"
                class="loading-cell"
            >

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

            <td
                colspan="8"
                class="loading-cell"
            >

                ${escaparHTML(mensaje)}

            </td>

        </tr>

    `;

}


/* =========================================================
   LIMPIAR CANTIDADES
========================================================= */

function limpiarCantidad(
    valor
) {

    if (
        valor === null ||
        valor === undefined
    ) {

        return "0,00";

    }


    let texto =
        String(valor)
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


    const numero =
        parseFloat(texto);


    if (isNaN(numero)) {

        return "0,00";

    }


    return numero
        .toFixed(2)
        .replace(".", ",");

}


/* =========================================================
   INICIALES
========================================================= */

function obtenerIniciales(
    nombre
) {

    if (!nombre) {
        return "?";
    }


    const partes =
        nombre
            .trim()
            .split(/\s+/);


    if (
        partes.length === 1
    ) {

        return partes[0]
            .substring(0, 2)
            .toUpperCase();

    }


    return (

        partes[0][0] +

        partes[
            partes.length - 1
        ][0]

    ).toUpperCase();

}


/* =========================================================
   FOTOS DE JUGADORES
========================================================= */

/*
 * Genera la ruta a la foto de un jugador probando,
 * por orden, las extensiones definidas en
 * EXTENSIONES_FOTO.
 */

function rutaFotoJugador(
    nombre,
    indiceExtension
) {

    const extension =
        EXTENSIONES_FOTO[
            indiceExtension
        ];


    return (

        CARPETA_FOTOS_JUGADORES +

        encodeURIComponent(
            nombre
        ) +

        "." +

        extension

    );

}


/* =========================================================
   AVATAR DE JUGADOR
========================================================= */

/*
 * Construye el círculo con la foto del jugador.
 *
 * Si el navegador no consigue cargarla porque no existe
 * ese archivo o no existe con esa extensión,
 * gestionarErrorFoto() prueba la siguiente extensión.
 *
 * Si ninguna funciona, se quedan visibles las iniciales.
 */

function crearAvatarHTML(
    nombre
) {

    const iniciales =
        obtenerIniciales(
            nombre
        );


    const nombreEscapado =
        escaparHTML(
            nombre
        );


    return `

        <span class="player-avatar">

            ${iniciales}

            <img
                src="${rutaFotoJugador(
                    nombre,
                    0
                )}"
                alt=""
                loading="lazy"
                data-nombre="${nombreEscapado}"
                data-intento="0"
                onerror="gestionarErrorFoto(this)"
            >

        </span>

    `;

}


/* =========================================================
   ERROR DE FOTO
========================================================= */

function gestionarErrorFoto(
    img
) {

    const siguienteIntento =
        parseInt(
            img.dataset.intento,
            10
        ) + 1;


    /*
     * Todavía quedan extensiones por probar.
     */

    if (
        siguienteIntento <
        EXTENSIONES_FOTO.length
    ) {

        img.dataset.intento =
            siguienteIntento;


        img.src =
            rutaFotoJugador(
                img.dataset.nombre,
                siguienteIntento
            );


        return;

    }


    /*
     * No hay foto para este jugador:
     * ocultamos la imagen y se quedan visibles
     * las iniciales de fondo.
     */

    img.style.display =
        "none";

}


/* =========================================================
   SEGURIDAD HTML
========================================================= */

function escaparHTML(
    texto
) {

    const div =
        document.createElement(
            "div"
        );


    div.textContent =
        texto === null ||
        texto === undefined
            ? ""
            : String(texto);


    return div.innerHTML;

}


/* =========================================================
   HORA ACTUAL
========================================================= */

function obtenerHoraActual() {

    const ahora =
        new Date();


    return ahora.toLocaleTimeString(
        "es-ES",
        {
            hour: "2-digit",
            minute: "2-digit"
        }
    );

}


/* =========================================================
   ANIMACIÓN DE MARCADOR
   CONTEO DE IMPORTES
========================================================= */

function animarImporte(
    idElemento,
    valorFinalTexto
) {

    const elemento =
        document.getElementById(
            idElemento
        );


    if (!elemento) {
        return;
    }


    const valorFinal =
        parseFloat(
            valorFinalTexto.replace(
                ",",
                "."
            )
        ) || 0;


    const valorInicial =
        0;


    const duracion =
        700;


    const inicio =
        performance.now();


    function paso(
        ahora
    ) {

        const progreso =
            Math.min(
                (ahora - inicio) /
                duracion,
                1
            );


        const facilitado =
            1 -
            Math.pow(
                1 - progreso,
                3
            );


        const valorActual =
            valorInicial +
            (
                valorFinal -
                valorInicial
            ) *
            facilitado;


        elemento.textContent =
            valorActual
                .toFixed(2)
                .replace(
                    ".",
                    ","
                ) +
            " €";


        if (
            progreso < 1
        ) {

            requestAnimationFrame(
                paso
            );

        }

    }


    requestAnimationFrame(
        paso
    );

}


/* =========================================================
   ANIMACIÓN DE MARCADOR
   CONTEO DE ENTEROS
========================================================= */

function animarContadorEntero(
    idElemento,
    valorFinal,
    sufijo
) {

    const elemento =
        document.getElementById(
            idElemento
        );


    if (!elemento) {
        return;
    }


    const duracion =
        700;


    const inicio =
        performance.now();


    function paso(
        ahora
    ) {

        const progreso =
            Math.min(
                (ahora - inicio) /
                duracion,
                1
            );


        const facilitado =
            1 -
            Math.pow(
                1 - progreso,
                3
            );


        const valorActual =
            Math.round(
                valorFinal *
                facilitado
            );


        elemento.textContent =
            `${valorActual}${sufijo}`;


        if (
            progreso < 1
        ) {

            requestAnimationFrame(
                paso
            );

        }

    }


    requestAnimationFrame(
        paso
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
