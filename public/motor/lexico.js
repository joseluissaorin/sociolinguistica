// Léxico de formas y lemas (véase scripts/lexico.mjs).
export class Lexico {
  constructor(texto) {
    this.mapa = new Map();
    for (const linea of texto.split("\n")) {
      if (!linea) continue;
      const [forma, lemas] = linea.split("\t");
      this.mapa.set(forma, lemas ? lemas.split("|") : []);
    }
  }
  conocida(w) { return this.mapa.has(w.toLowerCase()); }
  lemas(w) { return this.mapa.get(w.toLowerCase()) || []; }
}

// Carga los léxicos desde una función que devuelve el texto de «es» o «ca».
export async function cargarLexicos(leer) {
  const [es, ca] = await Promise.all([leer("es"), leer("ca")]);
  return { es: new Lexico(es), ca: new Lexico(ca) };
}

// Un lema es verbal si acaba en infinitivo: -ar, -er, -ir (y -re en catalán).
export const esLemaVerbal = (l, lengua = "es") => (lengua === "ca" ? /(ar|er|ir|re)$/ : /(ar|er|ir|ír)$/).test(l);
