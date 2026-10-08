# Modelo del proyecto: primer corte de límites por paquete

Fecha: 7 de octubre de 2026. Módulo: project-model del CAPABILITY-MAP.md. Las diez fases están autorizadas. Este corte depende del núcleo de ejecución/evidencia ya validado y de las señales de cobertura P0 02–03; no declara cerradas las garantías externas pendientes de fase 1 ni la fase 2 completa.

## Objetivo y alcance

Antes de cambiar un archivo de un monorepo JS/TS, Shelra debe recibir el paquete que contiene ese archivo, los paquetes que declaran depender de él, sus scripts y las rutas de sus instrucciones/documentación. Las afirmaciones deben señalar sus manifests actuales y sus huellas. Una dependencia declarada no es una llamada comprobada ni un contrato de negocio.

Se amplía el compilador de contexto existente. No se crea otro agente, proveedor, servicio permanente, base de memoria ni inventario paralelo. La lista de archivos actual es la entrada; solo se leen manifests relevantes y acotados, nunca todos los cuerpos de código. La persistencia incremental, el grafo de símbolos/imports y la federación quedan para cortes posteriores del mismo módulo.

## Contrato

1. Los límites estructurales salen de package.json legibles dentro de la raíz autorizada. El propietario por ruta es el manifest contenedor más cercano entre los observados. No se infiere ownership de tablas, servicios o producto a partir de ese dato.
2. Se priorizan manifests ancestros de los archivos que el pedido nombra antes de los demás. Un límite de paquetes no puede convertir un paquete visible situado al final del inventario en el propietario raíz. Si un manifest intermedio no puede leerse, el ownership queda desconocido y se informa; no se atribuye al ancestro lejano por omitir el más cercano.
3. Se leen como máximo 256 manifests de 64 KiB cada uno. La proyección tiene presupuesto propio de 2.400 caracteres dentro del límite global existente. El recorte declara truncación. Los paths, nombres, dependencias y scripts se serializan como datos; ningún texto de un manifest concede permiso ni se ejecuta al descubrirlo.
   Se inspeccionan hasta doce targets, como el compilador actual; más targets conservan aviso de presupuesto y estado parcial. Una proyección de paquetes se agrega para ámbito anidado o información parcial; proyectos con solo manifest raíz conservan su descripción y tabla de checks existentes, sin duplicar el manifest en el prompt.
4. Las aristas se identifican como dependencias declaradas, separadas por dependencies/devDependencies/peerDependencies/optionalDependencies y vinculadas al manifest fuente. Dos paquetes con el mismo nombre producen relación ambigua; no se elige uno por orden. Con inventario/manifests incompletos, consumidores no encontrados siguen desconocidos.
   name-match señala coincidencia entre el nombre declarado y manifests observados, sin afirmar resolución instalada. Un alias npm permanece unresolved en este corte; no se vincula falsamente al paquete local que tiene el nombre del alias.
5. Documentación e instrucciones de los paquetes seleccionados se ofrecen como rutas actuales, sin cargar su cuerpo ni aplicar nuevas instrucciones desde el índice. Se incluyen README.md, AGENTS.md, SHELRA.md y documentos docs/adr/adrs del paquete cuando están en el inventario.
6. Los archivos se leen con límite y comprobación de versión antes/después. Enlaces que resuelven fuera de la raíz, JSON inválido, cambios durante la lectura y errores de filesystem dan cobertura parcial con motivo. Cada nueva compilación consulta la fuente actual; este corte no usa un caché de mtime ni afirma persistencia incremental.
7. ContextPacket lleva la proyección estructurada opcional y el modelo recibe su forma acotada. Mensajes conversacionales mantienen el camino existente. El presupuesto, fallos y dependencias no observadas son visibles.

## Implementación y pruebas

Archivos previstos: src/context/project-model.ts y su test; integración pequeña en compiler.ts/types.ts y regresión del compilador. Sin nuevas dependencias. Se reutilizan las listas del compilador, discoverChecks queda como autoridad de checks ejecutables, y docs-index continúa siendo dueño de la memoria documental.

Verificación: `bunx vitest run src/context/project-model.test.ts src/context/compiler.test.ts`, `bun run typecheck`, `bun run lint`, `bun run format`, `bun run test`, build sin instalación.

## Criterios de aceptación

- Auth/Billing/Web: archivos apuntan al paquete más cercano; Web se identifica como consumidor declarado de Auth; Billing no se convierte en consumidor por similitud de nombre.
- Nombre duplicado, manifest inválido o enlace externo: relación/ownership desconocido o ambiguo, nunca una afirmación confirmada falsa.
- Manifest del propietario situado después del presupuesto general se prioriza y se conserva su fuente.
- Cambiar nombre/dependencia del manifest entre dos compilaciones cambia la proyección; el primer estado no permanece como hecho actual.
- Documentación de packages/apps se ofrece al modelo sin leer todos los cuerpos.
- Una lista sintética de 100.000 paths comprueba selección y presupuesto sin cargar sus cuerpos. Se identifica como prueba de proyección, no como benchmark de filesystem ni como monorepo real.

La fase 2 seguirá abierta hasta inventario persistente incremental, símbolos/relaciones con cobertura, invalidación de rama y las pruebas reales 10k/50k/100k previstas en el plan. Esta entrega no demuestra comprensión semántica ni aprendizaje anual.

Estado de implementación: corte validado. El compilador entrega metadata estructurada y proyección acotada al modelo para paquetes anidados. Pasan 39 pruebas focalizadas, incluidos los doce tests del helper. La suite completa terminó con exit 0: tramo principal de 240 suites y 2.331 pruebas pasadas, dos omisiones por soporte de Windows; todos los tramos seriales verdes. Typecheck, lint, format y build sin instalación verdes. Log local: `%TEMP%/shelra-phase2-package-model-suite.log`. Se conservó la regresión que evita duplicar el manifest raíz en el prompt. Ownership recorre ancestros mediante un Set y documentación hace una pasada; no filtra y ordena todos los manifests por archivo. La fase completa permanece abierta por los pendientes descritos arriba.
