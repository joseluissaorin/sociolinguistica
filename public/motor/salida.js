// Paquete de salida: la misma estructura en el ZIP de la web y en la carpeta de la CLI.
import { aFilas, escribirCSV, leerCSV, CABECERA } from "./csv.js";
import { whisperATexto } from "./proceso.js";

const enc = new TextEncoder();

// Resumen por ciudad y hablante: casos, tipos y valores ya rellenos de -d-.
function resumen(casos) {
  const grupos = new Map();
  for (const c of casos) {
    const k = `${c.ciudad}\u0000${c.clave}`;
    if (!grupos.has(k)) grupos.set(k, { Ciudad: c.ciudad, Hablante: c.clave, "Género": c.genero, Edad: c.edad, "Educación": c.educacion, Casos: 0, "Elisiones transcritas": 0, "Ultracorrecciones transcritas": 0, "Entre palabras": 0, "Con -d- decidida": 0 });
    const g = grupos.get(k);
    g.Casos++;
    if (c.tipo === "elisión escrita") g["Elisiones transcritas"]++;
    if (c.tipo === "ultracorrección escrita") g["Ultracorrecciones transcritas"]++;
    if (c.posicion === "entre palabras") g["Entre palabras"]++;
    if (c.d) g["Con -d- decidida"]++;
  }
  const filas = [...grupos.values()].sort((a, b) => (a.Ciudad + a.Hablante).localeCompare(b.Ciudad + b.Hablante));
  return escribirCSV(filas, filas.length ? Object.keys(filas[0]) : ["Ciudad"]);
}

export function incrustarEnEstudio(plantilla, casos, info) {
  const datos = JSON.stringify({ info, filas: aFilas(casos) }).replace(/<\//g, "<\\/");
  return plantilla.replace(/<script id="datos" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="datos" type="application/json">${datos}</script>`);
}

const LEEME = (info) => `Casos de -d- intervocálica · PRESEEA
Generado el ${info.generado} con ${info.herramienta}

casos.csv          Un caso por fila. Las nueve primeras columnas siguen la estructura del trabajo
                   (Hablante; Ciudad; Ejemplo; Forma; Lema; -d-; Género; Edad; Educación).
                   Separador: punto y coma. Codificación: UTF-8. Se abre bien en Excel y en Google Sheets.
descartados.csv    Posibles elisiones que Jev considera otra palabra (tos de toser, pues…). Revísalas.
estudio.html       Ábrelo con el navegador para escuchar cada caso y rellenar la columna -d-.
                   Lo que marques se guarda en el navegador; exporta el CSV al terminar.
Recortes/          Un MP3 por caso, con ${info.margen} s de margen a cada lado.
Whisper/           Transcripción automática con tiempos de cada audio (.txt legible y .json).
casos.json         Los mismos casos con todos sus datos internos (lo usa la categorización con Jev).
resumen.csv        Casos por hablante.

Opciones: d entre palabras ${info.opciones.frontera ? "sí" : "no"} · pasajes en otras lenguas ${info.opciones.otrasLenguas ? "sí" : "no"} · palabras extranjeras ${info.opciones.extranjero ? "sí" : "no"} · Jev ${info.jev ? "sí" : "no"}
Solo se incluyen los casos que caen dentro del audio: los MP3 abiertos del corpus duran unos diez minutos.

Datos de PRESEEA (https://preseea.uah.es), licencia CC BY-NC-ND 4.0.
`;

// entrevistas: [{ meta, casos, recortes, whisper, alineacion }]
// Devuelve un Map ruta → Uint8Array.
export function empaquetar(entrevistas, { plantillaEstudio, info }) {
  const archivos = new Map();
  const todos = entrevistas.flatMap((e) => e.casos);
  const casos = todos.filter((c) => !c.descartado);
  const descartados = todos.filter((c) => c.descartado);
  archivos.set("casos.csv", enc.encode(escribirCSV(aFilas(casos))));
  if (descartados.length) archivos.set("descartados.csv", enc.encode(escribirCSV(aFilas(descartados))));
  archivos.set("resumen.csv", enc.encode(resumen(casos)));
  archivos.set("LEEME.txt", enc.encode(LEEME(info)));
  archivos.set("casos.json", enc.encode(JSON.stringify({ info, entrevistas: entrevistas.map((e) => ({ meta: e.meta, alineacion: e.alineacion })), casos: todos }, null, 1)));
  if (plantillaEstudio) archivos.set("estudio.html", enc.encode(incrustarEnEstudio(plantillaEstudio, casos, info)));
  for (const e of entrevistas) {
    if (e.whisper) {
      archivos.set(`Whisper/${e.meta.clave}.json`, enc.encode(JSON.stringify(e.whisper)));
      archivos.set(`Whisper/${e.meta.clave}.txt`, enc.encode(whisperATexto(e.whisper)));
    }
    for (const [ruta, bytes] of e.recortes || []) archivos.set(ruta, bytes);
  }
  return archivos;
}

// Rehace los archivos de texto de un paquete ya existente a partir de casos.json (tras Jev).
// Si se da el casos.csv anterior, se conserva lo que el grupo ya hubiera rellenado.
export function reempaquetar(json, { plantillaEstudio, csvAnterior = "" }) {
  const archivos = new Map();
  if (csvAnterior) {
    const previas = new Map(leerCSV(csvAnterior).filas.map((f) => [f.ID, f]));
    for (const c of json.casos) {
      const f = previas.get(c.id);
      if (!f) continue;
      if (f["-d-"] && !/transcrita/.test(f["-d-"])) c.d = f["-d-"];
      if (f.Revisor) c.revisor = f.Revisor;
      if (f.Notas) c.notas = f.Notas;
      if (f.Enlace) c.enlace = f.Enlace;
    }
  }
  const casos = json.casos.filter((c) => !c.descartado);
  const descartados = json.casos.filter((c) => c.descartado);
  json.info.jev = json.casos.some((c) => c.jev);
  archivos.set("casos.csv", enc.encode(escribirCSV(aFilas(casos))));
  archivos.set("descartados.csv", enc.encode(escribirCSV(aFilas(descartados))));
  archivos.set("resumen.csv", enc.encode(resumen(casos)));
  archivos.set("LEEME.txt", enc.encode(LEEME(json.info)));
  archivos.set("casos.json", enc.encode(JSON.stringify(json, null, 1)));
  if (plantillaEstudio) archivos.set("estudio.html", enc.encode(incrustarEnEstudio(plantillaEstudio, casos, json.info)));
  return archivos;
}

export { CABECERA };
