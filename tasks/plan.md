# Plan por fases para la ingeniería de grandes proyectos en ShelraCode

Fecha: 7 de octubre de 2026; actualizado el 8. Estado: el usuario autorizó ejecutar las diez fases y ordenó continuar sin detenerse al cerrar entregas. Entrega activa: P3 03, correcciones por componente y entorno, implementada con comprobaciones focalizadas. Cinco entregas del núcleo, señales P0 02–04, primer corte de fase 2 por paquetes, captura humana duradera y separación comando/confirmación están validados. Las fases completas conservan sus pendientes. Punto de partida: ShelraCode actual, con sus cambios locales existentes.

Cinco entregas implementadas y validadas: [SPEC-evidence-core.md](../SPEC-evidence-core.md). El camino productivo comparte evidencia; conserva operaciones ante pérdidas de respuesta/restart; el benchmark y checker ejecutan candidatos privados con aislamiento Windows comprobado. P0 conserva su estado pendiente; se ejecutó su baseline pertinente antes del corte autorizado. La fase 1 completa sigue abierta para soporte adicional de procesos/oráculos, versiones externas y reconciliación de efectos externos.

La meta es que Shelra conserve el contexto correcto, investigue problemas entre componentes, preserve decisiones arquitectónicas y demuestre sus resultados mientras un proyecto evoluciona durante meses y años. La posición competitiva se ganará con mediciones reproducibles y uso real. No se atribuye esa capacidad al producto actual.

El resultado esperado tiene dos escalones: un agente fiable para tareas complejas delimitadas y, después, un agente que mantenga sistemas grandes con autonomía delegada y conocimiento coherente. El segundo exige evidencia longitudinal que el primero no proporciona.

## Alcance y supuestos

- Se conserva el producto Bun y TypeScript, el CLI y los proveedores existentes. No se comienza con una reescritura ni con entrenamiento de un modelo fundacional.
- Free mode conserva su regla: ningún coste pagado o desconocido entra como gratuito. Todos los modelos, incluidos planificadores, reflexiones y verificadores, pasan por el routing autorizado.
- Proyecto grande significa complejidad real: paquetes, servicios, datos, contratos, infraestructura, integraciones y decisiones históricas. Los archivos de relleno solo sirven para medir navegación y rendimiento.
- El objetivo incluye repositorios de 10.000, 50.000 y 100.000 archivos, trabajo en múltiples repositorios y ecosistemas distintos. El soporte se incorpora por adaptadores probados; no se presume soporte universal.
- La autonomía se define por ámbito, permisos persistentes y efectos permitidos. Se busca reducir supervisión repetitiva sin eliminar la responsabilidad sobre cambios irreversibles.
- OrionBIM se usa inicialmente como referencia de complejidad. Una prueba sobre su producto real necesita sus repositorios, entornos y accesos autorizados; un fixture no demuestra mantenimiento del producto real.
- Los umbrales de este plan son objetivos de aceptación propuestos. Los resultados medidos tendrán su versión, muestra y límites.

El plan aprobado en [docs/EXECUTION-PLAN.md](../docs/EXECUTION-PLAN.md) conserva sus reglas y compromisos. Este programa amplía el horizonte de F7 y F9; no cambia su fecha ni su estado por escribir una propuesta. La revisión de octubre puede demostrar mejoras acotadas, pero no un año de operación.

## Los cinco cambios fundamentales

| Cambio | Problema que resuelve | Resultado observable |
| --- | --- | --- |
| Núcleo común de ejecución y evidencia | Modos que actúan y terminan con protecciones diferentes | La misma acción recibe la misma política y el mismo veredicto en todos los modos |
| Modelo del proyecto con fuentes y vigencia | Contexto reconstruido parcialmente y dependencias no conocidas | Propietarios, consumidores, contratos y decisiones consultables con cobertura explícita |
| Memoria que distingue autoridad de verdad comprobada | Contradicciones, pérdidas y crédito sin prueba de la afirmación | Correcciones aplicadas por ámbito y conocimiento obsoleto identificado antes de usarlo |
| Contrato de intención y verificación de comportamiento | Compilar o pasar checks parciales se confunde con resolver el pedido | Cada comportamiento obligatorio tiene evidencia sobre el estado final |
| Evaluación longitudinal y autonomía graduada | Confianza concedida por demostraciones cortas | El alcance aumenta solo cuando supera pruebas de ese alcance y pilotos reales |

Estas cinco bases tienen prioridad sobre añadir agentes, herramientas, proveedores o memoria semántica por sí mismos.

## Mapa de capacidades propuesto

Los identificadores son estables. Las dependencias son unidireccionales; los contratos se especificarán en el módulo que los ofrece. Este mapa organiza la iniciativa y no crea nuevas autoridades sobre código, decisiones o permisos.

| Módulo | Responsabilidad | Depende de |
| --- | --- | --- |
| evidence-core | Evidencia del host, versiones, acciones, políticas y cierre común | — |
| project-model | Inventario incremental, símbolos, relaciones, contratos y cobertura | evidence-core |
| durable-knowledge | Memoria por ámbito, fuentes, conflictos, supersesión y recuperación | evidence-core, project-model |
| intent-contract | Objetivo, condiciones de éxito, restricciones, riesgo y causalidad | evidence-core, project-model, durable-knowledge |
| behavior-verification | Ejecutar y vincular pruebas a cada condición del contrato | evidence-core, intent-contract |
| architecture-review | Revisar límites, contratos, convenciones y deuda del cambio | project-model, durable-knowledge, intent-contract |
| system-integration | Integraciones entre servicios, repositorios y entornos | behavior-verification, architecture-review |
| sustained-autonomy | Trabajo persistente, delegación, recuperación y permisos por ámbito | durable-knowledge, system-integration |
| evaluation-program | Oráculos externos y medición de todos los módulos | evidence-core |

Orden: evidence-core → project-model → durable-knowledge → intent-contract → behavior-verification → architecture-review → system-integration → sustained-autonomy. evaluation-program acompaña cada entrega y no autoriza acciones del agente.

El usuario autorizó ejecutar todas las fases de este mapa. Antes de implementar un módulo se concreta y revisa su especificación y se divide en cambios pequeños, sin pedir de nuevo autorización para continuar. Los límites se ajustan con evidencia del código y las pruebas; la autorización no sustituye los criterios de aceptación.

## Arquitectura objetivo

El flujo de ingeniería propuesto es:

    Pedido original
      → contrato de intención y restricciones
      → contexto del proyecto con fuentes y dudas
      → plan según riesgo e impacto
      → ejecución mediante un núcleo común
      → observación y diagnóstico
      → comprobaciones de comportamiento y revisión del cambio
      → resultado respaldado por evidencia del host
      → conocimiento duradero vinculado a lo realmente comprobado

Un taskId enlaza el pedido, el plan, las acciones, el diff, las comprobaciones, el resultado y el aprendizaje. Cada comprobación referencia el estado candidato: commit base, huella de cambios locales, configuración, versión de esquema, fixtures y datos de prueba, versión de servicios y artefacto observado cuando correspondan. La evidencia externa declara su fecha, caducidad y necesidad de revalidación. Un cambio posterior invalida la evidencia afectada.

Los estados deben distinguir al menos confirmado, fallido, no ejecutado, no disponible, parcial y conflictivo. Una herramienta caída nunca significa ausencia de dependientes. Un smoke de arranque nunca significa que el negocio funciona. Un check pasado no confirma todas las afirmaciones que estaban en el contexto.

El modelo propone hipótesis y acciones. El host decide qué se ejecutó, qué resultado se observó, qué se invalidó y qué puede declararse verificado. Los juicios semánticos permanecen identificados como juicios.

## Punto de partida comprobable

| Hallazgo al preparar el plan | Fuente en el producto | Consecuencia para este programa |
| --- | --- | --- |
| El modo autónomo tenía un camino separado de acciones y contexto; el primer corte P1 lo retiró de CLI y benchmark | [src/autonomy/kernel.ts](../src/autonomy/kernel.ts), [SPEC-evidence-core.md](../SPEC-evidence-core.md) | Compartir el núcleo de responsabilidad antes de ampliar autonomía |
| La detección de requisitos depende de expresiones y un umbral de varios comportamientos | [src/agent/requirements.ts](../src/agent/requirements.ts), [src/agent/behavior-verifier.ts](../src/agent/behavior-verifier.ts) | Contrato trazable incluso para un solo comportamiento importante |
| El smoke genérico busca errores de ejecución, sin probar necesariamente resultados del negocio | [src/agent/runtime-smoke.ts](../src/agent/runtime-smoke.ts), [src/exec/browser.ts](../src/exec/browser.ts) | Añadir flujos y expectativas explícitos |
| El contexto inicial es acotado y la cobertura puede quedar incompleta | [src/context/compiler.ts](../src/context/compiler.ts) | Cobertura y omisiones visibles, inventario incremental |
| Un error del transporte LSP puede terminar como cero resultados | [src/lsp/manager.ts](../src/lsp/manager.ts) | Diferenciar consulta vacía de consulta fallida |
| Captura humana limitada por turno y capacidades del índice de memoria | [src/memory/reflection.ts](../src/memory/reflection.ts), [src/memory/store.ts](../src/memory/store.ts), [src/memory/gate.ts](../src/memory/gate.ts) | Evitar pérdida silenciosa y separar límites de inferencias y declaraciones humanas |
| Reconfirmación por comandos y crédito de contexto no demuestran cada afirmación | [src/memory/store.ts](../src/memory/store.ts), [src/agent/agent.ts](../src/agent/agent.ts) | Vincular aprendizaje y frescura a evidencia pertinente |
| Existen oráculos y pruebas de memoria, pero una simulación no equivale a operación anual | [bench/README.md](../bench/README.md), [bench/long-horizon/](../bench/long-horizon/) | Separar evaluación del harness, modelo real y piloto de producción |

Los tests de contrato, ledger, recuperación, routing y memoria existentes se reutilizan. Los módulos nuevos son límites propuestos; no se debe duplicar su responsabilidad en una segunda implementación.

## Fase 0 Línea base honesta y cierre de fallos críticos

**Objetivo:** poder medir la mejora y eliminar señales de éxito que esconden desconocimiento.

Entregas:

1. Registrar versión del código, cambios locales, plataforma, proveedor, modelo real, política Free, presupuestos y resultado. Los tests usan HOME y proyectos de prueba aislados.
2. Convertir los hallazgos del audit en reproducciones persistentes: LSP caído, contexto sin Git truncado, ocho reglas capturadas parcialmente, memoria llena, corrección contradictoria, reparación con confianza negativa, checker parcial y UI que carga con resultado incorrecto.
3. Reparar primero los fallos pequeños de veracidad: error LSP distinto de cero referencias; truncamiento visible; escritura de memoria rechazada distinta de duplicado; diagnóstico insuficiente sin aplicar un parche presentado como causa confirmada.
4. Registrar las comprobaciones esenciales de memoria, contrato y finalización en CI junto con las de Free mode. Separar incompatibilidad del entorno de regresión del producto, sin ocultar ninguna.

**Salida:** todas las reproducciones existen; los fallos críticos de señales tienen regresión; un resultado no disponible no se convierte en passed. La baseline se conserva y los escenarios no quedan accesibles al agente como respuestas esperadas durante la evaluación.

**Dependencia:** ninguna fase anterior. **Riesgo:** ajustar el producto a probes triviales; mitigación: variantes reservadas y resultados fuera del workspace editable.

## Fase 1 Núcleo común de ejecución y evidencia

**Objetivo:** que la fiabilidad pertenezca a Shelra y se aplique a todos sus modos.

Entregas:

1. Extraer un servicio pequeño de acciones y resultados del camino productivo. Reutilizar contratos, herramientas, políticas y evaluación existentes; evitar comenzar dividiendo por completo agent.ts.
2. Migrar --autonomous en cortes: checkpoints y protección de tests; después reglas y decisiones; después contexto, memoria y cierre. Puede conservar temporalmente otro planificador, pero no otro criterio de éxito.
3. Mantener recibos de comandos, lecturas relevantes, cambios, observaciones y comprobaciones. Cada recibo incluye ámbito, estado candidato, resultado y cobertura. Los efectos externos distinguen iniciado, confirmado, fallido y ambiguo.
4. Generar el resumen de comprobaciones desde recibos del host. Las frases del modelo no pueden aumentar el alcance de lo verificado. Un test aislado no respalda “todos los tests”.
5. Proteger estado de evidencia y oráculos frente a las herramientas del modelo. Para autonomías amplias, el aislamiento debe limitar efectos reales del shell y del código ejecutado, no solo analizar el texto del comando.

**Salida:** pruebas de paridad interactive/headless/autonomous; mismos permisos y veredictos ante las mismas acciones y resultados. Ningún camino autónomo aplica escrituras mediante primitivas que evitan las protecciones. Ediciones posteriores invalidan comprobaciones pertinentes. Efectos externos usan claves de idempotencia o reconciliación cuando el adaptador lo permite; una operación no idempotente de resultado ambiguo no se reintenta automáticamente.

**Dependencia:** fase 0. **Riesgo:** dos autoridades durante la migración; mitigación: adaptar cada modo al mismo servicio y retirar cada ruta antigua al terminar su corte.

## Fase 2 Modelo del proyecto y navegación de monorepos

**Objetivo:** saber dónde vive un comportamiento, qué lo consume y qué falta por conocer.

Entregas:

1. Descubrir workspaces, paquetes, servicios, entrypoints, instrucciones por carpeta, manifests, scripts de checks, documentación, esquemas y configuraciones de despliegue.
2. Mantener un índice local incremental por huellas y cambios de Git, con fallback para carpetas sin Git. No recorrer ni cargar todos los cuerpos en cada turno.
3. Incorporar imports y exports comprobables, referencias y llamadas cuando el servidor de lenguaje esté disponible. Conservar aristas por su fuente: imports, símbolos, contratos HTTP, eventos, tablas y configuración. No confundir un grafo de imports con toda la arquitectura.
4. Seleccionar contexto por propietario, símbolos, consumidores, reglas y checks. Ampliarlo conforme la investigación descubre otras partes; ofrecer paginación y continuación para búsquedas truncadas.
5. Descubrir README y ADRs de apps, packages y services. Mantener cobertura por ámbito y fecha, incluyendo sistemas externos cuyo interior no puede inspeccionarse.

**Salida propuesta:** fixtures de 10k/50k/100k con archivos relevantes repartidos; al menos 95% de acierto en propietario y dependientes comprobables; cero relaciones inventadas presentadas como confirmadas. La pérdida de LSP o Git queda visible. Presupuesto inicial de contexto ≤12.000 caracteres de proyección, con cargas adicionales dirigidas.

La latencia p95 y memoria se fijan contra hardware y baseline antes del experimento. Objetivo inicial para búsqueda dirigida con índice caliente: p95 ≤2 s en 100k; actualización de hasta 100 archivos: p95 ≤5 s. Son metas por validar, no resultados actuales ni límites universales.

**Dependencia:** fase 1. **Riesgo:** un grafo incompleto inspira falsa confianza; mitigación: cobertura explícita, unknown y exploración dirigida.

## Fase 3 Conocimiento duradero con autoridad y vigencia

**Objetivo:** recordar la información correcta y corregirla sin borrar decisiones humanas.

Entregas:

1. Distinguir reglas, decisiones, hechos, hipótesis, procedimientos y episodios. Cada entrada tiene ámbito, fuente, huella, vigencia, autoridad y enlaces de supersesión o conflicto.
2. Procesar todos los enunciados humanos válidos por lotes. La memoria llena conserva el enunciado o devuelve un rechazo exacto y visible; nunca lo llama duplicado por falta de capacidad.
3. Una corrección inequívoca reemplaza el hecho anterior en el mismo ámbito. Una corrección ambigua crea conflicto pendiente. Una inferencia no retira una regla humana.
4. Cambios de archivos, contratos o versión marcan las afirmaciones dependientes para revalidar. Autoridad humana y vigencia factual se evalúan por separado.
5. Separar almacenamiento duradero del presupuesto de contexto. Evaluar una proyección indexada en SQLite sobre el almacenamiento existente; mantener datos inspeccionables, migración versionada, backup, integridad y recuperación. Aumentar un límite a mano no es la solución.
6. Recuperar por tarea, ámbito, relaciones y riesgo, con prioridad para restricciones aplicables. Mantener búsqueda lexical y símbolos como baseline; añadir retrieval semántico solo si demuestra ganancia en el conjunto reservado y cabe en el presupuesto.
7. Dar crédito a una afirmación únicamente con una comprobación pertinente. Exposición, utilización, éxito de la tarea y comprobación del hecho son señales distintas.
8. Conservar rationale, alternativas rechazadas, invariantes, dirección de producto y condición de retirada de decisiones. Contenido externo y recuerdos inferidos no conceden permisos; secretos y texto con instrucciones maliciosas no entran al conocimiento.

**Salida propuesta:** ocho reglas conservadas; 45 y 500 declaraciones humanas sin pérdidas silenciosas; PostgreSQL→CockroachDB queda como reemplazo por ámbito o conflicto explícito; typecheck no confirma una arquitectura inexistente. En pruebas reservadas, recall de restricciones críticas ≥95% y precisión ≥90%, con contexto y latencia publicados. Ninguna regla se omite silenciosamente por límites del prompt: si el ámbito aplicable no puede establecerse, se informa y restringe la acción.

**Dependencia:** fase 2. **Riesgo:** supersesión excesiva y crecimiento sin control; mitigación: ámbitos, historial, compactación de inferencias y cuotas que no falsean resultados.

## Fase 4 Comprensión de intención y diagnóstico causal

**Objetivo:** convertir el pedido en condiciones comprobables y encontrar la causa antes de atribuir el arreglo.

Entregas:

1. Conservar el pedido íntegro. Crear un contrato con objetivo, comportamientos, ejemplos, restricciones, consumidores, riesgos, dudas y condiciones de éxito. Cada requisito conserva el fragmento que lo originó.
2. Validar cobertura con un contexto independiente. El extractor por expresiones queda como ayuda, sin decidir qué tareas merecen verificación.
3. Para bugs, registrar reproducción o evidencia equivalente, hipótesis, observación que las distingue, causa apoyada y regresión. Si no se puede reproducir, declarar exactamente qué sigue sin confirmar.
4. Antes de editar interfaces, datos o código compartido, identificar consumidores y cambios de contratos, migraciones y despliegue. Profundidad proporcional al riesgo.
5. Permitir exploración por capas: UI, estado, stream, API, runtime, proveedor, herramienta y base de datos. No exigir recorrer siempre todas; seguir donde la evidencia sitúa el fallo.

**Salida propuesta:** casos adversariales que compilan con causa incorrecta se rechazan como arreglo confirmado. Pedidos equivalentes en español, inglés y prosa imperativa generan la misma cobertura. Todos los requisitos obligatorios tienen estado propio; un contrato estructuralmente válido nunca basta como prueba de comprensión.

**Dependencia:** fases 2 y 3. **Riesgo:** ceremonia y latencia; mitigación: formato breve para bajo riesgo y diagnóstico profundo para cambios compartidos o inciertos.

## Fase 5 Verificación independiente del comportamiento

**Objetivo:** determinar por ejecución si el resultado satisface el pedido.

Entregas:

1. Matriz requisito→check→recibo→estado candidato. Un checker parcial no obtiene pase global. unavailable, skipped y no tests found no equivalen a passed.
2. Separar expectativas, autoría y comprobación. Usar contratos existentes, pruebas previas y oráculos externos cuando existan. Otro contexto del mismo modelo reduce contaminación, pero no elimina sesgos correlacionados.
3. Ejecutar pruebas del checker en una copia aislada del estado candidato, con límites de tiempo, memoria, red y escrituras. Congelar su prueba antes de la reparación y ejecutarla de nuevo sin permitir cambiar el oráculo.
4. Mantener el smoke como diagnóstico de arranque. Añadir flujos con resultado de negocio: crear cuenta, autorización, total de factura, persistencia, cola, descarga y errores esperados según el pedido.
5. Descubrir checks por paquetes afectados y dependientes. Primero JS/TS; ampliar con adaptadores para Go, Python, Rust y .NET/C# antes de atribuir soporte en esos ecosistemas.
6. Permitir actualizaciones legítimas de tests por cambio explícito de comportamiento. Comparar contrato y expectativas; distinguir adaptar el test de eliminar una regresión. Una compatibilidad innecesaria no debe ser la salida para evitar esa evaluación.
7. Ejecutar build solo cuando su adaptador garantiza una operación apropiada sin instalaciones ni despliegues inesperados. Elegir unitarios, integración, API, datos y flujo real por riesgo.

**Salida:** UI que carga y factura $0 cuando se esperaban $20 falla; checker que cubre una de tres condiciones no aprueba; resultado de la versión previa no verifica la nueva; intento de modificar el oráculo se rechaza. Todos los escenarios obligatorios se verifican o terminan explícitamente pendientes. Para cerrar la fase, el harness supera todos los probes críticos deterministas y el agente resuelve al menos 90% de la batería acotada predeclarada, con pendientes y abstenciones en el denominador. Objetivo competitivo agregado inicial: falsos “completado” ≤2%, y cero en la batería crítica. Un agente que siempre se abstiene no pasa.

**Dependencia:** fases 1 y 4. **Riesgo:** costes o verificación indisponible; mitigación: escalado por riesgo, presupuesto, evidencia parcial explícita y entorno reproducible.

## Fase 6 Arquitectura coherente y control de deuda

**Objetivo:** que cientos de cambios no conviertan el proyecto en una colección de excepciones.

Entregas:

1. Registrar límites de dominio, ownership, contratos compartidos, dependencia permitida e invariantes con fuente. Separar convención inferida de regla obligatoria.
2. Incorporar comprobaciones ejecutables por proyecto: imports prohibidos, ciclos nuevos, duplicación de configuración y contratos, API incompatible, migración destructiva y ownership de tablas.
3. Revisar el diff por crecimiento de responsabilidad, duplicación de negocio, estado global, fallbacks silenciosos, retries sin límite y recursos sin presupuesto. Los juicios difíciles incluyen evidencia y confianza, sin presentarse como análisis estático.
4. Usar fixtures de consultas y carga para N+1, concurrencia y llamadas innecesarias. Lint por sí solo no prueba esas propiedades.
5. Evaluar alternativas antes de otra abstracción, dependencia, helper, shim o compatibilidad. Justificar qué obligación del contrato necesita el cambio.
6. Mantener un registro de deuda con razón, ámbito, coste y condición de retirada. Medir deuda nueva por cambio; no bloquear una mejora solo porque el proyecto ya tenía deuda.
7. Revisar también crecimiento de servicios y archivos, any nuevo sin justificación, catch silenciosos, constantes y configuración duplicadas, efectos ocultos, validación ausente y atajos de seguridad. Usar reglas ejecutables cuando expresen una obligación real del proyecto y revisión del cambio para lo que requiera juicio.

**Salida propuesta:** cero violaciones de límites críticos en oráculos reservados; cero APIs o cambios de datos incompatibles sin estrategia declarada y comprobada; detección ≥90% de fallos arquitectónicos sembrados con falsos positivos ≤10%. La revisión arquitectónica tiene hallazgos y evidencia propios, distintos de checksPassed. Calidad observada estable o mejor en una cadena de 100 cambios.

**Dependencia:** fases 2–5. **Riesgo:** reglas rígidas que impiden evolución; mitigación: decisiones versionadas, excepciones explícitas y comprobación de la arquitectura nueva.

## Fase 7 Ingeniería entre servicios, repositorios y entornos

**Objetivo:** seguir un problema completo sin optimizar un componente a costa de otro.

Entregas:

1. Federación de proyectos: identidades de repositorios, versiones, contratos compartidos y referencias explícitas entre ellos. No juntar todos los recuerdos en un scope global.
2. Adaptadores de observación para HTTP, base de datos, workers, colas, almacenamiento, CI y MCP. Empezar con los que utiliza el fixture; cada adaptador declara límites y efectos.
3. Entornos reproducibles y trazas correlacionadas. Para migraciones: datos existentes, expand/contract cuando proceda, compatibilidad de consumidores y recuperación ensayada.
4. Fallos inyectados: proveedor caído, eventos duplicados, cola retrasada, permisos denegados, contrato v2, rollback parcial y almacenamiento inaccesible.
5. Integración desktop/Revit mediante fixture y después entorno autorizado: versión de add-in/API, IPC, MCP, recursos y resultado del modelo. No confundir bridge activo con flujo completado.

**Salida:** un cambio deliberado de OrionPoint en el fixture identifica efectos sobre OrionMCP, backend, almacenamiento, frontend y add-in cuando existen contratos que los conectan. Pruebas end-to-end verifican esos efectos. Integraciones inaccesibles permanecen unknown. Después se repite en repositorios reales autorizados.

**Dependencia:** fases 5 y 6. **Riesgo:** llamar real a una maqueta; mitigación: reportar por separado fixture, staging y producto.

## Fase 8 Trabajo sostenido y coordinación

**Objetivo:** continuar tareas largas entre sesiones, procesos, ramas y fallos sin perder propósito ni repetir efectos.

Entregas:

1. Objetivos persistentes con contrato, plan, decisiones, incertidumbres, entregas y trabajo pendiente. Checkpoints antes de compactación y recuperación tras crash.
2. Contexto reconstruido por fuentes actuales. Cambiar de rama o recibir commits externos invalida supuestos, relaciones y pruebas afectadas.
3. Delegación con alcance, snapshot, presupuesto y ownership. El padre contrasta el resultado con evidencia; no adopta la afirmación del subagente como prueba.
4. Aislamiento de trabajo mediante ramas o worktrees cuando convenga, leases de escritura y detección de conflictos. No restaurar cambios previos del usuario como si fueran del agente.
5. Presupuestos para llamadas, tokens, tiempo, retries, procesos y gasto autorizado; cancelación y estado resumible. Un proveedor de menor capacidad no hereda alcance de alto riesgo sin recalificarlo.
6. Rutina de aprendizaje: lección con causa, solución, evidencia y límites; detectar repetición de fallos y propuestas de skills sin convertir ruido operativo en regla.

**Salida:** recuperaciones inyectadas no pierden restricciones ni reutilizan evidencia invalidada. En integraciones con idempotencia o reconciliación verificable, las recuperaciones no duplican efectos. En las demás, un resultado ambiguo detiene ese efecto y exige reconciliación antes de repetirlo. Plan y conocimiento convergen a lo ocurrido. La coordinación mejora la tarea frente al agente único o se desactiva en ese ámbito.

**Dependencia:** fases 3 y 7. **Riesgo:** agentes adicionales amplifican errores y coste; mitigación: ownership, límites y medición del beneficio neto.

## Fase 9 Demostración competitiva y longitudinal

**Objetivo:** comprobar que el harness mejora ingeniería y que esa mejora resiste acumulación de cambios.

El programa de evaluación empieza en fase 0. Esta fase exige integrar y superar las pruebas anteriores, sin cambiar sus criterios después de ver los resultados.

Tres comparaciones distintas:

- **Aporte del harness:** misma familia/modelo elegible fijado, mismos presupuestos, baseline frente a nueva versión y ablations de memoria, contrato y verificación.
- **Producto completo:** Shelra, Codex y Claude Code en sus CLIs y sesiones independientes, workspaces y oráculos equivalentes; modelos, configuración, consumo y límites publicados. Solo ejecutar referencias dentro del uso autorizado de sus cuentas.
- **Continuidad:** cadenas de 30, 100 y 1.000 tareas sobre proyectos que realmente evolucionan. Mantener estado entre tareas; introducir cambios de arquitectura, documentación obsoleta, migraciones, ramas y fallos.

No basta con 1.000 prompts repetidos ni con timestamps simulados. El grader externo examina comportamiento, contratos, diff y decisiones activas. El agente no accede a respuestas reservadas ni modifica el grader.

Cada comparación usa k≥3; aumentar muestra antes de afirmar superioridad cuando la incertidumbre siga siendo grande. Publicar intervalos, dispersión, tareas fallidas, canceladas y limitadas por proveedor. No excluirlas del resultado operativo; separar además desempeño cuando hubo ejecución evaluable.

**Salida propuesta:** criterios críticos sin violaciones; falsos completados dentro del límite predeclarado; calidad e intención estables en checkpoints 10/30/100/300/1.000; aprendizaje con mejora comprobable frente a memoria desactivada; menor redescubrimiento sin pérdida de corrección. Resolver ≥90% de los pasos de las cadenas predeclaradas, sin omitir pendientes del denominador; además, sostener resultados por proyecto y repetición, sin ocultar una cadena mala con el promedio. Publicación reproducible de diferencias y límites. Un empate o una derrota también se publica.

No se usa un score agregado para compensar fallos de seguridad o arquitectura crítica. “Entre los mejores” solo se afirma en dimensiones y conjuntos donde la evidencia comparativa lo sostenga.

**Dependencia:** fases 0–8 para la evaluación integrada. **Riesgo:** entrenar sobre el benchmark; mitigación: fixtures separados de desarrollo, conjuntos reservados y proyectos nuevos.

## Fase 10 Piloto real de 30 a 365 días

**Objetivo:** demostrar mantenimiento sostenido de un proyecto representativo.

Seleccionar primero un sistema acotado con varios componentes, luego OrionBIM o un equivalente autorizado. Registrar desde Day 1 conocimiento, decisiones, deuda, checks, incidentes y tiempo de supervisión. El piloto puede comenzar con autonomía limitada mientras sigue la construcción; eso no permite saltar las puertas de desarrollo.

| Punto de control | Evidencia necesaria |
| --- | --- |
| 30 días | Flujo completo de tareas reales, onboarding y recuperación sin explicaciones repetidas de arquitectura básica |
| 90 días | Cambios de contratos, migraciones y correcciones de conocimiento sin uso silencioso de versiones anteriores |
| 180 días | Regresiones y deuda no aumentan frente al periodo base; menor intervención por tarea comparable |
| 365 días | Continuidad y calidad sostenidas con cambios de personal, componentes y decisiones; revisión externa del resultado |

Comparar tareas de complejidad similar; si las tareas se vuelven más difíciles, no interpretar más tiempo como pérdida de aprendizaje. Registrar todo el trabajo humano y las decisiones que Shelra no pudo tomar.

**Salida:** informe de operación real, incidentes, limitaciones y alcance que puede delegarse. Un replay de un año se etiqueta como simulación; solo 365 días observados sustentan evidencia de un año de operación.

**Dependencia:** permisos por alcance y puertas del nivel de autonomía correspondiente. **Riesgo:** autonomía prematura en producción; mitigación: ampliación por ámbito y efectos con política persistente.

## Niveles de autonomía que debe ganar

| Nivel | Alcance | Condición para ampliarlo |
| --- | --- | --- |
| L0 | Lectura, diagnóstico, mapa y plan | Evidencia y cobertura correctas en la batería de descubrimiento |
| L1 | Cambios locales reversibles dentro del alcance delegado | Núcleo común, contrato y regresiones de ese alcance |
| L2 | Tareas completas en ramas con checks y revisión | Verificación de comportamiento y arquitectura; cadena de 100 tareas con ≥90% resueltas y ninguna violación crítica |
| L3 | Cambios entre servicios y staging | Contratos, migraciones, rollback y pruebas cross-system |
| L4 | Operación de producción expresamente delegada | Piloto satisfactorio, permisos persistentes por efecto, observabilidad y respuesta a incidentes |

No es necesario pedir confirmación para cada acción ya autorizada. La política declara de antemano lo permitido y lo que requiere decisión humana. Tests verdes no amplían permisos por sí mismos. Alto impacto, accesos ausentes y conflictos humanos quedan explícitos.

## Métricas y reglas de aceptación

| Métrica | Definición | Meta propuesta |
| --- | --- | --- |
| Corrección del pedido | Tareas completas según oráculo externo / tareas asignadas | Mejora frente a baseline; sin esconder no ejecutadas |
| Falso completado | Declaró verificado/completado pese a fallo obligatorio del estado final | ≤2% inicialmente; cero en batería crítica |
| Preservación crítica | Invariantes y reglas aplicables mantenidas por cambio | 100% en escenarios críticos reservados |
| Vigencia de conocimiento | Afirmaciones obsoletas usadas sin advertencia | Cero en batería de supersesión y cambios de arquitectura |
| Recall crítico | Restricciones/decisiones pertinentes recuperadas antes de actuar | ≥95%; revisión de todos los misses críticos |
| Precisión de contexto | Información recuperada útil para decidir / información recuperada | ≥90% en conjunto reservado |
| Cobertura de verificación | Requisitos obligatorios con evidencia vigente / requisitos obligatorios | 100% para marcar la tarea verificada |
| Deuda añadida | Violaciones de límites, duplicación y excepciones nuevas por tarea | Ninguna crítica; tendencia estable o descendente |
| Aprendizaje útil | Variación de éxito, redescubrimiento y fallos repetidos en tareas comparables | Mejora frente a sin memoria, sin coste oculto de corrección |
| Supervisión | Minutos humanos, recordatorios y rescates por tarea comparable | Descenso observado; nunca se interpreta menor revisión como mayor calidad |
| Eficiencia | Tokens, llamadas, latencia p50/p95, RAM y disco por tarea | Correctness primero; presupuesto predeclarado por suite |

Cero fallos observados no prueba riesgo cero. Para incidentes aproximadamente independientes, cero en n observaciones tiene un límite superior aproximado del 95% de 3/n. Las tareas de una misma cadena están correlacionadas: publicar resultados por cadenas y proyectos, no presentar 1.000 pasos como 1.000 muestras independientes.

## Entrenamiento del sistema

“Capacitar” significa aquí mejorar habilidades de ingeniería del sistema y comprobar transferencia a tareas nuevas. El currículo va de descubrir y reproducir a mantener contratos, datos y arquitectura.

| Escalón | Trabajo de aprendizaje | Transferencia exigida |
| --- | --- | --- |
| 1 | Búsqueda, caller/callee, errores honestos y reproducir bugs | Misma habilidad en otro paquete y otro vocabulario |
| 2 | Estado, concurrencia, cancelación y errores | Implementación correcta con casos borde no vistos |
| 3 | API, auth, billing, datos y workers | Flujo de negocio y consumidores siguen funcionando |
| 4 | Migraciones, límites y decisiones reemplazadas | Arquitectura nueva coherente y memoria anterior retirada correctamente |
| 5 | Multi-repo, MCP, desktop y entornos | Causa y efectos verificados entre sistemas |
| 6 | Continuidad, interrupciones y cambios externos | Tareas futuras requieren menos redescubrimiento y no pierden decisiones |

Los fallos se convierten primero en casos de regresión y luego, cuando hay evidencia duradera, en conocimiento o procedimientos. Separar desarrollo, validación de promoción y test final sellado. Prompts y skills se ajustan en desarrollo y se promueven con validación; si sus resultados guían cambios, ese conjunto deja de servir como prueba final. La comparación competitiva usa proyectos y cadenas que no participaron en esa selección. Fine-tuning, embeddings y selección de modelos más capaces quedan como experimentos posteriores, con licencia, privacidad y presupuesto explícitos.

## Implementación y organización

Un responsable del núcleo y evidencia; uno de conocimiento y navegación; uno de verificación y evaluación. Una persona puede cubrir varios roles. El dueño del proyecto resuelve decisiones de producto y arquitectura; no actúa como recordatorio permanente para ejecutar checks.

Se libera una fase por puerta medida. Dentro de una fase pueden trabajar en paralelo tareas independientes con ownership de archivos. Los benchmarks y la observación del piloto continúan en segundo plano; los criterios de salida no se relajan por calendario.

Cada entrega incluye especificación acotada, regresión significativa, migración cuando corresponda, evidencia de mejora y mecanismo de desactivación. No se exige escribir tests para cambios de documentación o refactors triviales que no alteran comportamiento.

La migración usa los límites existentes antes de crear nuevos directorios. Las ubicaciones futuras se deciden en la especificación del módulo. No se añaden dependencias pesadas, servicios permanentes ni frameworks de agentes sin una ganancia medida.

## Horizonte de trabajo propuesto

Estimación inicial con 2–3 personas dedicadas y entornos de pruebas disponibles; se recalibra al terminar fase 0.

| Horizonte aproximado | Resultado |
| --- | --- |
| Semanas 1–2 | Baseline reproducible y defectos críticos de veracidad cerrados |
| Semanas 3–5 | Núcleo común, evidencia y paridad de modos |
| Semanas 6–10 | Modelo incremental y memoria coherente |
| Semanas 11–14 | Contratos de intención y verificación real de comportamiento |
| Semanas 15–20 | Revisión arquitectónica y contratos entre sistemas |
| Semanas 21–28 | Coordinación sostenida y evaluaciones integradas de 100/1.000 tareas |
| 30/90/180/365 días de piloto | Evidencia operativa acumulada del alcance delegado |

Las semanas estiman construcción, no garantizan la categoría D o E. Una persona necesita un horizonte mayor. Un fallo de una puerta extiende la fase; la presión de lanzamiento no cambia el veredicto.

## Primer ciclo de trabajo

El backlog detallado está en [tasks/todo.md](todo.md). Orden inicial:

1. Congelar baseline y persistir reproducciones.
2. Corregir estados engañosos de LSP, contexto y memory_write.
3. Respetar incertidumbre del diagnóstico en el camino autónomo.
4. Añadir regresiones de cobertura del checker y resultado real de UI.
5. Concretar evidence-core y migrar el primer corte con paridad de modos.

Esto cierra riesgos comprobados antes de levantar indexación, memoria y autonomía sobre ellos.

## Comandos actuales y verificación

Para cambios de código, usar los comandos del repositorio:

    bun run typecheck
    bun run lint
    bun run format
    bun run test

Build sin instalación automática en PowerShell:

    $env:SHELRA_BUILD_SKIP_INSTALL = "1"
    bun run build:binary

Regresiones focalizadas existentes:

    bunx vitest run --pool=forks --maxWorkers=1 src/lsp/manager.test.ts src/context/compiler.test.ts
    bunx vitest run --pool=forks --maxWorkers=1 src/memory/reflection.test.ts src/memory/gate.test.ts src/memory/store.test.ts src/memory/retrieval.test.ts
    bunx vitest run --pool=forks --maxWorkers=1 src/agent/completion-gate.test.ts src/agent/behavior-verifier.test.ts src/agent/runtime-smoke.test.ts

Antes de una comparación con modelos reales, fijar SHELRA_BENCH_MODEL a un modelo vigente probado elegible para Free mode y preparar login autorizado. Este comando usa el benchmark actual y no define una batería nueva:

    bun run src/index.ts bench --manifest bench/suites/shelra-agent-core-silent-v0.2.json --model $env:SHELRA_BENCH_MODEL --repeat 3

Guardar método y resultados en bench/history. No lanzar ahora ejecuciones pagadas ni declarar que estas pruebas se ejecutaron por aparecer aquí. Los comandos de suites futuras se incorporarán junto con sus manifests verificables.

## Decisiones por concretar al iniciar

- Proyecto real del primer piloto y entornos disponibles.
- Equipo, presupuesto de tiempo/cuota y hardware para objetivos de latencia.
- Primeros ecosistemas fuera de JS/TS: priorizar .NET/C# si el piloto incluye Revit.
- Qué efectos estarán delegados en cada nivel y cómo se auditan.
- Retención, privacidad y exportación del conocimiento de proyectos.

Estas decisiones ajustan alcance y secuencia de adaptadores. No impiden comenzar la baseline ni cerrar los fallos locales demostrados.

## Condición final

Shelra alcanza el siguiente nivel cuando puede resolver y verificar tareas complejas con fuentes actuales y arquitectura consistente. Alcanza autonomía longitudinal cuando además conserva esas propiedades en trabajo real prolongado, corrige conocimiento equivocado y reduce el esfuerzo de supervisión sin degradar el resultado.

El objetivo competitivo se evalúa sobre esos resultados. Añadir más memoria, más agentes o más código no constituye avance si no mejora la corrección y la continuidad medidas.
