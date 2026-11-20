# Modelo funcional: Excel → aplicación

Este documento registra la lógica que debe conservarse al trasladar el libro **PARA ARREGLO.xlsx** a la aplicación. El Excel se usa como referencia de flujo; sus datos personales y notas de estudiantes no se reproducen aquí.

## Lo que el libro realmente hace

El libro no usa un único instrumento universal. Sus hojas muestran, al menos, dos modelos de valoración distintos:

1. **Matriz por criterios y descriptores.** La hoja `Criterios` guarda criterios reutilizables y cuatro descriptores por criterio (`Excelente`, `Bueno`, `Suficiente`, `Insuficiente`). En la hoja de una actividad, el docente escoge los criterios que observará, marca un nivel por estudiante y la matriz convierte esos niveles a la ponderación de la actividad. El profesor puede trabajar con los renglones pertinentes a esa actividad; la aplicación no debe obligarlo a evaluar todos los indicadores o criterios de la secuencia.
2. **Escala de logro por niveles.** La hoja `Valores` y algunas matrices usan cinco niveles (`Estratégico`, `Autónomo`, `Resolutivo`, `Receptivo`, `Preformal`) con una escala numérica propia. No es la misma tabla de cuatro descriptores de `Criterios` y no debe convertirse automáticamente a ella.
3. **Puntos directos.** En otras capturas el docente registra la puntuación obtenida sin marcar niveles. Es otra entrada válida para la misma calificación resumida.

En la hoja `Criterios` se muestran descriptores, no un valor numérico para cada nivel. Al importar ese catálogo, la app propone como inicio Insuficiente = 0, Suficiente = 1, Bueno = 2 y Excelente = 3; cada actividad permite ajustar esos números antes de confirmar. Las escalas numéricas que sí vienen en un anexo de la secuencia se mantienen tal como fueron extraídas.

Las hojas P1–P4 consolidan resultados de actividades y otras fuentes de calificación del período. Sus fórmulas no son idénticas en todas las hojas; por eso la app conserva la regla, escala y máximo de cada actividad antes de resumirla.

## Flujo que debe seguir el docente

1. **Preparar la secuencia.** Importar o escribir temas/actividades en orden. La importación puede proponer indicadores, criterios y anexos como datos de referencia; no asigna por sí sola una actividad a un período, curso o evaluación.
2. **Revisar y distribuir.** Corregir lo extraído y asignar cada actividad a P1, P2, P3 o P4. Una actividad ya asignada se selecciona desde el período; no se vuelve a crear para evaluarla. Si se desea evaluar otra vez, se registra una nueva aplicación ligada a la misma actividad fuente.
3. **Diseñar la evaluación una vez.** En el mismo formulario se elige el nombre de la actividad, su valor y el método:
   - **Puntos directos:** se conserva el máximo y se anota la puntuación.
   - **Por matriz/competencias:** se seleccionan solo los criterios que se usarán, se vinculan con los indicadores pertinentes y se asignan o ajustan puntos. Cada criterio muestra sus descriptores y niveles. El maestro puede usar un solo indicador o varios, y los valores de nivel se pueden cambiar para esa actividad.
4. **Calificar cada curso desde una tabla.** Se abre la actividad preparada, aparece su matriz ya configurada y se marca un nivel por criterio/estudiante o se escribe la nota directa. No se crean actividades ni se rediseñan criterios desde la pantalla de captura.
5. **Consolidar.** Ambos métodos entregan una nota final acotada al máximo de la actividad y llegan al mismo libro/resumen del período. El desglose por criterio, indicador y competencia se conserva para consulta.
6. **Registrar la jornada aparte de la evaluación.** Asistencia, comportamiento, participación y disciplina se capturan en el registro diario correspondiente. Guardar una nota no implica que la clase se impartió ni modifica la asistencia.

## Correspondencia con el modelo de datos actual

| Idea del libro | Entidad/campos de la aplicación | Regla de integridad |
|---|---|---|
| Actividad preparada | `activities`: título, curso/período, máximo, método, vínculo a secuencia | Un registro por curso para captura; una actividad común puede compartir diseño entre cursos. |
| Actividad/indicador de secuencia | secuencia revisada: `activities` de secuencia + `indicators`, competencias y asignaciones P1–P4 | Importar no equivale a asignar ni evaluar. El docente confirma la distribución. |
| Catálogo reutilizable de criterios | `evaluation_criteria` y `evaluation_criterion_values` | Plantillas disponibles para reutilizar; la escala del catálogo no sustituye una escala fuente diferente. |
| Criterios de una actividad | `activity_criteria`, y copia de trabajo dentro de `activities.rubric` | Guarda la selección y fotografía de descriptores, valores y vínculo al indicador usados por esa actividad. |
| Selección de nivel del alumno | `grades.criterion_levels` y `grade_criterion_ratings` | Guarda el índice elegido y una copia legible de nivel, puntos y descriptor vigentes al calificar. |
| Nota común del estudiante | `grades.score` | Se calcula desde la matriz o se registra directamente. En ambos casos es la nota que alimenta el resumen. |
| Resumen/hoja de período | informes de período, categorías, competencias y matriz de notas | Los puntos obtenidos se convierten al máximo de la actividad y luego se agregan según la configuración del período. |
| Registro diario | `class_sessions` y `attendance` | Asistencia, estado de clase, conducta y participación mantienen su flujo propio. |

## Invariantes de producto

- El diseño de la evaluación ocurre antes de capturar notas. La pantalla de notas debe ser la parte más rápida del uso diario.
- No hay una escala fija global de cuatro o cinco niveles. La actividad guarda las etiquetas, los puntos y los descriptores que le corresponden.
- Una matriz puede evaluar un subconjunto de los indicadores de la secuencia. No se fuerza a completar todos los renglones.
- El máximo final se fija al crear la actividad; los puntos de criterios y su distribución deben cuadrar con ese máximo antes de habilitar Guardar.
- Cambiar la escala después de guardar notas no recalcula esas notas silenciosamente.
- Un criterio importado desde un anexo se conserva como dato fuente, no se publica automáticamente como plantilla reutilizable ni se asigna a un período.
- Conducta, participación, disciplina y asistencia tienen significado y captura separados, aunque el informe final pueda mostrarlos juntos.

## Estado de la implementación relacionada

La creación de actividad ahora presenta en un solo formulario la actividad, el modo de puntuación y —cuando corresponde— la matriz por criterios, indicadores y niveles. Se pueden añadir criterios en el formulario sin salir a otra pantalla, reutilizar una plantilla o cargar los criterios de la secuencia. Se conservan las escalas numéricas que vienen de la secuencia y se pueden ajustar antes de guardar. La nota calculada sigue usando el registro de calificaciones existente.

Esta integración es una mejora del flujo de diseño; no certifica por sí sola todos los cálculos del libro ni sustituye la comprobación visual con los docentes. La verificación debe abarcar escala fuente, escala del catálogo, matriz con un criterio, matriz con varios criterios, puntos directos y resumen por competencia.
