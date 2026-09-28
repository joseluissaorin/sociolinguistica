#!/usr/bin/env node
// socio: la misma herramienta que sociolinguistica.joseluissaorin.com, desde la terminal.
//
//   socio procesar <carpeta> [<carpeta>…] --salida <dir> [--frontera] [--sin-otras-lenguas]
//                  [--sin-extranjero] [--sin-jev] [--solo CLAVE,CLAVE] [--margen 1.5]
//       Cada carpeta tiene Audios/*.mp3 y Transcripciones/*.txt (como las que da preseea-descargas).
//   socio categorizar <dir>                         Pasa por Jev los casos que aún no lo estén.
//   socio hoja <dir> --carpeta <idDrive> [--cuenta correo]
//       Sube los recortes a Drive, rellena «Enlace» y crea la hoja de cálculo compartida.
//   socio sincronizar <dir> [--cuenta correo]       Fusiona casos.csv con la hoja (en los dos sentidos).
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
    for (const col of ["-d-", "Revisor", "Notas", "Enlace"]) if (v[col] && !f[col]) { f[col] = v[col]; n++; }
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
  const info = { generado: new Date().toISOString().slice(0, 16).replace("T", " "), herramienta: "socio (CLI)", opciones, margen, jev };
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
  // 1. Subcarpeta con los recortes, reflejando la estructura local.
  const buscar = (nombre, padre) => {
    const r = JSON.parse(gog(["drive", "ls", "--parent", padre, "--json", "--max", "1000"], cuenta));
    return (r.files || r).find((f) => f.name === nombre && /folder/.test(f.mimeType));
  };
  const crear = (nombre, padre) => JSON.parse(gog(["drive", "mkdir", nombre, "--parent", padre, "--json"], cuenta));
  const idCarpeta = (ruta) => {
    let padre = op.carpeta;
    for (const parte of ruta.split("/")) {
      const f = buscar(parte, padre) || crear(parte, padre);
      padre = f.id || f.file?.id;
    }
    return padre;
  };
  const enlaces = new Map();
  const porCarpeta = new Map();
  for (const f of filas) if (f.Recorte && !f.Enlace) {
    const d = dirname(f.Recorte);
    if (!porCarpeta.has(d)) porCarpeta.set(d, new Set());
    porCarpeta.get(d).add(f.Recorte);
  }
  let subidos = 0;
  for (const [d, rutas] of porCarpeta) {
    const padre = idCarpeta(d);
    const existentes = new Map(((r) => (r.files || r))(JSON.parse(gog(["drive", "ls", "--parent", padre, "--json", "--max", "1000"], cuenta))).map((x) => [x.name, x.id]));
    for (const ruta of rutas) {
      let id = existentes.get(basename(ruta));
      if (!id) {
        const r = JSON.parse(gog(["drive", "upload", join(dir, ruta), "--parent", padre, "--json"], cuenta));
        id = r.id || r.file?.id;
        subidos++;
        if (subidos % 50 === 0) log(`  ${subidos} recortes subidos…`);
      }
      enlaces.set(ruta, `https://drive.google.com/file/d/${id}/view`);
    }
  }
  for (const f of filas) if (enlaces.has(f.Recorte)) f.Enlace = enlaces.get(f.Recorte);
  writeFileSync(join(dir, "casos.csv"), escribirCSV(filas));
  log(`${subidos} recortes subidos; enlaces rellenos.`);

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

const ORDENES = { procesar, categorizar: recategorizar, hoja, sincronizar };
if (!ORDENES[orden]) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 15).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(orden ? 1 : 0);
}
ORDENES[orden]().catch((e) => { log("Error:", e.message); process.exit(1); });
