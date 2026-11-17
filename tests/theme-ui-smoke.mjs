import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find(path => existsSync(path));
if (!executablePath) throw new Error('Instala Chrome/Edge o define PLAYWRIGHT_CHROMIUM_EXECUTABLE.');
const out = resolve('.build/theme-ui-smoke');
mkdirSync(out, { recursive: true });
const baseUrl = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-features=BlockInsecurePrivateNetworkRequests'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && !/fonts\.googleapis/.test(message.text())) errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log(`PASS ${message}`); };
const openGroup = async (group, item) => {
  const button = page.locator(`.nav-group-button[aria-label="${group}"]`);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await page.getByRole('button', { name: item, exact: true }).click();
};
const assertDark = async section => {
  assert(await page.locator('html').getAttribute('data-theme') === 'dark', `${section}: tema oscuro global activo`);
  assert(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(16, 23, 25)', `${section}: fondo global oscuro`);
  const panel = page.locator('.panel').first();
  if (await panel.count()) assert(await panel.evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(25, 35, 39)', `${section}: paneles en modo oscuro`);
};

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByRole('heading', { name: 'Tu clase comienza aquí.' }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert(await page.getByRole('button', { name: 'Activar modo claro' }).isVisible(), 'el tema del sistema se aplica en Inicio');
  await page.getByRole('button', { name: 'Activar modo claro' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert(await page.getByRole('button', { name: 'Activar modo oscuro' }).isVisible(), 'la elección manual se conserva al recargar');
  await page.getByRole('button', { name: 'Activar modo oscuro' }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');

  await openGroup('Estudiantes', 'Cursos');
  await page.getByRole('heading', { name: 'Cursos', exact: true }).waitFor();
  await assertDark('Cursos');
  const course5A = page.locator('.course-overview-card').filter({ hasText: '5A' });
  assert(await course5A.count() === 1, 'Cursos muestra 5A en su resumen');
  assert((await course5A.innerText()).replace(/\s+/g, ' ').includes('21 estudiantes'), 'Cursos resume la matrícula');
  assert(await page.locator('.course-administration-panel').count() === 0, 'administración de cursos inicia contraída');
  await course5A.getByRole('button', { name: 'Administrar curso' }).click();
  assert((await page.locator('.course-administration-panel').innerText()).includes('ADMINISTRACIÓN · 5A'), 'la administración se abre a petición');
  await page.locator('.course-administration-panel').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('.course-overview-card').filter({ hasText: '5A' }).getByRole('button', { name: 'Administrar curso' }).click();
  await page.getByRole('button', { name: 'Añadir o importar estudiantes' }).click();
  await page.getByRole('heading', { name: 'Estudiantes de 5A' }).waitFor();
  await assertDark('Lista del curso');
  const rosterAdmin = page.locator('.student-management-disclosure');
  assert(await rosterAdmin.evaluate(el => !el.open), 'la administración de matrícula queda contraída con datos');
  await rosterAdmin.locator('summary').click();
  assert(await page.getByText('Importar o actualizar desde CSV', { exact: true }).isVisible(), 'la administración de matrícula se abre bajo demanda');
  await rosterAdmin.locator('summary').click();
  await openGroup('Estudiantes', 'Lista general');
  await page.getByRole('heading', { name: 'Estudiantes', exact: true }).waitFor();
  await assertDark('Lista general');
  assert(await page.locator('.student-directory-summary .metric').count() === 3, 'Lista general resume cursos, estudiantes y pendientes');
  assert(await page.locator('.roster-workbook-import').evaluate(el => !el.open), 'la importación masiva queda contraída tras cargar las listas');
  await page.screenshot({ path: resolve(out, 'estudiantes-general.png'), fullPage: true });

  await openGroup('Actividades', 'Indicadores de logro');
  await page.getByRole('heading', { name: 'Indicadores de logro', exact: true }).waitFor();
  await assertDark('Indicadores');
  await page.getByRole('button', { name: 'Criterios de evaluación', exact: true }).click();
  await page.getByRole('heading', { name: 'Criterios de evaluación', exact: true }).waitFor();
  await assertDark('Criterios');
  await page.getByRole('button', { name: 'Secuencia y revisión', exact: true }).click();
  await page.getByRole('heading', { name: 'Secuencia y revisión', exact: true }).waitFor();
  await assertDark('Secuencia');
  await page.screenshot({ path: resolve(out, 'secuencia.png'), fullPage: true });
  await page.getByRole('button', { name: 'Plan de evaluación', exact: true }).click();
  await page.getByRole('heading', { name: /Plan de evaluación/ }).waitFor();
  await assertDark('Plan de evaluación');
  assert(await page.locator('.plan-editor').count() === 0 && await page.getByRole('button', { name: /Editar plan/ }).isVisible(), 'el plan guardado aparece como resumen y se edita a petición');
  await page.getByRole('button', { name: 'Historial y respaldo', exact: true }).click();
  await page.getByRole('heading', { name: 'Historial y respaldo', exact: true }).waitFor();
  await assertDark('Historial');

  await openGroup('Asistencia', 'Registro diario');
  await page.getByRole('heading', { name: 'Asistencia del día' }).waitFor();
  await assertDark('Asistencia diaria');
  await openGroup('Asistencia', 'Comportamiento');
  await page.getByRole('heading', { name: 'Comportamiento del día' }).waitFor();
  await assertDark('Comportamiento');
  await openGroup('Asistencia', 'Registro oficial mensual');
  await page.getByRole('heading', { name: 'Registro mensual de asistencia' }).waitFor();
  await assertDark('Registro oficial mensual');
  assert(await page.locator('.monthly-register-sheet').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(25, 35, 39)', 'la hoja mensual conserva legibilidad en pantalla oscura');
  await page.emulateMedia({ media: 'print' });
  assert(await page.locator('.monthly-register-sheet').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(255, 255, 255)', 'el PDF/impresión mantiene el formato de papel claro');
  await page.emulateMedia({ media: 'screen' });
  await openGroup('Asistencia', 'Resumen semanal');
  await page.getByRole('heading', { name: 'Resumen semanal de asistencia' }).waitFor();
  await assertDark('Resumen semanal');

  await openGroup('Calificaciones', 'Capturar notas');
  await page.getByRole('heading', { name: 'Calificaciones', exact: true }).waitFor();
  await assertDark('Captura de notas');
  await page.getByRole('button', { name: 'Libro de calificaciones', exact: true }).click();
  await page.getByRole('heading', { name: 'Libro de calificaciones', exact: true }).waitFor();
  await assertDark('Libro de calificaciones');
  await page.getByRole('button', { name: 'Informe por estudiante', exact: true }).click();
  await page.getByRole('heading', { name: 'Informe por estudiante' }).waitFor();
  await assertDark('Informe por estudiante');

  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.getByRole('heading', { name: 'Tu clase comienza aquí.' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await assertDark('Inicio móvil');
  assert(await page.locator('body').evaluate(el => el.scrollWidth <= window.innerWidth + 2), 'Inicio móvil no desborda horizontalmente');
  for (const card of await page.locator('.course-card').all()) {
    const badge = await card.locator('.course-emblem').boundingBox();
    const count = await card.locator('.course-student-count').boundingBox();
    assert(Boolean(badge && count && count.x >= badge.x + badge.width), 'el código y la matrícula del curso no se superponen en móvil');
  }
  assert(await page.getByRole('button', { name: 'Activar modo claro' }).isVisible(), 'el interruptor global sigue accesible en móvil');
  await page.screenshot({ path: resolve(out, 'inicio-movil.png'), fullPage: true });

  if (errors.length) throw new Error(errors.join(' | '));
  console.log('PASS sin errores de navegador ni respuestas HTTP fallidas');
} catch (error) {
  await page.screenshot({ path: resolve(out, 'fallo.png'), fullPage: true }).catch(() => {});
  console.error('THEME_UI_FAILURE', error);
  if (errors.length) console.error('BROWSER_ERRORS', errors);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
