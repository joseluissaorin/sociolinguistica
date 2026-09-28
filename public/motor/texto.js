// Utilidades de texto compartidas por el navegador, el Worker y la CLI.

export const VOCALES = "aeiouáéíóúüàèòï";
export const VOCAL = `[${VOCALES}]`;
const ES_VOCAL = new RegExp(`^${VOCAL}$`, "i");
export const esVocal = (c) => !!c && ES_VOCAL.test(c);

const SIN_TILDE = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", à: "a", è: "e", ò: "o", ï: "i" };
export const sinTildes = (s) => s.replace(/[áéíóúüàèòï]/g, (c) => SIN_TILDE[c]);
export const normalizar = (s) => sinTildes(s.toLowerCase()).replace(/[^a-zñç]/g, "");

// Posiciones de las d entre vocales dentro de una palabra.
export function dsIntervocalicas(w) {
  const pos = [];
  for (let i = 1; i < w.length - 1; i++) {
    if ((w[i] === "d" || w[i] === "D") && esVocal(w[i - 1].toLowerCase()) && esVocal(w[i + 1].toLowerCase())) pos.push(i);
  }
  return pos;
}

// Candidatas con una d repuesta en cada hiato: tomao → tomado, salío → salido, lao → lado.
export function reponerD(w) {
  const out = new Set();
  for (let i = 0; i < w.length - 1; i++) {
    if (!esVocal(w[i]) || !esVocal(w[i + 1])) continue;
    const antes = w.slice(0, i + 1), despues = w.slice(i + 1);
    out.add(antes + "d" + despues);
    // salío → salido: la tilde del hiato desaparece al reponer la d.
    const sinT = despues[0] in SIN_TILDE ? SIN_TILDE[despues[0]] + despues.slice(1) : despues;
    out.add(antes + "d" + sinT);
    // lío → lido: también la tilde de la vocal anterior.
    const a = antes.slice(-1);
    if (a in SIN_TILDE) out.add(antes.slice(0, -1) + SIN_TILDE[a] + "d" + despues);
  }
  return [...out];
}

// Variantes ortográficas para transcripciones con seseo o erratas: demaciao → demasiado.
export function variantesOrtograficas(w) {
  const v = new Set([w]);
  v.add(w.replace(/c(?=[eéií])/g, "s"));
  v.add(w.replace(/z/g, "s"));
  v.add(w.replace(/s(?=[eéií])/g, "c"));
  v.add(w.replace(/s/g, "z"));
  v.add(w.replace(/v/g, "b"));
  v.add(w.replace(/b/g, "v"));
  v.delete(w);
  return [...v];
}

// Formas apocopadas que la transcripción escribe tal cual (na = nada, to = todo).
// Solo una lista cerrada: la regla general daría «se» → «sede» o «no» → «nodo».
export const APOCOPES = {
  na: { estandar: "nada", ambigua: true }, "ná": { estandar: "nada" }, naa: { estandar: "nada" },
  to: { estandar: "todo", ambigua: true }, "tó": { estandar: "todo" }, too: { estandar: "todo" },
  toa: { estandar: "toda" }, "toá": { estandar: "toda" },
  tos: { estandar: "todos", ambigua: true }, toas: { estandar: "todas" },
  pue: { estandar: "puede", ambigua: true },
  ande: { estandar: "donde", ambigua: true },
};

// Sílabas aproximadas: grupos vocálicos separados en núcleos (hiato entre fuertes o con débil tildada).
function nucleos(w) {
  const fuerte = (c) => "aeoáéóíúàèò".includes(c);
  const res = [];
  let i = 0;
  while (i < w.length) {
    if (!esVocal(w[i])) { i++; continue; }
    let ini = i, ultimaFuerte = fuerte(w[i]) ? i : -1;
    i++;
    while (i < w.length && esVocal(w[i])) {
      if (fuerte(w[i]) && ultimaFuerte >= 0) break; // dos fuertes: hiato
      if (fuerte(w[i])) ultimaFuerte = i;
      i++;
    }
    res.push([ini, i - 1]);
  }
  return res;
}

// Índice del núcleo tónico según las reglas de acentuación del español.
function nucleoTonico(w) {
  const n = nucleos(w);
  if (!n.length) return -1;
  const tilde = n.findIndex(([a, b]) => /[áéíóú]/.test(w.slice(a, b + 1)));
  if (tilde >= 0) return tilde;
  if (n.length === 1) return 0;
  const llana = /[aeiouns]$/.test(w);
  return llana ? n.length - 2 : n.length - 1;
}

// «tras tónica» si la vocal anterior a la d (en la posición dada) es la tónica de la palabra.
export function acento(w, posD) {
  w = w.toLowerCase();
  const n = nucleos(w);
  const t = nucleoTonico(w);
  if (t < 0) return "";
  const i = n.findIndex(([a, b]) => posD - 1 >= a && posD - 1 <= b);
  if (i < 0) return "";
  return i === t ? "tras tónica" : "tras átona";
}

// Terminación de la palabra si la d está en la última sílaba: -ado, -ida, -udo…
export function terminacion(w, posD) {
  const s = sinTildes(w.toLowerCase());
  const m = s.match(/([aeiou])d([aeo])(s?)$/);
  if (m && m.index + 1 === posD) return `-${m[1]}d${m[2]}${m[3]}`;
  return "interior";
}

export const formaParticipio = (w) => /[aií]d[oa]s?$/i.test(w);

// cansadas → cansado; aburrida → aburrido.
export const masculinoSingular = (w) => w.replace(/as$/, "o").replace(/os$/, "o").replace(/a$/, "o");

// Etiqueta para nombres de archivo: sin tildes ni espacios.
export const paraArchivo = (s) => sinTildes(s.toLowerCase()).replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
