// Tabla de casos: columnas, escritura y lectura del CSV (punto y coma, UTF-8 con BOM para Excel).

const num = (x) => (x === undefined || x === null || x === "" ? "" : String(x).replace(".", ","));

// Las nueve primeras son las de estructura-base-datos.csv, en su orden.
export const COLUMNAS = [
  ["Hablante", (c) => c.clave],
  ["Ciudad", (c) => c.ciudad],
  ["Ejemplo", (c) => c.ejemplo],
  ["Forma", (c) => c.forma],
  ["Lema", (c) => c.lema],
  ["-d-", (c) => c.d],
  ["Género", (c) => c.genero],
  ["Edad", (c) => c.edad],
  ["Educación", (c) => c.educacion],
  ["ID", (c) => c.id],
  ["Forma estándar", (c) => c.estandar],
  ["Tipo", (c) => c.tipo],
  ["Posición", (c) => c.posicion],
  ["Terminación", (c) => c.terminacion],
  ["Acento", (c) => c.acento],
  ["Categoría", (c) => c.categoria],
  ["Confianza Jev", (c) => (c.confianzaJev === undefined ? "" : c.confianzaJev + " %")],
  ["Lengua", (c) => c.lengua],
  ["Guía PRESEEA", (c) => c.guia],
  ["Aviso", (c) => (c.avisos || []).join("; ")],
  ["Años", (c) => c.anos],
  ["Inicio", (c) => num(c.inicio)],
  ["Fin", (c) => num(c.fin)],
  ["Alineación", (c) => c.alineacion],
  ["Recorte", (c) => c.recorte],
  ["Enlace", (c) => c.enlace],
  ["Revisor", (c) => c.revisor],
  ["Notas", (c) => c.notas],
  ["Asignado a", (c) => c.asignado],
];
export const CABECERA = COLUMNAS.map(([n]) => n);

// Columnas que rellena el grupo: son las que se fusionan al sincronizar.
export const EDITABLES = ["-d-", "Lema", "Categoría", "Revisor", "Notas", "Asignado a"];

const campo = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aFilas(casos) {
  return casos.map((c) => Object.fromEntries(COLUMNAS.map(([n, f]) => [n, f(c) ?? ""])));
}

export function escribirCSV(filas, cabecera = CABECERA) {
  return "﻿" + [cabecera.map(campo).join(";"), ...filas.map((f) => cabecera.map((n) => campo(f[n])).join(";"))].join("\r\n") + "\r\n";
}

// Lector tolerante: detecta el separador (tabulador, punto y coma o coma) y las comillas.
export function leerCSV(texto) {
  texto = texto.replace(/^﻿/, "");
  const primera = texto.split(/\r?\n/, 1)[0];
  const sep = ["\t", ";", ","].map((s) => [s, primera.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const filas = [];
  let fila = [], v = "", i = 0, comillas = false;
  while (i < texto.length) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { v += '"'; i += 2; continue; }
      if (c === '"') { comillas = false; i++; continue; }
      v += c; i++; continue;
    }
    if (c === '"' && v === "") { comillas = true; i++; continue; }
    if (c === sep) { fila.push(v); v = ""; i++; continue; }
    if (c === "\n" || c === "\r") {
      fila.push(v); v = "";
      if (fila.some((f) => f.trim() !== "")) filas.push(fila);
      fila = [];
      if (c === "\r" && texto[i + 1] === "\n") i++;
      i++; continue;
    }
    v += c; i++;
  }
  fila.push(v);
  if (fila.some((f) => f.trim() !== "")) filas.push(fila);
  if (!filas.length) return { cabecera: [], filas: [] };
  const cabecera = filas[0].map((s) => s.trim());
  return { cabecera, filas: filas.slice(1).map((f) => Object.fromEntries(cabecera.map((n, k) => [n, f[k] ?? ""]))) };
}

// Fusión a tres bandas por ID: base (lo último sincronizado), local y remoto.
// Si solo un lado cambió una casilla, gana ese; si cambiaron los dos y difieren, es un conflicto:
// se queda el valor remoto (la hoja compartida) y se anota.
export function fusionar(base, local, remoto, columnas = EDITABLES) {
  const idx = (filas) => new Map(filas.map((f) => [f.ID, f]));
  const B = idx(base || []), L = idx(local), R = idx(remoto);
  const conflictos = [];
  const ids = [...new Set([...L.keys(), ...R.keys()])];
  const salida = ids.map((id) => {
    const l = L.get(id), r = R.get(id), b = B.get(id) || {};
    if (!l) return { ...r };
    if (!r) return { ...l };
    // Las columnas calculadas mandan desde el análisis local; las del grupo se fusionan abajo.
    const f = { ...r, ...Object.fromEntries(Object.entries(l).filter(([k]) => !columnas.includes(k))) };
    for (const col of columnas) {
      const vb = (b[col] ?? "").trim(), vl = (l[col] ?? "").trim(), vr = (r[col] ?? "").trim();
      if (vl === vr) f[col] = vl;
      else if (vl === vb) f[col] = vr;
      else if (vr === vb) f[col] = vl;
      else if (!vr) f[col] = vl;
      else if (!vl) f[col] = vr;
      else { f[col] = vr; conflictos.push({ id, columna: col, local: vl, remoto: vr }); }
    }
    return f;
  });
  return { filas: salida, conflictos };
}
