// Detección de los casos de -d- intervocálica en los turnos del informante.
import {
  VOCAL, esVocal, dsIntervocalicas, reponerD, variantesOrtograficas, APOCOPES,
  acento, terminacion, formaParticipio, masculinoSingular,
} from "./texto.js";
import { esLemaVerbal } from "./lexico.js";

export const OPCIONES_POR_DEFECTO = { frontera: false, otrasLenguas: true, extranjero: true };

export const CATEGORIAS = {
  participio: "participio verbal",
  adjetivo: "adjetivo",
  sustantivo: "sustantivo",
  verbo: "verbo",
  pronombre: "pronombre o determinante",
  adverbio: "adverbio",
  propio: "nombre propio",
  otra: "otra",
};

const HABER = new Set("he has ha hemos habéis han había habías habíamos habíais habían habré habrás habrá habremos habréis habrán habría habrías habríamos habríais habrían haya hayas hayamos hayáis hayan hubiera hubieras hubiéramos hubierais hubieran hubiese hubiésemos hubieseis hubiesen hube hubo hubimos hubieron haber habiendo".split(" "));
const SER = new Set("ser soy eres es somos sois son era eras éramos erais eran fui fue fuimos fueron sido sea sean será serán sería serían fuera fueran siendo".split(" "));
const ESTAR = new Set("estar estoy estás está estamos estáis están estaba estabas estábamos estaban estuve estuvo estuvimos estuvieron esté estén estaría estarían estado estando".split(" "));

// Lengua del léxico que corresponde a la etiqueta <lengua> de la transcripción.
const lexicoDe = (lengua) => (!lengua ? "es" : /catal|valenci|mallorq/i.test(lengua) ? "ca" : null);

function marcarContexto(turno, tok, antes = 10, despues = 10) {
  const t = turno.texto;
  let a = tok.ini, b = tok.fin;
  for (let n = 0; n < antes && a > 0; ) { a--; if (t[a] === " " && t[a - 1] !== " ") n++; }
  for (let n = 0; n < despues && b < t.length; ) { if (t[b] === " " && t[b + 1] !== " ") n++; if (n < despues) b++; }
  return ((a > 0 ? "…" : "") + t.slice(a, tok.ini).trimStart() + "[" + t.slice(tok.ini, tok.fin) + "]" + t.slice(tok.fin, b).trimEnd() + (b < t.length ? "…" : "")).trim();
}

// ¿Es la forma el participio de alguno de sus lemas verbales? (querido de querer sí; pido de pedir no)
export function esParticipio(forma, lemas, lengua = "es") {
  const m = masculinoSingular(forma.toLowerCase());
  return lemas.some((l) => esLemaVerbal(l, lengua) && (m === l.replace(/ar$/, "ado") || m === l.replace(/[eií]r$/, "ido")));
}
export const tras_haber = (previa) => HABER.has(previa);

// Categoría a partir del auxiliar anterior (se afina después con Jev).
function categoriaProvisional(forma, previa) {
  if (!formaParticipio(forma) || !previa) return "";
  if (HABER.has(previa)) return CATEGORIAS.participio;
  if (SER.has(previa)) return CATEGORIAS.participio;
  if (ESTAR.has(previa)) return CATEGORIAS.adjetivo;
  return "";
}

// Elige el lema según la categoría. «probs» es la distribución de Jev sobre los candidatos, si la hay.
export function elegirLema(candidatos, categoria, estandar, lengua = "es", probs = null) {
  const w = estandar.toLowerCase();
  const verbales = candidatos.filter((l) => esLemaVerbal(l, lengua));
  const otros = candidatos.filter((l) => !esLemaVerbal(l, lengua));
  const mejor = (lista) => (probs ? [...lista].sort((x, y) => (probs[y] || 0) - (probs[x] || 0))[0] : lista[0]);
  if (!candidatos.length) {
    if (formaParticipio(w)) return masculinoSingular(w);
    // bermudas → bermuda: plural de un nombre o adjetivo que no está en el léxico.
    if ((categoria === CATEGORIAS.sustantivo || categoria === CATEGORIAS.adjetivo) && /[aeiouáéó]s$/.test(w)) return w.slice(0, -1);
    return w;
  }
  if (categoria === CATEGORIAS.participio || categoria === CATEGORIAS.verbo) return mejor(verbales.length ? verbales : candidatos);
  if (categoria === CATEGORIAS.adjetivo || categoria === CATEGORIAS.sustantivo) {
    if (otros.length) return mejor(otros);
    return formaParticipio(w) ? masculinoSingular(w) : mejor(candidatos);
  }
  if (categoria) return mejor(otros.length ? otros : candidatos);
  return mejor(otros.length ? otros : verbales);
}

// Busca la forma estándar de una palabra escrita sin d: tomao → tomado, na → nada.
// El patrón clásico de la elisión: la d cae en la última sílaba (-ao, -aos, -ío, -ía, -úo…).
const HIATO_FINAL = new RegExp(`${VOCAL}(?:o|os|a|as|e|es)$`);

// La transcripción a veces omite la tilde del hiato: lio = lío, via = vía, maria = maría.
function conocidaConTilde(w, lex) {
  if (lex.conocida(w)) return true;
  for (let i = 0; i < w.length; i++) {
    const t = { i: "í", u: "ú" }[w[i]];
    if (t && (esVocal(w[i - 1]) || esVocal(w[i + 1])) && lex.conocida(w.slice(0, i) + t + w.slice(i + 1))) return true;
  }
  return false;
}

function restituir(w, lex, lenguaLex) {
  if (lenguaLex === "es" && Object.hasOwn(APOCOPES, w)) return { estandar: APOCOPES[w].estandar, apocope: true, ambigua: !!APOCOPES[w].ambigua };
  if (conocidaConTilde(w, lex)) return null;
  const cands = reponerD(w);
  const ok = cands.filter((c) => lex.conocida(c));
  // Solo es elisión segura si la d repuesta cae en la última sílaba (tomao, lao, salío).
  const final = (c) => HIATO_FINAL.test(w) && dsIntervocalicas(c).some((p) => p >= c.length - 4);
  if (ok.length) {
    const seguras = ok.filter(final);
    const estandar = seguras[0] || ok[0];
    return { estandar, ambigua: !seguras.length || ok.length > 1, alternativas: ok };
  }
  if (!HIATO_FINAL.test(w)) return null;
  for (const c of cands.filter(final)) {
    const v = variantesOrtograficas(c).find((x) => lex.conocida(x));
    if (v) return { estandar: v, ortografia: true, ambigua: true };
  }
  return null;
}

const CLITICO = /(me|te|se|nos|os|le|les|lo|la|los|las)$/;
const PREFIJOS = /^(super|ultra|hiper|extra|sobre|pre|re|des|anti|pseudo|semi|auto|contra|mini|micro|multi|inter|sub)(?=[a-záéíóú]{3})/;
const quitarTilde = (s) => s.replace(/[áéíóú](?=[^áéíóú]*$)/, (c) => ({ á: "a", é: "e", í: "i", ó: "o", ú: "u" })[c]);

// Lemas por regla para lo que no está en el léxico: adverbios en -mente, clíticos,
// superlativos, diminutivos y prefijos.
export function lemasPorRegla(w, lex) {
  if (/mente$/.test(w) && w.length > 7) return { lemas: [w], categoria: CATEGORIAS.adverbio };
  let base = w;
  for (let n = 0; n < 2 && CLITICO.test(base); n++) {
    base = base.replace(CLITICO, "");
    const b = quitarTilde(base);
    if (lex.conocida(b) && /(r|ndo)$/.test(b)) return { lemas: lex.lemas(b) };
  }
  // Superlativos y diminutivos: se busca la base; si es un participio, se trata como tal.
  const desdeBase = (b) => {
    if (formaParticipio(b)) {
      const verbos = lex.lemas(b).filter((l) => esLemaVerbal(l));
      const regla = verbos.length ? null : lemasPorRegla(b, lex);
      return { lemas: verbos.length ? [...verbos, masculinoSingular(b)] : regla ? regla.lemas : [masculinoSingular(b)] };
    }
    return lex.conocida(b) ? { lemas: lex.lemas(b) } : null;
  };
  const sup = w.match(/^(.+?)ísim([oa])s?$/);
  if (sup) for (const b of [sup[1] + "o", quitarTilde(sup[1]) + "o"]) { const r = lex.conocida(b) || formaParticipio(b) ? desdeBase(b) : null; if (r) return r; }
  const dim = w.match(/^(.+?)(?:it|ill|ic)([oa])s?$/);
  if (dim) for (const b of [dim[1] + dim[2], dim[1] + "o", dim[1] + "e"]) { const r = lex.conocida(b) ? desdeBase(b) : null; if (r) return r; }
  const pre = w.match(PREFIJOS);
  if (pre) {
    const resto = w.slice(pre[1].length);
    if (lex.conocida(resto)) return { lemas: lex.lemas(resto).map((l) => pre[1] + l) };
  }
  // Participio de un verbo que no está en la lista: estresada → estresar / estresado.
  const part = w.match(/^(.+?)(a|i)d[oa]s?$/);
  if (part && part[1].length >= 3) {
    const verbos = part[2] === "a" ? [part[1] + "ar"] : [part[1] + "ir", part[1] + "er"];
    return { lemas: [...verbos, masculinoSingular(w)] };
  }
  return null;
}

// Devuelve los casos de una entrevista ya leída con leerTranscripcion().
// incluir(tok) permite filtrar (por ejemplo, solo las palabras que caen dentro del audio).
export function detectar(tr, lexicos, opciones = {}, incluir = () => true) {
  const op = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const casos = [];
  const { meta, turnos, tokens } = tr;

  for (const tok of tokens) {
    if (tok.hablante !== "I" || tok.sigla) continue;
    if (tok.lengua && !op.otrasLenguas) continue;
    if (tok.extranjero && !op.extranjero) continue;
    if (!incluir(tok)) continue;

    const turno = turnos[tok.turno];
    const lenguaLex = tok.extranjero ? null : lexicoDe(tok.lengua);
    const lex = lenguaLex ? lexicos[lenguaLex] : null;
    const w = tok.w.toLowerCase();
    const previo = tokens[tok.i - 1] && tokens[tok.i - 1].turno === tok.turno ? tokens[tok.i - 1] : null;
    const base = {
      clave: meta.clave, ciudad: meta.ciudad, token: tok.i, forma: tok.w,
      lengua: tok.extranjero ? `extranjera${tok.lengua ? " (" + tok.lengua + ")" : ""}` : tok.lengua || "español",
      lenguaLex: lenguaLex || "",
      avisos: [...tok.avisos],
      ejemplo: marcarContexto(turno, tok),
      contexto: marcarContexto(turno, tok, 25, 25),
      previa: previo ? previo.w.toLowerCase() : "",
    };

    const nuevos = [];
    const ds = dsIntervocalicas(w);
    // quedao tiene una d escrita (que-d-) y otra elidida (-ao): salen los dos casos.
    // Una palabra cortada («to… todos») es un arranque fallido, no una elisión.
    const r = lex && !tok.avisos.has("palabra cortada") ? restituir(w, lex, lenguaLex) : null;
    const std = r ? r.estandar : w;
    let pElidida = -1;
    if (r) {
      let i = 0;
      while (i < w.length && std[i] === w[i]) i++;
      const dsStd = dsIntervocalicas(std);
      pElidida = std[i] === "d" && dsStd.includes(i) ? i : std[i + 1] === "d" && dsStd.includes(i + 1) ? i + 1 : dsStd[dsStd.length - 1] ?? -1;
      const c = { ...base, avisos: [...base.avisos], estandar: std, posD: pElidida, tipo: "elisión escrita", posicion: "interior", d: "elidida (transcrita)" };
      if (r.apocope) c.avisos.push("apócope");
      if (r.ortografia) c.avisos.push("ortografía normalizada");
      if (r.ambigua) { c.avisos.push("posible elisión: revisar"); c.d = ""; c.ambigua = true; }
      if (r.alternativas && r.alternativas.length > 1) c.alternativas = r.alternativas;
      nuevos.push(c);
    }
    for (const p of ds) {
      const pStd = r && pElidida >= 0 && p >= pElidida ? p + (std.length - w.length) : p;
      const c = { ...base, avisos: [...base.avisos], estandar: std, posD: pStd, tipo: "-d- escrita", posicion: "interior", d: "" };
      if (lex && !r && !lex.conocida(w)) {
        const sinD = w.slice(0, p) + w.slice(p + 1);
        const regla = lex.conocida(sinD) ? null : lemasPorRegla(w, lex);
        if (lex.conocida(sinD)) {
          // bacalado: la d sobra; terminación y acento se miden sobre lo escrito.
          Object.assign(c, { tipo: "ultracorrección escrita", d: "ultracorrección (transcrita)", estandar: sinD, candidatos: [sinD], terminacion: terminacion(w, p), acento: lenguaLex === "es" ? acento(w, p) : "" });
          c.avisos.push("posible ultracorrección: revisar");
        }
        else if (regla) { c.candidatos = regla.lemas; c.categoria = regla.categoria || ""; c.avisos.push("lema por regla"); }
        else c.avisos.push("no está en el léxico");
      }
      nuevos.push(c);
    }
    // Varias d en la misma palabra (nadador, quedao): se numeran en orden.
    const internas = nuevos.filter((c) => c.posD >= 0).sort((a, b) => a.posD - b.posD);
    if (internas.length > 1) internas.forEach((c, k) => c.avisos.push(`${k + 1}.ª d de la palabra`));

    if (op.frontera && /^d/i.test(w) && esVocal(w[1]) && previo && !tok.pausaAntes) {
      const pw = previo.w.toLowerCase();
      if (esVocal(pw[pw.length - 1]) || pw === "y") {
        nuevos.push({ ...base, avisos: [...base.avisos], estandar: w, posD: 0, tipo: "-d- escrita", posicion: "entre palabras", d: "" });
      }
    }

    for (const c of nuevos) {
      const std = c.estandar;
      c.terminacion ??= c.posicion === "entre palabras" ? "inicial" : c.posD > 0 ? terminacion(std, c.posD) : "";
      c.acento ??= lenguaLex === "es" && c.posD > 0 ? acento(std, c.posD) : "";
      if (!c.candidatos) c.candidatos = lex ? lex.lemas(std) : [];
      if (lex && !c.candidatos.length && c.posicion === "entre palabras") c.candidatos = [std];
      if (lex && !c.candidatos.length && !c.avisos.some((a) => /léxico|regla/.test(a))) {
        const regla = lemasPorRegla(std, lex);
        if (regla) { c.candidatos = regla.lemas; c.categoria = regla.categoria || ""; }
        c.avisos.push(regla ? "lema por regla" : "no está en el léxico");
      }
      c.categoria = c.categoria || categoriaProvisional(std, c.previa);
      c.lema = lex ? elegirLema(c.candidatos, c.categoria, std, lenguaLex) : std;
      casos.push(c);
    }
  }
  return casos;
}
