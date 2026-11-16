# Verificación del registro docente

## Alcance

La prioridad de esta revisión es el apartado de asistencia. La aplicación ofrece tres vistas dentro del menú **Asistencia**:

- **Registro diario:** captura P/A/T/E/R por curso, fecha y bloque. Una nota fuera de clase no confirma una asistencia.
- **Registro mensual oficial:** muestra fechas y marcas, totales y porcentaje por estudiante; permite descargar el PDF adjunto desde la misma pantalla.
- **Resumen semanal:** una matriz por estudiante y semana con cuántas veces asistió, sobre el número de sesiones impartidas, y un detalle diario seleccionable.

La cuadrícula PDF sigue la estructura observada en el formulario de asistencia del registro MINERD de 5.º: dos meses por página, hasta 21 sesiones por panel, 40 filas numeradas y `T`/`%`. La nómina con nombres se agrega en una página aparte para que las filas numeradas se puedan identificar. Si un mes rebasa 21 sesiones, continúa en otro panel. Es una adaptación imprimible del apartado de asistencia; no produce el libro MINERD completo ni sustituye su evaluación formal en el centro.

Referencia examinada: [Registro de evaluación de los aprendizajes de 5.º de secundaria, MINERD](https://ministeriodeeducacion.gob.do/docs/direccion-general-de-curriculo/8Ny5-registro-5to-grado-sec-academicapdf.pdf).

## Reglas de cálculo y límites de la fuente

La fuente indica P/A/T/E/R, que tres tardanzas se convierten en una ausencia, y `T × 100 / días trabajados` para el porcentaje. La aplicación calcula `T = presentes + tardanzas − una por cada grupo de tres tardanzas`; deja el total y el porcentaje pendientes si hay marcas faltantes. Para la implementación, E permanece como marca separada y cuenta como jornada trabajada en el denominador sin sumarse a T; R se propaga desde la fecha de retiro y se excluye de jornadas posteriores.

La fuente no especifica con claridad en la instrucción de porcentaje cómo incluir E ni detalla cómo ajustar el denominador después de R. Esas dos decisiones están expuestas en la leyenda del registro y deben cotejarse con la dirección del centro antes de usar porcentajes para decisiones oficiales. El registro diario además distingue una fecha programada sin marcas (no impartida) de una fecha futura (programada).

## Pruebas ejecutadas

El 14 de noviembre de 2026, tras corregir el plan P2 y su resumen, se repitió la suite completa cuatro veces. Cada ronda empezó con una base PGlite vacía. Las cuatro aprobaron **36/36 casos (100% cada una)**: **144/144 casos, 0 fallos**. El flujo anual de cada ronda recorrió 182 fechas laborables sintéticas en 5A/5B/5C, del 20 de octubre de 2026 al 30 de junio de 2027, con 61 estudiantes: 546 sesiones, 11.102 filas de asistencia, 7.930 valoraciones de conducta y 11.102 notas diarias de libreta. El flujo anual contó 74.162 aserciones por ronda y 296.648 entre las cuatro; las cuatro rondas procesaron 44.408 filas de asistencia y 44.408 filas de notas de libreta.

La prueba específica de ponderación P2 guardó un examen de 15 + 20, una rúbrica con máximo bruto 85, dos revisiones diarias de libreta, dos prácticas y conducta. Verificó 35/35 en exámenes; 85/85 → 20 en secuencia; 3.5/4 → 17.5 en libreta; 18/20 → 13.5 en conducta; 10/10 en prácticas; y **96/100** en total. También revisó que ambas categorías de 20 puntos se agrupen como **Libretas y tareas · 40** sin perder el desglose.

La auditoría de navegador/API de solo lectura sobre la demo P1–P4 dio **82.376/82.376 comprobaciones, 0 fallos**. Incluyó la identidad del programa, las listas de 61 estudiantes, los cuatro libros de período, 424 actividades y 8.622 filas de notas, más los resúmenes diarios/mensuales/semanales, las rúbricas, las competencias, las fórmulas ponderadas y los puntos extra. El navegador confirmó que la app muestra **Registro docente** y no una tienda. La verificación de interfaz comprobó que P2 presenta la columna agrupada de 40 puntos y los dos aportes de 20.

El flujo de navegador validó para cada curso (5A, 5B y 5C) la descarga como `application/pdf`, el encabezado de archivo, su firma PDF y páginas tamaño carta; recorrió las vistas mensual y semanal y guardó capturas. El PDF se renderizó para inspección visual. `npm run typecheck`, `npm test` y `npm run build` también aprobaron tras los cambios de aplicación.

## Evidencia

- `output/validation/four-clean-rounds/summary.json`: total de rondas y resultados individuales, con el porcentaje de cada una.
- `output/validation/four-clean-rounds/round-01-test.log` a `round-04-test.log`: salida completa de cada suite limpia.
- `test-results/full-year-flow.json`: volumen, fechas y aserciones del flujo anual por ronda.
- `test-results/thousand-integrity-checks.json`: resultado y desglose de la auditoría de 82.376 comprobaciones.
- `test-results/ui/demo-calificaciones-p2.png`: vista del resumen P2 con las dos partidas agrupadas sobre 40.
- `test-results/ui/registro-mensual-oficial-5a.png` y `registro-semanal-5a.png`: capturas del recorrido de interfaz.
- `tmp/pdfs/registro-minerd-5a-demo.pdf`, `registro-minerd-5b-demo.pdf`, `registro-minerd-5c-demo.pdf`: PDFs ficticios inspeccionados.

## Datos de demostración y preparación para entrega

Los nombres, marcas, notas y días añadidos más allá del horario oficial son sintéticos. Los PDFs de demostración llevan la marca **MUESTRA FICTICIA · NO APTA PARA ENTREGA**. No se debe presentar ese archivo a coordinación. Para producir copias con datos reales todavía hay que cargar/revisar la matrícula y completar centro, docente, calendario y marcas; el horario de referencia recibido llega hasta el 20 de enero de 2027. Las pruebas no escriben en Neon ni despliegan en Render.

## Repetir

```powershell
npm run typecheck
npm test
npm run build
node scripts/verify-monthly-register-pdf.mjs
node scripts/audit-thousand-demo-checks.mjs
.\scripts\verify-four-clean-rounds.ps1
```

El servidor de demostración para las dos verificaciones de navegador usa `.local/teacher-preview-p2-calibrated` y debe estar disponible en `http://127.0.0.1:3002`. El plan P2 refleja los pesos del Excel de Matemática; los valores asignados a cada una de sus nueve actividades de secuencia son inventados para la prueba y solo su suma bruta de 85 está tomada como tope de categoría. P1 conserva una discrepancia en el archivo fuente entre la configuración y la fórmula de la hoja `Notas`; P3 y P4 son planes ficticios de demostración.
