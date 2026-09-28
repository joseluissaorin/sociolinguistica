// Pruebas del motor: node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leerTranscripcion } from "../public/motor/transcripcion.js";
import { Lexico } from "../public/motor/lexico.js";
import { detectar, CATEGORIAS } from "../public/motor/deteccion.js";
import { aplicar } from "../public/motor/jev.js";
import { alinear } from "../public/motor/alineacion.js";
import { fusionar, leerCSV, escribirCSV } from "../public/motor/csv.js";
import { acento } from "../public/motor/texto.js";

const L = { es: new Lexico(readFileSync("public/lexico/es.txt", "utf8")), ca: new Lexico(readFileSync("public/lexico/ca.txt", "utf8")) };
const cab = `<Trans><Hablantes><Hablante codigo_hab = "I" sexo = "mujer" grupo_edad = "3" edad = "60" nivel_edu = "medio"/></Hablantes></Trans>\n`;
const casos = (linea, op) => detectar(leerTranscripcion(cab + linea, "PRUE_M32_001.txt"), L, op);
const uno = (linea, forma, op) => casos(linea, op).find((c) => c.forma === forma);

test("une las palabras partidas por <alargamiento/>", () => {
  const tr = leerTranscripcion(cab + "I: unas chancla<alargamiento/>s y la ca<alargamiento/>da", "X.txt");
  assert.deepEqual(tr.tokens.map((t) => t.w), ["unas", "chanclas", "y", "la", "cada"]);
});

test("solo los turnos del informante", () => {
  assert.equal(casos("E: todo nada\nI: cada").length, 1);
});

test("elisiones transcritas: tomao, salío, lao, na", () => {
  const t = uno("I: lo había tomao", "tomao");
  assert.equal(t.tipo, "elisión escrita"); assert.equal(t.estandar, "tomado"); assert.equal(t.lema, "tomar"); assert.equal(t.d, "elidida (transcrita)");
  assert.equal(uno("I: se salío", "salío").estandar, "salido");
  assert.equal(uno("I: al otro lao", "lao").estandar, "lado");
  const na = uno("I: no hay na", "na");
  assert.equal(na.estandar, "nada"); assert.ok(na.avisos.includes("posible elisión: revisar"));
});

test("quedao da dos casos: la d escrita y la elidida", () => {
  const cs = casos("I: me he quedao");
  assert.equal(cs.length, 2);
  assert.deepEqual(cs.map((c) => c.tipo).sort(), ["-d- escrita", "elisión escrita"]);
});

test("ultracorrección: bacalado", () => {
  const c = uno("I: el bacalado", "bacalado");
  assert.equal(c.tipo, "ultracorrección escrita"); assert.equal(c.estandar, "bacalao");
});

test("no confunde hiatos sin tilde con elisiones (lio, via, seis, precio)", () => {
  assert.equal(casos("I: menudo lio por la via con seis de precio").filter((c) => c.tipo !== "-d- escrita").length, 0);
});

test("lemas: abogadas → abogado; participio tras haber → infinitivo", () => {
  assert.equal(uno("I: las abogadas", "abogadas").lema, "abogado");
  const c = uno("I: los han cansado", "cansado");
  assert.equal(c.categoria, CATEGORIAS.participio); assert.equal(c.lema, "cansar");
});

test("Jev: adjetivo → masculino singular; participio → infinitivo", () => {
  const c = uno("I: estoy muy cansada", "cansada");
  aplicar(c, { categoria: { choice: CATEGORIAS.adjetivo, confidence: 0.9 } });
  assert.equal(c.lema, "cansado");
  const q = uno("I: no has querido", "querido");
  aplicar(q, { categoria: { choice: CATEGORIAS.verbo, confidence: 0.7 } });
  assert.equal(q.categoria, CATEGORIAS.participio); assert.equal(q.lema, "querer");
});

test("opciones: catalán y d entre palabras", () => {
  const linea = `I: me dijo <lengua = "catalán"> la vida </lengua>`;
  assert.ok(casos(linea).some((c) => c.lengua === "catalán"));
  assert.ok(!casos(linea, { otrasLenguas: false }).some((c) => c.lengua === "catalán"));
  assert.ok(casos(linea, { frontera: true }).some((c) => c.forma === "dijo" && c.posicion === "entre palabras"));
});

test("acento", () => {
  assert.equal(acento("cansado", 5), "tras tónica");
  assert.equal(acento("cómodo", 4), "tras átona");
});

test("alineación: tomao casa con tomado", () => {
  const tr = leerTranscripcion(cab + "I: ya me lo había tomao muchas veces", "X.txt");
  const w = [["Ya", 0, 0.2], ["me", 0.2, 0.3], ["lo", 0.3, 0.4], ["había", 0.4, 0.7], ["tomado", 0.7, 1.1], ["muchas", 1.1, 1.4], ["veces.", 1.4, 1.8]];
  const r = alinear(tr.tokens, w, 2);
  assert.deepEqual(r.tiempos[4], { ini: 0.7, fin: 1.1, calidad: "exacta" });
});

test("fusión a tres bandas", () => {
  const base = [{ ID: "1", "-d-": "", Notas: "" }];
  const local = [{ ID: "1", "-d-": "elidida", Notas: "" }];
  const remoto = [{ ID: "1", "-d-": "", Notas: "ojo" }];
  const { filas, conflictos } = fusionar(base, local, remoto);
  assert.equal(filas[0]["-d-"], "elidida"); assert.equal(filas[0].Notas, "ojo"); assert.equal(conflictos.length, 0);
  const c = fusionar(base, [{ ID: "1", "-d-": "mantenida" }], [{ ID: "1", "-d-": "relajada" }]);
  assert.equal(c.conflictos.length, 1); assert.equal(c.filas[0]["-d-"], "relajada");
});

test("CSV de ida y vuelta con punto y coma y comillas", () => {
  const f = [{ A: 'dijo "hola"; adiós', B: "x" }];
  assert.deepEqual(leerCSV(escribirCSV(f, ["A", "B"])).filas, f);
});

test("una palabra cortada no es una elisión", () => {
  assert.equal(casos("I: y to <palabra_cortada/> todos").filter((c) => c.tipo === "elisión escrita").length, 0);
});
