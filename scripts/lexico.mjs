// Construye public/lexico/{es,ca}.txt a partir de las listas de lematización de
// Michal Měchura (https://github.com/michmech/lemmatization-lists, ODbL).
// Solo se guardan las formas que pueden intervenir en un caso de -d-:
//   · formas con d entre vocales (con sus lemas);
//   · formas que empiezan por d + vocal (para la opción «entre palabras»);
//   · formas con hiato que, al meterles una d, dan otra palabra conocida
//     (mío/mido): hay que saber que existen para no tomarlas por elisiones.
// Formato: «forma<TAB>lema1|lema2», una por línea; «forma» sola si no hace falta lema.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { VOCAL, reponerD, variantesOrtograficas } from "../public/motor/texto.js";

const SUPLEMENTO = {
  // Palabras gramaticales que la lista no trae como formas.
  es: { nada: ["nada", "nadar"], todo: ["todo"], toda: ["todo"], todos: ["todo"], todas: ["todo"], cada: ["cada"], nadie: ["nadie"], además: ["además"], donde: ["donde"], dónde: ["donde"], adonde: ["adonde"], adónde: ["adonde"], adiós: ["adiós"], dedo: ["dedo"], lado: ["lado"], vida: ["vida"], miedo: ["miedo"], sido: ["ser"], ido: ["ir"], pedo: ["pedo"], medio: ["medio"], media: ["medio"], modo: ["modo"], módulo: ["módulo"], ciudadano: ["ciudadano"], ciudadana: ["ciudadano"], todavía: ["todavía"], enseguida: ["enseguida"], veintidós: ["veintidós"], adecuado: ["adecuado"], caos: ["caos"], bilbao: ["bilbao"] },
  ca: {},
};

const vdv = new RegExp(`${VOCAL}d${VOCAL}`);
const ini = new RegExp(`^d${VOCAL}`);
const hiato = new RegExp(`${VOCAL}${VOCAL}`);
// bacalao, cacao, paseo: hacen falta para reconocer las ultracorrecciones (bacalado).
const hiatoFinal = /[aeoáéó][aeo]s?$/;

for (const lengua of ["es", "ca"]) {
  const origen = `datos/lemmatization-${lengua}.txt`;
  if (!existsSync(origen)) {
    mkdirSync("datos", { recursive: true });
    const r = await fetch(`https://raw.githubusercontent.com/michmech/lemmatization-lists/master/lemmatization-${lengua}.txt`);
    writeFileSync(origen, Buffer.from(await r.arrayBuffer()));
  }
  const mapa = new Map();
  const add = (f, l) => { if (!mapa.has(f)) mapa.set(f, new Set()); mapa.get(f).add(l); };
  for (const linea of readFileSync(`datos/lemmatization-${lengua}.txt`, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const [lema, forma] = linea.split("\t");
    if (!forma) continue;
    add(forma.toLowerCase(), lema.toLowerCase());
    add(lema.toLowerCase(), lema.toLowerCase());
  }
  for (const [f, ls] of Object.entries(SUPLEMENTO[lengua])) for (const l of ls) add(f, l);

  const salida = [];
  for (const [forma, lemas] of mapa) {
    if (vdv.test(forma) || ini.test(forma)) salida.push(`${forma}\t${[...lemas].join("|")}`);
    else if (hiatoFinal.test(forma)) salida.push(forma);
    else if (hiato.test(forma) && reponerD(forma).some((c) => mapa.has(c) || variantesOrtograficas(c).some((v) => mapa.has(v)))) salida.push(forma);
  }
  salida.sort();
  writeFileSync(`public/lexico/${lengua}.txt`, salida.join("\n") + "\n");
  console.log(lengua, salida.length, "formas");
}
