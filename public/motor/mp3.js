// Corte de MP3 por tramas, sin recodificar. Sirve igual en el navegador, en el Worker y en Node.

const BITRATES = {
  // [versión MPEG1][capa III] y [MPEG2/2.5][capa III], en kbit/s
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
};
const MUESTREO = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

function cabecera(b, i) {
  if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[i + 1] >> 3) & 3;    // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const capa = (b[i + 1] >> 1) & 3;       // 1 = capa III
  if (version === 1 || capa !== 1) return null;
  const br = BITRATES[version === 3 ? 1 : 2][(b[i + 2] >> 4) & 15];
  const sr = (MUESTREO[version] || [])[(b[i + 2] >> 2) & 3];
  if (!br || !sr) return null;
  const relleno = (b[i + 2] >> 1) & 1;
  const muestras = version === 3 ? 1152 : 576;
  const largo = Math.floor(((muestras / 8) * br * 1000) / sr) + relleno;
  return { largo, dur: muestras / sr, mono: ((b[i + 3] >> 6) & 3) === 3, version };
}

// Índice de tramas: [{ off, largo, t }] con t = segundo de inicio de la trama.
export function indexar(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) { // ID3v2
    i = 10 + ((b[6] & 0x7f) << 21 | (b[7] & 0x7f) << 14 | (b[8] & 0x7f) << 7 | (b[9] & 0x7f));
  }
  const tramas = [];
  let t = 0;
  while (i < b.length - 4) {
    const h = cabecera(b, i);
    // Se exige que la trama siguiente también sea válida para no tomar datos por cabeceras.
    if (!h || (i + h.largo < b.length - 4 && !cabecera(b, i + h.largo))) { i++; continue; }
    // La trama Xing/Info del principio no contiene audio.
    const lado = h.version === 3 ? (h.mono ? 17 : 32) : (h.mono ? 9 : 17);
    const etiqueta = String.fromCharCode(b[i + 4 + lado], b[i + 5 + lado], b[i + 6 + lado], b[i + 7 + lado]);
    if (!tramas.length && (etiqueta === "Xing" || etiqueta === "Info")) { i += h.largo; continue; }
    tramas.push({ off: i, largo: h.largo, t });
    t += h.dur;
    i += h.largo;
  }
  return { bytes: b, tramas, duracion: t };
}

// Devuelve un MP3 con las tramas entre ini y fin (segundos). Se añaden dos tramas
// por delante porque la capa III puede tomar datos de las anteriores (depósito de bits).
export function cortar(indice, ini, fin) {
  const { bytes, tramas } = indice;
  let a = tramas.findIndex((f) => f.t >= ini);
  if (a < 0) return new Uint8Array(0);
  a = Math.max(0, a - 2);
  let z = a;
  while (z < tramas.length && tramas[z].t < fin) z++;
  const out = new Uint8Array(tramas.slice(a, z).reduce((n, f) => n + f.largo, 0));
  let p = 0;
  for (let k = a; k < z; k++) { out.set(bytes.subarray(tramas[k].off, tramas[k].off + tramas[k].largo), p); p += tramas[k].largo; }
  return out;
}

// Trozos de unos «largo» segundos, con «solape» segundos por delante, para Whisper.
export function trocear(indice, largo = 240, solape = 2) {
  const trozos = [];
  for (let ini = 0; ini < indice.duracion; ini += largo) {
    const desde = Math.max(0, ini - solape);
    // El trozo empieza dos tramas antes de «desde» (véase cortar): ese es su desfase real.
    const primera = Math.max(0, indice.tramas.findIndex((f) => f.t >= desde) - 2);
    trozos.push({ ini, fin: Math.min(indice.duracion, ini + largo), desfase: indice.tramas[primera].t, bytes: cortar(indice, desde, ini + largo) });
  }
  return trozos;
}
