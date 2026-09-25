/**
 * Search terms for memory retrieval (docs/architecture/18-MEMORY-V2.md §4.3, cause R3). The write gate's tokenizer
 * kept ASCII only, so a Spanish request ("configuración del módulo") became `configuraci` and `dulo` and matched
 * nothing the model had stored in English. Here a request and an entry are reduced to the same terms:
 *
 * - Unicode letters and digits, accents folded (`configuración` → `configuracion`), identifiers and paths kept whole;
 * - English and Spanish stopwords dropped;
 * - a small bilingual lexicon of everyday coding words mapped to one English term (`pruebas` → `test`,
 *   `despliegue` → `deploy`, `base de datos` → `database`), so a Spanish request meets an English memory;
 * - light suffix folding for the rest (plurals, `-ing`, `-ed`), the same on both sides.
 *
 * It is deliberately small and general: no embeddings (decision of 2026-09-17, kept in doc 18 §8), no per-project
 * tuning. The gate keeps its own tokenizer, so what counts as a duplicate does not change with this.
 */

const STOPWORDS = new Set([
  // English
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "is",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "with",
  "as",
  "by",
  "be",
  "are",
  "was",
  "were",
  "at",
  "from",
  "when",
  "which",
  "into",
  "not",
  "no",
  "do",
  "does",
  "did",
  "done",
  "can",
  "could",
  "should",
  "would",
  "will",
  "please",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "i",
  "so",
  "if",
  "then",
  "than",
  "there",
  "here",
  "what",
  "why",
  "how",
  "all",
  "any",
  "some",
  "just",
  "also",
  "now",
  "again",
  "yes",
  "ok",
  "okay",
  "one",
  "get",
  "got",
  "let",
  "make",
  "want",
  "need",
  "have",
  "has",
  "had",
  "been",
  "about",
  "after",
  "before",
  "over",
  "only",
  "up",
  "out",
  "same",
  "other",
  "more",
  "very",
  "still",
  "because",
  // Spanish
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "y",
  "o",
  "de",
  "del",
  "al",
  "en",
  "con",
  "por",
  "para",
  "que",
  "qué",
  "es",
  "son",
  "se",
  "su",
  "sus",
  "lo",
  "le",
  "les",
  "mi",
  "mis",
  "tu",
  "tus",
  "este",
  "esta",
  "esto",
  "estos",
  "estas",
  "ese",
  "esa",
  "eso",
  "como",
  "cómo",
  "cuando",
  "donde",
  "dónde",
  "pero",
  "si",
  "sí",
  "ya",
  "muy",
  "mas",
  "más",
  "otra",
  "otro",
  "otros",
  "otras",
  "vez",
  "hay",
  "ahora",
  "hazlo",
  "haz",
  "dale",
  "bien",
  "favor",
  "porfa",
  "puedes",
  "podrias",
  "necesito",
  "quiero",
  "tambien",
  "también",
  "solo",
  "sólo",
  "todo",
  "todos",
  "toda",
  "todas",
  "nos",
  "me",
  "te",
  "ha",
  "han",
  "fue",
  "era",
  "está",
  "esta",
  "están",
  "estan",
  "ser",
  "hacer",
  "hace",
  "hago",
  "haces",
  "hice",
  "ven",
  "veo",
  "voy",
  "vamos",
  "tengo",
  "tiene",
  "tienen",
  "puede",
  "pueden",
  "sigue",
  "sin",
  "us",
  "stuff",
  "like",
  "thing",
  "things",
]);

/** Multi-word phrases folded to one term before splitting (Spanish first: they are the ones that split badly). */
const PHRASES: Array<[RegExp, string]> = [
  [/\bbases? de datos\b/gu, " database "],
  [/\binicio de sesion\b|\biniciar sesion\b|\binicia sesion\b/gu, " login "],
  [/\bcerrar sesion\b/gu, " logout "],
  [/\bvariables? de entorno\b/gu, " env "],
  [/\bpie de pagina\b/gu, " footer "],
  [/\bcontrol de versiones\b/gu, " git "],
  [/\bpull request\b|\bsolicitud de cambios\b/gu, " pr "],
  [/\bcode review\b|\brevision de codigo\b/gu, " review "],
  [/\bend to end\b|\bextremo a extremo\b/gu, " e2e "],
  [/\bprueba unitaria\b|\bpruebas unitarias\b|\bunit tests?\b/gu, " test "],
  [/\bzona horaria\b|\btime ?zones?\b/gu, " timezone "],
  [/\blinea de comandos\b|\bcommand line\b/gu, " cli "],
  [/\bmodo oscuro\b|\bdark mode\b/gu, " dark "],
  [/\ben (?:mi|tu|la) maquina\b|\ben local\b|\blocalmente\b|\blocally\b|\bon my machine\b/gu, " local "],
];

/**
 * Everyday coding words, English and Spanish, mapped to one English term. Keys are accent-folded and lower-case.
 * General vocabulary only: a word earns a place by meaning the same thing in any project.
 */
const LEXICON: Record<string, string> = Object.fromEntries(
  (
    [
      ["test", "test tests testing tested prueba pruebas probar testear spec specs"],
      [
        "config",
        "config configs configuration configurations configure configured configuracion configuraciones configurar ajustes settings setting",
      ],
      ["build", "build builds building built compilar compila compilacion compile compiles compiled compiling"],
      [
        "deploy",
        "deploy deploys deployed deploying deployment deployments despliegue despliegues desplegar despliega publicar",
      ],
      ["auth", "auth authentication authenticate autenticacion autenticar authorization autorizacion"],
      ["login", "login logins signin sign-in ingresar ingreso"],
      ["database", "database databases db bd postgres postgresql mysql sqlite"],
      [
        "fail",
        "fail fails failed failing failure failures falla fallan fallo fallos fallando falló broken roto rota rompe rompio crash crashes crashed explota explotan error errors errores",
      ],
      [
        "fix",
        "fix fixes fixed fixing arregla arreglar arreglo arreglalo corrige corregir correccion repair repara reparar soluciona solucionar",
      ],
      ["dependency", "dependency dependencies deps dependencia dependencias paquete paquetes package packages"],
      ["install", "install installs installed installing instalar instala instalacion"],
      ["server", "server servers servidor servidores backend"],
      ["route", "route routes routing ruta rutas endpoint endpoints"],
      ["page", "page pages pagina paginas"],
      ["component", "component components componente componentes"],
      ["style", "style styles styling estilo estilos css"],
      ["folder", "folder folders carpeta carpetas directory directories directorio directorios dir"],
      ["file", "file files archivo archivos fichero ficheros"],
      ["branch", "branch branches rama ramas"],
      ["migration", "migration migrations migracion migraciones migrate migrar"],
      ["slow", "slow slowly lento lenta lentitud performance rendimiento latency latencia"],
      ["email", "email emails mail mails correo correos"],
      ["payment", "payment payments pago pagos checkout cobro cobros"],
      ["user", "user users usuario usuarios"],
      ["password", "password passwords contrasena contrasenas clave"],
      ["env", "env environment environments entorno entornos dotenv"],
      ["log", "log logs logging logger registro registros bitacora"],
      ["table", "table tables tabla tablas"],
      ["query", "query queries consulta consultas"],
      ["lint", "lint linter linting eslint biome"],
      ["type", "type types typing typecheck tipo tipos tipado"],
      ["image", "image images imagen imagenes"],
      ["order", "order orders pedido pedidos orden ordenes"],
      ["cart", "cart carts carrito carritos"],
      ["product", "product products producto productos"],
      ["price", "price prices pricing precio precios"],
      ["invoice", "invoice invoices factura facturas"],
      ["shipping", "shipping shipment envio envios"],
      ["notification", "notification notifications notificacion notificaciones"],
      ["search", "search searches searching busqueda busquedas buscar buscador"],
      ["schedule", "schedule schedules scheduled scheduler cron programar programado programacion"],
      ["job", "job jobs tarea tareas task tasks"],
      ["data", "data datos dato"],
      ["clean", "clean cleanup limpiar limpieza"],
      ["load", "load loads loading loaded cargar carga"],
      ["add", "add adds added adding agregar agrega anadir anade"],
      ["delete", "delete deletes deleted remove removes removed borrar borra eliminar elimina"],
      ["update", "update updates updated updating upgrade actualizar actualiza actualizacion"],
      ["version", "version versions versioning"],
      ["browser", "browser browsers navegador navegadores"],
      ["mobile", "mobile movil moviles phone celular"],
      ["screen", "screen screens pantalla pantallas"],
      ["button", "button buttons boton botones"],
      ["form", "form forms formulario formularios"],
      ["header", "header headers cabecera cabeceras encabezado"],
      ["menu", "menu menus navbar navigation navegacion"],
      ["theme", "theme themes tema temas"],
      ["translation", "translation translations traduccion traducciones i18n locale locales idioma idiomas"],
      ["date", "date dates fecha fechas"],
      ["security", "security secure seguridad seguro vulnerability vulnerabilidad"],
      ["permission", "permission permissions permiso permisos role roles rol"],
      ["token", "token tokens jwt"],
      ["secret", "secret secrets secreto secretos credential credentials credencial credenciales"],
      ["cache", "cache caches cached caching"],
      ["upload", "upload uploads uploaded subir subida"],
      ["download", "download downloads descargar descarga"],
      ["release", "release releases lanzamiento version-bump"],
      ["commit", "commit commits committed commitear"],
      ["docs", "docs documentation documentacion readme"],
      ["review", "review reviews reviewing reviewed revisa revisar revisalo revision revisiones"],
      ["api", "api apis"],
      ["request", "request requests peticion peticiones solicitud solicitudes"],
      ["response", "response responses respuesta respuestas"],
      ["timeout", "timeout timeouts timed-out expira expirado"],
      ["retry", "retry retries retrying reintento reintentos reintentar"],
      ["flaky", "flaky intermitente intermitentes inestable"],
      ["seed", "seed seeds seeding semilla sembrar"],
      ["fixture", "fixture fixtures"],
      ["mock", "mock mocks mocking simulado"],
      ["start", "start starts starting arrancar arranca iniciar inicia levantar"],
      ["run", "run runs running ran correr corre ejecutar ejecuta"],
      ["script", "script scripts"],
      ["container", "container containers contenedor contenedores docker"],
      ["pipeline", "pipeline pipelines"],
      ["report", "report reports reporte reportes informe informes"],
      ["export", "export exports exportar exporta"],
      ["import", "import imports importar importa"],
      ["memory", "memory memoria"],
      ["session", "session sessions sesion sesiones"],
      ["cookie", "cookie cookies"],
      ["storage", "storage almacenamiento bucket buckets"],
      ["webhook", "webhook webhooks"],
      ["queue", "queue queues cola colas"],
      ["worker", "worker workers trabajador"],
      ["backfill", "backfill backfills backfilling reprocess reprocessing reprocesar reprocesa rerun"],
      ["analytics", "analytics analitica analiticas medir mide metrics metricas tracking"],
      ["production", "production prod produccion"],
      ["staging", "staging preproduccion"],
      [
        "crypto",
        "hash hashing hashed hashes encrypt encrypted encryption cifrar cifran cifrado cifra encriptar encriptado",
      ],
      ["algorithm", "algorithm algorithms algoritmo algoritmos"],
      ["framework", "framework frameworks"],
    ] as Array<[string, string]>
  ).flatMap(([term, words]) => words.split(" ").map((word) => [word, term] as const)),
);

/** Accent-folded, lower-cased text. */
export function foldText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

/** Plural and verb-form folding for words the lexicon does not know; the same on the request and the entry side. */
function stem(word: string): string {
  if (/[./_\d-]/u.test(word)) return word;
  // A short plural ("dags", "bots") folds too; "bus", "gas" and the like end in a vowel before the s.
  if (word.length === 4 && /[^aeiousy]s$/u.test(word)) return word.slice(0, -1);
  if (word.length < 5) return word;
  if (word.endsWith("ies") && word.length > 5) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ciones")) return `${word.slice(0, -6)}cion`;
  if (word.endsWith("ing") && word.length > 6) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 5) return word.slice(0, -2);
  if (word.endsWith("es") && /[sxz]es$|ches$|shes$/u.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * The search terms of a text, deduplicated in order of appearance. Identifiers (`load_config`), paths
 * (`src/api/users.ts`) and versions stay whole; a path also yields its file name and the name without extension.
 */
export function searchTerms(text: string): string[] {
  let folded = foldText(text);
  for (const [pattern, replacement] of PHRASES) folded = folded.replace(pattern, replacement);
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    if (term.length < 2 || STOPWORDS.has(term) || seen.has(term)) return;
    seen.add(term);
    terms.push(term);
  };
  for (const raw of folded.split(/[^\p{L}\p{N}_./-]+/u)) {
    const token = raw.replace(/^[./-]+|[./-]+$/gu, "");
    if (token.length < 2) continue;
    if (token.includes("/") || /\.[a-z0-9]{1,5}$/u.test(token)) {
      add(token);
      const base = token.split("/").pop() ?? token;
      add(base);
      add(base.replace(/\.[a-z0-9]+$/u, ""));
      continue;
    }
    const mapped = LEXICON[token];
    if (mapped) {
      add(mapped);
      continue;
    }
    // A compound (`load-config`, `user_id`) matches as a whole and by its parts.
    if (/[-_]/u.test(token)) {
      add(token);
      for (const part of token.split(/[-_]+/u)) {
        if (part.length >= 3) add(LEXICON[part] ?? stem(part));
      }
      continue;
    }
    add(LEXICON[stem(token)] ?? stem(token));
  }
  return terms;
}
