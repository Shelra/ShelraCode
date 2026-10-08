# Especificación de evidence-core para la fase 1

Fecha: 7 de octubre de 2026. Alcance autorizado: iniciar fase 1 del [plan](tasks/plan.md). Módulo: evidence-core del [mapa](CAPABILITY-MAP.md).

## Objetivo y supuestos

Shelra debe ejecutar el mismo ciclo protegido en chat, headless y --autonomous. La ejecución autónoma del producto y del benchmark no pueden evitar herramientas, reglas, checkpoints, memoria y finalización del camino productivo.

Se reutiliza Agent.processMessage como núcleo común. Sus políticas y herramientas ya resuelven esas responsabilidades; adaptar AutonomyKernel mediante un segundo conjunto de primitivas recrearía la divergencia. El kernel histórico puede conservarse como referencia de pruebas, sin una ruta pública de CLI o benchmark que lo ejecute.

El resultado estructurado refleja el veredicto observado por el host, sin crear otro evaluador ni store. La cobertura funcional completa del pedido y una revisión arquitectónica independiente pertenecen a fases posteriores. Este ciclo no atribuye esas capacidades al cierre común.

Supuestos de implementación: conservar formatos normales headless, cuentas y sesiones existentes, proveedores/routing Free, sandbox y memoria; añadir un resultado final del host para autonomía; no añadir dependencias ni usar modelos externos.

## Contrato y comportamiento

1. --autonomous usa configuración y ejecución headless comunes, incluyendo proveedor elegido, sandbox, sesión, at-mentions y opciones pertinentes. El benchmark shelra-autonomy se registra como alias del executor productivo; sus resultados nuevos se etiquetan con el harness real.
2. Agent expone getLastTurnResult(). Su valor se limpia al iniciar cada turno, pertenece al taskId y distingue verified, answered, unverified, blocked, limited, paused y cancelled. verified es derivado del estado verified, no un permiso otorgado por texto del modelo.
3. El resultado incluye changedFiles, comprobaciones con command/cwd/source/passed/fresh, y limitaciones. No se puede atribuir un pase obsoleto al estado final ni convertir una ejecución focalizada en todas las pruebas.
4. La CLI autónoma produce exit 0 solo ante verified; los demás estados producen exit distinto de 0 y resultado explícito. El headless normal conserva su comportamiento de salida actual. No se analiza el texto final ni la etiqueta de fase del kernel para decidirlo.
5. Los recibos reutilizan WorkspaceState y ObservedCheckRun. fresh se calcula desde el workspace, candidato observado y cambios del turno. unknown nunca es fresh.
6. WorkspaceState compara contenido y HEAD, no solo tamaño/mtime. Si no puede obtener una firma o comparar commits, no concluye que nada cambió.
7. Cada host check se registra con su candidato individual. El candidato posterior de otro check no se asigna retrospectivamente a un pase anterior. Un check que cambia entradas de código no verifica automáticamente el estado que dejó.
8. El resumen del host se añade cuando hay comprobaciones; conserva resultados fallidos, obsoletos y no disponibles. La verificación existente sigue siendo autoridad de aceptación.
9. La memoria, checkpoints, reglas, decisiones, protección de tests y recuperación se heredan de Agent.processMessage; no se reimplementan en el adaptador autónomo.
10. Los recibos de este corte cubren comprobaciones locales. La recuperación exactly-once de efectos externos requiere futuros adaptadores con idempotencia/reconciliación y no se promete aquí.
11. El resultado público redacta credenciales; los comandos internos conservan su forma original para comparar el check ejecutado. El veredicto positivo se publica después de observar el hook, la reflexión y la última captura. Un candidato modificado o una cancelación no obtiene éxito ni crédito positivo por los checks anteriores. El episodio del turno conserva el resultado final del host.

## Estructura

- src/agent/evidence-core.ts y su test: tipos y proyección de recibos ya observados.
- src/agent/agent.ts: integración de recibos por ejecución y resultado del turno.
- src/agent/workspace-state.ts y sus tests: huellas de contenido y comparación conservadora.
- src/index.ts y helper CLI focalizado si hace falta: ruta autónoma común y exit code.
- src/providers/free-providers.ts y tests: la ruta autónoma admite los mismos proveedores del ciclo común.
- src/bench/: el alias autónomo usa el executor productivo y metadata real.
- bench/README.md: documentar significado actual y diferenciar resultados históricos.

## Estilo de código

Conservar interfaces TypeScript explícitas, funciones pequeñas, resultados tipados y Biome. La forma actual de src/contract/contract.ts orienta la proyección:

    export interface ObservedCheckRun {
      command: string;
      passed: boolean;
      detail: string;
      fresh: boolean;
      beforeFirstChange: boolean;
      unrunnable?: string;
      finished?: boolean;
    }

No duplicar el tipo para cambiar su significado. Los campos adicionales del recibo describen cómo se obtuvo esa proyección.

## Estrategia de pruebas

- Baseline offline: contratos, WorkspaceState, AgentKernel y autonomía histórica. Resultado previo: 16 suites y 112 pruebas pasadas en el árbol local, antes de implementar este corte.
- Unitarios significativos: firmas con igual tamaño/mtime y distinto contenido; unknown; error de comparación Git; alcance y obsolescencia de recibos.
- Integración del turno: pasar check → cambiar código → cerrar; varios checks cuando el siguiente cambia entradas; fallos y no disponibles; resultado limpiado entre turnos.
- Paridad de camino: --autonomous usa realmente Agent.processMessage, herramientas y checkpoint/políticas comunes; servidor compatible local y proyectos temporales, sin inferencia pagada.
- Benchmark: alias usa executor productivo con metadata correcta; conservar evaluación externa y contar resultados no verificados honestamente.
- Free-mode tests y checks completos apropiados al cerrar cambios de código.

## Comandos

    bun run typecheck
    bun run lint
    bun run format
    bun run test
    bunx vitest run --pool=forks --maxWorkers=1 src/contract/ src/agent/workspace-state.test.ts src/agent/workspace-state-async.test.ts src/agent/kernel.test.ts
    bunx vitest run --pool=forks --maxWorkers=1 src/agent/evidence-core.test.ts src/agent/completion-gate.test.ts
    bunx vitest run --pool=forks --maxWorkers=1 src/providers/ src/routing/ src/agent/free-mode-routing.test.ts

Build en PowerShell sin instalación automática:

    $env:SHELRA_BUILD_SKIP_INSTALL = "1"
    bun run build:binary

Los nuevos tests de CLI y benchmark se agregan al comando focalizado cuando existan.

## Límites

- Siempre: preservar cambios locales previos; mantener Free mode y resiliencia; aislar HOME/workspaces de pruebas; vincular afirmaciones a evidencia con ámbito.
- Decisión del usuario si aparece fuera del alcance: nuevas dependencias, servicios permanentes, inferencia pagada, cambios de producto incompatibles no contemplados aquí.
- Nunca: editar ShelraCode/, borrar pruebas para esconder fallos, crear otra autoridad de finalización, declarar P0 completa o fiabilidad anual por este corte.

## Aceptación y límites de la fase

El corte se acepta cuando las rutas autónomas del producto comparten ejecución, las pruebas demuestran guardas/checkpoints reales, recibos obsoletos no respaldan el candidato final y el resultado estructurado determina la salida autónoma.

La fase 1 completa del programa incluye además aislamiento fuerte de evidencia/oráculos y cobertura de efectos externos. Lo no implementado se registra como pendiente; compartir la ruta no acredita por sí solo una garantía completa sobre shell sin sandbox.

## Estado del primer corte

Implementado el 7 de octubre de 2026 sobre el árbol local existente. Baseline: HEAD 7a0a182897fe255bf6999b0bd2c9e3af105c93d8 con cambios previos del usuario conservados; Windows y Bun 1.4.1. Las evaluaciones de este corte usan proveedores simulados o un gateway HTTP/SSE local con herramientas y CLI reales, no modelos cloud ni un piloto de producción.

Cambios observables:

- CLI --autonomous y benchmark shelra-autonomy usan Agent.processMessage. El resultado del host y el oráculo del benchmark permanecen separados.
- Cada turno tiene un resultado nuevo e inmutable; el texto del modelo no lo convierte en verified. Solo verified produce exit 0 en --autonomous.
- SHA-256 sustituye firmas de tamaño/mtime. Se detectan reescrituras con mismo tamaño/fecha y cambios de HEAD; fallos de lectura o comparación no acreditan frescura. La lectura usa bloques de 64 KiB.
- Diagnóstico inicial, comandos del modelo y checks del contrato tienen candidatos individuales. Checks que cambian código, checks anteriores a otra edición y candidatos desconocidos no verifican el cierre.
- Timeout seguido por test focalizado conserva el alcance focalizado. Cancelación durante diagnóstico o reflexión se refleja como cancelled. Un Stop hook o una edición externa durante la reflexión que cambia código deja el turno unverified sin crédito positivo por el contrato obsoleto.
- Recibos públicos redactados y resumen final del host. La salida headless antigua de texto/herramientas no recibió una revisión general de redacción en este corte.

Validación del corte completada: bun run test terminó exit 0, con 231 suites y 2.187 pruebas pasadas en su primer tramo, una prueba omitida por falta de sh en Windows, y todos sus tramos seriales de Vitest/Bun verdes. Typecheck, lint, format, git diff --check y build:binary pasaron; el build no instaló el ejecutable en el perfil del usuario. La suite de finalización pasó 99/99 con el cierre y crédito diferidos. Tras el último ajuste de episodio se repitieron sus dos regresiones adversariales (2/2) y la suite de episodios (14/14), con código final.

Las pruebas de CLI ejecutan Bun, SDK, herramientas, checks, checkpoints y SQLite reales contra un servidor HTTP/SSE local y HOME de prueba. Los casos incluyen éxito, test fallido con texto de éxito falsificado, escritura rechazada por ámbito, proveedor explícito, at-mentions, sesión reanudada y oráculo externo que pasa o falla independientemente del veredicto de Shelra. No se alteraron oráculos externos para aprobar los cambios. La expectativa antigua de un cierre global positivo con lint no disponible se sustituyó por un cierre unverified, manteniendo el recibo del test que sí pasó y comprobando que no se reintenta el check ausente.

La captura Git representa archivos limpios mediante HEAD y solo lee contenido de archivos modificados o sin seguimiento; ignora dependencias, salidas generadas y estado interno. Sin Git, el inventario es acotado y una captura incompleta es unknown. Estas firmas no describen datos externos ni garantizan aislamiento ante código adversarial que modifica y restaura archivos dentro de una ejecución.

La fase 1 permanece abierta para aislamiento de evidencia/oráculos, observaciones externas versionadas y efectos ambiguos con idempotencia o reconciliación. Los hechos propuestos por reflexión aún necesitan validación pertinente y vigencia por ámbito en P3; un resultado final correcto no acredita cada inferencia almacenada. Este corte mejora la fiabilidad de tareas delimitadas; no demuestra comprensión arquitectónica anual ni mantenimiento autónomo de OrionBIM.

## Segundo corte: autoridad del checker y oráculo congelado

Autorización: continuar P1, 7 de octubre de 2026. Objetivo: imponer en el host los límites del subagente check y no aceptar un pase si cambió el código o las entradas del oráculo durante su ejecución. Baseline del corte: behavior-verifier y workspace-guard, 2 suites/15 pruebas verdes; cierre anterior validado en el primer corte.

Supuestos: reutilizar las herramientas, política, runner y snapshots actuales; mantener pruebas locales sin nuevos paquetes, servicios ni inferencia cloud. Este corte limita herramientas y detecta cambios observables. No constituye una sandbox de sistema operativo: el código ejecutado por un test conserva los permisos del proceso.

Contrato:

1. Check recibe lectura/búsqueda del workspace y escritura/edición/borrado exclusivamente de archivos regulares dentro de .shelra/verify. No recibe MCP, memoria, escritorio, pagos, extensiones de escritura, procesos en segundo plano ni shell general. Las instrucciones de un agente o skill solo pueden reducir estos permisos.
2. Una ruta de escritura se comprueba por su ubicación real, incluidos enlaces y padres que aún no existen; .shelra/verify y sus padres deben estar contenidos en el workspace. Un enlace hacia otra ubicación no autoriza escritura, captura ni limpieza recursiva.
3. El shell del checker admite únicamente runners conocidos sobre exactamente un test del área de verificación y opciones de ejecución explícitamente admitidas. Se rechazan encadenamiento, preload/import de código adicional, filtros que puedan omitir comportamientos, actualizaciones de snapshots y programas arbitrarios. npx/bunx se ejecutan sin instalación automática.
4. El host conserva texto original del test y helpers en memoria. Antes de cada ejecución restaura esos originales en un área validada y vacía. Capturas incompletas, archivos inaccesibles o enlaces no generan un oráculo parcial que parezca completo.
5. El host compara el candidato antes/después del checker y de cada ejecución. Unknown o cambio observado de código/configuración impide usar el pase. También comprueba que el test y helpers ejecutados siguen coincidiendo con el original al finalizar; una modificación del oráculo no pasa.
6. Los intentos denegados retornan fallo explícito sin ejecutar la herramienta. Los recursos no disponibles se reportan según la resiliencia actual; no se presentan como test pasado. Los fallos del test conservan su reparación acotada usando la copia del host.
7. No se atribuye cobertura funcional completa a un conjunto de tests por este endurecimiento; el contrato por comportamiento pertenece a P5. Tampoco se promete impedir efectos de código arbitrario fuera del workspace, ni detectar escrituras restauradas entre dos observaciones.

Archivos previstos: behavior-verifier.ts para política del comando; helper específico del checker para herramientas/rutas/oráculo y su test; agent.ts para broker y ejecución protegida; completion-gate.test.ts para regresiones reales. Responsabilidades pequeñas y sin otro evaluador ni store.

Aceptación: escritura en src rechazada antes de ejecutar; escape por traversal/enlace rechazado; MCP y shell general ausentes; flags peligrosos y auto-install rechazados; checker que modifica código o su test al correr no produce evidencia válida; reparación legítima mantiene el oráculo original y pasa; área de verificación limpia al terminar; resultado, texto y recibos coherentes.

Verificación: tests focalizados del helper y comandos; integración Agent con herramientas reales y proveedor que valida schemas; test real de Bun que intenta modificar código/oráculo; suite de cierre; checks del proyecto y build sin instalación.

Implementación del segundo corte:

- checker-tools.ts reduce el conjunto heredado a seis herramientas, conserva la política previa, comprueba rutas absolutas y solo permite ejecutar un test existente desde el root. No conecta MCP ni expone extensiones al checker.
- checker-files.ts captura test y helpers completos: hasta 20 archivos, 200 KiB por archivo, profundidad 3 y 128 entradas. Conserva BOM/CRLF exactos. Rechaza enlaces, hard-links, binarios, alias de rutas y capturas parciales. Solo ignora archivos .pyc de __pycache__, inspeccionando igualmente su estructura.
- behavior-verifier.ts admite flags explícitos por runner y fuerza --no-install para npx/bunx. Filtros, preload/import/config, actualización de snapshots y opciones desconocidas se rechazan antes de ejecutar.
- El host restaura los originales en cada intento, compara candidato y oráculo incluso si el runner lanza después de ejecutar, y conserva el recibo fallido. Un fallo de limpieza invalida la verificación y deja un motivo visible. Un test vacío o interrumpido no genera un recibo pasado; un estado desconocido permanece desconocido.
- Las regresiones usan herramientas y filesystem reales con proveedor simulado que valida schemas. Dos tests de integración ejecutan Bun real: alteración del código y reemplazo del propio test con exit 0 no producen verified. La reparación legítima sigue usando el original y conserva su caso positivo.

Validación del segundo corte completada el 7 de octubre de 2026: bun run test terminó exit 0 sobre el código final. Su primer tramo pasó 233 suites y 2.256 pruebas; dos pruebas quedaron omitidas por soporte de Windows (sh y symlink de archivo). Los cuatro tramos seriales de Vitest y todos los tramos de Bun pasaron. Typecheck, lint, format, git diff --check y build:binary verdes; sin instalación en el perfil del usuario. La suite de cierre contiene 106 pruebas, incluidas las nuevas regresiones de integridad y disponibilidad. Junctions y hard-links NTFS reales sí se verificaron. La revisión independiente detectó las rutas de excepción y limpieza que se corrigieron antes del run completo. No constituye evidencia de modelos cloud ni de un piloto anual.

Pendientes de P1 confirmados durante este corte: el proceso del test aún comparte permisos y entorno con Shelra; la evaluación externa del benchmark opera sobre el workspace de la sesión y necesita una copia de candidato y assets de oráculo protegidos; una operación externa aplicada antes de perder la respuesta puede repetirse con la recuperación actual. Estas limitaciones requieren cortes separados, con aislamiento y reconciliación, antes de cerrar P1.

## Tercer corte: operaciones que sobreviven a una respuesta perdida

Autorización: el usuario ordenó continuar las diez fases sin detenerse al cerrar entregas (AGENTS.md). Objetivo P1 08: conservar la intención antes de ejecutar una herramienta y su resultado antes de que el proveedor cierre el paso; recuperar una generación sin repetir automáticamente sus operaciones huérfanas.

Baseline reproducida: Agent.processMessage con proveedor simulado que valida schemas y bash real ejecutó tres veces un append externo local solicitado una vez. Dos respuestas se perdieron antes de onStepFinish; ninguna petición de recuperación contenía el comando previo. El contador y HOME estaban dentro de una fixture temporal, sin red ni credenciales reales.

Contrato del corte:

1. Un journal del host vive fuera del bucle de reintentos, tanto en el agente principal como en cada subagente. Envuelve execute después de todas las guardas existentes. Registra started antes de invocar, confirmed al recibir un resultado exitoso y ambiguous cuando el resultado no confirma el efecto o la invocación lanza. Una negativa explícita antes de ejecutar no se presenta como un efecto aplicado.
2. La pérdida de stream conserva pares tool-call/tool-result desde la ejecución observada, no solo desde onStepFinish. Se añaden únicamente las llamadas que faltan en los pasos completados. Los resultados MCP se conservan en su forma original en memoria.
3. Las operaciones todavía sin acuse y las huérfanas de una generación interrumpida forman una barrera de recuperación, incluidos reintentos transparentes del adaptador. Coincidencia por herramienta, argumentos JSON canonicalizados, cwd real y posición entre llamadas iguales del mismo lote; cambiar toolCallId no vuelve a ejecutar. Un resultado confirmado se reutiliza; un efecto ambiguo se reporta y no se repite automáticamente. Las invocaciones normales posteriores a un paso confirmado conservan su comportamiento; no hay deduplicación global de todos los argumentos. Dos acciones iguales explícitas en un lote tienen posiciones distintas.
4. La barrera no depende de isVerificationCommand: un script llamado test/build puede tener efectos. Hooks y MCP están dentro de la misma frontera. Una ejecución pendiente no desaparece al cambiar de modelo.
5. En sesiones persistentes, la intención y estado se escriben en el SQLite existente antes de continuar. El fingerprint evita persistir argumentos crudos; un resumen redactado y acotado conserva el resultado para explicar una recuperación tras reiniciar. Un started dejado por otro proceso se recupera como ambiguous. La escritura fallida de intención impide ese efecto y permite continuar por otras vías.
6. La recuperación de un resultado no acredita un test nuevo ni vuelve a contabilizar una mutación ya observada. La evidencia conserva su candidato original. Un resultado ambiguo no permite verified por checks locales ajenos al efecto.
7. El journal no prueba ausencia de efectos ni exactly-once de un servidor externo. La identidad semántica entre comandos diferentes y la reconciliación específica de una API requieren adaptadores de dominio; un modelo no puede declarar por sí mismo que un efecto ambiguo no ocurrió. El API de Agent sin sesión mantiene protección del proceso, sin prometer persistencia entre reinicios.

Implementación por responsabilidad: helper del journal y test; recibos persistentes y migración del SQLite existente; integración de los dos bucles y regresiones de resiliencia; prueba de restart en Bun real. No otro criterio de finalización, servicio permanente o dependencia. Tipos explícitos y Biome como en los cortes anteriores.

Aceptación: append externo una sola vez tras dos pérdidas de respuesta con IDs iguales o distintos; resultados host presentes en la recuperación; fallo posterior al append no provoca segundo efecto ni éxito verificado; comportamiento equivalente en child; llamadas intencionales tras ACK y operaciones distintas siguen permitidas; restart con intención pendiente no vuelve a ejecutar; fallo de persistencia bloquea antes del efecto; resultados privados no se guardan en texto sin redactar.

Verificación: tests del journal con herramientas schema-validating; Agent con bash y filesystem reales en fixture portable Bun; subprocess Bun con SQLite y HOME temporales para restart; suite de resiliencia y cierre; typecheck/lint/format/build y checks completos al estabilizar la integración. Estado: en implementación. El aislamiento de procesos/oráculos continúa en P1 09.

Implementación observada del tercer corte:

- tool-operations.ts envuelve la ejecución principal y delegada después de las guardas. Recupera resultados anteriores a onStepFinish, conserva outputs MCP en memoria y no atribuye nueva evidencia a un resultado reutilizado.
- La migración SQLite 9 conserva únicamente identidad, estado y resumen generado por el host. Un índice único impide dos intenciones pendientes con la misma identidad. La escritura de intención precede al efecto y al avance del proveedor; el pedido original también queda guardado antes del primer efecto.
- Una sesión reiniciada recibe los recibos pendientes como datos del host. Un resultado confirmado se reutiliza sin su output original, que no se persiste; un started queda ambiguo y no se ejecuta de nuevo. Un resultado incierto impide verified y produce una explicación visible.
- Pruebas con Bun, bash, archivos externos locales, HOME temporal y SQLite reales: el contador de la reproducción baja de tres aplicaciones a una; sucede igual con IDs regenerados, corte antes del evento del SDK, subagentes e interrupción del iterador. Crash con resultado persistido y crash con fallo de persistencia del resultado tampoco repiten el efecto.
- Las 177 pruebas focalizadas de journal, procesos reales, resiliencia y cierre pasan en el código del corte. Typecheck, lint y format verdes; la suite completa sigue en ejecución al registrar este estado.

Límite explícito: una llamada fallida cuyo resultado se recibió y confirmó normalmente puede volver a intentarse como antes. Este journal protege pérdida de respuesta y recuperación; no implementa reconciliadores de negocio ni demuestra idempotencia semántica entre comandos distintos. P1 08 queda parcialmente implementada hasta completar esa cobertura. Los proveedores de estas pruebas son simulados y no acreditan una ejecución cloud o anual.

## Cuarto corte: candidato y oráculo separados de la continuación

Objetivo P1 09: ejecutar los criterios del benchmark sobre una copia privada del candidato, conservando el proyecto original para tareas posteriores. Antes de ejecutar se concreta el soporte real del aislamiento de procesos.

Contrato de la primera entrega:

1. gradeWorkspace es el punto común de todos los ejecutores. Crea una copia temporal acotada del candidato y una copia de los assets del benchmark; los placeholders y SHELRA_BENCH_WORKSPACE/ROOT apuntan exclusivamente a ellas. No restaura tests ni genera salidas en el proyecto de la sesión.
2. La copia conserva todos los archivos del candidato necesarios para sus checks, incluidas sus dependencias ya instaladas. No instala paquetes. Omisiones intencionales de Git, estado local o artefactos se declaran en la evidencia. Límites, enlaces externos, archivos especiales, error de lectura y cambios durante la captura no se convierten en una copia válida parcial.
3. Una huella de contenido identifica lo congelado. Cambios observados en el candidato original durante la captura/evaluación impiden atribuir el pase a la continuación. Cambios de los assets copiados del oráculo durante su ejecución invalidan el resultado. Se conserva la restauración legítima de tests en la copia evaluada.
4. El entorno del grader se construye desde una lista permitida, HOME/TEMP privados y las variables del contrato; no hereda llaves, tokens, secretos ni hooks del usuario. El runner general mantiene su comportamiento por defecto; esta política se aplica explícitamente al grader.
5. El reporte distingue copia privada, detección de integridad y sandbox OS. No declara aislamiento de permisos cuando solo existen copia y filtros de entorno. En una plataforma sin mecanismo comprobado, la garantía queda unavailable; no se inventa un pase de seguridad.
6. El adaptador OS limita escrituras al candidato privado, concede solo lectura a las expectativas, retira red y acceso a credenciales y termina el árbol del proceso por timeout/cancelación. Los comandos que no puede ejecutar se reportan, sin caer silenciosamente en ejecución sin aislamiento.
7. La limpieza valida el destino absoluto temporal y no sigue enlaces. Un fallo de limpieza se reporta; nunca borra el workspace, el benchmark original ni un destino fuera de la raíz creada por el host.

Archivos previstos: helper de copias e integridad en src/bench con tests; grading.ts y sus pruebas de continuación; opción explícita de entorno en exec/command.ts; adaptador OS por separado tras una reproducción real. Sin dependencias nuevas, Docker ni servicio permanente.

Aceptación de la entrega de copias: un oráculo que restaura/modifica el candidato no altera el original ni la próxima tarea; un oráculo modificado no genera verificación positiva; enlaces externos y capturas incompletas no pasan; un token ficticio del host no llega al proceso; fallos y cancelación conservan estados honestos. Aceptación adicional de aislamiento: un proceso real intenta leer un secreto de prueba externo, escribir expectativas y abrir red; el OS lo impide. Los resultados de una sola plataforma no se atribuyen a las demás.

Fuentes de diseño Windows: Microsoft Learn, [Launch an AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer) y [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation). En la baseline no existía un adaptador Shelra comprobado por estos probes; las pruebas implementadas y su alcance se registran debajo.

Implementación y pruebas del cuarto corte:

- Los tres ejecutores usan gradeWorkspace con copias privadas y hashes de contenido. Los oráculos estándar copian bench/oracles y bench/fixtures; otros roots copian sus archivos íntegros dentro del presupuesto. Se conservan dependencias y memoria del candidato y se declara la omisión de .git. Límite inicial: 100.000 archivos, 2 GiB totales y 256 MiB por archivo; superar un límite deja la evaluación no ejecutada, nunca una copia parcial aprobada.
- Enlaces internos se materializan y hard-links se copian como archivos independientes; enlaces externos, ciclos y archivos especiales se rechazan. Copia, fuente y expectativas se comparan antes de ejecutar; al terminar se comprueban fuente y expectativas. La restauración de tests por el grader sucede en su candidato privado.
- Windows usa AppContainer sin capacidades de red, ACL de lectura para expectativas/runtime, escritura para candidato/HOME/TEMP y lista explícita de tres handles heredados. Un job limita memoria y procesos, mata descendientes y no permite breakaway. El helper nativo se compila con .NET Framework instalado; no descarga paquetes ni requiere un servicio. Timeout, cancelación y errores del mecanismo no ejecutan una alternativa sin sandbox.
- Windows ejecuta el contrato con cmd.exe, con placeholders que usan ese quoting. El runtime privado copia Bun y Node ya disponibles; otros runtimes no se atribuyen soporte por este corte. Linux/macOS conservan por ahora la copia y filtro de entorno, con processIsolation: unavailable; no tienen la garantía OS de Windows.
- Los recibos de evaluación llegan al resultado de Shelra y agentes de referencia y al export de history. Resultados que no pudieron evaluarse conservan not_run y bloqueo; no se convierten en passes.
- Seis suites y 39 pruebas focalizadas pasan en Windows con código integrado. Los procesos reales demuestran lectura de archivo externo rechazada, expectativa legible pero no escribible, copia del candidato escribible, cero conexiones al servidor local, timeout con descendientes detenidos y cancelación con job cerrado. El oráculo que intenta sobrescribirse recibe EPERM. No se afirma aislamiento de VM ni inmunidad frente a vulnerabilidades del sistema operativo.

Pendientes: prueba completa del repositorio sobre el cuarto corte, runners adicionales por ecosistema, límites de disco, integración del checker productivo con candidato privado y mecanismos OS comprobados en otras plataformas. P1 continúa abierta.

## Quinta entrega: checker productivo en candidato privado

Objetivo: reutilizar la copia y el adaptador de ejecución para el checker productivo, conservando sus imports relativos y la evidencia del candidato original.

Contrato previo a implementar:

1. El test y helpers originales se restauran como hoy; se congela una copia del proyecto con esos archivos en su ruta original .shelra/verify. El runner del host ejecuta allí. Los imports relativos alcanzan el código candidato de la copia.
2. Windows concede escritura al candidato y únicamente lectura a .shelra/verify y sus archivos. No hereda permisos de escritura hacia esas expectativas ni concede DELETE_CHILD o permiso de renombrar sus ancestros. Un intento de editar o quitar el test o helper debe fallar en el OS, también mediante rename o acceso por otro enlace. El diseño inicial de superponer una denegación al permiso heredado falló la prueba adversarial; la implementación retira ese permiso de escritura en la frontera.
3. Se compara el código de la copia antes/después además de la fuente original y el oráculo. Un test que parchea la implementación para pasar no genera evidencia positiva. Los artefactos ya excluidos por el snapshot del producto mantienen ese alcance declarado.
4. Un runner inyectado por código del host conserva su interfaz para tests, pero se registra como runner del llamador; no se atribuye la garantía AppContainer por su output. El modelo no puede elegir ese runner. Los runners normales no evitan la sandbox mediante reportes del modelo.
5. Error de copia, sandbox o limpieza produce unavailable/unverified conforme a la política existente y conserva el motivo. La comprobación del candidato original enlaza el recibo a la versión que se continuará. Ningún error autoriza ejecutar sobre el proyecto vivo. El bash del subagente checker también pasa por esta ejecución privada, incluso antes de producir su reporte; limitar la forma del comando no autoriza ejecutar ese test en el proyecto vivo.

Aceptación: test real que importa el código por ruta relativa pasa cuando el comportamiento es correcto; editar src de la copia no cambia el proyecto y no obtiene verified; editar, reemplazar o borrar su test/helper está bloqueado en Windows; un dato ficticio fuera de la copia no puede leerse; reparación mantiene las expectativas originales. Conservar regresiones de candidatos desconocidos, cancelación y limpieza fallida.

Implementación de la quinta entrega, en validación:

- independent-runner.ts es la ejecución privada común del bash del checker y del run final del host. La integración sustituye la implementación de BashTool antes de construir herramientas y guardas; conserva schemas, políticas, hooks y journal existentes. Un runner inyectado por el host recibe el cwd privado y se identifica como caller-runner.
- Las comprobaciones conservan el test y helpers originales, comparan fuente y copia después de ejecutar y no atribuyen un pase si el test cambia código para conseguirlo. Las excepciones de copia o ejecución invalidan el cierre; no activan una alternativa sobre el proyecto original.
- Los recibos públicos incluyen procedencia de ejecución y huella SHA-256 de la copia. El test de integración encontró que la primera proyección perdía estos campos; se corrigió esa proyección conservando la distinción entre runner del llamador y sandbox OS.
- El probe real de Windows encontró que la primera ACL permitía escribir, borrar y renombrar las expectativas. El permiso se reconstruyó sin escritura heredada sobre ellas ni borrado de sus ancestros. Las cuatro pruebas nativas pasan, incluyendo intento de cambiar ACL con icacls, red, archivos externos, timeout y cancelación. Las seis suites focalizadas siguientes pasaron 41 pruebas; la suite completa de cierre y los checks finales siguen pendientes al registrar este estado.

Validación final de las entregas tercera a quinta, 7 de octubre de 2026: bun run test terminó exit 0. Tramo principal: 239 suites y 2.310 pruebas pasadas, dos omisiones por soporte de Windows; cuatro tramos seriales de Vitest y todos los tramos de Bun verdes. Las 133 pruebas focalizadas de cierre, recibos, runner privado y aislamiento Windows pasaron en el código final. Typecheck, lint, format, git diff --check y build:binary verdes; build omitió la instalación en el perfil del usuario. Registro completo local: archivo shelra-phase1-isolation-suite.log en TEMP. Se corrigieron las fixtures/expectativas que dejaron de corresponder a la protección real, conservando los casos que deben fallar y sus veredictos unverified.

La garantía está limitada a los mecanismos y runtimes probados. Otros sistemas operativos conservan processIsolation unavailable y no adquieren una garantía Windows. No hay cuotas de disco ni reconciliadores de negocio implementados por esta entrega. La fase 1 continúa abierta.

## Siguiente corte: señales locales de cobertura y disponibilidad

Objetivo: cerrar P0 02 y P0 03 antes de construir el modelo del proyecto. La fuente actual confirma dos fallos: manager.query convierte una excepción del transporte en una lista vacía exitosa; compileContextPacket no propaga project.complete=false al campo truncated ni informa al modelo de esa exploración incompleta. El helper listWorkspaceFiles tampoco marca su lectura como incompleta cuando falla readdir/stat.

Contrato y alcance previo a implementar:

1. Una consulta LSP fallida conserva operación, servidor y motivo. Si todos fallan, success=false y estado unavailable; si algunos responden, success=false y estado partial con resultados de los que respondieron. Una respuesta vacía válida se distingue de ambas y no afirma ausencia global de consumidores. Fallar la segunda petición de call hierarchy recibe el mismo trato. No se añaden servidores ni dependencias.
2. El alcance informado es el de los servidores que la consulta llegó a ejecutar; no se atribuye análisis completo del repositorio. Un fallo no cancela el turno ni destruye resultados válidos de otros servidores. La salida textual también incluye disponibilidad porque es lo que recibe el modelo.
3. El inventario sin Git conserva su presupuesto y señala toda lectura incompleta por límite de profundidad/archivos o error de filesystem. El packet propaga truncated y explica que una búsqueda negativa en esa lectura no demuestra ausencia, indicando herramientas para continuar. No carga todos los archivos para conseguir una etiqueta completa.
4. Se conserva el API existente de diagnósticos después de editar y se amplía solo la respuesta de query con metadatos de disponibilidad. Checks y contexto conversacional mantienen sus contratos. Los cambios se limitan a manager/types/tests LSP y compiler/workspace-files/tests de contexto.

Aceptación: consulta con rechazo de transporte no devuelve No results found exitoso; fallo en la segunda consulta de jerarquía tampoco escapa como excepción sin resultado; consulta vacía válida sigue siendo complete en su alcance; dos servidores con un fallo conservan resultados parciales; más de 400 archivos sin Git y objetivo fuera del tramo visible producen packet.truncated=true con aviso de cobertura. La fixture de directorio que no puede leerse tampoco se declara completa.

Verificación: pruebas focalizadas de manager y compiler, fixture real de 450 archivos sin Git y transporte simulado explícitamente identificado; typecheck/lint/format y suite final del proyecto. No constituyen pruebas de comprensión semántica de 100.000 archivos ni de un LSP real. No se declara P0 completa con estos dos tickets.

Ejecución observada: antes del cambio, seis casos nuevos fallaron en la baseline: transporte caído presentado como consulta vacía exitosa; rechazo de la segunda petición de jerarquía que escapaba; respuesta parcial presentada completa; ausencia de alcance de una consulta vacía; inventario de 451 archivos truncado sin señal; directorio no legible presentado como lista completa. Tras corregir manager.query, la disponibilidad llega en texto y metadatos al tool result; la sincronización y consulta ocurren en la misma frontera de error. compiler propaga la cobertura incompleta y su aviso, y workspace-files preserva fallos de lectura/stat. Las 27 pruebas focalizadas iniciales pasan. Se añaden además casos de sincronización fallida y fuente desaparecida. Validación final de este corte pendiente.

El conjunto crítico de recibos, recuperación y checker, junto con estas señales de contexto/LSP y las regresiones actuales de memoria, se incorpora a CI en Linux y Windows reutilizando el setup de Bun existente. Windows ejecuta los probes AppContainer; en Linux se omiten explícitamente los probes nativos Windows y se prueba la copia privada sin atribuirle permisos de sandbox. La suite completa local no demuestra un job remoto que aún no se ha ejecutado.

Validación final de señales locales: las 29 pruebas focalizadas de LSP/contexto/scope pasan. bun run test sobre el código final terminó exit 0, incluidos los tramos seriales; typecheck, lint, format y build:binary sin instalación verdes. YAML de la nueva matriz validado usando yaml ya instalado; no se añadieron dependencias. Registro completo local: shelra-phase1-project-signals-suite.log en TEMP. P0 02 y P0 03 cerrados en su alcance; P0 como fase sigue abierta.
