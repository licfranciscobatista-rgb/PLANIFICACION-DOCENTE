import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const origin = process.env.ATTENDANCE_HANDOFF_QA_ORIGIN || 'http://127.0.0.1:3047';
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find(value => existsSync(value));
assert.ok(executablePath, 'No se encontró Chrome o Edge.');

async function getAttendance(courseId, date, block = 1) {
  const response = await fetch(`${origin}/api/registro?action=attendance&courseId=${encodeURIComponent(courseId)}&date=${date}&block=${block}`, { cache: 'no-store' });
  assert.equal(response.status, 200, 'La consulta de asistencia debe responder correctamente.');
  return (await response.json()).data;
}

const bootResponse = await fetch(`${origin}/api/registro?action=bootstrap`, { cache: 'no-store' });
assert.equal(bootResponse.status, 200);
const boot = (await bootResponse.json()).data;
assert.equal(boot.demo, true, 'La prueba solo puede ejecutarse en demo local aislada.');
const courseA = boot.courses.find(course => course.code === '5A');
const courseB = boot.courses.find(course => course.code === '5B');
assert.ok(courseA && courseB, 'La base demo debe incluir 5A y 5B.');
assert.ok(courseA.students.length > 0 && courseB.students.length > 0);
const date = process.env.ATTENDANCE_HANDOFF_QA_DATE || '2026-11-19';
const firstA = courseA.students[0];
const firstB = courseB.students[0];

const browser = await chromium.launch({ headless: true, executablePath });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 500) errors.push(`HTTP ${response.status()} ${response.url()}`); });

  const initial = await page.goto(origin, { waitUntil: 'networkidle', timeout: 60000 });
  assert.equal(initial?.status(), 200);
  await page.locator('.course-card').filter({ hasText: '5A' }).getByRole('button', { name: 'Asistencia' }).click();
  await page.getByRole('heading', { name: 'Registro de la clase' }).waitFor();
  await page.locator('input[type="date"]').fill(date);
  await page.getByRole('button', { name: 'Todos presentes' }).click();
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await page.getByRole('heading', { name: 'Confirma la lista de 5A' }).waitFor();
  await page.getByRole('button', { name: 'Confirmar asistencia', exact: true }).click();

  const behaviorTab = page.getByRole('tab', { name: 'Paso 2: participación, comportamiento y disciplina' });
  await page.getByText('Valoración del bloque', { exact: true }).waitFor();
  await page.getByText('Asistencia confirmada. Completa aquí la participación', { exact: false }).waitFor();
  assert.equal(await behaviorTab.getAttribute('aria-selected'), 'true', 'Al confirmar 5A debe abrirse el segundo formulario.');

  await page.getByLabel(`Participación ${firstA.name}`).fill('7.5');
  await page.getByLabel(`Comportamiento ${firstA.name}`).fill('8');
  await page.getByLabel(`Disciplina ${firstA.name}`).fill('9');
  await page.getByText('Guardado en la cuenta', { exact: true }).waitFor({ timeout: 15000 });
  const savedA = await getAttendance(courseA.id, date);
  const rowA = savedA.rows.find(row => row.studentId === firstA.id);
  assert.equal(rowA.status, 'P');
  assert.equal(rowA.participation, 7.5);
  assert.equal(rowA.behavior, 8);
  assert.equal(rowA.discipline, 9);

  await page.getByRole('button', { name: 'Ir a Inicio' }).click();
  await page.locator('.course-card').filter({ hasText: '5B' }).getByRole('button', { name: 'Asistencia' }).click();
  await page.locator('input[type="date"]').fill(date);
  const attendanceTab = page.getByRole('tab', { name: 'Paso 1: asistencia' });
  assert.equal(await attendanceTab.getAttribute('aria-selected'), 'true', '5B debe iniciar en asistencia hasta su propia confirmación.');
  await page.getByRole('button', { name: 'Todos presentes' }).click();
  await page.getByRole('button', { name: 'Revisar y confirmar' }).click();
  await page.getByRole('heading', { name: 'Confirma la lista de 5B' }).waitFor();
  await page.getByRole('button', { name: 'Confirmar asistencia', exact: true }).click();
  await page.getByText('Valoración del bloque', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Paso 2: participación, comportamiento y disciplina' }).getAttribute('aria-selected'), 'true', '5B debe abrir su formulario de bloque al confirmar.');
  await page.getByLabel(`Participación ${firstB.name}`).fill('6');
  await page.getByLabel(`Comportamiento ${firstB.name}`).fill('7');
  await page.getByLabel(`Disciplina ${firstB.name}`).fill('8');
  await page.getByText('Guardado en la cuenta', { exact: true }).waitFor({ timeout: 15000 });
  const savedB = await getAttendance(courseB.id, date);
  const rowB = savedB.rows.find(row => row.studentId === firstB.id);
  assert.equal(rowB.status, 'P');
  assert.equal(rowB.participation, 6);
  assert.equal(rowB.behavior, 7);
  assert.equal(rowB.discipline, 8);

  await page.getByRole('tab', { name: 'Paso 1: asistencia' }).click();
  await page.getByRole('button', { name: 'Ir a Inicio' }).click();
  await page.locator('.course-card').filter({ hasText: '5B' }).getByRole('button', { name: 'Asistencia' }).click();
  await page.locator('input[type="date"]').fill(date);
  assert.equal(await page.getByRole('tab', { name: 'Paso 1: asistencia' }).getAttribute('aria-selected'), 'true', 'La selección explícita de 5B debe recordarse independientemente de 5A.');

  await page.getByRole('button', { name: 'Ir a Inicio' }).click();
  await page.locator('.course-card').filter({ hasText: '5A' }).getByRole('button', { name: 'Asistencia' }).click();
  await page.locator('input[type="date"]').fill(date);
  await page.getByText('Valoración del bloque', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Paso 2: participación, comportamiento y disciplina' }).getAttribute('aria-selected'), 'true', 'Volver a 5A debe retomar su segundo formulario.');
  assert.equal(await page.getByLabel(`Participación ${firstA.name}`).inputValue(), '7.5', 'La valoración del primer curso debe seguir visible al regresar.');

  await page.evaluate(key => window.localStorage.removeItem(key), `attendance-mode:${courseA.id}:${date}:1`);
  await page.getByRole('button', { name: 'Ir a Inicio' }).click();
  await page.locator('.course-card').filter({ hasText: '5A' }).getByRole('button', { name: 'Asistencia' }).click();
  await page.locator('input[type="date"]').fill(date);
  await page.getByText('Valoración del bloque', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Paso 2: participación, comportamiento y disciplina' }).getAttribute('aria-selected'), 'true', 'Una sesión ya impartida debe abrir la valoración aunque no exista preferencia local.');
  assert.equal(await page.getByLabel(`Participación ${firstA.name}`).inputValue(), '7.5');
  assert.deepEqual(errors, [], 'La interfaz no debe producir errores de navegador ni respuestas 500.');

  console.log(JSON.stringify({
    result: 'passed',
    isolatedDemo: true,
    date,
    courses: [courseA.code, courseB.code],
    confirmations: 2,
    behaviorFormsOpened: 2,
    ratingValuesVerifiedInDatabase: 6,
    switchingCoursesRestoresPerCoursePreference: true,
    confirmedSessionsDefaultToBehaviorForm: true,
    browserErrors: errors.length,
  }, null, 2));
} finally {
  await browser.close();
}
