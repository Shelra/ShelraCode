# Mapa de capacidades de ingeniería sostenida

Referencia completa: [tasks/plan.md](tasks/plan.md).

El usuario autorizó ejecutar las diez fases el 7 de octubre de 2026 y ordenó continuar sin detenerse al cerrar entregas. El núcleo evidence-core ya tiene cinco entregas validadas; comienza el primer corte de project-model sobre ese núcleo y las señales locales corregidas. Las fases completas conservan sus pendientes y puertas de aceptación.

| Módulo | Responsabilidad | Depende de | Estado |
| --- | --- | --- | --- |
| evidence-core | Camino productivo compartido y evidencia del host vinculada al candidato | — | Cinco entregas implementadas; suite completa y checks finales verdes en Windows; fase 1 abierta |
| project-model | Inventario y relaciones comprobables | evidence-core | Primer corte de límites por paquete integrado y validado con suite completa; fase 2 abierta |
| durable-knowledge | Memoria por ámbito, autoridad y vigencia | evidence-core, project-model | Captura/almacenamiento humano, veracidad y separación comando/confirmación validados con suite completa; correcciones por ámbito en ejecución; evidencia semántica pendiente |
| intent-contract | Condiciones de éxito y diagnóstico causal | evidence-core, project-model, durable-knowledge | Autorizado; pendiente de sus dependencias |
| behavior-verification | Aceptación ejecutada por requisito | evidence-core, intent-contract | Autorizado; pendiente de sus dependencias |
| architecture-review | Límites, contratos y deuda del cambio | project-model, durable-knowledge, intent-contract | Autorizado; pendiente de sus dependencias |
| system-integration | Contratos y pruebas entre sistemas | behavior-verification, architecture-review | Autorizado; pendiente de sus dependencias |
| sustained-autonomy | Continuidad, recuperación y coordinación | durable-knowledge, system-integration | Autorizado; pendiente de sus dependencias |
| evaluation-program | Oráculos y medición independiente | evidence-core | Baseline y regresiones del corte autorizado |

Especificaciones: [SPEC-evidence-core.md](SPEC-evidence-core.md), [SPEC-project-model.md](SPEC-project-model.md) y [SPEC-durable-knowledge.md](SPEC-durable-knowledge.md). P0 no se declara cerrada; P0 02–03 sí tienen sus reproducciones y correcciones verificadas. Los primeros componentes usan entregas ya comprobadas, sin declarar cerradas las garantías externas, semánticas ni longitudinales pendientes.
