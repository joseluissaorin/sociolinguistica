// Esquemas de valores para la columna -d-.
// El principal es el de la Guía PRESEEA de estudio de la /d/ intervocálica
// (Samper, Malaver y Samper, 2021, doi:10.37536/PRESEEA.2021.guia3): tres variantes
// (plena, relajada, elidida), que para comparar entre ciudades se agrupan en retenida/elidida.
// «no analizable» no es una variante: esos casos no entran en los porcentajes.
const NO_ANALIZABLE = ["no analizable", "solapamiento, ruido, risa o no se oye bien: no cuenta en los porcentajes (anotad el motivo en Notas)"];

export const ESQUEMAS = {
  guia: {
    nombre: "Guía PRESEEA: plena, relajada, elidida",
    valores: [
      ["plena", "la d se oye como aproximante [ð̞] clara"],
      ["relajada", "se oye algo, pero muy abierta o breve"],
      ["elidida", "no se oye nada entre las vocales (hiato, vocal alargada o diptongo)"],
      NO_ANALIZABLE,
    ],
  },
  dicotomia: {
    nombre: "Dicotomía: retenida, elidida",
    valores: [
      ["retenida", "se oye la d, plena o relajada"],
      ["elidida", "no se oye nada entre las vocales"],
      NO_ANALIZABLE,
    ],
  },
  fina: {
    nombre: "Fina: tensa, plena, relajada, elidida con hiato, elidida con diptongo",
    valores: [
      ["tensa", "casi oclusiva [d]"],
      ["plena", "aproximante [ð̞] clara"],
      ["relajada", "muy abierta o breve"],
      ["elidida con hiato", "sin d; las dos vocales se mantienen (can-sa-o)"],
      ["elidida con diptongo", "sin d; las vocales se funden o forman diptongo (cansáu)"],
      NO_ANALIZABLE,
    ],
  },
};

export const valoresDe = (clave) => (ESQUEMAS[clave] || ESQUEMAS.guia).valores.map(([v, d]) => ({ v, d }));
