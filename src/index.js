// Worker de sociolinguistica.joseluissaorin.com
//   GET  /f/txt/CLAVE.txt, /f/audio/CLAVE.mp3   proxy hacia el corpus PRESEEA (sin CORS en origen)
//   POST /api/whisper  { clave }                 transcripción con tiempos (caché en R2)
//   POST /api/jev      { casos: [...] }          categorización con Jev (TypeSafe)
//   POST /api/whisper-audio  (MP3 en el cuerpo)   solo con clave de administración: audios que no están en PRESEEA
// Todo lo demás son estáticos de public/.
import { indexar, trocear } from "../public/motor/audio.js";
import { datosCaso, peticion, MAX_POR_LOTE } from "../public/motor/jev.js";

const ORIGEN = "https://preseea.uah.es/corpus";
const RUTA = /^\/f\/(txt|audio)\/([A-Za-z0-9_\-]{3,40})\.(txt|mp3)$/;
const CLAVE = /^[A-Za-z0-9_\-]{3,40}$/;
const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const VERSION_WHISPER = "v1";

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
});
const error = (msg, status) => json({ error: msg }, status);

async function limite(env, req, cual) {
  if (env.CLAVE_ADMIN && req.headers.get("x-clave") === env.CLAVE_ADMIN) return true;
  const ip = req.headers.get("cf-connecting-ip") || "anon";
  const { success } = await env[cual].limit({ key: ip });
  return success;
}

async function preseea(tipo, clave, ext, method = "GET") {
  return fetch(`${ORIGEN}/${tipo}/${clave}.${ext}`, { method, cf: { cacheEverything: true, cacheTtl: 60 * 60 * 24 * 30 } });
}

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Transcribe el audio (MP3 o WAV) en trozos y une las palabras con su tiempo absoluto.
async function transcribir(env, bytes) {
  const indice = indexar(bytes);
  const palabras = [], segmentos = [];
  for (const t of trocear(indice, 240, 2)) {
    const r = await env.AI.run(WHISPER, {
      audio: base64(t.bytes), language: "es", task: "transcribe",
      condition_on_previous_text: false, vad_filter: false,
    });
    for (const s of r.segments || []) {
      const ini = s.start + t.desfase, fin = s.end + t.desfase;
      for (const w of s.words || []) {
        const a = w.start + t.desfase, b = w.end + t.desfase, medio = (a + b) / 2;
        // Del solape solo se queda cada palabra en el trozo al que pertenece su punto medio.
        if (medio < t.ini || medio >= t.fin) continue;
        palabras.push([w.word.trim(), +a.toFixed(2), +b.toFixed(2)]);
      }
      const medio = (ini + fin) / 2;
      if (medio >= t.ini && medio < t.fin) segmentos.push([+ini.toFixed(2), +fin.toFixed(2), s.text.trim()]);
    }
  }
  return { modelo: WHISPER, duracion: +indice.duracion.toFixed(2), palabras, segmentos };
}

async function apiWhisper(req, env) {
  let clave;
  try { ({ clave } = await req.json()); } catch { return error("Cuerpo no válido", 400); }
  if (!CLAVE.test(clave || "")) return error("Clave no válida", 400);
  const key = `whisper/${VERSION_WHISPER}/${clave}.json`;
  const guardado = await env.CACHE.get(key);
  if (guardado) return new Response(guardado.body, { headers: { "Content-Type": "application/json; charset=utf-8", "X-Cache": "HIT" } });
  if (!(await limite(env, req, "LIMITE_WHISPER"))) return error("Demasiadas transcripciones seguidas. Espera un minuto.", 429);

  const r = await preseea("audio", clave, "mp3");
  if (!r.ok) return error(`PRESEEA respondió ${r.status} para ${clave}.mp3`, r.status === 404 ? 404 : 502);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let res;
  try { res = await transcribir(env, bytes); }
  catch (e) { return error(`Whisper falló: ${e.message || e}`, 502); }
  const cuerpo = JSON.stringify({ clave, bytesAudio: bytes.length, fecha: new Date().toISOString(), ...res });
  await env.CACHE.put(key, cuerpo, { httpMetadata: { contentType: "application/json" } });
  return new Response(cuerpo, { headers: { "Content-Type": "application/json; charset=utf-8", "X-Cache": "MISS" } });
}

async function apiJev(req, env) {
  if (!env.TYPESAFE_API_KEY) return error("Jev no está configurado en este servidor", 503);
  let casos;
  try { ({ casos } = await req.json()); } catch { return error("Cuerpo no válido", 400); }
  if (!Array.isArray(casos) || !casos.length || casos.length > MAX_POR_LOTE) return error(`Envía entre 1 y ${MAX_POR_LOTE} casos`, 400);
  if (!(await limite(env, req, "LIMITE_JEV"))) return error("Demasiadas peticiones seguidas. Espera un minuto.", 429);

  const respuestas = await Promise.all(casos.map(async (c) => {
    const cuerpo = JSON.stringify(peticion(datosCaso(c)));
    let ultimo = "";
    for (let intento = 0; intento < 6; intento++) {
      try {
        const r = await fetch("https://api.typesafe.ai/v1/systemone", {
          method: "POST", body: cuerpo,
          headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
        });
        if (r.ok) return { answers: (await r.json()).answers };
        ultimo = `Jev respondió ${r.status}`;
        if (r.status !== 429 && r.status < 500) break;
        // Respeta Retry-After si viene; si no, espera exponencial con algo de azar.
        const tras = parseFloat(r.headers.get("retry-after") || "") * 1000;
        await new Promise((ok) => setTimeout(ok, tras > 0 ? Math.min(tras, 10000) : 400 * 2 ** intento + Math.random() * 400));
      } catch (e) {
        ultimo = `Jev no respondió (${e.message})`;
        await new Promise((ok) => setTimeout(ok, 400 * 2 ** intento));
      }
    }
    console.log("jev-error", ultimo);
    return { error: ultimo || "Jev no respondió" };
  }));
  return json({ respuestas });
}

async function apiWhisperAudio(req, env) {
  if (!env.CLAVE_ADMIN || req.headers.get("x-clave") !== env.CLAVE_ADMIN) return error("No autorizado", 401);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length || bytes.length > 300 * 1024 * 1024) return error("Audio vacío o demasiado grande", 400);
  try { return json({ bytesAudio: bytes.length, fecha: new Date().toISOString(), ...(await transcribir(env, bytes)) }); }
  catch (e) { return error(`Whisper falló: ${e.message || e}`, 502); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/whisper-audio" && req.method === "POST") return apiWhisperAudio(req, env);
    if (url.pathname === "/api/whisper" && req.method === "POST") return apiWhisper(req, env);
    if (url.pathname === "/api/jev" && req.method === "POST") return apiJev(req, env);

    const m = url.pathname.match(RUTA);
    if (!m) return env.ASSETS.fetch(req);
    const [, tipo, clave, ext] = m;
    if ((tipo === "txt") !== (ext === "txt")) return new Response("Ruta no válida", { status: 400 });
    if (req.method !== "GET" && req.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
    const r = await preseea(tipo, clave, ext, req.method);
    if (!r.ok) return new Response(`PRESEEA respondió ${r.status} para ${clave}.${ext}`, { status: r.status === 404 ? 404 : 502 });
    const h = new Headers();
    h.set("Content-Type", ext === "mp3" ? "audio/mpeg" : "text/plain");
    const len = r.headers.get("Content-Length");
    if (len) h.set("Content-Length", len);
    h.set("Cache-Control", "public, max-age=2592000");
    h.set("Access-Control-Allow-Origin", "*");
    return new Response(r.body, { status: 200, headers: h });
  },
};
