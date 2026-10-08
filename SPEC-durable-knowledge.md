# Conocimiento duradero: entregas verificables

Fecha: 7 de octubre de 2026. Módulo durable-knowledge. El programa completo está autorizado; las fases anteriores conservan sus puertas pendientes. Los primeros arreglos de veracidad/captura humana reutilizan el store existente y no necesitan afirmar que el modelo completo del proyecto ya existe.

## Objetivo y límites

Conservar declaraciones humanas y conocimiento de ingeniería sin convertir un rechazo en éxito, una inferencia en autoridad humana o un check general en prueba de una afirmación. Se mantienen Bun, los archivos editables de memoria, el routing y los presupuestos del contexto. No se añaden servicios, embeddings ni dependencias. La persistencia y la proyección al prompt tienen límites distintos; ampliaciones de almacenamiento requieren un contrato explícito y pruebas de recuperación.

## Primer corte: P0 04, respuesta veraz de memory_write

La herramienta actual recibe action=skip tanto por duplicado como por capacidad o autoridad, y responde que una nota existente ya cubre el pedido en los tres casos. Capacidad no identifica una nota existente; autoridad no demuestra que la nueva afirmación sea verdadera ni equivalente.

- El gate identifica los motivos tipados capacity, duplicate y authority.
- Un duplicado comprobado conserva success=true y nombra la entrada ya guardada; no crea otra.
- Falta de capacidad y prohibición de reemplazar una fuente superior devuelven success=false y su motivo real, sin afirmar cobertura por una nota.
- Índice lleno y error de persistencia permanecen fallos explícitos. Solo una escritura efectiva puede responder Saved/Updated.
- El corte no cambia capacidades, autoridad, supersesión ni la política de archivo. Captura de ocho reglas y persistencia de 45/500 declaraciones se especifican y verifican en una entrega posterior.

Implementación: src/memory/gate.ts, src/toolset/tools.ts y tests de la herramienta. Se preservan los cambios locales existentes. Estilo: campos opcionales compatibles en GateDecision; ramas explícitas y motivos visibles, sin interpretar frases de error para decidir el estado.

## Verificación

Tests con herramientas reales y memoria en carpetas temporales: cuarenta entradas de un tipo más una nueva; intento de reemplazar una declaración humana; repetición idéntica; índice mecánico lleno; error real de escritura. Comprobar respuesta, índice y cuerpo persistido, incluyendo que un rechazo no crea el archivo solicitado. Sin llamadas a modelos ni HOME real.

Comandos: `bunx vitest run --pool=forks --maxWorkers=1 src/toolset/tools.test.ts src/memory/gate.test.ts`, `bun run typecheck`, `bun run lint`, `bun run format`, suite completa y build sin instalación al cerrar cambios productivos.

## Siguientes cortes, aún abiertos

Captura humana íntegra con reporte de cada rechazo; almacenamiento durable separado del índice/prompt; alcance explícito de entidades y correcciones Auth/Billing; evidencia de contenido y vigencia; crédito que mida utilidad sin confirmar afirmaciones; recuperación/retrieval con presupuestos y pruebas reservadas. No se atribuye aprendizaje anual por reparar una respuesta de herramienta.

## Segundo corte: captura y almacenamiento humano separados de la proyección

La captura determinista no comparte el límite de cinco propuestas de la reflexión. Conserva todas las declaraciones reconocidas del pedido; deduplica por declaración completa, no por el prefijo corto de su nombre. El gate mantiene seguridad/autoridad y sus reglas actuales de relación, pero el límite de cuarenta inferencias por tipo no rechaza declaraciones humanas.

Cada declaración humana nueva se guarda como un único topic Markdown autocontenido en `human/<slug>.md`, dentro del mismo scope de memoria. Incluye title/hook además de cuerpo, fuente y estado. El rename atómico de ese archivo es el punto de persistencia; MEMORY.md es una proyección posterior, acotada a sus 200 líneas/25 KiB. Una proyección llena o fallida no pierde una declaración ya persistida ni transforma ese hecho en fallo de almacenamiento: el resultado declara projected=false y el motivo. Los topics legados siguen legibles; el nuevo formato tiene prioridad por slug y el borrado explícito elimina ambas ubicaciones para evitar resurrección.

Los links de MEMORY.md deben resolver a la ubicación física del topic; el slug lógico que acepta memory_read sigue siendo su nombre, sin directorios ni extensión. La CLI debe mostrar también el histórico de topics humanos retirados. Se comprobarán ambos consumidores además del prompt del agente; no basta con que el lector interno encuentre el archivo.

El catálogo consultable se deriva de topics actuales; no hay otro journal o base que pueda quedar contradictorio con su cuerpo. Superseded/done/archived salen de recuperación activa aunque queden en el índice corto tras una interrupción. Un topic humano sin fila en MEMORY.md sigue recuperándose después de reiniciar. Las mutaciones existentes conservan campos de índice y siguen la ubicación canónica.

Las filas de la proyección respaldadas por topics humanos canónicos pueden omitirse para dar lugar a inferencias nuevas: esto no archiva ni borra sus declaraciones. El límite por tipo cuenta las entradas no humanas; muchas reglas no bloquean por sí mismas el aprendizaje del mismo tipo. Una escritura no humana tampoco puede sustituir una declaración humana creada entre la decisión del gate y la escritura.

Presupuestos iniciales del corte: 5.000 topics humanos por scope (incluido histórico; rebasar el límite da rechazo explícito), 32 KiB por topic, directory/file sin symlinks o junctions. Falta de lectura o parseo produce cobertura parcial visible al modelo/herramienta, nunca prueba de ausencia. La recuperación sigue siendo lexical y los presupuestos de prompt actuales se mantienen. memory_list pagina hasta 200 entradas, 100 por defecto, con total y siguiente offset; memory_read recibe el slug lógico de siempre. Este corte no afirma rendimiento de millones de recuerdos.

Para un lote de admisiones, se actualiza la colección cargada con la entrada efectivamente escrita; no se releen todos los cuerpos después de cada nueva declaración. Las operaciones de archivo/supersesión pueden recargar porque cambian varias entradas.

Aceptación adicional: ocho reglas en un pedido; dos declaraciones diferentes con prefijo de slug común; 45 y 500 declaraciones humanas distintas realmente persistidas; recuperación en otro proceso con MEMORY.md ausente; consulta relevante al recuerdo 499 dentro del presupuesto; supersesión/borrado/delivery no resucitan; error de proyección después de commit se distingue de error previo a commit; lectura corrupta o enlace externo se reporta parcial; inferencias siguen limitadas. Los tests son harness/FS reales y proveedores simulados cuando corresponda, sin atribuir aprendizaje semántico ni años de observación.

Validación final de los dos primeros cortes: `bun run test` exit 0, tramo principal de 241 suites y 2.355 pruebas pasadas, dos omisiones de Windows; tramos seriales verdes. Typecheck, lint, format, build sin instalación, YAML y git diff --check verdes. Log: `%TEMP%/shelra-durable-human-final-suite.log`. Diecisiete pruebas específicas de conocimiento humano, incluidas ubicación física, CLI histórica y capacidad canónica. Se conservaron dos reproducciones de defectos detectados en la revisión de la entrega y sus correcciones. No se cierra la fase 3 completa.

## Tercer corte: un comando pasado no confirma una afirmación

La reproducción anterior reconfirmaba una entrada completa porque su cuerpo mencionaba entre backticks un comando pasado. Un typecheck puede pasar aunque cambie el propietario de una base o deje de existir una invariante; actualizar lastConfirmed en ese caso elimina una señal de vigencia sin comprobar la afirmación. El corte está implementado y validado con la suite completa.

El nuevo contrato distingue uso de un procedimiento, resultado observado de un comando y confirmación del contenido. Registrar un comando exacto pasado conserva su resultado y la fecha de esa observación, pero no actualiza lastConfirmed ni elimina staleness de las fuentes. La regla vigente de AGENTS.md cuenta ese comando como recall, igual que memory_read; se conserva como señal heurística de uso, sin convertirla en confirmación del contenido ni crédito automático. La creación/reescritura de una inferencia tampoco equivale por defecto a comprobarla. La antigüedad de una entrada sin confirmación usa su origen estable, no cada edición cosmética. Una fecha inválida o fuente ilegible se trata como vigencia incierta.

Plan: añadir campos pequeños de última observación de comando al formato actual; cambiar la función y el caller productivo para nombrar el uso observado; conservar el crédito como utilidad del contexto, sin presentarlo como prueba de contenido. No se declara aún evidencia semántica por propiedad, versión externa ni supersesión por ámbito. Las confirmaciones futuras requieren pruebas vinculadas a la afirmación y su candidato.

Una reescritura que cambie cuerpo, hook o fuentes elimina la confirmación y observación de comando que pertenecían al contenido anterior; su historial se conserva. El registro del comando no atribuye una observación a un topic que cambió durante la operación. Las confirmaciones legadas no se convierten retroactivamente en evidencia semántica; siguen requiriendo revalidación pertinente.

Aceptación: fixture real donde cambia la configuración de almacenamiento, el typecheck real pasa y la memoria arquitectónica sigue marcada posiblemente obsoleta; solo entradas que nombran el comando exacto reciben evidencia de su uso; una edición de texto sin confirmación no rejuvenece conocimiento; volver a leer el topic conserva esos campos y el último momento de confirmación. La antigua expectativa de borrar staleness por nombrar un comando se sustituye explícitamente por este contrato; las comprobaciones de selección exacta permanecen.

Validación: tres reproducciones iniciales fallaron antes del arreglo; cuatro pruebas nuevas pasan, incluido typecheck real sobre una configuración que cambia. La integración Agent conservó uso/recall y dejó de confirmar el contenido. La primera suite completa mostró una expectativa antigua de reconfirmación; se sustituyó expresamente por el contrato anterior, manteniendo la selección exacta del comando y comprobando los campos persistidos. Suite completa final exit 0: tramo principal de 242 suites y 2.359 pruebas pasadas, dos omisiones de Windows; tramos seriales verdes. Typecheck, lint, format, build sin instalación, sintaxis YAML y git diff --check verdes. Log: `%TEMP%/shelra-command-evidence-final-suite.log`. El benchmark life sigue siendo una simulación sin modelo ni disco y su selección de uso es un oráculo de fixture, no evidencia de aprendizaje autónomo.

## Cuarto corte especificado: correcciones por componente y entorno

Responsabilidad: evitar que similitud textual y el nombre de una tecnología fusionen o retiren recuerdos de componentes distintos. Se agrega un subject pequeño (entity y environment opcional) al topic existente. Identifica alcance, no prueba el contenido ni concede autoridad. Alias de entidades y nombres de entornos no se consideran iguales sin evidencia; no se deducen consumidores o contratos de esta etiqueta.

Las declaraciones humanas reconocidas conservan sus palabras. Un parser acotado obtiene el subject de formas explícitas como “We use PostgreSQL for Auth”, “Usamos PostgreSQL para Billing” y sus correcciones “Use CockroachDB instead of PostgreSQL for Auth”. También puede identificar el entorno explícito al final. Las formas ambiguas, compuestas o no reconocidas mantienen alcance desconocido; no se inventa un componente. Otros productores pueden proponer subject estructurado, manteniendo su fuente inferida. Una quote humana válida obtiene su alcance de la quote, nunca de una etiqueta inventada por la reflexión.

El gate compara subjects antes de restatement/near-duplicate. Auth y Billing, o producción y pruebas, no se fusionan aunque compartan casi todo el texto. Un slug explícito no autoriza trasladar una entrada a otro subject; las colisiones de nombres automáticos reciben el nombre distinto que ya usa la captura. El writer y la operación de supersesión vuelven a comprobar el alcance para no depender solo del gate.

Una corrección con tecnología anterior y subject inequívocos retira únicamente entradas compatibles de ese subject. Si el cambio carece de subject y encuentra declaraciones con alcance conocido, o una corrección localizada encuentra una declaración anterior sin alcance, conserva ambas y registra conflicto pendiente con los slugs afectados. La recuperación muestra ese conflicto explícitamente: no presenta dos afirmaciones contradictorias como conocimiento resuelto. El legado sin subjects conserva su compatibilidad; no se declara una migración semántica automática de todo el histórico.

Aceptación: fixtures reales de Auth y Billing usando PostgreSQL; corrección de Auth a CockroachDB mantiene Billing; cadenas de correcciones conservan la historia; entorno de pruebas no reemplaza producción; statements muy similares de componentes distintos no se fusionan; corrección ambigua deja conflicto visible; reflexión con quote no atribuye alcance falso; scope y conflicto sobreviven otra lectura/proceso. Herramientas, CLI y prompt publican el alcance. Tests fuera del HOME real y sin llamadas a modelos. La transición atómica de varios topics, resolución de alias, prueba semántica por propiedad y generalización del parser quedan para cortes posteriores.
