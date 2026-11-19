# Registro docente

Aplicación para llevar asistencia, comportamiento observado, actividades, calificaciones e informes individuales de los cursos 5A, 5B y 5C.

## Estado actual

- La vista local usa nombres ficticios y una base PostgreSQL embebida de prueba. No contiene la lista real ni notas de estudiantes.
- El menú **Asistencia** separa la captura diaria, el registro mensual y el resumen semanal por estudiante. El registro mensual descarga un PDF tamaño carta con la cuadrícula de asistencia inspirada en el formulario MINERD de 5.º, más una nómina vinculada por número.
- El PDF de demostración lleva marca de agua y no es entregable: usa nombres y registros sintéticos. La vista semanal cuenta P + T por semana; el registro mensual aplica la equivalencia de tres tardanzas por una ausencia.
- El libro general abre por curso, pone cada evaluación en su columna, desglosa los criterios de rúbrica por competencia y separa conducta de participación.
- La planificación de una actividad común se hace una vez para los tres cursos; la captura de notas sigue independiente para cada lista.
- La vista **Desarrollo de calificaciones** muestra por estudiante el aporte de cada categoría, las evidencias por actividad y el desglose por competencia. En P2, las actividades de secuencia (20 puntos, máximo bruto 85) y la revisión diaria de libreta (20 puntos) se resumen juntas como **Libretas y tareas · 40**, conservando el aporte de cada una.
- El plan P2 usa 35 puntos de exámenes (15 + 20), 20 de actividades de secuencia, 20 de libreta diaria, 15 de participación/conducta y 10 de prácticas para casa. La distribución de P1 aún necesita reconciliación: `Config_evaluacion` muestra 35/15/20/20/10, mientras la fórmula de `Notas` suma 90 puntos de actividades y añade el examen sobre 10.
- La base local `teacher-preview-p2-calibrated` contiene una demostración ficticia P1–P4 en los tres cursos. Solo el plan P2 de la demo sigue los pesos del archivo de Matemática; P1, P3 y P4 usan reglas sintéticas para probar el sistema. Los máximos individuales asignados a las nueve actividades de secuencia de la demo también son sintéticos, aunque suman 85. El horario después del 20 de enero de 2027 es sintético y no corresponde a fechas oficiales.
- El proyecto Neon `registro-docente` usa autenticación por correo; `Verify at Sign-up` está desactivado para que los docentes puedan crear y usar su cuenta sin código. Todavía no se han cargado estudiantes.
- `render.yaml` deja preparada una configuración de Render; aún no hay servicio publicado ni URL real.
- `render.yaml` usa el plan gratuito. Render suspende el servicio tras un periodo sin tráfico y puede tardar alrededor de un minuto en reactivarlo; la base Neon permanece separada y conserva los datos aunque Render use almacenamiento efímero.
- En la base de demostración los cuatro períodos aparecen confirmados solo para probar fórmulas y flujo. Eso no confirma los planes reales del año ni modifica la base separada del docente.

## Desarrollo local

Requiere Node.js 22 a 24.

```powershell
npm ci
npm run dev
```

La configuración local de demostración está en `.env.local` y no debe subirse al repositorio. La aplicación abre en `http://127.0.0.1:3000`; la vista de demostración guarda su base en los datos locales de usuario, fuera del repositorio y separada de cualquier conexión real a Neon. `DEMO_DATABASE_PATH` permite elegir otra base ficticia y `DEMO_DATABASE_ROOT` cambiar su carpeta.

## Verificación

```powershell
npm run typecheck
npm test
npm run build
```

La prueba de navegador de producción se ejecuta con el servidor ya iniciado en el puerto 3000:

```powershell
npm run start -- -p 3000
node tests/ui-smoke.mjs
```

El smoke test usa exclusivamente la lista ficticia local y revisa los tres cursos, persistencia después de recargar, notas 0 y máximas, informes, historial, borrador tras un error simulado y diseño móvil.

## Datos y seguridad

- La identidad de cada estudiante usa un identificador estable del curso; cambiar entre cursos no reasigna notas ni asistencia.
- Los registros de asistencia, las actividades y las notas se guardan por separado y generan historial.
- Los campos vacíos no se convierten en cero. Guardar una calificación no cambia si se impartió la clase.
- Cada cuenta obtiene un espacio de trabajo propio, identificado por el ID de su sesión; la aplicación no exige verificar el correo.
- Las conexiones de base de datos y el secreto de cookies no se guardan en el repositorio.

## Variables para producción

Render solicita las variables privadas al crear el servicio:

- `DATABASE_URL`: conexión agrupada/pooler de Neon para la aplicación.
- `MIGRATION_DATABASE_URL`: conexión directa de Neon, sin `-pooler`, para aplicar el esquema antes de cada despliegue.
- `APP_URL`: URL HTTPS exacta asignada al servicio Render.
Render genera `NEON_AUTH_COOKIE_SECRET`. `NEON_AUTH_BASE_URL` y `APP_TIMEZONE` ya están en `render.yaml`. `DEMO_MODE` queda desactivado en producción. La app y Neon permiten registrar cuentas sin un código de verificación; cada sesión mantiene su espacio separado.

La URL directa de Neon da acceso de escritura a la base: se copia desde Neon a los campos privados de Render y no se pega en el código ni en el chat. El despliegue se completa cuando el código esté en un repositorio remoto, se haya escogido el workspace de Render y el docente revise y aplique el plan.
