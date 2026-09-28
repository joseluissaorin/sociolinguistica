// Audio de PRESEEA: casi siempre MP3, pero algunos «.mp3» del corpus son en realidad WAV
// (PCM sin comprimir). Esta capa detecta el formato y corta igual los dos.
import * as mp3 from "./mp3.js";

function leerWav(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12, fmt = null, datos = null;
  while (p + 8 <= b.length) {
    const id = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
    let largo = dv.getUint32(p + 4, true);
    if (id === "fmt ") fmt = { canales: dv.getUint16(p + 10, true), frecuencia: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true), formato: dv.getUint16(p + 8, true) };
    if (id === "data") { datos = { off: p + 8, largo: Math.min(largo, b.length - p - 8) }; break; }
    p += 8 + largo + (largo & 1);
  }
  if (!fmt || !datos || fmt.formato !== 1 || fmt.bits !== 16) throw new Error("WAV no admitido (solo PCM de 16 bits)");
  const bloque = fmt.canales * 2;
  return { tipo: "wav", bytes: b, ...fmt, bloque, datos, duracion: datos.largo / bloque / fmt.frecuencia };
}

function cabeceraWav(frecuencia, canales, bytesDatos) {
  const h = new DataView(new ArrayBuffer(44));
  const t = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  t(0, "RIFF"); h.setUint32(4, 36 + bytesDatos, true); t(8, "WAVE"); t(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, canales, true);
  h.setUint32(24, frecuencia, true); h.setUint32(28, frecuencia * canales * 2, true);
  h.setUint16(32, canales * 2, true); h.setUint16(34, 16, true); t(36, "data"); h.setUint32(40, bytesDatos, true);
  return new Uint8Array(h.buffer);
}

export function indexar(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return leerWav(b);
  return { tipo: "mp3", ...mp3.indexar(b) };
}

export const extension = (indice) => (indice.tipo === "wav" ? "wav" : "mp3");
export const tipoMime = (ruta) => (/\.wav$/i.test(ruta) ? "audio/wav" : "audio/mpeg");

export function cortar(indice, ini, fin) {
  if (indice.tipo !== "wav") return mp3.cortar(indice, ini, fin);
  const { bytes, datos, bloque, frecuencia, canales } = indice;
  const a = Math.max(0, Math.floor(ini * frecuencia)) * bloque;
  const z = Math.min(datos.largo, Math.ceil(fin * frecuencia) * bloque);
  if (z <= a) return new Uint8Array(0);
  const out = new Uint8Array(44 + z - a);
  out.set(cabeceraWav(frecuencia, canales, z - a));
  out.set(bytes.subarray(datos.off + a, datos.off + z), 44);
  return out;
}

// WAV a 16 kHz y mono (lo que usa Whisper): ocupa hasta seis veces menos.
function wav16k(indice, ini, fin) {
  const { bytes, datos, bloque, frecuencia, canales } = indice;
  const dv = new DataView(bytes.buffer, bytes.byteOffset + datos.off, datos.largo);
  const total = datos.largo / bloque;
  const paso = frecuencia / 16000;
  const n = Math.max(0, Math.floor((Math.min(fin, indice.duracion) - ini) * 16000));
  const out = new Uint8Array(44 + n * 2);
  out.set(cabeceraWav(16000, 1, n * 2));
  const dvo = new DataView(out.buffer, 44);
  for (let k = 0; k < n; k++) {
    // Media de las muestras que caen en este intervalo (filtro paso bajo sencillo).
    const s0 = Math.floor(ini * frecuencia + k * paso), s1 = Math.min(total, Math.max(s0 + 1, Math.floor(ini * frecuencia + (k + 1) * paso)));
    let suma = 0, cuenta = 0;
    for (let s = s0; s < s1; s++) for (let c = 0; c < canales; c++) { suma += dv.getInt16(s * bloque + c * 2, true); cuenta++; }
    dvo.setInt16(k * 2, cuenta ? Math.round(suma / cuenta) : 0, true);
  }
  return out;
}

// Trozos para Whisper con su desfase real (véase mp3.trocear).
export function trocear(indice, largo = 240, solape = 2) {
  if (indice.tipo !== "wav") return mp3.trocear(indice, largo, solape);
  const trozos = [];
  const l = Math.min(largo, 120);
  for (let ini = 0; ini < indice.duracion; ini += l) {
    const desde = Math.max(0, ini - solape);
    trozos.push({ ini, fin: Math.min(indice.duracion, ini + l), desfase: desde, bytes: wav16k(indice, desde, ini + l) });
  }
  return trozos;
}
