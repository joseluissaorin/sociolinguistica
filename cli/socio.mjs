#!/usr/bin/env node
// socio: la misma herramienta que sociolinguistica.joseluissaorin.com, desde la terminal.
//
//   socio procesar <carpeta> [<carpeta>…] --salida <dir> [--frontera] [--sin-otras-lenguas]
//                  [--sin-extranjero] [--sin-jev] [--solo CLAVE,CLAVE] [--margen 1.5] [--esquema guia|dicotomia|fina]
//       Cada carpeta tiene Audios/*.mp3 y Transcripciones/*.txt (como las que da preseea-descargas).
//   socio categorizar <dir>                         Pasa por Jev los casos que aún no lo estén.
//   socio hoja <dir> --carpeta <idDrive> [--cuenta correo]
//       Sube los recortes a Drive, rellena «Enlace» y crea la hoja de cálculo compartida.
//   socio sincronizar <dir> [--cuenta correo]       Fusiona casos.csv con la hoja (en los dos sentidos).
//   socio repartir <dir> --entre "Ana,Luis,Marta"   Reparte los casos a partes iguales (columna «Asignado a»).
//   socio paquetes <dir>                            Un ZIP por persona (sus casos y recortes) y uno completo.
//   socio esquema <dir> guia|dicotomia|fina         Cambia los valores de -d- del estudio y de la hoja.
//
// Variables: SOCIO_URL (por defecto la web pública) y SOCIO_CLAVE_ADMIN (opcional, sin límite de uso).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { decodificar } from "../public/motor/transcripcion.js";
import { Lexico } from "../public/motor/lexico.js";
import { procesarEntrevista, MARGEN } from "../public/motor/proceso.js";
import { empaquetar, reempaquetar } from "../public/motor/salida.js";
import { categorizar } from "../public/motor/jev.js";
import { leerCSV, escribirCSV, fusionar, CABECERA, EDITABLES } from "../public/motor/csv.js";
import { ESQUEMAS, valoresDe } from "../public/motor/valores.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const secretos = join(homedir(), ".claude/.secrets/sociolinguistica.env");
if (existsSync(secretos)) for (const l of readFileSync(secretos, "utf8").split("\n")) {
  const m = l.match(/^(\w+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const URL_BASE = process.env.SOCIO_URL || "https://sociolinguistica.joseluissaorin.com";
const ADMIN = process.env.SOCIO_CLAVE_ADMIN || "";
const cabeceras = (extra = {}) => ({ ...(ADMIN ? { "x-clave": ADMIN } : {}), ...extra });

// ---------- argumentos ----------
const [orden, ...resto] = process.argv.slice(2);
const pos = [], op = {};
for (let i = 0; i < resto.length; i++) {
  const a = resto[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    if (resto[i + 1] !== undefined && !resto[i + 1].startsWith("--")) op[k] = resto[++i]; else op[k] = true;
  } else pos.push(a);
}
const log = (...x) => console.error(...x);

function escribir(dir, archivos) {
  for (const [ruta, bytes] of archivos) {
    const p = join(dir, ruta);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }
}

async function pedir(url, init, intentos = 4) {
  for (let k = 0; ; k++) {
    const r = await fetch(url, init);
    if (r.ok) return r;
    const texto = await r.text();
    if (k + 1 >= intentos || (r.status < 500 && r.status !== 429)) throw new Error(`${r.status}: ${texto.slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 3000 * (k + 1)));
  }
}

// Whisper: primero la caché local; luego el servidor por clave (mismo MP3 que PRESEEA);
// si el MP3 local es distinto, se sube el audio (solo con clave de administración).
async function whisper(clave, mp3, dirSalida) {
  const local = join(dirSalida, "Whisper", `${clave}.json`);
  if (existsSync(local)) {
    const w = JSON.parse(readFileSync(local, "utf8"));
    if (w.bytesAudio === mp3.length) return w;
  }
  let w = null;
  try {
    const r = await pedir(`${URL_BASE}/api/whisper`, { method: "POST", headers: cabeceras({ "Content-Type": "application/json" }), body: JSON.stringify({ clave }) });
    w = await r.json();
  } catch (e) { log(`  ${clave}: PRESEEA no lo tiene (${e.message}); se sube el audio local`); }
  if (!w || w.bytesAudio !== mp3.length) {
    if (!ADMIN) throw new Error(`${clave}: el MP3 local no es el de PRESEEA y no hay SOCIO_CLAVE_ADMIN para subirlo`);
    const r = await pedir(`${URL_BASE}/api/whisper-audio`, { method: "POST", headers: cabeceras({ "Content-Type": "audio/mpeg" }), body: mp3 });
    w = { clave, ...(await r.json()) };
  }
  mkdirSync(dirname(local), { recursive: true });
  writeFileSync(local, JSON.stringify(w));
  return w;
}

const enviarJev = async (lote) => {
  const r = await pedir(`${URL_BASE}/api/jev`, { method: "POST", headers: cabeceras({ "Content-Type": "application/json" }), body: JSON.stringify({ casos: lote }) }, 6);
  return (await r.json()).respuestas;
};

// Conserva lo que el grupo ya haya rellenado si se vuelve a procesar encima.
function conservarEdiciones(dir, archivos) {
  const p = join(dir, "casos.csv");
  if (!existsSync(p) || !archivos.has("casos.csv")) return;
  const viejo = leerCSV(readFileSync(p, "utf8")).filas;
  const nuevo = leerCSV(new TextDecoder().decode(archivos.get("casos.csv")));
  const V = new Map(viejo.map((f) => [f.ID, f]));
  let n = 0;
  for (const f of nuevo.filas) {
    const v = V.get(f.ID); if (!v) continue;
    // Los valores «(transcrita)» los pone la máquina: no se arrastran.
    for (const col of ["-d-", "Revisor", "Notas", "Enlace", "Asignado a"]) if (v[col] && !f[col] && !/transcrita/.test(v[col])) { f[col] = v[col]; n++; }
  }
  if (n) { archivos.set("casos.csv", new TextEncoder().encode(escribirCSV(nuevo.filas, nuevo.cabecera))); log(`Conservadas ${n} casillas ya rellenas.`); }
}

async function procesar() {
  if (!pos.length || !op.salida) throw new Error("Uso: socio procesar <carpeta>… --salida <dir>");
  const salida = resolve(op.salida);
  const lexicos = { es: new Lexico(readFileSync(join(RAIZ, "public/lexico/es.txt"), "utf8")), ca: new Lexico(readFileSync(join(RAIZ, "public/lexico/ca.txt"), "utf8")) };
  const opciones = { frontera: !!op.frontera, otrasLenguas: !op["sin-otras-lenguas"], extranjero: !op["sin-extranjero"] };
  const solo = op.solo ? new Set(String(op.solo).split(",")) : null;
  const margen = op.margen ? parseFloat(op.margen) : MARGEN;
  const tareas = [];
  for (const carpeta of pos) {
    const dirT = join(carpeta, "Transcripciones"), dirA = join(carpeta, "Audios");
    for (const f of readdirSync(dirT).filter((x) => x.endsWith(".txt")).sort()) {
      const clave = f.replace(/\.txt$/, "");
      if (solo && !solo.has(clave)) continue;
      const pa = ["mp3", "wav"].map((x) => join(dirA, `${clave}.${x}`)).find(existsSync) || join(dirA, `${clave}.mp3`);
      if (!existsSync(pa)) { log(`  ${clave}: sin audio, se omite`); continue; }
      tareas.push({ clave, txt: join(dirT, f), f, mp3: new Uint8Array(readFileSync(pa)) });
    }
  }
  // Whisper, de cuatro en cuatro; el resto del proceso es local e inmediato.
  let sig = 0;
  const trabajador = async () => {
    while (sig < tareas.length) {
      const t = tareas[sig++];
      try { t.whisper = await whisper(t.clave, t.mp3, salida); log(`  ${t.clave}: transcrito`); }
      catch (e) { log(`  ${t.clave}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabajador));
  const entrevistas = [];
  for (const t of tareas) {
    if (!t.whisper) continue;
    const e = procesarEntrevista({ texto: decodificar(readFileSync(t.txt)), nombre: t.f, mp3: t.mp3, whisper: t.whisper, lexicos, opciones, margen });
    e.whisper = t.whisper;
    entrevistas.push(e);
    log(`  ${t.clave}: ${e.casos.length} casos en ${Math.round(t.whisper.duracion)} s de audio · alineación ${(e.alineacion.cobertura * 100).toFixed(1)} %`);
  }
  const todos = entrevistas.flatMap((e) => e.casos);
  const jev = !op["sin-jev"];
  if (jev) {
    log(`Jev: categorizando ${todos.length} casos…`);
    const r = await categorizar(todos, enviarJev, { simultaneos: 4, progreso: (h, n, err) => process.stderr.write(`\r  ${h}/${n}${err ? ` · ${err} errores` : ""}   `) });
    log(`\n  hecho (${r.errores} errores)`);
  }
  const esquema = ESQUEMAS[op.esquema] ? op.esquema : "guia";
  const info = { generado: new Date().toISOString().slice(0, 16).replace("T", " "), herramienta: "socio (CLI)", opciones, margen, jev, esquema, valores: valoresDe(esquema) };
  const archivos = empaquetar(entrevistas, { plantillaEstudio: readFileSync(join(RAIZ, "public/estudio.html"), "utf8"), info });
  conservarEdiciones(salida, archivos);
  escribir(salida, archivos);
  log(`Listo: ${todos.filter((c) => !c.descartado).length} casos (${todos.filter((c) => c.descartado).length} descartados) en ${salida}`);
}

async function recategorizar() {
  const dir = resolve(pos[0] || ".");
  const json = JSON.parse(readFileSync(join(dir, "casos.json"), "utf8"));
  if (op.todo) for (const c of json.casos) c.jev = false;
  const r = await categorizar(json.casos, enviarJev, { simultaneos: 4, progreso: (h, n) => process.stderr.write(`\r  ${h}/${n}   `) });
  log(`\n${r.enviados} casos enviados, ${r.errores} errores`);
  const archivos = reempaquetar(json, { plantillaEstudio: readFileSync(join(RAIZ, "public/estudio.html"), "utf8") });
  conservarEdiciones(dir, archivos);
  escribir(dir, archivos);
}

// ---------- Google Drive y Sheets (con gog) ----------
const gog = (args, cuenta) => execFileSync("gog", [...args, "-a", cuenta, "--no-input"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const CUENTA = () => op.cuenta || process.env.SOCIO_CUENTA || "alu0101618883@ull.edu.es";
const estado = (dir) => join(dir, ".sincronizacion.json");
const col = (n) => { let s = ""; n++; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function leerHoja(id, cuenta) {
  const out = JSON.parse(gog(["sheets", "get", id, "casos!A1:ZZ", "--json"], cuenta));
  const valores = out.values || out.result?.values || [];
  const [cab, ...filas] = valores;
  return filas.map((f) => Object.fromEntries(cab.map((n, k) => [n, f[k] ?? ""])));
}

function escribirHoja(id, filas, cuenta) {
  const valores = [CABECERA, ...filas.map((f) => CABECERA.map((n) => f[n] ?? ""))];
  const tmp = join(homedir(), ".cache", `socio-hoja-${process.pid}.json`);
  mkdirSync(dirname(tmp), { recursive: true });
  writeFileSync(tmp, JSON.stringify(valores));
  gog(["sheets", "update", id, `casos!A1:${col(CABECERA.length - 1)}${valores.length}`, `--values-json=@${tmp}`, "--input=RAW"], cuenta);
}

async function hoja() {
  const dir = resolve(pos[0] || ".");
  const cuenta = CUENTA();
  if (!op.carpeta) throw new Error("Falta --carpeta <id de la carpeta de Drive>");
  const { filas } = leerCSV(readFileSync(join(dir, "casos.csv"), "utf8"));
  // 1. Los recortes se suben de una vez con «gog drive sync push», que devuelve el ID de cada
  //    archivo (también de los que ya estaban): con eso se rellena «Enlace».
  const ls = (padre) => JSON.parse(gog(["drive", "ls", "--parent", padre, "--json", "--max", "1000"], cuenta)).files || [];
  let recortes = ls(op.carpeta).find((f) => f.name === "Recortes" && /folder/.test(f.mimeType))?.id;
  if (!recortes) recortes = JSON.parse(gog(["drive", "mkdir", "Recortes", "--parent", op.carpeta, "--json"], cuenta)).folder.id;
  log("Subiendo los recortes a Drive…");
  const r = JSON.parse(gog(["drive", "sync", "push", "--parent", recortes, join(dir, "Recortes"), "--json"], cuenta));
  const ids = new Map(r.actions.filter((a) => a.file_id && !/folder/.test(a.mime_type || "")).map((a) => [`Recortes/${a.path}`, a.file_id]));
  let n = 0;
  for (const f of filas) if (ids.has(f.Recorte)) { f.Enlace = `https://drive.google.com/file/d/${ids.get(f.Recorte)}/view`; n++; }
  writeFileSync(join(dir, "casos.csv"), escribirCSV(filas));
  log(`${r.summary.create_files} recortes nuevos en Drive (${r.summary.skip_files} ya estaban); ${n} enlaces rellenos.`);

  // 2. La hoja de cálculo: se crea una vez a partir del CSV y se recuerda su ID.
  const est = existsSync(estado(dir)) ? JSON.parse(readFileSync(estado(dir), "utf8")) : {};
  if (!est.hoja) {
    const nombre = op.nombre || "Casos de -d- intervocálica";
    const tmp = join(homedir(), ".cache", "socio-casos.csv");
    writeFileSync(tmp, escribirCSV(filas).replace(/^﻿/, ""));
    const r = JSON.parse(gog(["drive", "upload", tmp, "--parent", op.carpeta, "--convert-to", "sheet", "--name", nombre, "--json"], cuenta));
    est.hoja = r.id || r.file?.id;
    // La pestaña se llama como el archivo subido; se renombra a «casos» para que la sincronización la encuentre.
    const meta = JSON.parse(gog(["sheets", "metadata", est.hoja, "--json"], cuenta));
    const pest = (meta.sheets || meta.spreadsheet?.sheets || [])[0]?.properties;
    if (pest && pest.title !== "casos") gog(["sheets", "rename-tab", est.hoja, pest.title, "casos"], cuenta);
    // Cabecera fija y desplegable en la columna -d- (sin bloquear otros valores).
    gog(["sheets", "freeze", est.hoja, "--rows", "1", "--sheet", "casos"], cuenta);
    const info = existsSync(join(dir, "casos.json")) ? JSON.parse(readFileSync(join(dir, "casos.json"), "utf8")).info : {};
    const valores = [...(info.valores || valoresDe("guia")).map((x) => x.v), "elidida (transcrita)", "ultracorrección (transcrita)"];
    gog(["sheets", "validation", "set", est.hoja, `casos!F2:F${filas.length + 1}`, "--type", "ONE_OF_LIST", ...valores.flatMap((v) => ["--value", v.trim()]), "--no-strict", "--show-custom-ui"], cuenta);
    log(`Hoja creada: https://docs.google.com/spreadsheets/d/${est.hoja}`);
  } else {
    escribirHoja(est.hoja, fusionar(est.base || [], filas, leerHoja(est.hoja, cuenta)).filas, cuenta);
  }
  est.base = leerHoja(est.hoja, cuenta).map((f) => Object.fromEntries(["ID", ...EDITABLES].map((k) => [k, f[k] ?? ""])));
  est.cuenta = cuenta;
  writeFileSync(estado(dir), JSON.stringify(est));
}

async function sincronizar() {
  const dir = resolve(pos[0] || ".");
  const est = JSON.parse(readFileSync(estado(dir), "utf8"));
  const cuenta = op.cuenta || est.cuenta || CUENTA();
  const local = leerCSV(readFileSync(join(dir, "casos.csv"), "utf8")).filas;
  const remoto = leerHoja(est.hoja, cuenta);
  const { filas, conflictos } = fusionar(est.base || [], local, remoto);
  const orden = new Map(local.map((f, k) => [f.ID, k]));
  filas.sort((a, b) => (orden.get(a.ID) ?? 1e9) - (orden.get(b.ID) ?? 1e9));
  escribirHoja(est.hoja, filas, cuenta);
  writeFileSync(join(dir, "casos.csv"), escribirCSV(filas));
  est.base = filas.map((f) => Object.fromEntries(["ID", ...EDITABLES].map((k) => [k, f[k] ?? ""])));
  est.ultima = new Date().toISOString();
  writeFileSync(estado(dir), JSON.stringify(est));
  const cambiadas = (a, b) => a.filter((f) => { const o = b.find((x) => x.ID === f.ID); return !o || EDITABLES.some((c) => (o[c] ?? "") !== (f[c] ?? "")); }).length;
  log(`Sincronizado: ${cambiadas(filas, local)} filas actualizadas en local, ${cambiadas(filas, remoto)} en la hoja.`);
  if (conflictos.length) {
    const p = join(dir, `conflictos-${est.ultima.slice(0, 19).replace(/:/g, "-")}.csv`);
    writeFileSync(p, escribirCSV(conflictos.map((c) => ({ ID: c.id, Columna: c.columna, "Valor local": c.local, "Valor en la hoja (se queda)": c.remoto })), ["ID", "Columna", "Valor local", "Valor en la hoja (se queda)"]));
    log(`${conflictos.length} conflictos: se ha quedado el valor de la hoja. Lista en ${p}`);
  }
}

// Reparte los casos entre varias personas a partes iguales. Cada entrevista va entera a una persona
// según un cuadrado latino sobre edad y nivel de estudios (así cada una escucha de todo: sexos,
// edades, niveles y ciudades); después se igualan los totales pasando los últimos casos de alguna
// entrevista de quien tiene de más a quien tiene de menos.
async function repartir() {
  const dir = resolve(pos[0] || ".");
  const nombres = String(op.entre || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (nombres.length < 2) throw new Error('Uso: socio repartir <dir> --entre "Ana,Luis,Marta"');
  const p = join(dir, "casos.csv");
  const { filas, cabecera } = leerCSV(readFileSync(p, "utf8"));
  const cab = cabecera.includes("Asignado a") ? cabecera : [...cabecera, "Asignado a"];
  const n = nombres.length;
  const porEntrevista = new Map();
  for (const f of filas) { if (!porEntrevista.has(f.Hablante)) porEntrevista.set(f.Hablante, []); porEntrevista.get(f.Hablante).push(f); }
  const ciudades = [...new Set(filas.map((f) => f.Ciudad))].sort();
  // Objetivo por ciudad: partes iguales; los restos se reparten en rueda para que los totales cuadren.
  let rueda = 0;
  for (const ciudad of ciudades) {
    const entrevistas = [...porEntrevista].filter(([, fs]) => fs[0].Ciudad === ciudad).sort();
    const total = entrevistas.reduce((t, [, fs]) => t + fs.length, 0);
    const meta = new Array(n).fill(Math.floor(total / n));
    for (let r = 0; r < total % n; r++) meta[(rueda++) % n]++;
    const carga = new Array(n).fill(0);
    for (const [clave, fs] of entrevistas) {
      const m = clave.match(/_([HM])(\d)(\d)_/) || [0, "H", 1, 1];
      const k = (+m[2] + +m[3] + (m[1] === "M" ? 1 : 0) + ciudades.indexOf(ciudad)) % n;
      for (const f of fs) f["Asignado a"] = nombres[k];
      carga[k] += fs.length;
    }
    // Igualar: primero entrevistas enteras que quepan; si no, el final de una entrevista.
    for (let vuelta = 0; vuelta < 100; vuelta++) {
      const mas = [...carga.keys()].sort((x, y) => (carga[y] - meta[y]) - (carga[x] - meta[x]))[0];
      const menos = [...carga.keys()].sort((x, y) => (carga[x] - meta[x]) - (carga[y] - meta[y]))[0];
      const cuantos = Math.min(carga[mas] - meta[mas], meta[menos] - carga[menos]);
      if (cuantos <= 0) break;
      const suyas = entrevistas.map(([, fs]) => fs.filter((f) => f["Asignado a"] === nombres[mas])).filter((fs) => fs.length);
      const enteras = suyas.filter((fs) => fs.length <= cuantos).sort((x, y) => y.length - x.length);
      const trozo = enteras.length ? enteras[0] : suyas.sort((x, y) => x.length - y.length)[0].slice(-cuantos);
      for (const f of trozo) f["Asignado a"] = nombres[menos];
      carga[mas] -= trozo.length; carga[menos] += trozo.length;
    }
  }
  writeFileSync(p, escribirCSV(filas, cab));
  for (const [i, nom] of nombres.entries()) {
    const suyas = filas.filter((f) => f["Asignado a"] === nom);
    const entrevistas = new Set(suyas.map((f) => f.Hablante));
    const porCiudad = ciudades.map((c) => `${c} ${suyas.filter((f) => f.Ciudad === c).length}`).join(", ");
    log(`${nom}: ${suyas.length} casos de ${entrevistas.size} entrevistas (${porCiudad})`);
  }
}

// Cambia el esquema de valores de un análisis ya hecho: casos.json, estudio.html y desplegable de la hoja.
async function esquema() {
  const dir = resolve(pos[0] || ".");
  const clave = pos[1] || op.esquema;
  if (!ESQUEMAS[clave]) throw new Error(`Esquemas: ${Object.keys(ESQUEMAS).join(", ")}`);
  const json = JSON.parse(readFileSync(join(dir, "casos.json"), "utf8"));
  json.info.esquema = clave; json.info.valores = valoresDe(clave);
  const archivos = reempaquetar(json, { plantillaEstudio: readFileSync(join(RAIZ, "public/estudio.html"), "utf8"), csvAnterior: readFileSync(join(dir, "casos.csv"), "utf8") });
  escribir(dir, archivos);
  const est = existsSync(estado(dir)) ? JSON.parse(readFileSync(estado(dir), "utf8")) : {};
  if (est.hoja) {
    const cuenta = op.cuenta || est.cuenta || CUENTA();
    const valores = [...json.info.valores.map((x) => x.v), "elidida (transcrita)", "ultracorrección (transcrita)"];
    gog(["sheets", "validation", "set", est.hoja, `casos!F2:F${json.casos.length + 1}`, "--type", "ONE_OF_LIST", ...valores.flatMap((v) => ["--value", v]), "--no-strict", "--show-custom-ui"], cuenta);
  }
  log(`Esquema «${ESQUEMAS[clave].nombre}» aplicado.`);
}

// Un ZIP por persona con sus casos, sus recortes y un estudio que solo muestra lo suyo,
// más el paquete completo. Van a <dir>/Paquetes/.
async function paquetes() {
  const dir = resolve(pos[0] || ".");
  const { zipSync } = await import("fflate");
  const plantilla = readFileSync(join(RAIZ, "public/estudio.html"), "utf8");
  const json = JSON.parse(readFileSync(join(dir, "casos.json"), "utf8"));
  const { filas, cabecera } = leerCSV(readFileSync(join(dir, "casos.csv"), "utf8"));
  const enc = new TextEncoder();
  const leeme = readFileSync(join(dir, "LEEME.txt"));
  const salida = join(dir, "Paquetes");
  mkdirSync(salida, { recursive: true });
  const armar = (nombreZip, suyas, nota) => {
    const ids = new Set(suyas.map((f) => f.ID));
    const archivos = {
      "casos.csv": enc.encode(escribirCSV(suyas, cabecera)),
      "casos.json": enc.encode(JSON.stringify({ ...json, casos: json.casos.filter((c) => ids.has(c.id)) })),
      "estudio.html": enc.encode(incrustarFilas(plantilla, suyas, json.info)),
      "LEEME.txt": nota ? enc.encode(nota + "\n\n" + new TextDecoder().decode(leeme)) : leeme,
    };
    for (const r of new Set(suyas.map((f) => f.Recorte).filter(Boolean))) archivos[r] = [readFileSync(join(dir, r)), { level: 0 }];
    writeFileSync(join(salida, nombreZip), zipSync(archivos, { level: 6 }));
    log(`  ${nombreZip}: ${suyas.length} casos`);
  };
  const personas = [...new Set(filas.map((f) => f["Asignado a"]).filter(Boolean))];
  for (const p of personas) armar(`Estudio de ${p}.zip`, filas.filter((f) => f["Asignado a"] === p), `Paquete de ${p}: ${filas.filter((f) => f["Asignado a"] === p).length} casos asignados.`);
  armar("Estudio completo.zip", filas, "");
}
function incrustarFilas(plantilla, filas, info) {
  const datos = JSON.stringify({ info, filas }).replace(/<\//g, "<\\/");
  return plantilla.replace(/<script id="datos" type="application\/json">[\s\S]*?<\/script>/, () => `<script id="datos" type="application/json">${datos}</script>`);
}

const ORDENES = { procesar, categorizar: recategorizar, hoja, sincronizar, repartir, esquema, paquetes };
if (!ORDENES[orden]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 19).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(orden ? 1 : 0);
}
ORDENES[orden]().catch((e) => { log("Error:", e.message); process.exit(1); });
