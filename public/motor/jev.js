// Preguntas a Jev (TypeSafe) para categorizar cada caso, e interpretación de las respuestas.
// Jev no escribe: elige entre opciones y devuelve probabilidades. El código propone
// los candidatos (lemas del léxico) y Jev decide en contexto.
import { CATEGORIAS, elegirLema, esParticipio, tras_haber } from "./deteccion.js";

export const MODELO = "jev-latest";
export const MAX_POR_LOTE = 20;

const DEF_CATEGORIAS = {
  [CATEGORIAS.participio]: "Participio con valor verbal: en un tiempo compuesto con haber (ha cansado, había tomado) o en pasiva con ser (fue robado).",
  [CATEGORIAS.adjetivo]: "Adjetivo, o participio con valor de adjetivo: con estar o parecer (estoy cansado), junto a un nombre (una puerta cerrada) o como atributo.",
  [CATEGORIAS.sustantivo]: "Nombre común: la vida, el lado, un abogado, la comida, el pasado.",
  [CATEGORIAS.verbo]: "Forma verbal que no es participio: conjugada, infinitivo o gerundio (puede, pidió, poder, quedarme, ayudando).",
  [CATEGORIAS.pronombre]: "Pronombre, determinante o cuantificador: nada, todo, todos, cada, nadie, demás.",
  [CATEGORIAS.adverbio]: "Adverbio, preposición o conjunción: además, todavía, donde, adonde, enseguida, desde, de.",
  [CATEGORIAS.propio]: "Nombre propio de persona, lugar, marca u obra: Madrid, Badalona, Almudena.",
  [CATEGORIAS.otra]: "Otra cosa: interjección, palabra cortada o fragmento que no se puede clasificar.",
};

// Datos mínimos que viajan al Worker (y que este valida).
export function datosCaso(c) {
  return {
    forma: String(c.forma || "").slice(0, 60),
    estandar: String(c.estandar || "").slice(0, 60),
    contexto: String(c.contexto || c.ejemplo || "").slice(0, 700),
    lengua: String(c.lengua || "español").slice(0, 40),
    tipo: String(c.tipo || "").slice(0, 40),
    candidatos: (c.candidatos || []).slice(0, 8).map((l) => String(l).slice(0, 60)),
  };
}

export function peticion(d) {
  const state = {
    frase: d.contexto,
    palabra_marcada: d.forma,
    forma_estandar: d.estandar,
    lengua_del_pasaje: d.lengua,
  };
  const questions = {
    categoria: {
      type: "choice",
      instructions: "En `frase`, la palabra marcada entre corchetes es `palabra_marcada` (forma estándar: `forma_estandar`). Es una transcripción de una entrevista oral. ¿Qué función gramatical cumple esa palabra en esa frase concreta?",
      criteria: DEF_CATEGORIAS,
    },
  };
  if (d.candidatos.length > 1) {
    state.lemas_posibles = d.candidatos;
    questions.lema = {
      type: "choice",
      instructions: "¿De cuál de estos lemas es forma la palabra marcada entre corchetes en `frase`, según su sentido en esa frase? Un participio verbal pertenece al verbo; un adjetivo o un nombre, a su forma en masculino singular.",
      criteria: Object.fromEntries(d.candidatos.map((l) => [l, null])),
    };
  }
  if (d.tipo === "elisión escrita") {
    questions.elision = {
      type: "noul",
      instructions: "La palabra marcada entre corchetes en `frase` está escrita `palabra_marcada`. ¿Es una pronunciación relajada de `forma_estandar` en la que se ha perdido la d (como tomao por tomado o na por nada), y no otra palabra distinta?",
      criteria: {
        true: "Es `forma_estandar` pronunciada sin la d.",
        false: "Es otra palabra (por ejemplo, tos de toser, pues, un nombre propio o una palabra en otra lengua).",
      },
    };
  }
  return { model: MODELO, state, questions };
}

// Aplica las respuestas al caso (lo modifica y lo devuelve).
export function aplicar(caso, answers) {
  const cat = answers.categoria;
  if (cat && cat.choice) {
    caso.categoria = cat.choice;
    caso.confianzaJev = Math.round((cat.confidence ?? cat.probabilities?.[cat.choice] ?? 0) * 100);
    // Dos reglas que Jev no puede contradecir: participio tras haber (he querido) y
    // «verbo» para una forma que es justo el participio de su lema.
    const participio = esParticipio(caso.estandar, caso.candidatos || [], caso.lenguaLex || "es");
    if (participio && (tras_haber(caso.previa) || caso.categoria === CATEGORIAS.verbo)) { caso.categoria = CATEGORIAS.participio; caso.porRegla = true; }
    else caso.porRegla = false;
  }
  const probs = answers.lema?.probabilities || null;
  caso.lema = elegirLema(caso.candidatos || [], caso.categoria, caso.estandar, caso.lenguaLex || "es", probs);
  if (caso.categoria === CATEGORIAS.propio && !(caso.candidatos || []).length) caso.lema = caso.estandar;

  const avisos = (caso.avisos || []).filter((a) => !/^Jev/.test(a));
  if (caso.confianzaJev !== undefined && caso.confianzaJev < 60 && !caso.porRegla) avisos.push("Jev duda de la categoría");
  if (answers.elision) {
    const p = answers.elision.noul;
    caso.probElision = Math.round(p * 100);
    // Por debajo del 35 %, otra palabra (prefería no es preferida); entre el 35 % y el 80 %, a revisar.
    caso.descartado = p < 0.35;
    if (caso.descartado) { avisos.push(`Jev: no parece elisión (${caso.probElision} %)`); caso.d = ""; }
    else if (p < 0.8) { avisos.push(`Jev duda de la elisión (${caso.probElision} %)`); caso.d = ""; }
    else caso.d = "elidida (transcrita)";
  }
  caso.avisos = avisos;
  caso.jev = true;
  return caso;
}

// Categoriza una lista de casos por lotes. enviar(lote de datosCaso) → [{ answers } | { error }].
// Solo se envían los que aún no pasaron por Jev (así se puede reanudar).
export async function categorizar(casos, enviar, { simultaneos = 3, progreso = () => {} } = {}) {
  const pendientes = casos.filter((c) => !c.jev);
  const lotes = [];
  for (let i = 0; i < pendientes.length; i += MAX_POR_LOTE) lotes.push(pendientes.slice(i, i + MAX_POR_LOTE));
  let hechos = 0, errores = 0, siguiente = 0;
  async function trabajador() {
    while (siguiente < lotes.length) {
      const lote = lotes[siguiente++];
      let respuestas;
      try { respuestas = await enviar(lote.map(datosCaso)); }
      catch (e) { respuestas = lote.map(() => ({ error: e.message || String(e) })); }
      lote.forEach((c, k) => {
        const r = respuestas[k];
        if (r && r.answers) aplicar(c, r.answers); else errores++;
      });
      hechos += lote.length;
      progreso(hechos, pendientes.length, errores);
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneos, lotes.length) }, trabajador));
  return { enviados: pendientes.length, errores };
}
