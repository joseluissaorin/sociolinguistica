# La -d- intervocálica en PRESEEA

Una herramienta para estudiar la -d- intervocálica (*cansado*, *cansao*) en las entrevistas del corpus [PRESEEA](https://preseea.uah.es/). Busca todos los casos en las transcripciones, los sitúa en el audio, corta un recorte por caso, los categoriza con Jev y abre un estudio para escucharlos y decidir, uno a uno, cómo se pronuncia la d.

Nació para el trabajo de Sociolingüística y Etnolingüística de la Universidad de La Laguna, pero sirve para cualquier ciudad del corpus.

**En línea:** <https://sociolinguistica.joseluissaorin.com>

## Cómo se usa

1. Haz una consulta en el [buscador de PRESEEA](https://preseea.uah.es/corpus/consultas.php). Para tener todas las entrevistas de una ciudad basta con buscar una palabra muy frecuente (*de*) filtrando por ella; se pueden marcar varias ciudades.
2. Descarga el CSV de resultados y arrástralo a la web (o pega las claves de las entrevistas).
3. Elige las opciones y pulsa «Procesar». Sale un ZIP con la tabla de casos, los recortes y el estudio.
4. Descomprime el ZIP y abre `estudio.html` en el navegador. Escucha cada caso y márcalo con el teclado (1 mantenida, 2 relajada, 3 elidida, 4 no se oye; los valores se pueden cambiar).
5. Cada persona del grupo exporta su CSV y se fusionan con «Fusionar CSV», o se sincroniza todo con una hoja de Google desde la terminal (más abajo).

La primera vez que alguien procesa una entrevista, Whisper tarda cerca de un minuto; después la transcripción queda guardada y sale al momento para todo el mundo.

## Qué sale

```
casos.csv          un caso por fila
descartados.csv    posibles elisiones que Jev considera otra palabra (tos de toser, pues…)
estudio.html       el estudio, con los datos dentro: funciona sin conexión
Recortes/          un audio por caso, con 1,5 s de margen a cada lado
Whisper/           la transcripción automática de cada audio, con tiempos (.txt y .json)
casos.json         los casos con todos sus datos internos
resumen.csv        casos por hablante
```

Las nueve primeras columnas de `casos.csv` son las de la base de datos del trabajo: **Hablante; Ciudad; Ejemplo; Forma; Lema; -d-; Género; Edad; Educación**. Detrás van otras que ayudan a analizar y a revisar:

| Columna | Qué es |
| --- | --- |
| ID | Identificador fijo del caso (`BARC_H21_085-0011`); con él se cruzan el CSV, el estudio y la hoja de cálculo. |
| Forma estándar | La palabra con su d: *tomao* → *tomado*. |
| Tipo | `-d- escrita`, `elisión escrita` (la transcripción ya la escribe sin d) o `ultracorrección escrita` (*bacalado*). |
| Posición | Dentro de la palabra o entre dos palabras. |
| Terminación | `-ado`, `-ada`, `-ido`, `-ida`, `-udo`… si la d está en la última sílaba; si no, `interior`. |
| Acento | Si la vocal anterior a la d es la tónica. |
| Categoría, Confianza Jev | Función gramatical en esa frase y cuánto se fía Jev. |
| Lengua | `español`, `catalán`, `extranjera`… según las etiquetas de la transcripción. |
| Aviso | Lo que conviene mirar: habla simultánea, transcripción dudosa, palabra cortada, elisión dudosa, tiempo aproximado… |
| Inicio, Fin, Alineación | Segundo de la palabra en el audio y cómo se obtuvo (`exacta`, `parecida`, `interpolada`, `dudosa`). |
| Recorte, Enlace | El audio del caso en el ZIP y, si se sube, en Drive. |
| Revisor, Notas | Para el grupo. |

| Guía PRESEEA | `cuenta`, o por qué la guía oficial excluye el caso: d entre palabras, palabra cortada, semivocal (*raudo*) o semiconsonante (*medio*, *estudio*). |
| Asignado a | Reparto del trabajo entre las personas del grupo (véase `repartir`). |

La columna **-d-** solo trae un valor cuando la transcripción ya lo muestra (`elidida (transcrita)`, `ultracorrección (transcrita)`); el resto lo decide el grupo escuchando.

## Qué valores se usan para decidir

Por defecto, los de la *[Guía PRESEEA de estudio de la /d/ intervocálica](https://preseea.uah.es/sites/default/files/2022-02/Gu%C3%ADa%20PRESEEA%20de%20estudio%20de%20la%20d%20intervoc%C3%A1lica_Samper,%20Malaver%20y%20Samper%20(2021).pdf)* (Samper, Malaver y Samper, 2021), que es el esquema de los estudios PRESEEA de Madrid, Granada, Sevilla, Las Palmas o Caracas:

- **plena**: la d se oye como aproximante [ð̞] clara;
- **relajada**: se oye algo, pero muy abierta o breve;
- **elidida**: no se oye nada entre las vocales (hiato, vocal alargada o diptongo);
- **no analizable**: solapamiento, ruido, risa o no se oye bien. No es una variante: estos casos no entran en los porcentajes.

Para comparar entre ciudades, la guía agrupa plena y relajada como «retenida» frente a «elidida». Hay otros dos esquemas listos (la dicotomía retenida/elidida y uno fino con *tensa* y dos tipos de elisión) y se pueden escribir valores propios: al procesar en la web, en los ajustes del estudio o con `--esquema` en la terminal. Si el grupo cambia de esquema, conviene que lo haga todo el mundo a la vez.

La guía excluye además algunos contextos: la d entre palabras, las palabras cortadas y los contactos con semivocal o semiconsonante (*raudo*, *medio*, *estudio*), donde la d se conserva casi siempre. Esos casos no se borran (así los ID no cambian), pero la columna «Guía PRESEEA» dice por qué quedarían fuera.

## Cómo encuentra los casos

- **Solo los turnos del informante.** Las etiquetas se quitan antes de buscar, también las que parten una palabra (`chancla<alargamiento/>s`), que de otro modo harían perder casos. Se toleran las etiquetas mal cerradas y las comillas tipográficas que aparecen en algunas transcripciones.
- **La d escrita entre vocales**, con o sin tilde (*todo*, *además*, *podía*). Si una palabra tiene dos, salen dos casos.
- **Las elisiones que ya vienen escritas**, que un buscador de «d» no vería nunca: se repone la d en cada hiato y se comprueba en el diccionario (*tomao* → *tomado*, *salío* → *salido*, *lao* → *lado*, *demaciao* → *demasiado*), y se reconocen las apócopes habituales (*na*, *to*, *tos*, *pue*). Las dudosas se marcan para revisar y Jev decide si de verdad son elisiones. Las palabras con hiatos que existen de por sí (*lío*, *vía*, *seis*, *precio*) no se confunden, aunque vengan sin tilde.
- **Una palabra puede dar dos casos:** *quedao* tiene una d escrita (*que-d-*) y otra elidida (*-ao*).
- **Las ultracorrecciones**, como *bacalado* por *bacalao*.
- **Opciones:** la d inicial entre vocales de dos palabras (*la dama*, *me dijo*, siempre que no haya pausa entre ellas); los pasajes marcados en otra lengua, que se lematizan con el léxico catalán cuando toca; y las palabras marcadas como extranjeras.
- **Solo los casos con audio.** Los MP3 abiertos del corpus duran unos diez minutos aunque la entrevista sea más larga, así que solo entran los casos que caen dentro de ese fragmento. Algunos «.mp3» del corpus son en realidad WAV; también funcionan.

## Tiempos: Whisper y alineación

El audio se transcribe con Whisper (`whisper-large-v3-turbo` en Workers AI) con tiempos por palabra, y esa transcripción se alinea con la de PRESEEA mediante programación dinámica. Las palabras emparejadas reciben su tiempo; las demás, uno interpolado entre sus vecinas. En las entrevistas de prueba se emparejan entre el 93 % y el 98 % de las palabras, y las marcas `<tiempo>` de PRESEEA coinciden con el resultado.

Cuando el tiempo de una palabra es interpolado, el recorte abarca todo el hueco entre las dos palabras emparejadas más cercanas (hasta 15 s), de modo que la palabra queda dentro aunque la estimación se desvíe; esos casos llevan el aviso «recorte ampliado». En una muestra al azar vuelta a transcribir, todos los recortes con tiempo exacto contenían su palabra.

Whisper solo aporta el tiempo. La forma y la decisión salen de la transcripción del corpus y del oído del grupo, porque Whisper normaliza lo que oye: escribe *tomado* donde se dijo *tomao*. Para el alineamiento, *tomao* y *tomado* se tratan como la misma palabra.

## Lemas y Jev

El lema sale de un léxico de formas del español y del catalán (las [listas de lematización](https://github.com/michmech/lemmatization-lists) de Michal Měchura), reducido a las formas que pueden intervenir en un caso. Lo que no está en el léxico se resuelve con reglas: adverbios en *-mente*, clíticos (*quedarme* → *quedar*), superlativos, diminutivos, prefijos y participios.

[Jev](https://typesafe.ai) no escribe texto: elige entre opciones y da una probabilidad. El código le propone los candidatos y Jev decide en contexto:

- **la categoría gramatical** del caso en esa frase;
- **el lema** cuando hay varios posibles (*nada* pronombre o *nadar*);
- **si una elisión dudosa lo es** (*tos* de *todos* o de *toser*).

Para los participios, el lema depende del uso: si funciona como verbo, el infinitivo (*ha cansado* → *cansar*); si funciona como adjetivo o nombre, el masculino singular (*estoy cansada* → *cansado*, *las abogadas* → *abogado*). Dos reglas fijas corrigen a Jev cuando hace falta: un participio detrás de *haber* es siempre verbal, y si Jev dice «verbo» ante una forma que es justo el participio de su lema (*querido* de *querer*), se toma como participio.

## Desde la terminal

La misma herramienta existe como programa de terminal, útil para procesar carpetas que ya tengas descargadas (por ejemplo, con [Descargas PRESEEA](https://preseea.joseluissaorin.com)) y para sincronizar con una hoja de Google.

```sh
npm install
node cli/socio.mjs procesar "PRESEEA Barcelona" "PRESEEA Palma" --salida analisis
node cli/socio.mjs categorizar analisis --todo      # repetir la categorización con Jev
```

Cada carpeta de entrada tiene `Audios/` y `Transcripciones/`. Opciones de `procesar`: `--frontera`, `--sin-otras-lenguas`, `--sin-extranjero`, `--sin-jev`, `--margen 2`, `--solo BARC_H21_085,BARC_M13_001`. Si vuelves a procesar encima de una carpeta, se conserva lo que ya estuviera rellenado. Los ID se asignan en orden dentro de cada entrevista, así que cambiar las opciones de búsqueda cambia los ID: decidid las opciones antes de empezar a rellenar.

### Repartir el trabajo

```sh
node cli/socio.mjs repartir analisis --entre "Ana,Luis,Marta"   # partes iguales, columna «Asignado a»
node cli/socio.mjs paquetes analisis                            # un ZIP por persona y uno completo
```

Cada entrevista va entera a una persona según un cuadrado latino sobre edad y nivel de estudios, de modo que todas escuchan hombres y mujeres de las tres edades, los tres niveles y todas las ciudades; después se igualan los totales partiendo las menos entrevistas posibles. En el estudio, al escribir el nombre en Ajustes se filtran los casos propios y el progreso cuenta solo esos.

### Hoja de Google compartida

Con [gog](https://github.com/openclaw/gogcli) configurado:

```sh
node cli/socio.mjs hoja analisis --carpeta <ID de la carpeta de Drive>   # sube los recortes y crea la hoja
node cli/socio.mjs sincronizar analisis                                  # en los dos sentidos
```

`hoja` sube los recortes a Drive, rellena la columna «Enlace» y crea la hoja de cálculo. `sincronizar` hace una fusión a tres bandas por ID: compara la hoja y el CSV local con la última versión sincronizada. Si solo cambió un lado, gana ese; si cambiaron los dos y no coinciden, se queda el valor de la hoja y el conflicto se anota en un CSV aparte. Solo se fusionan las columnas que rellena el grupo (-d-, Lema, Categoría, Revisor, Notas).

## Cómo funciona

```
navegador ──(CSV, se lee en local)
    ├── /                     página (public/index.html)
    ├── /estudio.html         estudio (un único archivo; va también dentro del ZIP)
    ├── /f/txt|audio/CLAVE    Worker ──► preseea.uah.es (el corpus no envía CORS)
    ├── /api/whisper          Worker ──► Workers AI (Whisper), caché en R2 por clave
    └── /api/jev              Worker ──► TypeSafe (Jev), con las preguntas fijadas en el código
```

- El motor (`public/motor/`) es el mismo en el navegador, en el Worker y en la terminal: lectura de transcripciones, detección, alineación, cortes de audio, CSV y preguntas a Jev.
- Los recortes se cortan por tramas MP3, sin recodificar, en el propio navegador.
- El Worker no es un proxy abierto: solo sirve las rutas del corpus con una clave válida, transcribe audios del corpus por su clave y hace a Jev las preguntas que define `public/motor/jev.js`. Tiene límites de uso por IP.
- No hay base de datos de usuarios: el CSV y las decisiones del grupo no salen del navegador. Solo se guardan las transcripciones de Whisper, que son las mismas para todo el mundo.

## Desplegar tu propia copia

Hace falta una cuenta de Cloudflare con Workers AI y R2, Node 20 o superior y, para Jev, una clave de [TypeSafe](https://typesafe.ai).

```sh
git clone https://github.com/joseluissaorin/sociolinguistica.git
cd sociolinguistica
npm install
npx wrangler r2 bucket create sociolinguistica
npx wrangler secret put TYPESAFE_API_KEY
npx wrangler secret put CLAVE_ADMIN        # opcional: sin límite de uso para la terminal
npm run deploy
```

Antes, en `wrangler.jsonc`, quita el `account_id` y cambia `routes` por un dominio tuyo (o usa `"workers_dev": true`). En la terminal, `SOCIO_URL` apunta a tu copia y `SOCIO_CLAVE_ADMIN` lleva la clave de administración.

El léxico se regenera con `npm run lexico` y las pruebas se pasan con `npm test`.

## Licencias y créditos

- El código se publica con licencia [MIT](LICENSE).
- Los audios y las transcripciones son de [PRESEEA](https://preseea.uah.es/), con licencia [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.es); no se incluyen en el repositorio.
- Los léxicos de `public/lexico/` derivan de las [listas de lematización](https://github.com/michmech/lemmatization-lists) de Michal Měchura, con licencia [ODbL](https://opendatacommons.org/licenses/odbl/).
- [client-zip](https://github.com/Touffy/client-zip) (David Junger) y [fflate](https://github.com/101arrowz/fflate) (Arjun Barrameda) van en `public/vendor/`, con licencia MIT.
