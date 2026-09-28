// Alineación de la transcripción de PRESEEA con las palabras de Whisper para dar
// a cada palabra de la transcripción su segundo en el audio.
// Programación dinámica semiglobal: la transcripción puede sobrar por el final
// (el audio abierto es un fragmento) y por el principio.
import { normalizar } from "./texto.js";

// tomao y tomado deben casar: se comparan también sin la d entre vocales.
const sinD = (s) => s.replace(/([aeiou])d(?=[aeiou])/g, "$1").replace(/([aeiou])\1+/g, "$1");

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const f = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = f[0]; f[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = f[j];
      f[j] = Math.min(f[j] + 1, f[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return f[b.length];
}

const EXACTA = 3, PARECIDA = 1, DISTINTA = -2, HUECO = -1;

function parecido(a, b) {
  if (!a || !b) return DISTINTA;
  if (a === b || sinD(a) === sinD(b)) return EXACTA;
  const d = levenshtein(a, b);
  return d / Math.max(a.length, b.length) <= 0.34 ? PARECIDA : DISTINTA;
}

// tokens: [{ w }] de leerTranscripcion; palabras: [[texto, ini, fin]] de Whisper.
// Devuelve { tiempos: [{ ini, fin, calidad } | null] por token, cobertura, cuantos }.
export function alinear(tokens, palabras, duracion, anclas = []) {
  const W = palabras.map((p) => normalizar(p[0]));
  const m = W.length;
  // Ventana de la transcripción: hasta un poco después de donde las marcas <tiempo> pasan del final del audio.
  let n = tokens.length;
  const pasada = anclas.find((a) => a.seg > duracion + 90);
  if (pasada) n = Math.min(n, pasada.token);
  n = Math.min(n, m * 3 + 400);
  const T = tokens.slice(0, n).map((t) => normalizar(t.w));

  const ancho = n + 1;
  const D = new Int32Array((m + 1) * ancho);
  const P = new Uint8Array((m + 1) * ancho); // 1 diagonal, 2 arriba (palabra de Whisper sin pareja), 3 izquierda (token sin pareja)
  for (let i = 1; i <= m; i++) { D[i * ancho] = i * HUECO; P[i * ancho] = 2; }
  for (let j = 1; j <= n; j++) { D[j] = 0; P[j] = 3; } // hueco inicial gratis en la transcripción
  for (let i = 1; i <= m; i++) {
    const wi = W[i - 1], fila = i * ancho, filaAnt = (i - 1) * ancho;
    for (let j = 1; j <= n; j++) {
      const diag = D[filaAnt + j - 1] + parecido(wi, T[j - 1]);
      const arriba = D[filaAnt + j] + HUECO;
      const izq = D[fila + j - 1] + HUECO;
      if (diag >= arriba && diag >= izq) { D[fila + j] = diag; P[fila + j] = 1; }
      else if (arriba >= izq) { D[fila + j] = arriba; P[fila + j] = 2; }
      else { D[fila + j] = izq; P[fila + j] = 3; }
    }
  }
  // Hueco final gratis en la transcripción: se parte de la mejor celda de la última fila.
  let j = 0;
  for (let k = 1; k <= n; k++) if (D[m * ancho + k] > D[m * ancho + j]) j = k;
  const pareja = new Array(tokens.length).fill(-1);
  const puntos = new Array(tokens.length).fill(0);
  let i = m;
  while (i > 0 && j > 0) {
    const p = P[i * ancho + j];
    if (p === 1) {
      const s = parecido(W[i - 1], T[j - 1]);
      if (s > 0) { pareja[j - 1] = i - 1; puntos[j - 1] = s; }
      i--; j--;
    } else if (p === 2) i--;
    else j--;
  }

  // Tiempos: los tokens emparejados, directos; los demás, interpolados entre vecinos.
  const tiempos = new Array(tokens.length).fill(null);
  const fijos = [];
  for (let k = 0; k < tokens.length; k++) if (pareja[k] >= 0) {
    const [, ini, fin] = palabras[pareja[k]];
    tiempos[k] = { ini, fin, calidad: puntos[k] === EXACTA ? "exacta" : "parecida" };
    fijos.push(k);
  }
  for (let f = 0; f < fijos.length - 1; f++) {
    const a = fijos[f], b = fijos[f + 1];
    if (b - a < 2) continue;
    const t0 = tiempos[a].fin, t1 = tiempos[b].ini;
    const hueco = Math.max(0, t1 - t0);
    const calidad = b - a <= 6 && hueco <= 4 ? "interpolada" : "dudosa";
    for (let k = a + 1; k < b; k++) {
      const x0 = t0 + (hueco * (k - a - 1)) / (b - a - 1), x1 = t0 + (hueco * (k - a)) / (b - a - 1);
      tiempos[k] = { ini: +x0.toFixed(2), fin: +Math.max(x1, x0 + 0.15).toFixed(2), calidad };
    }
  }
  return { tiempos, emparejadas: fijos.length, palabrasWhisper: m, cobertura: m ? fijos.length / m : 0, ultimoToken: fijos.length ? fijos[fijos.length - 1] : -1 };
}
