import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const origin = process.env.INLINE_RUBRIC_QA_ORIGIN || 'http://127.0.0.1:3040';
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find(value => existsSync(value));
assert.ok(executablePath, 'No se encontró Chrome o Edge.');

const response = await fetch(`${origin}/api/registro?action=bootstrap`, { cache: 'no-store' });
assert.equal(response.status, 200);
const initial = (await response.json()).data;
assert.equal(initial.demo, true, 'La prueba debe usar una base local demo.');
assert.equal(initial.activities.length, 0, 'La base aislada debe empezar sin actividades.');
if (initial.courses.length === 0) {
  const courseInput = { code: 'QA1', name: 'Curso de prueba', startDate: '2026-11-18', endDate: '2026-12-18', noClassDates: [] };
  const created = await fetch(`${origin}/api/registro`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'course', input: courseInput }),
  });
  assert.equal(created.status, 200, 'La base local acepta el curso de prueba.');
}

const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', result => { if (result.status() >= 500) errors.push(`HTTP ${result.status()} ${result.url()}`); });
  const loaded = await page.goto(`${origin}/prototipo/flujo-actividad`, { waitUntil: 'networkidle', timeout: 45000 });
  assert.equal(loaded?.status(), 200);

  const activitiesMenu = page.getByRole('button', { name: 'Actividades', exact: true });
  if (await activitiesMenu.getAttribute('aria-expanded') !== 'true') await activitiesMenu.click();
  await page.locator('#activities-nav-submenu').getByRole('button', { name: 'Secuencia y revisión', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar manualmente', exact: true }).click();
  await page.getByRole('heading', { name: 'Períodos', exact: true }).waitFor();

  const title = 'QA · Criterio por competencias editable';
  await page.getByRole('button', { name: 'Crear actividad', exact: true }).first().click();
  await page.locator('.activity-drawer details.activity-advanced-options > summary').click();
  await page.getByLabel('Vínculo con la secuencia').selectOption('MANUAL');
  await page.getByLabel('Nombre de la actividad').fill(title);
  await page.getByLabel('Máximo de puntos').fill('10');
  await page.getByRole('button', { name: 'Crear y continuar', exact: true }).click();
  await page.getByRole('button', { name: /Por competencias/ }).click();

  await page.getByRole('button', { name: 'Añadir criterio', exact: true }).click();
  await page.getByLabel('Nombre del criterio 1').fill('Resuelve y justifica la suma de vectores');
  for (const level of ['Insuficiente', 'Suficiente', 'Bueno', 'Excelente']) {
    await page.getByLabel(`${level} para el criterio 1`, { exact: true }).fill(`Descriptor ${level.toLowerCase()} para la suma de vectores.`);
  }
  const save = page.getByRole('button', { name: 'Guardar valoración', exact: true });
  assert.equal(await save.isDisabled(), false, 'La actividad debe poder guardarse sin plantilla global y con su indicador automático.');
  await save.click();
  await page.locator('.activity-table tbody tr').filter({ hasText: title }).waitFor();

  const afterResponse = await fetch(`${origin}/api/registro?action=bootstrap`, { cache: 'no-store' });
  assert.equal(afterResponse.status, 200);
  const after = (await afterResponse.json()).data;
  const activity = after.activities.find(item => item.title === title);
  assert.ok(activity, 'La actividad quedó guardada.');
  assert.equal(activity.scoringMode, 'rubric');
  assert.equal(activity.rubric.length, 1);
  assert.equal(activity.rubric[0].label, 'Resuelve y justifica la suma de vectores');
  assert.equal(activity.rubric[0].levels.length, 4);
  assert.equal(activity.indicatorPoints.reduce((sum, item) => sum + item.points, 0), 10);
  assert.equal(after.criteriaCatalog.length, 0, 'La rúbrica pertenece a la actividad y no requiere guardar plantillas globales.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', title, criteria: activity.rubric.length, assignedPoints: activity.maxPoints, globalTemplatesRequired: false, browserErrors: errors.length }, null, 2));
} finally {
  await browser.close();
}
