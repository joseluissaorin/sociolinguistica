// Proceso completo de una entrevista: transcripción + Whisper → casos con tiempo y recorte.
import { leerTranscripcion } from "./transcripcion.js";
import { alinear } from "./alineacion.js";
import { detectar } from "./deteccion.js";
import { indexar, cortar, extension } from "./audio.js";
import { paraArchivo } from "./texto.js";

export const MARGEN = 1.5;
const GRUPOS = { 1: "1 (20-34)", 2: "2 (35-54)", 3: "3 (55 o más)" };

// texto: transcripción ya decodificada; mp3: Uint8Array; whisper: respuesta de /api/whisper.
export function procesarEntrevista({ texto, nombre, mp3, whisper, lexicos, opciones = {}, margen = MARGEN }) {
  const tr = leerTranscripcion(texto, nombre);
  const al = alinear(tr.tokens, whisper.palabras, whisper.duracion, tr.anclas);
  const casos = detectar(tr, lexicos, opciones, (tok) => al.tiempos[tok.i] !== null);
  const indice = mp3 ? indexar(mp3) : null;
  const recortes = new Map();
  const porToken = new Map();
  const { meta } = tr;
  const ciudad = meta.ciudad || "Sin ciudad";

  casos.forEach((c, k) => {
    const t = al.tiempos[c.token];
    c.id = `${meta.clave}-${String(k + 1).padStart(4, "0")}`;
    c.genero = meta.sexo;
    c.edad = GRUPOS[meta.grupoEdad] || meta.grupoEdad;
    c.anos = meta.edad;
    c.educacion = meta.nivel;
    c.inicio = t.ini;
    c.fin = t.fin;
    c.alineacion = t.calidad;
    // Si el tiempo es interpolado, el recorte cubre todo el hueco entre las palabras emparejadas
    // vecinas (hasta 15 s): así la palabra queda dentro aunque la estimación se desvíe.
    let [r0, r1] = [t.ini, t.fin];
    if (t.ventana && t.ventana[1] - t.ventana[0] <= 15) { [r0, r1] = t.ventana; c.avisos.push("recorte ampliado"); }
    else if (t.calidad === "dudosa") c.avisos.push("tiempo aproximado: puede no estar en el recorte");
    // Las dos d de «quedao» comparten recorte.
    if (!porToken.has(c.token)) {
      const ruta = `Recortes/${paraArchivo(ciudad)}/${meta.clave}/${c.id}_${paraArchivo(c.forma) || "palabra"}.${indice ? extension(indice) : "mp3"}`;
      porToken.set(c.token, ruta);
      if (indice) recortes.set(ruta, cortar(indice, Math.max(0, r0 - margen), r1 + margen));
    }
    c.recorte = porToken.get(c.token);
  });

  return {
    meta, casos, recortes,
    alineacion: { emparejadas: al.emparejadas, palabrasWhisper: al.palabrasWhisper, cobertura: al.cobertura },
    duracionAudio: whisper.duracion,
  };
}

// Transcripción de Whisper legible, con el tiempo delante de cada segmento.
export function whisperATexto(whisper) {
  const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
  return whisper.segmentos.map(([a, b, t]) => `[${mmss(a)} - ${mmss(b)}] ${t}`).join("\n") + "\n";
}
