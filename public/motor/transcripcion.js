// Lectura de las transcripciones de PRESEEA: cabecera, turnos y palabras.
// Las transcripciones tienen etiquetas mal cerradas, comillas tipográficas y
// <alargamiento/> en mitad de palabra; el lector lo tolera todo.

export function decodificar(bytes) {
  let t;
  try { t = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { t = new TextDecoder("windows-1252").decode(bytes); }
  return t.replace(/^﻿/, "");
}

const CLAVE = /^[A-Z]{3,5}_[HM]\d\d_\d{2,4}$/;

function atributos(s) {
  const a = {};
  for (const m of s.matchAll(/([\wáéíóúñ]+)\s*=\s*["“”]([^"“”]*)["“”]/g)) a[m[1]] = m[2].trim();
  return a;
}

function leerCabecera(cab, nombre) {
  const corpus = atributos((cab.match(/<Corpus[^>]*>/i) || [""])[0]);
  const datos = atributos((cab.match(/<Datos[^>]*>/i) || [""])[0]);
  const hablantes = [...cab.matchAll(/<Hablante\b[^>]*>/gi)].map((m) => atributos(m[0]));
  const inf = hablantes.find((h) => (h.codigo_hab || "").toUpperCase() === "I")
    || hablantes.find((h) => /inform/i.test(h.papel || "")) || {};

  let clave = (nombre || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  if (!CLAVE.test(clave)) clave = (datos.clave_texto || inf.nombre || "").replace(/\s+/g, "").replace(/AMBAS/i, "").replace(/\.WAV$/i, "");
  // H21: sexo, grupo de edad y nivel de estudios van codificados en la clave.
  const m = clave.match(/_([HM])(\d)(\d)_/);
  const NIVEL = { 1: "bajo", 2: "medio", 3: "alto" };
  const nivel = (inf.nivel_edu || "").toLowerCase();
  return {
    clave,
    ciudad: corpus.ciudad || corpus.subcorpus || "",
    pais: corpus.pais || "",
    sexo: (inf.sexo || (m ? (m[1] === "H" ? "hombre" : "mujer") : "")).toLowerCase(),
    grupoEdad: inf.grupo_edad || (m ? m[2] : ""),
    edad: inf.edad || "",
    nivel: ["bajo", "medio", "alto"].includes(nivel) ? nivel : (m ? NIVEL[m[3]] : nivel),
  };
}

// Segundos a partir de «02:10», «00:00:01», «9:05», con comillas raras o letras sueltas.
function segundos(attr) {
  const m = attr.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}

const TURNO = /^\s*([A-Za-z][A-Za-z0-9]{0,3})\s*\.?\s*:\s?(.*)$/;
const PIEZA = /(<[^<>]*>)|(<[^<>\s]*)|([\p{L}\p{M}]+(?:['’·][\p{L}\p{M}]+)*)|(\/+)|(\s+)|([^\s<\/\p{L}\p{M}]+)/gu;
const ESTADOS = ["simultáneo", "lengua", "extranjero", "extranjerismo", "transcripción_dudosa", "sic", "entre_risas", "siglas", "cita"];

// Devuelve { meta, turnos, tokens, anclas }.
//   tokens: todas las palabras de la entrevista, de todos los hablantes, en orden.
//   anclas: [{ token, seg }] a partir de las marcas <tiempo>.
export function leerTranscripcion(texto, nombre = "") {
  const corte = texto.search(/<\/Trans>/i);
  const finCab = corte >= 0 ? corte + 8 : Math.max(0, texto.search(/<\/Hablantes>/i));
  const meta = leerCabecera(texto.slice(0, finCab), nombre);
  const turnos = [], tokens = [], anclas = [];
  const estado = {};   // etiqueta → valor mientras está abierta
  let actual = null;

  for (const linea of texto.slice(finCab).split(/\r?\n/)) {
    const mt = linea.match(TURNO);
    let resto;
    if (mt && !/^(https?|www)$/i.test(mt[1])) {
      actual = { hablante: mt[1].toUpperCase(), texto: "", tokens: [] };
      turnos.push(actual);
      resto = mt[2];
      for (const k of Object.keys(estado)) delete estado[k]; // las etiquetas no cruzan turnos
    } else {
      if (!actual || !linea.trim()) continue;
      resto = " " + linea; // continuación del turno anterior
    }

    let pausa = false, ultimaPalabra = null, pegado = false; // pegado: <alargamiento/> sin espacio tras una palabra
    for (const m of resto.matchAll(PIEZA)) {
      const [pieza, etiqueta, rota, palabra, barras, espacio] = m;
      if (etiqueta) {
        const t = etiqueta.slice(1, -1).trim();
        const cierre = t.startsWith("/");
        const nombreEt = t.replace(/^\/\s*/, "").split(/[\s=\/]/)[0].toLowerCase();
        if (nombreEt.startsWith("alargamiento")) { pegado = ultimaPalabra !== null && m.index === ultimaPalabra.finLocal; continue; }
        pegado = false;
        if (nombreEt === "tiempo") { const s = segundos(t); if (s !== null) anclas.push({ token: tokens.length, seg: s }); continue; }
        if (nombreEt === "palabra_cortada" || nombreEt === "palaba_cortada") { if (ultimaPalabra) ultimaPalabra.avisos.add("palabra cortada"); continue; }
        if (ESTADOS.includes(nombreEt)) {
          if (cierre) delete estado[nombreEt];
          else if (!t.endsWith("/")) estado[nombreEt] = nombreEt === "lengua" ? (atributos(t).lengua || (t.match(/["“”]([^"“”]+)/) || [])[1] || "otra") : true;
        }
        continue;
      }
      if (rota) { pegado = false; continue; }
      if (barras) { pausa = true; actual.texto += " " + barras; pegado = false; ultimaPalabra = null; continue; }
      if (espacio) { pegado = false; if (ultimaPalabra) ultimaPalabra.finLocal = -1; continue; }
      if (palabra) {
        if (pegado && ultimaPalabra) {
          // chancla<alargamiento/>s → «chanclas»
          ultimaPalabra.w += palabra;
          actual.texto += palabra;
          ultimaPalabra.fin = actual.texto.length;
          ultimaPalabra.finLocal = m.index + palabra.length;
          pegado = false;
          continue;
        }
        if (actual.texto && !/[\s¿¡(]$/.test(actual.texto)) actual.texto += " ";
        const tok = {
          w: palabra, i: tokens.length, turno: turnos.length - 1, hablante: actual.hablante,
          ini: actual.texto.length, fin: actual.texto.length + palabra.length, finLocal: m.index + palabra.length,
          pausaAntes: pausa, lengua: estado.lengua || "", extranjero: !!(estado.extranjero || estado.extranjerismo),
          sigla: !!estado.siglas, avisos: new Set(),
        };
        if (estado["simultáneo"]) tok.avisos.add("habla simultánea");
        if (estado["transcripción_dudosa"]) tok.avisos.add("transcripción dudosa");
        if (estado.sic) tok.avisos.add("sic");
        if (estado.entre_risas) tok.avisos.add("entre risas");
        actual.texto += palabra;
        tokens.push(tok);
        actual.tokens.push(tok.i);
        ultimaPalabra = tok;
        pausa = false;
        continue;
      }
      // Puntuación: ¿? ¡! . , …
      pegado = false;
      const p = pieza.replace(/[<>]/g, "");
      if (!p) continue;
      if (/^[¿¡(]/.test(p) && actual.texto && !/\s$/.test(actual.texto)) actual.texto += " ";
      actual.texto += p;
      if (/[.?!…]/.test(p)) pausa = true;
    }
  }
  for (const t of tokens) delete t.finLocal;
  return { meta, turnos, tokens, anclas };
}
