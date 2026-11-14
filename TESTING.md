# Pruebas del registro docente

Estas pruebas usan estudiantes sintéticos y una base PostgreSQL local PGlite. No importan nombres, notas ni asistencia de las fuentes del docente y no acceden a producción.

## Flujo de 30 días

La batería de integración debe recorrer 30 fechas desde el 20 de octubre de 2026 para cada curso: 5A (21 estudiantes), 5B (19) y 5C (21). Cada lote se vuelve a leer inmediatamente para comprobar los identificadores del curso, la sesión y el estudiante. El volumen mínimo es de 90 sesiones y 1.830 marcas de asistencia, además del comportamiento diario y las notas de libreta. Las expectativas del informe se calculan por separado de la función que genera el informe.

## Casos de integridad

- Cero frente a vacío y pendientes visibles.
- Todos ausentes frente a una sesión sin registros.
- Sesiones futuras programadas y sesiones vencidas no impartidas.
- Guardar notas fuera de clase sin crear asistencia.
- Identificadores de otro curso o docente rechazados.
- Una fila inválida revierte el lote completo.
- Repetir una solicitud conserva el mismo resultado sin duplicados.
- Una solicitud repetida con contenido distinto se rechaza.
- Dos ediciones con la misma versión producen un conflicto controlado.
- Reordenar o corregir los nombres conserva la identidad y el historial.
- El primer examen de 15 puntos no se transforma en 35 por normalización.
- Las rúbricas se calculan desde sus niveles y pesos explícitos.
- La exportación y la reapertura mantienen los registros guardados.

## Ejecución

```powershell
npm test
```

## Resultado ejecutado

El 13 de noviembre de 2026, `npm test` terminó con código de salida 0: **23 pruebas aprobadas, 0 fallidas**, en aproximadamente 15,4 segundos.

Se guardaron y volvieron a leer 90 sesiones con **1.830 asistencias, 1.830 valoraciones de comportamiento y 1.830 notas de libreta**. Las 30 fechas lectivas sintéticas por curso abarcaron del 20 de octubre al 30 de noviembre de 2026, con un reloj de prueba fijado al 1 de diciembre. Los informes de los 61 estudiantes coincidieron con un cálculo independiente. La misma base se cerró y reabrió antes de volver a verificar registros e informe.

También pasaron los casos de cero/vacío, fecha futura, todos ausentes, libreta corregida fuera de clase, conducta 3/10 = 30%, rechazo de matrículas ajenas, rollback de lotes, claves foráneas y unicidad en PostgreSQL, solicitudes repetidas, versiones antiguas, examen de 15 puntos sin inflarlo a 35, rúbricas, identidad al reordenar alumnos, exportación aislada por docente, informes sin notas, rúbricas parciales y configuración de períodos siguientes.

La evidencia de volumen queda en `test-results/long-run-volume.json`; el resumen y las huellas de los archivos probados, en `test-results/run-summary.json`.

Estas comprobaciones corresponden al servicio y motor sobre PostgreSQL local PGlite. **No declaran verificados la interfaz, el inicio de sesión real de Neon, un corte real de red ni un despliegue en Render.** La repetición de una solicitud y el conflicto de versión prueban el contrato de reintentos y edición; no simulan por sí solos todos los fallos posibles de una conexión.

Además, el 13 de noviembre de 2026, `node tests/ui-smoke.mjs` terminó con código 0: **16 comprobaciones de navegador aprobadas** en un servidor Next.js de producción local. Recorrió los cursos, guardó y recargó asistencia y notas, confirmó separación entre cursos, informe e historial, conservó un borrador tras una respuesta 503 simulada y revisó la vista móvil. No hubo errores de consola ni respuestas HTTP fallidas en ese recorrido.
