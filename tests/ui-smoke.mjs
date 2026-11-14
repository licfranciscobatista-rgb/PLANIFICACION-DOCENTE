import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const executablePath = candidates.find(p => existsSync(p));
if (!executablePath) throw new Error('Instala Chrome/Edge o define PLAYWRIGHT_CHROMIUM_EXECUTABLE.');
const out = resolve('test-results/ui'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-features=BlockInsecurePrivateNetworkRequests'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
await page.emulateMedia({reducedMotion:'reduce'});
const errors = []; let allowExpected503 = false;
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('console', m => {if(m.type()==='error'&&!/fonts\.googleapis/.test(m.text())&&!(allowExpected503&&/503/.test(m.text())))errors.push('console: '+m.text()+' '+JSON.stringify(m.location()));});
page.on('response', r => {if(r.status()>=400&&!(allowExpected503&&r.status()===503))errors.push(`HTTP ${r.status()} ${r.url()}`);});
const assert = (ok, message) => {if(!ok)throw new Error(message);console.log('PASS '+message);};
const marks = (student,letter) => page.getByRole('button',{name:new RegExp(({P:'Presente',A:'Ausente',T:'Tardanza',E:'Excusa'})[letter]+' '+student)});
const examTitle = 'Examen de prueba 15 '+Date.now();
const draftComment = 'Borrador que debe quedar local '+Date.now();
const chooseOption = async (select, phrase) => { const value = await select.locator('option').evaluateAll((options, text) => options.find(o => o.textContent.includes(text))?.value, phrase); if (!value) throw new Error('No existe opción con texto: '+phrase); await select.selectOption(value); };
try {
  await page.goto('http://127.0.0.1:3000',{waitUntil:'networkidle',timeout:45000});
  await page.getByRole('heading',{name:'Tu clase comienza aquí.'}).waitFor();
  assert(await page.locator('.course-tabs button').count()===3,'carga el tablero demo');
  assert(await page.locator('.course-tabs button').count()===3,'muestra 5A, 5B y 5C');
  assert((await page.locator('.course-tabs').innerText()).includes('21')&&(await page.locator('.course-tabs').innerText()).includes('19'),'conteo 21/19/21 coincide con lista demo');
  await page.screenshot({path:resolve(out,'inicio-1440.png'),fullPage:true});
  await page.getByRole('button',{name:/Asistencia y conducta/}).click();
  await page.getByRole('heading',{name:'Asistencia y comportamiento'}).waitFor();
  await page.getByRole('button',{name:/Todos presentes/}).click();
  await marks('Estudiante 5A 02','A').click();
  await page.getByRole('spinbutton',{name:'Comportamiento Estudiante 5A 01'}).fill('0');
  await page.getByLabel('Tema trabajado').fill('Vectores · prueba interfaz');
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 21 estudiantes/).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Asistencia y conducta/}).click();
  await page.getByRole('button',{name:/Asistencia y conducta/}).waitFor();
  await page.getByRole('button',{name:/Todos presentes/}).waitFor();
  assert(await marks('Estudiante 5A 01','P').getAttribute('aria-pressed')==='true','asistencia y comportamiento 0 sobreviven al recargar');
  assert(await marks('Estudiante 5A 02','A').getAttribute('aria-pressed')==='true','se conserva una ausencia con su estudiante correcto');
  assert((await page.getByRole('spinbutton',{name:'Comportamiento Estudiante 5A 01'}).inputValue())==='0','cero se distingue de pendiente en la captura diaria');
  await page.screenshot({path:resolve(out,'asistencia-5A.png'),fullPage:true});

  await page.locator('.course-tabs button').filter({hasText:'5B'}).click();
  await page.getByRole('button',{name:/Todos presentes/}).waitFor();
  assert(await page.locator('.attendance-table tbody tr').count()===19,'cambio a 5B presenta 19 estudiantes, no arrastra la lista 5A');
  await page.getByRole('button',{name:/Todos presentes/}).click();
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 19 estudiantes/).waitFor();
  await page.locator('.course-tabs button').filter({hasText:'5C'}).click();
  await page.getByRole('button',{name:/Todos presentes/}).waitFor();
  assert(await page.locator('.attendance-table tbody tr').count()===21,'cambio a 5C presenta 21 estudiantes');
  await page.getByRole('button',{name:/Todos presentes/}).click();
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 21 estudiantes/).waitFor();

  await page.locator('.course-tabs button').filter({hasText:'5A'}).click();
  await page.getByRole('button',{name:/Actividades/}).click();
  await page.getByRole('button',{name:/Nueva actividad/}).click();
  await page.getByLabel('Nombre de la actividad').fill(examTitle);
  await page.getByLabel('Categoría').selectOption('exam');
  await page.getByLabel('Puntuación máxima').fill('15');
  await page.getByRole('button',{name:'Crear actividad'}).last().click();
  await page.getByText(examTitle,{exact:true}).waitFor();
  await page.getByRole('button',{name:/Calificaciones/}).click();
  await page.locator('.course-tabs button').filter({hasText:'5A'}).click();
  const selector=page.locator('.activity-selector select');
  await chooseOption(selector,examTitle);
  await page.getByLabel('Nota Estudiante 5A 01').fill('15');
  await page.getByLabel('Nota Estudiante 5A 02').fill('0');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 21 estudiantes/).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Calificaciones/}).click();
  assert((await page.getByLabel('Nota Estudiante 5A 01').inputValue())==='15','examen persiste la nota máxima en el estudiante correcto');
  assert((await page.getByLabel('Nota Estudiante 5A 02').inputValue())==='0','examen conserva el cero explícito');
  await page.locator('.course-tabs button').filter({hasText:'5B'}).click();
  await page.getByText(/Crear tu primera actividad|Prepara tu primera actividad/).first().waitFor();
  await page.locator('.course-tabs button').filter({hasText:'5A'}).click();
  await chooseOption(selector,examTitle);
  assert((await page.getByLabel('Nota Estudiante 5A 01').inputValue())==='15','la nota de 5A no aparece como nota de 5B y vuelve intacta a 5A');

  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  await page.getByRole('heading',{name:'Informe por estudiante'}).waitFor();
  await page.getByText('Puntos registrados',{exact:true}).first().waitFor();
  await page.getByRole('heading',{name:'Comportamiento por sesión'}).waitFor();
  await page.screenshot({path:resolve(out,'informe-5A.png'),fullPage:true});
  await page.getByRole('button',{name:/Historial y respaldo/}).click();
  await page.getByRole('heading',{name:'Historial y respaldo'}).waitFor();
  await page.locator('.data-table tbody tr').first().waitFor();
  assert((await page.locator('.data-table tbody tr').count())>=4,'el historial refleja los guardados confirmados');

  await page.locator('.course-tabs button').filter({hasText:'5C'}).click();
  await page.getByRole('button',{name:/Asistencia y conducta/}).click();
  const first=page.getByLabel(/Observación Estudiante 5C/).first();
  await first.fill(draftComment);
  await page.locator('input[aria-label="Buscar estudiante"]').fill('Estudiante 5C 01');
  assert(await page.locator('.attendance-table tbody tr').count()===1,'filtro visual limita filas sin quitar estudiantes del curso');
  allowExpected503=true; await page.route('**/api/registro',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'simulación de red interrumpida'})}));
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/simulación de red interrumpida/).waitFor();
  assert((await page.locator('.notice.draft-notice').count())===1,'una respuesta de error conserva el borrador');
  await page.unroute('**/api/registro'); allowExpected503=false;
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 21 estudiantes/).waitFor();
  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  await page.locator('label.field select').locator('option').filter({hasText:'Estudiante 5C 02'}).waitFor({state:'attached'});
  await chooseOption(page.locator('label.field select'),'Estudiante 5C 02');
  await page.getByRole('heading',{name:'Comportamiento por sesión'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(out,'informe-movil.png'),fullPage:true});
  assert(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+2),'informe responsivo móvil sin desbordamiento horizontal');

  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:3000',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Tu clase comienza aquí.'}).waitFor();
  await page.screenshot({path:resolve(out,'inicio-movil.png'),fullPage:true});
  assert(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+2),'inicio responsivo móvil sin desbordamiento horizontal');
  if(errors.length)throw new Error('Errores del navegador: '+errors.join(' | '));
  console.log('PASS sin excepciones, errores HTTP 5xx ni fallos en consola');
} catch(error) {
  await page.screenshot({path:resolve(out,'fallo.png'),fullPage:true}).catch(()=>{});
  console.error('UI_FAILURE',error);
  if(errors.length)console.error('BROWSER_ERRORS',errors);
  process.exitCode=1;
} finally {await context.close();await browser.close();}


