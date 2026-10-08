# Backlog inicial del programa de ingeniería de grandes proyectos

Fecha: 7 de octubre de 2026; actualizado el 8. Estado: todas las diez fases autorizadas; regla del usuario: continuar sin detenerse al cerrar entregas. Entrega activa: P3 03, correcciones por componente y entorno, con pruebas focalizadas. Núcleo de cinco entregas, señales P0 02–04, P2 01 y P3 01–02 validados con suite completa. Las fases completas permanecen abiertas. Los cortes posteriores usan componentes ya validados sin declarar satisfechas garantías externas o longitudinales pendientes.

Este backlog desarrolla [tasks/plan.md](plan.md). Las fases se liberan por sus criterios de salida. Antes de ejecutar cada corte se concreta y revisa su especificación. Los archivos indicados son alcance inicial; un ticket que necesite demasiados cambios se divide sin dejar dos criterios de finalización activos.

Los tickets P0 y el primer corte P1 están detallados porque cierran fallos ya identificados. El resto son entregas para descomponer al llegar a su puerta, evitando cientos de tickets basados en arquitectura todavía no validada.

El usuario autorizó comenzar P1 directamente. Se ejecutó una baseline pertinente de 16 suites y 112 pruebas antes del cambio; esto no cierra la puerta P0. La especificación del corte autorizado es [SPEC-evidence-core.md](../SPEC-evidence-core.md). El alcance efectivo usa Agent.processMessage como ejecución común, en vez de conservar dos adaptadores de acciones.

Validación del corte: suite completa del proyecto exit 0; 99 pruebas del cierre y regresiones finales de cancelación/cambio durante reflexión; 14 pruebas de episodios; typecheck, lint, format, build:binary y git diff --check verdes. Detalles, alcance y límites en la especificación.

Validación del segundo corte: suite completa exit 0; primer tramo con 233 suites y 2.256 pruebas pasadas, dos omisiones por soporte de Windows; tramos seriales verdes; 106 pruebas de cierre incluidas; typecheck, lint, format y build:binary sin instalación verdes. Checker limitado por el host y oráculo original conservado; excepciones, test vacío, timeout y limpieza fallida no generan evidencia positiva falsa.

## Fase 0 Reproducciones y veracidad

### P0 01 Congelar baseline y clasificar evidencia

- [ ] Registrar commit, cambios locales, configuración redacted, plataforma, resultados y tipo de ejecución.
- Dependencia: ninguna.
- Aceptación: un reporte distingue harness simulado, modelo real, oráculo externo y observación de producción; incluye tareas asignadas, ejecutadas y evaluables.
- Verificación: repetir una fixture con HOME temporal y comprobar que no escribe en el HOME real.
- Alcance: bench/README.md, runner y registro existentes bajo src/bench/, un reporte en bench/history/.

### P0 02 Persistir regresión de LSP caído

- [x] Mantener consulta fallida distinta de consulta vacía.
- Implementado y comprobado: disponibilidad complete/partial/unavailable en texto y metadatos de los servidores consultados; rechazo de transporte o sincronización y fallo de la segunda petición de call hierarchy no son resultados vacíos exitosos. Fuente desaparecida se reporta unavailable. Transporte simulado, filesystem real; no se atribuye prueba de un servidor LSP real.
- Dependencia: P0 01.
- Aceptación: timeout o transporte caído producen failed/unavailable con motivo; cero resultados solo significa consulta realizada en el alcance declarado.
- Verificación: bunx vitest run --pool=forks --maxWorkers=1 src/lsp/manager.test.ts.
- Archivos: src/lsp/manager.ts, src/lsp/manager.test.ts, src/lsp/types.ts si hace falta.

### P0 03 Propagar cobertura incompleta del contexto

- [x] Mostrar límites del inventario sin Git y consultas recortadas.
- Implementado y comprobado: fixture real de 451 archivos con objetivo fuera del tramo de 400, aviso de cobertura y packet.truncated; errores de readdir/stat conservan lectura incompleta. Se mantiene exploración acotada y se indican herramientas para continuar.
- Dependencia: P0 01.
- Aceptación: una fixture de más de 400 archivos con objetivo fuera del primer tramo no devuelve cobertura completa; el modelo recibe cómo continuar.
- Verificación: bunx vitest run --pool=forks --maxWorkers=1 src/context/compiler.test.ts.
- Archivos: src/context/compiler.ts, src/context/compiler.test.ts, src/context/types.ts; src/contract/workspace-files.ts solo si la prueba muestra que su contrato necesita cambiar.

### P0 04 Mostrar el motivo real de rechazo de memoria

- [x] Separar duplicado, falta de capacidad, regla de autoridad y error de persistencia.
- Validado. Baseline de herramienta real: capacidad y autoridad devolvían success=true; ambas regresiones fallaron antes del arreglo. Gate con skipKind explícito y resultados consistentes con disco; 63 pruebas focalizadas pasadas y suite completa final exit 0, incluidos duplicado, índice lleno y error real de escritura. Especificación: SPEC-durable-knowledge.md.
- Dependencia: P0 01.
- Aceptación: memory_write no responde que una nota “ya cubre” el pedido cuando la tienda está llena; almacenamiento efectivo, estado del resultado y explicación coinciden.
- Verificación: bunx vitest run --pool=forks --maxWorkers=1 src/toolset/tools.test.ts src/memory/gate.test.ts.
- Archivos: src/toolset/tools.ts, src/toolset/tools.test.ts, src/memory/gate.ts si necesita motivo tipado.

### P0 05 No aplicar reparación causal con diagnóstico insuficiente

- [ ] Respetar incertidumbre explícita en AutonomyKernel.
- Dependencia: P0 01.
- Aceptación: confident:false conserva la hipótesis y busca observación adicional o termina no confirmado; no escribe el parche propuesto ni lo presenta como verified_success por ese diagnóstico.
- Verificación: test con proveedor simulado y primitivas reales sobre un workspace temporal; comprobar diff y estado final.
- Alcance: src/autonomy/kernel.ts y test enfocado bajo src/autonomy/.

### P0 06 Congelar el escenario de checker parcial

- [ ] Reproducir un checker que prueba solo uno de tres comportamientos obligatorios.
- Dependencia: P0 01.
- Aceptación: el escenario conserva el pedido y oráculo externos; identifica el pase global incorrecto como regresión pendiente de P5, sin modificar expectativas para ocultarlo.
- Verificación: ejecutarlo con proveedor simulado sin llamadas cloud; el resultado publicado coincide con el oráculo.
- Alcance: src/agent/behavior-verifier.test.ts, src/agent/completion-gate.test.ts y fixture externa si corresponde.

### P0 07 Congelar el escenario de flujo incorrecto que carga

- [ ] Separar smoke de arranque y aceptación del negocio.
- Dependencia: P0 01.
- Aceptación: una UI sin errores que calcula $0 en lugar de $20 pasa únicamente el diagnóstico de arranque y falla el oráculo del pedido.
- Verificación: Chromium en fixture temporal; expectativas fuera del alcance editable del agente.
- Alcance: src/agent/runtime-smoke.test.ts y fixture bajo bench/.

### P0 08 Persistir fallos de captura, corrección y falsa reconfirmación

- [ ] Mantener probes de ocho reglas, 45/500 declaraciones, PostgreSQL→CockroachDB y typecheck que no verifica una afirmación arquitectónica.
- Captura y almacenamiento: cuatro probes nuevos fallaron antes del cambio (máximo cinco y colisión por prefijo). Ahora conserva 8/45/500 declaraciones reconocidas, recuperación en nuevo proceso sin MEMORY.md y estados no activos; estos resultados no cierran corrección semántica por ámbito ni falsa reconfirmación por comandos.
- Dependencia: P0 01.
- Aceptación: baseline reporta resultados verdaderos; variantes por ámbito comprueban que Auth y Billing no se reemplazan entre sí.
- Verificación: bunx vitest run --pool=forks --maxWorkers=1 src/memory/reflection.test.ts src/memory/gate.test.ts src/memory/store.test.ts src/memory/retrieval.test.ts.
- Archivos: esos cuatro tests, con fixtures temporales; reparaciones pertenecen a cortes separados de P3.

### P0 09 Hacer obligatorio el conjunto crítico del harness

- [ ] Añadir CI focalizada de veracidad, memoria y cierre, conservando Free-mode policy.
- Parcial: job engineering-evidence para Linux/Windows añadido y YAML validado con la dependencia yaml ya instalada; tests de recibos, journal, checker, contexto/LSP, memoria actual y CLI real usan sus runners originales. El job remoto aún no se ejecutó y los probes pendientes de P0 06–08 no se declaran capacidades aprobadas.
- Dependencias: P0 02–05 y fixtures P0 06–08.
- Aceptación: Linux y Windows separan soporte de entorno de resultado del producto; ningún test rojo se elimina ni se declara verde para habilitar CI. Las regresiones reparadas son checks obligatorios. Los probes de límites todavía no reparados conservan resultados en el reporte de baseline y no se presentan como capacidades aprobadas.
- Verificación: jobs correspondientes y regresiones focalizadas; conservar format, lint, typecheck y build actuales.
- Alcance: .github/workflows/typecheck.yml y tests de portabilidad que realmente lo requieran.

### P0 10 Cerrar la puerta inicial

- [ ] Publicar resultado de baseline y correcciones de señales.
- Dependencias: P0 01–09.
- Aceptación: el reporte enumera defectos cerrados y límites todavía pendientes; no etiqueta la fase como agente senior ni autónomo anual.
- Verificación: revisión independiente de recibos y repetición de una muestra.
- Alcance: reporte en bench/history/ y estado de esta fase.

## Fase 1 Primer corte del núcleo común

### P1 01 Especificar evidence-core

- [x] Concretar tipos de recibos, estados, invalidación, autoridad y API común.
- Dependencia: puerta P0.
- Aceptación: contrato pequeño reutiliza src/contract/types.ts y evaluación existentes; distingue evidencia observada de juicio; define ownership de datos y protección frente al modelo.
- Verificación: revisar ejemplos de comando fallido, evidencia antigua, check parcial, acción denegada y acción aplicada antes de un crash.
- Alcance: especificación de evidence-core según mapa revisado; no crear un segundo store sin justificarlo.

### P1 02 Primer adaptador de acciones

- [x] Llevar las escrituras públicas de --autonomous al camino productivo común.
- Implementación del corte: CLI real, SDK y SQLite temporales prueban checkpoint, conservación del estado previo y rechazo de una escritura fuera del workspace. No se creó otro servicio de primitivas.
- Dependencia: P1 01.
- Aceptación: checkpoint, scope y protección del estado previo se aplican igual que en el camino productivo; no se sobrescriben cambios previos del usuario.
- Verificación: prueba de paridad de acción permitida, denegada, fallida y revertida sobre scratch.
- Alcance: src/autonomy/runtime.ts, punto de integración de src/agent/agent.ts y servicio/test mínimo.

### P1 03 Migrar comandos y protección de tests

- [x] Compartir ejecución de comandos y política de checks mediante Agent.processMessage.
- Implementación del corte: un test real fallido mantiene salida autónoma no exitosa aunque el modelo emita una etiqueta de éxito. Las protecciones de tests, reglas, decisiones y proveedores se heredan del mismo camino.
- Dependencia: P1 02.
- Aceptación: el modo autónomo no evita políticas ejecutando primitivas alternativas; actualizar un test legítimamente y ocultar una regresión tienen resultados distintos.
- Verificación: parity tests con una batería del contrato y modificaciones de tests.
- Alcance: adaptadores de ambos modos y contrato existente; dividir si exige más de cinco archivos.

### P1 04 Invalidar evidencia al cambiar el candidato

- [ ] Vincular recibos con commit base, diff/configuración y ámbito.
- Parcial: contenido local con SHA-256 y HEAD; candidatos individuales antes/después de cada check; unknown, cambios durante el check y pases anteriores a otra edición no acreditan el candidato final. Pendiente: versiones observadas de datos, esquemas y servicios externos.
- Dependencia: P1 03.
- Aceptación: un check pasado antes de una edición relevante no respalda el cierre final; versiones de esquema, datos de prueba y servicios también invalidan su evidencia cuando corresponda; cambios irrelevantes no fuerzan trabajo arbitrario.
- Verificación: secuencia pasar→editar→cerrar, cambio de esquema/servicio y cambio externo durante la sesión.
- Alcance: contrato/evaluador y tests focalizados.

### P1 05 Emitir comprobaciones desde el host

- [x] Generar resumen de comprobaciones locales y alcance a partir de recibos del host.
- Implementación del corte: resultado estructurado con taskId, estados y recibos; salida autónoma depende del host. Un check focalizado tras timeout conserva su comando real. Redacción de credenciales en el resultado público. Cobertura del negocio y evidencia externa siguen pendientes de sus fases.
- Dependencia: P1 04.
- Aceptación: prueba aislada, test completo, migración no ejecutada y despliegue no observado se comunican con alcance exacto; texto del modelo no los eleva a verificados.
- Verificación: casos adversariales de afirmaciones y resultados.
- Alcance: src/agent/claim-check.ts, su test, integración de cierre y representación del recibo.

### P1 06 Cerrar paridad y retirar rutas alternativas

- [ ] Completar cortes de decisiones, reglas, contexto, memoria y cierre.
- Parcial: chat, headless, --autonomous y alias shelra-autonomy llaman al mismo ciclo protegido. El alias nuevo declara harness agent-chat y conserva el oráculo externo por separado. Pendiente: matriz ampliada, aislamiento fuerte de evidencia/oráculos y reconciliación de efectos externos ambiguos; la fase completa permanece abierta.
- Dependencias: P1 02–05; descomponer en tickets antes de implementar.
- Aceptación: mismo corpus de acciones en interactive/headless/autonomous, sin diferencias de protección o veredicto; rutas antiguas retiradas.
- Verificación: matriz de paridad, Free mode, fallo de proveedor y recuperación.
- Alcance: cortes separados por responsabilidad; ninguna reescritura monolítica.

## Entregas posteriores por descomponer

### P1 07 Imponer límites del checker y congelar su oráculo

- [x] Limitar herramientas/ejecución del checker y rechazar pases con cambios de candidato u oráculo.
- Dependencia: primer corte P1 validado; autorizado por la continuación del usuario.
- Aceptación y ámbito: segundo corte de [SPEC-evidence-core.md](../SPEC-evidence-core.md); incluye traversal/enlaces, comandos sin auto-install, originales preservados, comprobaciones antes/después y pruebas reales.
- Verificación: helper/comandos, integración adversarial y cierre, typecheck/lint/format/build. Aislamiento OS y efectos externos permanecen pendientes.

### P1 08 Recuperar operaciones externas de resultado ambiguo

- [ ] Registrar intención y resultado observado antes de reintentar una operación con efectos externos.
- Evidencia del corte: un probe offline de Agent.processMessage, proveedor simulado y shell real pierde la respuesta antes de stepFinish; la recuperación vuelve a ejecutar el efecto externo tres veces. No prueba comportamiento de un proveedor cloud.
- Aceptación: un efecto aplicado antes de perder la respuesta no se repite sin idempotencia demostrada o reconciliación; la sesión conserva incertidumbre y progreso. La recuperación de lecturas y llamadas seguras continúa.
- Alcance inicial: ciclo productivo de herramientas, recuperación y recibos existentes; especificar adaptadores y persistencia antes de implementar. No confiar en una etiqueta declarada por el modelo.
- Verificación: procesos/efectos locales de prueba fuera del workspace, crash y respuesta perdida; probar acción aplicada, no aplicada y resultado indeterminado, sin servicios externos reales.
- Parcial implementado: journal antes de efectos, SQLite y recuperación principal/delegada, recibos reales aunque el stream no cierre el paso, bloqueo de operaciones huérfanas ambiguas. 177 pruebas focalizadas verdes. El probe pasa de tres efectos a uno; crash/restart no repite. Reconciliación de dominio e identidad semántica entre comandos distintos siguen pendientes. La suite completa encontró una fixture con ID duplicado que se corrigió manteniendo sus expectativas; once pruebas del executor pasan tras la corrección. No se declara la suite completa verde todavía.

### P1 09 Aislar evaluación y ejecución del oráculo

- [ ] Ejecutar el grader sobre una copia congelada del candidato, con oráculos fuera del alcance editable y permisos de proceso limitados.
- Evidencia del código: gradeWorkspace usa el workspace vivo después de Agent.cleanup; el oráculo polyglot restaura assets allí y la continuación puede heredar esos cambios. El guard del checker limita herramientas, pero no los permisos del código importado ni el entorno del test.
- Aceptación: evaluar no modifica el workspace que se continuará; el modelo y sus tests no pueden escribir el oráculo ni leer credenciales del host. La plataforma sin aislamiento disponible se reporta sin atribuir esa garantía.
- Alcance inicial: src/bench/agent-executor.ts, src/bench/grading.ts, src/bench/runner.ts, bench/oracles/polyglot.ts y runner/aislamiento existente; dividir por responsabilidad y concretar spec de soporte Windows/Linux antes de implementar.
- Verificación: hashes del candidato y assets antes/después, continuación sobre candidato original, intents de escritura/lectura y corte de proceso. No declarar aislamiento OS por snapshots.
- Parcial implementado: copia privada compartida entre ejecutores, entorno permitido, huellas y metadatos, AppContainer/ACL/job de Windows sin fallback sin sandbox. Checker productivo integrado, incluyendo su bash anterior al reporte. 133 pruebas focalizadas de cierre, procedencia y ejecución privada verdes; suite completa exit 0 (tramo principal: 239 suites y 2.310 pruebas pasadas; dos omisiones de Windows; tramos seriales verdes). Typecheck/lint/format/build sin instalación y git diff --check verdes. Otros OS/runtimes y límites de disco no se atribuyen soporte.

### P2 01 Límites por paquete con fuentes actuales

- [x] Entregar al modelo el paquete del archivo nombrado, consumidores declarados y documentación anidada, con fuente y cobertura.
- Dependencias de este corte: núcleo común validado en las cinco entregas P1 y señales de disponibilidad/cobertura P0 02–03. El cierre de fase 2 conserva las demás dependencias del plan.
- Especificación: [SPEC-project-model.md](../SPEC-project-model.md). El helper lee manifests acotados y el compilador existente publica la proyección; no hay un inventario paralelo ni cargas de todos los cuerpos.
- Evidencia inicial: 39 pruebas focalizadas de package-model/contexto/LSP verdes, incluidos fixture Auth/Billing/Web, nombres duplicados, alias npm, manifest inválido o excesivo, junction externo, prioridades fuera del presupuesto, documentación borrada y lista sintética de 100.000 paths. La lista sintética solo prueba proyección; no se presenta como benchmark de filesystem.
- Validación final: suite completa exit 0 (tramo principal de 240 suites y 2.331 pruebas pasadas, dos omisiones de Windows; tramos seriales verdes); typecheck/lint/format/build sin instalación verdes. Índice persistente incremental, símbolos/imports y fixtures reales 10k/50k/100k son siguientes cortes de fase 2.

| Fase | Cortes ordenados | Evidencia para cerrar |
| --- | --- | --- |
| P2 | Inventario por paquete → documentación anidada → índice incremental → símbolos y relaciones → retrieval y paginación | 10k/50k/100k, cambios de rama/archivos, coverage y propietario/consumidores |
| P3 | Captura humana íntegra → tipos/ámbitos → conflictos/supersesión → frescura pertinente → almacenamiento/proyección → retrieval → crédito y reflexión | Probes humanos y arquitectura v1→v2; conjunto reservado de memoria |
| P4 | Pedido íntegro → contrato y cobertura → riesgo/impacto → reproducción/hipótesis → causa/regresión | Pedidos equivalentes y bugs de varias capas, sin falso diagnóstico |
| P5 | IDs cubiertos → checker aislado → oráculo congelado → checks por paquete → flujos de negocio → tests legítimamente actualizados | UI incorrecta, checker parcial, tests obsoletos, evidencia invalidada |
| P6 | Reglas arquitectónicas → imports/contratos → deuda y duplicación → observación de recursos → revisión independiente | Fallos sembrados y 100 cambios sin degradación crítica |
| P7 | Raíces autorizadas → contratos federados → entornos/adaptadores → fallos distribuidos → fixture Orion → staging real | Impacto y resultados entre frontend/backend/datos/workers/MCP/desktop |
| P8 | Objetivos persistentes → recuperación → leases/worktrees → delegación → presupuestos → aprendizaje por evidencia | Crashes, cancelación, cambios externos, efectos no idempotentes y proveedor limitado |
| P9 | Comparación same-model → comparación productos → 30/100 tareas → 1.000 tareas → revisión y publicación | Oráculos reservados, denominadores completos, incertidumbre y límites |
| P10 | Elegir piloto → baseline Day 1 → controles 30/90/180/365 → ampliar alcance demostrado | Calidad real, aprendizaje, deuda e intervención humana |

### P3 01 Captura humana duradera sin depender del índice corto

- [x] Cerrar validación de la primera entrega de captura/almacenamiento, conservando la fase 3 completa abierta.
- Dependencias del corte: store y gate existentes, núcleo validado; no necesita inferir ámbitos semánticos del modelo del proyecto todavía pendiente.
- Especificación: [SPEC-durable-knowledge.md](../SPEC-durable-knowledge.md). Topic humano autocontenido y atómico; proyección de 200 líneas separada de almacenamiento; consulta paginada; inferencias no reemplazan humanos ni quedan bloqueadas por sus filas de proyección.
- Evidencia focal: 8/45/500 declaraciones, nombres con prefijo común, recuperación en proceso Bun nuevo, error real de proyección, corrupción/junction/oversize, supersesión/borrado/reminder, 205 entradas paginadas y aprendizaje posterior. Agent.processMessage captura y una instancia nueva recibe ocho reglas; una captura fallida se informa al modelo sin cortar el turno. Proveedores y SQLite de esos tests de Agent son simulados; filesystem y proceso de recuperación reales.
- Presupuestos: 5.000 topics humanos canónicos por scope, 32 KiB/topic; legado compatible; prompt con presupuestos actuales. No se atribuye almacenamiento infinito ni rendimiento de millones de entradas.
- Validación final: suite completa exit 0, tramo principal con 241 suites y 2.355 pruebas pasadas y dos omisiones de Windows; tramos seriales verdes. Typecheck/lint/format/build sin instalación, sintaxis YAML y git diff --check verdes. Tras una revisión se repararon además enlaces físicos del índice, histórico CLI y protección del borrado frente a junction externo; sus reproducciones se conservan. Corrección Auth/Billing, fuente/vigencia pertinente y falsa reconfirmación son cortes siguientes.

### P3 02 No confirmar una afirmación porque pasó un comando

- [x] Separar observación de uso de un comando y confirmación del contenido; conservar vigencia incierta de la afirmación.
- Dependencias: P3 01 y recibos productivos del núcleo validado. Contrato en SPEC-durable-knowledge.md, tercer corte.
- Aceptación: typecheck real pasado no elimina stale de una afirmación de almacenamiento que cambió; nombre exacto del comando conserva evidencia de uso; reescritura cosmética no rejuvenece conocimiento. Source-version/property-level proof sigue abierto para otro corte.
- Validación: cuatro pruebas específicas y la integración Agent pasan; suite completa final exit 0, 242 suites principales y 2.359 pruebas pasadas, dos omisiones de Windows y tramos seriales verdes. Typecheck/lint/format/build sin instalación/YAML/diff verdes. Una expectativa antigua de reconfirmación se reemplazó por el contrato especificado, sin declarar prueba de contenido por checks generales.

### P3 03 Correcciones por componente y entorno

- [ ] Conservar subjects explícitos y separar corrección inequívoca de conflicto pendiente; Auth y Billing no se fusionan o retiran entre sí.
- Especificación previa: SPEC-durable-knowledge.md, cuarto corte. No se declara resolución semántica de entidades, aliases ni migración automática del histórico.
- Verificación: fixtures de memoria y herramienta reales; historia, entornos, autoridad de quotes, conflictos y recuperación posterior; checks del proyecto.

## Reglas de trabajo

- Un ticket de comportamiento se cierra con su aceptación comprobada, no con el número de archivos modificados.
- Antes de ampliar alcance se revisan dependencias y contrato del módulo.
- Tests focalizados durante el corte; checks apropiados completos al cerrar cambios de código.
- No ejecutar llamadas pagadas ni usar un fallback fuera de Free mode.
- No editar ShelraCode/ ni mezclar los cambios locales existentes con estas entregas.
- Un fallo de evaluación se conserva, se explica y se convierte en regresión; nunca se cambia el grader para conseguir verde.
- Reportar al cerrar cada puerta: resultado, evidencia, coste, límites y siguiente corte permitido.
