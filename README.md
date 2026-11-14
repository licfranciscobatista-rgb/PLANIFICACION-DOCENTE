# Registro docente

Aplicación para llevar asistencia, comportamiento observado, actividades, calificaciones e informes individuales de los cursos 5A, 5B y 5C.

## Estado actual

- La vista local usa nombres ficticios y una base PostgreSQL embebida de prueba. No contiene la lista real ni notas de estudiantes.
- Se creó un proyecto nuevo de Neon llamado `registro-docente`, en Ohio, con autenticación por correo y verificación OTP habilitadas. Todavía no se han cargado estudiantes.
- `render.yaml` deja preparada una configuración de Render; aún no hay servicio publicado ni URL real.
- El plan Render del archivo es de pago (`0.5c-512mb`) porque el nivel gratuito se suspende por inactividad y Render indica que no es para producción. La base Neon permanece separada y no depende del disco efímero de Render.
- El plan de evaluación P2 sigue marcado como provisional hasta confirmar horario, cantidad de sesiones y criterios de la secuencia.

## Desarrollo local

Requiere Node.js 22 a 24.

```powershell
npm ci
npm run dev
```

La configuración local de demostración está en `.env.local` y no debe subirse al repositorio. La aplicación abre en `http://127.0.0.1:3000`; la vista de demostración usa una ruta local separada de cualquier futura conexión real a Neon.

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
- El acceso de producción acepta solo la dirección configurada en `OWNER_EMAIL` y exige verificación de correo.
- Las conexiones de base de datos y el secreto de cookies no se guardan en el repositorio.

## Variables para producción

Render solicita las variables privadas al crear el servicio:

- `DATABASE_URL`: conexión agrupada/pooler de Neon para la aplicación.
- `MIGRATION_DATABASE_URL`: conexión directa de Neon, sin `-pooler`, para aplicar el esquema antes de cada despliegue.
- `APP_URL`: URL HTTPS exacta asignada al servicio Render.
- `OWNER_EMAIL`: correo autorizado del docente.

Render genera `NEON_AUTH_COOKIE_SECRET`. `NEON_AUTH_BASE_URL` y `APP_TIMEZONE` ya están en `render.yaml`. `DEMO_MODE` queda desactivado en producción.

La URL directa de Neon da acceso de escritura a la base: se copia desde Neon a los campos privados de Render y no se pega en el código ni en el chat. El despliegue se completa cuando el código esté en un repositorio remoto, se haya escogido el workspace de Render y el docente revise y aplique el plan.
