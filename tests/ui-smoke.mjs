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
const baseUrl = process.env.UI_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-features=BlockInsecurePrivateNetworkRequests'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
await page.emulateMedia({reducedMotion:'reduce'});
const errors = []; let allowExpected503 = false;
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('console', m => {if(m.type()==='error'&&!/fonts\.googleapis/.test(m.text())&&!(allowExpected503&&/503/.test(m.text())))errors.push('console: '+m.text()+' '+JSON.stringify(m.location()));});
page.on('response', r => {if(r.status()>=400&&!(allowExpected503&&r.status()===503))errors.push(`HTTP ${r.status()} ${r.url()}`);});
const assert = (ok, message) => {if(!ok)throw new Error(message);console.log('PASS '+message);};
const openSubmenu = async (name) => {
  const button=page.getByRole('button',{name,exact:true});
  if(await button.getAttribute('aria-expanded')!=='true')await button.click();
};
const goAttendance = async (item) => {
  await openSubmenu('Asistencia');
  await page.getByRole('button',{name:item,exact:true}).click();
};
const goActivities = async () => {
  await openSubmenu('Actividades');
  const periods=page.getByRole('button',{name:/Períodos P1–P4/});
  if(await periods.isDisabled()){
    await page.getByRole('button',{name:'Secuencia y revisión',exact:true}).click();
    await page.getByRole('button',{name:'Continuar manualmente',exact:true}).click();
  }else await periods.click();
  const activePeriod=await page.locator('.period-label select').count()
    ? await page.locator('.period-label select').inputValue()
    : (await page.locator('.period-label').innerText()).match(/P[1-4]/)?.[0]||'P2';
  await page.getByRole('button',{name:new RegExp('^'+activePeriod+'(?:\\s|$)')}).click();
};
const marks = (student,letter) => page.getByRole('button',{name:new RegExp(({P:'Presente',A:'Ausente',T:'Tardanza',E:'Excusa'})[letter]+' '+student)});
const examTitle = 'Examen de prueba 15 '+Date.now();
const rubricTitle = 'Rúbrica por competencia '+Date.now();
const participationTitle = 'Participación por estudiante '+Date.now();
const extraTitle = 'Puntos de regalo '+Date.now();
const draftComment = 'Borrador que debe quedar local '+Date.now();
const chooseOption = async (select, phrase) => { const value = await select.locator('option').evaluateAll((options, text) => options.find(o => o.textContent.includes(text))?.value, phrase); if (!value) throw new Error('No existe opción con texto: '+phrase); await select.selectOption(value); };
const scorePair = async cell => {
  const text = (await cell.innerText()).replace(/\s+/g,' ');
  const match = text.match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (!match) throw new Error('No se pudo leer puntos obtenidos/posibles: '+text);
  const number = value => Number(value.replace(/,/g,''));
  return {points:number(match[1]),possible:number(match[2])};
};
try {
  await page.goto(baseUrl,{waitUntil:'networkidle',timeout:45000});
  await page.getByRole('heading',{name:'Tu clase comienza aquí.'}).waitFor();
  assert(await page.locator('.course-tabs button').count()===3,'carga el tablero demo');
  assert(await page.locator('.course-tabs button').count()===3,'muestra 5A, 5B y 5C');
  assert((await page.locator('.course-tabs').innerText()).includes('21')&&(await page.locator('.course-tabs').innerText()).includes('19'),'conteo 21/19/21 coincide con lista demo');
  await page.screenshot({path:resolve(out,'inicio-1440.png'),fullPage:true});
  await goAttendance('Registro diario');
  await page.getByRole('heading',{name:'Asistencia del día'}).waitFor();
  await page.getByRole('button',{name:/Todos presentes/}).click();
  await marks('Estudiante 5A 02','A').click();
  await page.getByLabel('Tema trabajado').fill('Vectores · prueba interfaz');
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 21 estudiantes/).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await goAttendance('Registro diario');
  await page.getByRole('button',{name:/Todos presentes/}).waitFor();
  assert(await marks('Estudiante 5A 01','P').getAttribute('aria-pressed')==='true','la asistencia sobrevive al recargar');
  assert(await marks('Estudiante 5A 02','A').getAttribute('aria-pressed')==='true','se conserva una ausencia con su estudiante correcto');
  await page.screenshot({path:resolve(out,'asistencia-5A.png'),fullPage:true});
  await goAttendance('Registro oficial mensual');
  await page.getByRole('heading',{name:'Registro mensual de asistencia'}).waitFor();
  const monthlyRegister=page.locator('.monthly-register-table');
  await monthlyRegister.waitFor();
  assert(await monthlyRegister.locator('tbody tr').count()===21,'el formato mensual muestra a todos los estudiantes del curso');
  assert((await monthlyRegister.innerText()).includes('A. equiv.')&&(await page.getByRole('button',{name:'Imprimir / Guardar PDF'}).isEnabled()),'el registro mensual separa P/A/T/E y calcula ausencias equivalentes');
  await page.emulateMedia({media:'print'});
  assert(await page.locator('.monthly-register-sheet').isVisible()&&!await page.locator('.monthly-register-screen-only').isVisible(),'la impresión contiene la hoja mensual y excluye los paneles de resumen');
  assert(await page.locator('.monthly-register-demo-mark').isVisible()&&(await page.locator('.monthly-register-demo-mark').innerText()).includes('NO APTA PARA ENTREGA'),'la impresión demo conserva una marca visible de datos ficticios');
  await page.emulateMedia({media:'screen'});
  await page.evaluate(()=>{window.__printCount=0;window.print=()=>{window.__printCount++;};});
  await page.getByRole('button',{name:'Imprimir / Guardar PDF'}).click();
  assert(await page.evaluate(()=>window.__printCount===1),'el botón del registro mensual abre la impresión para guardar el PDF');
  await page.screenshot({path:resolve(out,'asistencia-mensual-5A.png'),fullPage:true});

  await goAttendance('Comportamiento');
  await page.getByRole('spinbutton',{name:'Comportamiento Estudiante 5A 01'}).fill('0');
  await page.getByRole('button',{name:'Guardar registro del día'}).click();
  await page.getByText(/Guardado confirmado · 21 estudiantes/).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await goAttendance('Comportamiento');
  assert((await page.getByRole('spinbutton',{name:'Comportamiento Estudiante 5A 01'}).inputValue())==='0','cero de comportamiento se distingue de pendiente al recargar');
  await page.screenshot({path:resolve(out,'comportamiento-5A.png'),fullPage:true});
  await page.getByRole('button',{name:'Registro diario'}).click();

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
  await goActivities();
  assert(await page.locator('.course-tabs').count()===0,'la planificación de actividades no depende del curso seleccionado');
  await page.getByRole('button',{name:'Crear actividad',exact:true}).first().click();
  await page.getByLabel('Nombre de la actividad').fill(examTitle);
  await page.getByLabel('Categoría de nota').selectOption('exam');
  await page.getByLabel('Máximo de la actividad').fill('15');
  await page.getByRole('button',{name:'Crear actividad'}).last().click();
  await page.getByText(examTitle,{exact:true}).waitFor();
  const commonExamRow=page.locator('.activity-table tbody tr').filter({hasText:examTitle});
  assert((await commonExamRow.locator('td').nth(3).innerText())==='5A · 5B · 5C','una actividad común se prepara una vez para los tres cursos');
  await page.getByRole('button',{name:/Capturar notas/}).click();
  await page.locator('.course-tabs button').filter({hasText:'5A'}).click();
  const selector=page.locator('.activity-selector select');
  await chooseOption(selector,examTitle);
  await page.getByLabel('Nota Estudiante 5A 01').fill('15');
  await page.getByLabel('Nota Estudiante 5A 02').fill('0');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 21 estudiantes/).waitFor();
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:/Capturar notas/}).click();
  assert((await page.getByLabel('Nota Estudiante 5A 01').inputValue())==='15','examen persiste la nota máxima en el estudiante correcto');
  assert((await page.getByLabel('Nota Estudiante 5A 02').inputValue())==='0','examen conserva el cero explícito');
  await page.locator('.course-tabs button').filter({hasText:'5B'}).click();
  await chooseOption(selector,examTitle);
  assert((await page.getByLabel('Nota Estudiante 5B 01').inputValue())==='','la actividad común aparece en 5B con notas aún pendientes');
  await page.getByLabel('Nota Estudiante 5B 01').fill('8');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 19 estudiantes/).waitFor();
  await page.locator('.course-tabs button').filter({hasText:'5A'}).click();
  await chooseOption(selector,examTitle);
  assert((await page.getByLabel('Nota Estudiante 5A 01').inputValue())==='15','la nota de 5A se conserva separada de la captura del mismo examen en 5B');

  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  await page.getByRole('heading',{name:'Informe por estudiante'}).waitFor();
  await page.getByRole('heading',{name:'Resumen por competencia'}).waitFor();
  await page.locator('.competency-matrix tbody tr').nth(20).waitFor();
  assert((await page.locator('.competency-matrix tbody tr').count())===21,'el resumen de competencia incluye todos los estudiantes del curso');
  await page.getByText('Puntos extra',{exact:true}).first().waitFor();
  await page.getByRole('heading',{name:'Comportamiento por sesión'}).waitFor();
  await page.screenshot({path:resolve(out,'informe-5A.png'),fullPage:true});

  await page.getByRole('button',{name:/Libro de calificaciones/}).click();
  await page.getByRole('heading',{name:'Libro de calificaciones'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.ledger-category-table tbody tr').length===21);
  assert(await page.locator('.ledger-category-table tbody tr').count()===21,'el desarrollo del período muestra los estudiantes del curso 5A');
  const ledgerCourse=page.getByRole('combobox',{name:'Filtrar curso'});
  await chooseOption(ledgerCourse,'Todos los cursos');
  await page.waitForFunction(()=>document.querySelectorAll('.ledger-category-table tbody tr').length===61);
  assert(await page.locator('.ledger-category-table tbody tr').count()===61,'el filtro reúne a los 61 estudiantes sin perder su curso');
  await chooseOption(ledgerCourse,'5A');
  await page.waitForFunction(()=>document.querySelectorAll('.ledger-table tbody tr').length===21);
  assert((await page.locator('.ledger-category-table thead').innerText()).includes('35 puntos'),'el resumen muestra el máximo de 35 puntos en exámenes');
  await page.screenshot({path:resolve(out,'desarrollo-calificaciones.png'),fullPage:true});
  const ledgerRow=page.locator('.ledger-table tbody tr').filter({hasText:'Estudiante 5A 01'});
  const ledgerCells=ledgerRow.locator('td');
  const ledgerHeaders=page.locator('.ledger-table thead tr:nth-child(2) th');
  const behaviorHeaderIndex=await ledgerHeaders.evaluateAll(headers=>headers.findIndex(header=>header.innerText.includes('Disciplina / comportamiento')));
  assert(behaviorHeaderIndex>=0&&(await ledgerCells.nth(2+behaviorHeaderIndex).innerText()).includes('/ 10'),'el libro general muestra la conducta tomada desde la asistencia');
  assert((await ledgerCells.nth(2+behaviorHeaderIndex).innerText()).includes('0'),'un cero de comportamiento guardado se conserva como nota real');
  const absentBehaviorRow=page.locator('.ledger-table tbody tr').filter({hasText:'Estudiante 5A 02'});
  assert((await absentBehaviorRow.locator('td').nth(2+behaviorHeaderIndex).innerText()).includes('Sin valoración por ausencia/excusa'),'una ausencia no recibe una nota de conducta');
  const pendingBehaviorRow=page.locator('.ledger-table tbody tr').filter({hasText:'Estudiante 5A 03'});
  assert((await pendingBehaviorRow.locator('td').nth(2+behaviorHeaderIndex).innerText()).includes('Pend.'),'una conducta pendiente de un estudiante presente no se muestra como cero');
  assert((await page.locator('.ledger-table thead').innerText()).includes('Disciplina / comportamiento'),'el libro general separa participación de disciplina');

  await goActivities();
  await page.getByRole('button',{name:'Crear actividad',exact:true}).first().click();
  await page.getByLabel('Nombre de la actividad').fill(participationTitle);
  await page.getByLabel('Categoría de nota').selectOption('participation');
  await page.getByLabel('Máximo de la actividad').fill('10');
  await page.getByRole('button',{name:'Crear actividad'}).last().click();
  await page.getByText(participationTitle,{exact:true}).waitFor();
  await page.getByRole('button',{name:/Libro de calificaciones/}).click();
  await ledgerRow.waitFor();
  const participationHeaderIndex=await page.locator('.ledger-table thead tr:nth-child(2) th').evaluateAll((headers,title)=>headers.findIndex(header=>header.innerText.includes(title)),participationTitle);
  assert(participationHeaderIndex>=0,'cada actividad aparece con su propio encabezado de calificación');
  const participationCell=()=>ledgerRow.locator('td').nth(2+participationHeaderIndex);
  assert((await participationCell().innerText()).includes('Pend.'),'una actividad sin corregir queda pendiente, no se presenta como cero');
  await page.getByRole('button',{name:/Capturar notas/}).click();
  await chooseOption(page.locator('.activity-selector select'),participationTitle);
  await page.getByLabel('Nota Estudiante 5A 01').fill('5');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 21 estudiantes/).waitFor();
  await page.getByRole('button',{name:/Libro de calificaciones/}).click();
  await ledgerRow.waitFor();
  const participationAfter=await scorePair(participationCell());
  assert(Math.abs(participationAfter.points-5)<0.001&&Math.abs(participationAfter.possible-10)<0.001,'el puntaje de participación llega a su columna y no se mezcla con conducta');

  await goActivities();
  await page.getByRole('button',{name:'Crear actividad',exact:true}).first().click();
  await page.getByLabel('Código de secuencia').fill('2.1');
  await page.getByLabel('Nombre de la actividad').fill(rubricTitle);
  await page.getByLabel('Categoría de nota').selectOption('sequence');
  await page.getByLabel('Evidencia que entregará el estudiante').fill('Procedimiento y explicación matemática');
  await page.getByLabel('Instrumento').fill('Rúbrica analítica');
  await page.getByRole('checkbox',{name:'Evaluar por criterios y niveles'}).check();
  const firstCriterion=page.locator('.criterion-editor').nth(0);
  await firstCriterion.getByLabel('Qué se evalúa').fill('Explica el procedimiento');
  await firstCriterion.locator('select').selectOption('comunicativa');
  for(let i=0;i<4;i++)await page.locator('.descriptor-grid textarea').nth(i).fill(`Comunica evidencia del nivel ${i+1}.`);
  await page.getByRole('button',{name:/Añadir criterio/}).click();
  const secondCriterion=page.locator('.criterion-editor').nth(1);
  await secondCriterion.getByLabel('Qué se evalúa').fill('Resuelve el problema');
  await secondCriterion.locator('select').selectOption('logico_matematica');
  for(let i=0;i<4;i++)await page.locator('.descriptor-grid textarea').nth(4+i).fill(`Resuelve evidencia del nivel ${i+1}.`);
  await page.getByRole('button',{name:'Crear actividad'}).last().click();
  await page.getByText(rubricTitle,{exact:false}).waitFor();
  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  const matrixRow=page.locator('.competency-matrix tbody tr').filter({hasText:'Estudiante 5A 01'});
  await matrixRow.waitFor();
  const cells=matrixRow.locator('td');
  const totalColumnIndex=await page.locator('.competency-matrix thead th').evaluateAll(headers=>headers.findIndex(header=>header.innerText.trim()==='Total'));
  assert(totalColumnIndex>=0,'la matriz de competencias conserva una columna total identificable');
  const before={communicative:await scorePair(cells.nth(2)),logical:await scorePair(cells.nth(3)),total:await scorePair(cells.nth(totalColumnIndex))};
  await page.getByRole('button',{name:/Capturar notas/}).click();
  await chooseOption(selector,rubricTitle);
  const rubricReference=page.getByRole('region',{name:'Matriz completa de criterios y descriptores'});
  await rubricReference.waitFor();
  assert(await rubricReference.locator('tbody tr').count()===4,'la captura muestra los cuatro niveles completos de la rúbrica antes de calificar');
  for(let i=1;i<=4;i++){
    assert(await rubricReference.getByText(`Comunica evidencia del nivel ${i}.`,{exact:true}).count()===1,`la matriz conserva visible el descriptor comunicativo ${i}`);
    assert(await rubricReference.getByText(`Resuelve evidencia del nivel ${i}.`,{exact:true}).count()===1,`la matriz conserva visible el descriptor matemático ${i}`);
  }
  const rubricMetaText=await rubricReference.locator('.rubric-metadata').innerText();
  const rubricFinalText=await rubricReference.locator('.rubric-final-value').innerText();
  const rubricMetaFields=await rubricReference.locator('.rubric-metadata>div strong').allTextContents();
  assert(rubricMetaFields.length===5&&rubricMetaFields[0]==='Matemática'&&rubricMetaFields[1]==='5A'&&rubricFinalText.includes('puntos finales'),`la rúbrica presenta sus metadatos y máximo: ${JSON.stringify({rubricMetaFields,rubricFinalText})}`);
  await page.getByLabel('Explica el procedimiento Estudiante 5A 01').selectOption('3');
  await page.getByLabel('Resuelve el problema Estudiante 5A 01').selectOption('0');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 21 estudiantes/).waitFor();
  const updatedCompetencySummary=page.waitForResponse(response=>response.url().includes('action=competency-summary')&&response.status()===200);
  const updatedStudentReport=page.waitForResponse(response=>response.url().includes('action=report')&&response.status()===200);
  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  await Promise.all([updatedCompetencySummary,updatedStudentReport]);
  await matrixRow.waitFor();
  const after={communicative:await scorePair(cells.nth(2)),logical:await scorePair(cells.nth(3)),total:await scorePair(cells.nth(totalColumnIndex))};
  const close=(actual,expected)=>Math.abs(actual-expected)<0.001;
  assert(close(after.communicative.points-before.communicative.points,5)&&close(after.logical.points-before.logical.points,1.25)&&close(after.total.points-before.total.points,6.25),`la rúbrica reparte los puntos por competencia y el total añade cada criterio una sola vez: ${JSON.stringify({before,after})}`);
  assert(close(after.total.possible-before.total.possible,0),'el guardado de niveles no duplica los puntos posibles de la rúbrica');

  await page.getByRole('button',{name:/Libro de calificaciones/}).click();
  await page.waitForFunction(title=>[...document.querySelectorAll('.ledger-table thead tr:nth-child(2) th')].filter(header=>header.innerText.includes(title)).length>=2,rubricTitle);
  const rubricHeaderIndices=await page.locator('.ledger-table thead tr:nth-child(2) th').evaluateAll((headers,title)=>({
    explain:headers.findIndex(header=>header.innerText.includes(title+' · Explica el procedimiento')),
    solve:headers.findIndex(header=>header.innerText.includes(title+' · Resuelve el problema')),
  }),rubricTitle);
  assert(rubricHeaderIndices.explain>=0&&rubricHeaderIndices.solve>=0,'el libro muestra cada criterio de rúbrica bajo su competencia');
  const rubricLedgerRow=page.locator('.ledger-table tbody tr').filter({hasText:'Estudiante 5A 01'});
  const rubricExplain=await scorePair(rubricLedgerRow.locator('td').nth(2+rubricHeaderIndices.explain));
  const rubricSolve=await scorePair(rubricLedgerRow.locator('td').nth(2+rubricHeaderIndices.solve));
  assert(close(rubricExplain.points+rubricSolve.points,after.total.points-before.total.points)&&close(rubricExplain.possible+rubricSolve.possible,10),'los criterios del libro suman el puntaje de la rúbrica sin duplicar el máximo');

  const bonusColumnIndex=await page.locator('.ledger-category-table thead th').evaluateAll(headers=>headers.findIndex(header=>header.innerText.includes('Puntos extra')));
  const studentSummaryRow=page.locator('.ledger-category-table tbody tr').filter({hasText:'Estudiante 5A 01'});
  const bonusBefore=await scorePair(studentSummaryRow.locator('td').nth(bonusColumnIndex));
  await goActivities();
  await page.getByRole('button',{name:'Crear actividad',exact:true}).first().click();
  await page.getByLabel('Nombre de la actividad').fill(extraTitle);
  await page.getByLabel('Categoría de nota').selectOption('extra');
  await page.getByLabel('Máximo de la actividad').fill('5');
  await page.getByRole('button',{name:'Crear actividad'}).last().click();
  await page.getByText(extraTitle,{exact:true}).waitFor();
  await page.getByRole('button',{name:/Capturar notas/}).click();
  await chooseOption(selector,extraTitle);
  await page.getByLabel('Nota Estudiante 5A 01').fill('3');
  await page.getByRole('button',{name:'Guardar calificaciones'}).click();
  await page.getByText(/Calificaciones guardadas · 21 estudiantes/).waitFor();
  await page.getByRole('button',{name:/Libro de calificaciones/}).click();
  await ledgerRow.waitFor();
  await page.waitForFunction(title=>[...document.querySelectorAll('.ledger-table thead tr:nth-child(2) th')].some(header=>header.innerText.includes(title)),extraTitle);
  const bonusAfter=await scorePair(studentSummaryRow.locator('td').nth(bonusColumnIndex));
  assert(bonusColumnIndex>=0&&close(bonusAfter.points-bonusBefore.points,3)&&close(bonusAfter.possible-bonusBefore.possible,5),'el desarrollo mantiene los puntos extra aparte de las cinco categorías');
  await page.getByRole('button',{name:/Informe por estudiante/}).click();
  await page.getByText('Puntos extra',{exact:true}).first().waitFor();
  assert((await page.locator('.metrics').first().innerText()).includes(`${bonusAfter.points} / ${bonusAfter.possible}`),'el informe muestra los puntos extra obtenidos y posibles');

  await page.getByRole('button',{name:/Historial y respaldo/}).click();
  await page.getByRole('heading',{name:'Historial y respaldo'}).waitFor();
  await page.locator('.data-table tbody tr').first().waitFor();
  assert((await page.locator('.data-table tbody tr').count())>=4,'el historial refleja los guardados confirmados');

  await page.locator('.course-tabs button').filter({hasText:'5C'}).click();
  await goAttendance('Comportamiento');
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
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Tu clase comienza aquí.'}).waitFor();
  await page.screenshot({path:resolve(out,'inicio-movil.png'),fullPage:true});
  assert(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth+2),'inicio responsivo móvil sin desbordamiento horizontal');

  await page.setViewportSize({width:1440,height:1000});
  await page.goto(baseUrl,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Tu clase comienza aquí.'}).waitFor();
  await page.getByRole('button',{name:/Plan de evaluación/}).click();
  await page.getByRole('button',{name:/Editar plan/}).click();
  await page.getByLabel('Nombre del período').fill('P1');
  await page.getByRole('button',{name:'Guardar plan'}).click();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Período activo"]')?.value==='P1');
  assert(await page.getByLabel('Período activo').inputValue()==='P1','crear P1 conserva P2 y activa el periodo nuevo');
  await page.getByLabel('Período activo').selectOption('P2');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Período activo"]')?.value==='P2');
  await goActivities();
  await page.getByText(examTitle,{exact:true}).waitFor();
  assert(await page.locator('.activity-table tbody tr').filter({hasText:examTitle}).count()===1,'P2 muestra sus actividades al volver al período');
  await page.getByLabel('Período activo').selectOption('P1');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Período activo"]')?.value==='P1');
  await goActivities();
  await page.getByText('No hay actividades preparadas').waitFor();
  assert(await page.locator('.activity-table tbody tr').filter({hasText:examTitle}).count()===0,'P1 no mezcla la actividad guardada en P2');
  await page.getByLabel('Período activo').selectOption('P2');
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Período activo"]')?.value==='P2');

  if(errors.length)throw new Error('Errores del navegador: '+errors.join(' | '));
  console.log('PASS sin excepciones, errores HTTP 5xx ni fallos en consola');
} catch(error) {
  await page.screenshot({path:resolve(out,'fallo.png'),fullPage:true}).catch(()=>{});
  console.error('UI_FAILURE',error);
  if(errors.length)console.error('BROWSER_ERRORS',errors);
  process.exitCode=1;
} finally {await context.close();await browser.close();}


