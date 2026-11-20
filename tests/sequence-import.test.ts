import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestDatabase } from '../src/lib/db';
import { RegistroService } from '../src/lib/service';
import { proposeActivities, proposeSequenceFromPdfPages, suggestIndicatorIdsFromCompetencies, type PdfSequenceTextItem } from '../src/lib/sequence-import';

const item = (str: string, x: number, y: number): PdfSequenceTextItem => ({ str, x, y });

test('el importador de texto reconoce encabezados numerados en orden', () => {
  assert.deepEqual(proposeActivities('Actividad 1.1: Diagnóstico inicial\n2.1 — Suma de vectores'), [
    { code: '1.1', title: 'Diagnóstico inicial' },
    { code: '2.1', title: 'Suma de vectores' },
  ]);
});

test('una actividad de secuencia conserva su lista original y puede evaluarse otra vez en otro período',async()=>{
 const db=await createTestDatabase();
 try{
  const service=new RegistroService(db,{demo:true,today:()=> '2026-11-15'});
  const owner='sequence-repeat-evaluation';
  const bootstrap=await service.bootstrap(owner);
  const course=bootstrap.courses.find(item=>item.code==='5A')!;
  const sequenceActivity={id:'vector-sum',code:'2.2',theme:'Suma de vectores',title:'Suma de vectores: método extremo–origen',lessonType:null,description:'Suma gráfica de vectores.',evidence:'',indicatorIds:['vector-indicator'],period:'P2',plannedPoints:5,plannedPercent:null,evaluationPurpose:'formativa' as const};
  const sequence={source:'uploaded' as const,sourceName:'secuencia.pdf',sourceText:'',reviewed:true,activePlanningPeriod:'P2' as const,periodAssignments:[{activityId:sequenceActivity.id,period:'P1' as const},{activityId:sequenceActivity.id,period:'P2' as const}],activities:[sequenceActivity],indicators:[{id:'vector-indicator',code:'I2',label:'Resuelve operaciones con vectores.',competency:'logico_matematica' as const}]};
  await service.saveCurriculumSequence(owner,sequence);
  const saved=(await service.bootstrap(owner)).curriculumSequence!;
  assert.deepEqual(saved.periodAssignments,sequence.periodAssignments,'la lista de varios períodos persiste en la secuencia');
  await service.updatePlan(owner,{...bootstrap.plan,period:'P1',startDate:'2026-10-20',endDate:'2026-11-01',sequence:undefined});
  await service.activatePlan(owner,'P1');
  const first=(await service.createSharedActivity(owner,{courseIds:[course.id],activity:{category:'sequence',title:sequenceActivity.title,date:'2026-10-27',maxPoints:5,sequenceActivityId:sequenceActivity.id,requestId:'vector-evaluation-p1'}}))[0]!;
  assert.equal(first.sequencePlannedPeriod,'P1');
  await service.activatePlan(owner,'P2');
  const second=(await service.createSharedActivity(owner,{courseIds:[course.id],activity:{category:'sequence',title:sequenceActivity.title,date:'2026-11-15',maxPoints:5,sequenceActivityId:sequenceActivity.id,requestId:'vector-evaluation-p2'}}))[0]!;
  assert.equal(second.sequenceActivityId,first.sequenceActivityId,'la segunda evaluación conserva el vínculo con la misma actividad de secuencia');
  assert.equal(second.period,'P2');
  assert.equal(second.sequencePlannedPeriod,'P2','cada repetición conserva el período donde se agregó sin mover la evaluación anterior');
  assert.equal((await service.bootstrap(owner)).activities.filter(item=>item.sequenceActivityId===sequenceActivity.id).length,2);
  await assert.rejects(service.saveCurriculumSequence(owner,{...sequence,periodAssignments:[...sequence.periodAssignments,{activityId:sequenceActivity.id,period:'P2'}]}),/repetida en la misma lista/);
 }finally{await db.close();}
});

test('las competencias explícitas del anexo proponen indicadores únicos y dejan sin asignar I6 o relaciones ambiguas', () => {
  const indicators = [
    { id: 'i1', competency: 'comunicativa' as const },
    { id: 'i2', competency: 'logico_matematica' as const },
    { id: 'i3', competency: 'resolucion' as const },
    { id: 'i4', competency: 'etica_ciudadana' as const },
    { id: 'i5', competency: 'cientifica_tecnologica' as const },
    { id: 'i6', competency: null },
    { id: 'i7', competency: 'desarrollo_personal' as const },
  ];
  assert.deepEqual(suggestIndicatorIdsFromCompetencies('resolución de problemas; comunicativa; pensamiento lógico, creativo y crítico.', indicators), ['i1', 'i2', 'i3']);
  assert.deepEqual(suggestIndicatorIdsFromCompetencies('científica y tecnológica; resolución de problemas; comunicativa.', indicators), ['i1', 'i3', 'i5']);
  assert.deepEqual(suggestIndicatorIdsFromCompetencies('competencia ambiental y de la salud', indicators), []);

  const ambiguous = [indicators[0]!, indicators[1]!, { id: 'i2-extra', competency: 'logico_matematica' as const }];
  assert.deepEqual(suggestIndicatorIdsFromCompetencies('comunicativa; pensamiento lógico', ambiguous), ['i1']);
});

test('el importador PDF reconstruye actividades y mantiene sus columnas asociadas', () => {
  const page = [
    item('Secuencia: Vectores', 40, 700), item('Período: 1.er período / septiembre - octubre 2026', 200, 700),
    item('1.', 539, 400), item('Emplea lenguaje matemático para operar vectores.', 557, 400),
    item('2.', 539, 300), item('Aplica razonamientos matemáticos correctos.', 557, 300),
    item('3.', 539, 200), item('Resuelve problemas de vectores.', 557, 200),
    item('4.', 539, 100), item('Justifica procesos matemáticos.', 557, 100),
    item('5.', 539, 0), item('Aplica herramientas y software tecnológicos.', 557, 0),
    item('6.', 539, -100), item('Integra la tecnología en los procesos matemáticos.', 557, -100),
    item('7.', 539, -200), item('Interpreta situaciones y respeta aportes.', 557, -200),
  ];
  const activityPage = [
    item('1', 40, 500), item('Actividad 1.1', 66, 500),
    item('Situación del robot:', 66, 494), item('datos y recorrido', 66, 488),
    item('Respuesta inicial', 186, 500), item('esquema y explicación', 186, 494), item('oral/escrita', 186, 488),
    item('• Identifica orientación', 297, 500), item('• Propone datos pertinentes', 297, 494), item('• Representa el recorrido', 297, 488),
    item('Lista de cotejo', 436, 500), item('diagnóstica', 436, 494), item('Anexo 1', 436, 488),
    item('D', 570, 500), item('(diagnóstica)', 574, 500), item('0% (diagnóstica)', 608, 500), item('fuera de nota', 612, 500), item('Preguntas guía', 667, 500), item('no se califica', 667, 494), item('ideas previas', 667, 488),
    item('2', 40, 450), item('Actividad 1.2', 66, 450),
    item('Clasificación de vectores', 66, 444), item('iguales y opuestos.', 66, 438),
    item('Diagrama anotado', 186, 450), item('y justificación escrita', 186, 444), item('en el cuaderno', 186, 438),
    item('• Compara dirección y módulo', 297, 450), item('• Distingue vectores opuestos', 297, 444), item('• Usa vocabulario correcto', 297, 438),
    item('Rúbrica breve', 436, 450), item('de clasificación', 436, 444), item('Anexo 2', 436, 438),
    item('F', 570, 450), item('(formativa)', 574, 450), item('5 puntos', 608, 450), item('de la actividad', 612, 450), item('Corrección dialogada', 667, 450), item('de confusiones', 667, 444), item('con ejemplos', 667, 438),
  ];
  const result = proposeSequenceFromPdfPages([page, activityPage]);
  assert.equal(result.theme, 'Vectores');
  assert.equal(result.period, 'P1');
  assert.deepEqual(result.activities.map(({ code, title }) => ({ code, title })), [
    { code: '1.1', title: 'Situación del robot: datos y recorrido' },
    { code: '1.2', title: 'Clasificación de vectores iguales y opuestos.' },
  ]);
  assert.equal(result.activities[0].evidence, 'Respuesta inicial esquema y explicación oral/escrita');
  assert.deepEqual(result.activities[1].evaluationCriteria, ['Compara dirección y módulo', 'Distingue vectores opuestos', 'Usa vocabulario correcto']);
  assert.equal(result.activities[1].instrument, 'Rúbrica breve de clasificación Anexo 2');
  assert.equal(result.activities[0].evaluationPurpose, 'diagnostica');
  assert.equal(result.activities[1].evaluationPurpose, 'formativa');
  assert.equal(result.activities[1].plannedPoints, 5);
  assert.equal(result.activities[0].plannedPercent, 0);
  assert.equal(result.activities[1].feedback, 'Corrección dialogada de confusiones con ejemplos');
  assert.equal(result.indicators.length, 7);
  assert.equal(result.indicators[0].label.startsWith('1.'), false);
  assert.equal(result.indicators[5].competency, null);
});

test('el importador PDF no mezcla la evaluación final con la última actividad', () => {
  const page = [
    item('11', 40, 506), item('Actividad 7.2', 62, 506), item('Recta que no pasa por el origen y', 62, 498), item('ecuación paramétrica.', 62, 491),
    item('Gráfico', 183, 506), item('desarrollo de ecuaciones', 183, 498), item('comprobación', 183, 491),
    item('• Identifica punto inicial', 294, 506), item('• Construye ecuación', 294, 498), item('• Verifica coordenadas', 294, 491),
    item('Rúbrica de ecuación', 432, 506), item('y comprobación', 432, 498), item('Anexo 11', 432, 491),
    item('F/S', 567, 498), item('formativa sumativa', 577, 498), item('sumativa también', 580, 491), item('10 puntos', 618, 498), item('de la actividad', 622, 498), item('correspondiente', 622, 491), item('Retroalimentación sobre elección', 664, 506), item('del vector dirección', 664, 498), item('y parámetro', 664, 491),
    item('Cierre', 33, 449), item('Evaluación final individual de la', 62, 457), item('secuencia Vectores', 62, 449),
    item('Prueba escrita con conceptos,', 183, 464), item('clasificación, operaciones', 183, 457), item('valor 10 puntos del período', 618, 453),
  ];
  const result = proposeSequenceFromPdfPages([page]);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].code, '7.2');
  assert.equal(result.activities[0].title, 'Recta que no pasa por el origen y ecuación paramétrica.');
  assert.equal(result.activities[0].evidence, 'Gráfico desarrollo de ecuaciones comprobación');
  assert.equal(result.activities[0].plannedPoints, 10);
  assert.equal(result.activities[0].feedback.includes('Evaluación final'), false);
  assert.equal(result.activities[0].evidence.includes('Prueba escrita'), false);
});

test('la secuencia conserva anexos diagnósticos, escalas variables y el examen final separado', () => {
  const page = [
    item('ANEXO 1. Lista de cotejo diagnóstica – Actividad 1.1: movimiento del robot', 32, 700),
    item('Indicador relacionado: emplea lenguaje matemático inicial para describir el desplazamiento. Competencias: resolución de problemas; comunicativa;', 32, 690),
    item('pensamiento lógico, creativo y crítico.', 32, 686),
    item('Criterio de evaluación', 246, 680),
    item('Reconoce hacia dónde se moverá el robot.', 117, 668),
    item('Propone información para programar el movimiento.', 117, 656),
    item('Representa el recorrido con un esquema.', 117, 644),
    item('Explica su estrategia.', 117, 632),
    item('Escucha a su pareja.', 117, 620),
    item('Registro: Sí / En proceso / No. Uso diagnóstico; no se pondera.', 32, 608),
    item('ANEXO 2. Rúbrica breve – Actividad 1.2: clasificación de vectores', 32, 590),
    item('Indicadores relacionados: emplea notación para diferenciar vectores. Competencias: comunicativa;', 32, 580),
    item('pensamiento lógico, creativo y crítico.', 32, 576),
    item('Criterio de evaluación', 246, 570),
    item('Compara dirección, sentido y módulo.', 117, 558),
    item('Clasifica los vectores.', 117, 546),
    item('Representa los vectores.', 117, 534),
    item('Justifica la clasificación.', 117, 522),
    item('Usa notación correcta.', 117, 510),
    item('Puntaje sugerido: 5 puntos. Cada criterio vale 1 punto: logrado = 1; parcialmente logrado = 0.5; no logrado = 0.', 32, 498),
    item('ANEXO 3. Rúbrica analítica – Actividad 2.1: aspiradora robot', 32, 480),
    item('Criterio de evaluación', 246, 460),
    item('Representa desplazamientos en orden.', 117, 448),
    item('Dibuja flechas coherentes.', 117, 436),
    item('Representa el desplazamiento directo.', 117, 424),
    item('Relaciona recorrido y suma.', 117, 412),
    item('Justifica el procedimiento.', 117, 400),
    item('Puntaje sugerido: 10 puntos. Cada criterio se valora de 0 a 2: 2 = correcto y justificado; 1 = parcial; 0 = no evidencia.', 32, 388),
    item('ANEXO 6. Rúbrica – Actividad 3: Escher y producto por escalar', 32, 370),
    item('Criterio de evaluación', 246, 350),
    item('Relaciona lectura y experiencia.', 117, 338),
    item('Describe desplazamientos.', 117, 326),
    item('Dibuja vectores.', 117, 314),
    item('Distingue escalares.', 117, 302),
    item('Argumenta y participa.', 117, 290),
    item('Puntaje sugerido: 10 puntos. Cada criterio vale 0–2: 2 = logrado; 1 = parcialmente logrado; 0 = no logrado.', 32, 278),
    item('ANEXO 12. Escala de valoración – evaluación final individual', 32, 260),
    item('Criterio de evaluación', 246, 240),
    item('Define y clasifica vectores.', 117, 228),
    item('Resuelve operaciones.', 117, 216),
    item('Representa vectores y módulos.', 117, 204),
    item('Modela una recta.', 117, 192),
    item('Justifica sus resultados.', 117, 180),
    item('Prueba escrita: 100 puntos internos, distribuidos por ejercicios. Para el registro del período, esta evidencia aporta 10 puntos.', 32, 168),
  ];
  const sequencePage = [
    item('Secuencia: Vectores', 40, 700), item('Período: 1.er período', 200, 700),
    item('1.', 539, 400), item('Emplea lenguaje matemático para operar vectores.', 557, 400),
    item('2.', 539, 300), item('Aplica razonamientos matemáticos correctos.', 557, 300),
    item('3.', 539, 200), item('Resuelve problemas de vectores.', 557, 200),
    item('4.', 539, 100), item('Justifica procesos matemáticos.', 557, 100),
    item('5.', 539, 0), item('Aplica herramientas tecnológicas.', 557, 0),
    item('6.', 539, -100), item('Integra la tecnología.', 557, -100),
    item('7.', 539, -200), item('Interpreta situaciones.', 557, -200),
  ];
  const activityPage = [
    item('1', 40, 500), item('Actividad 1.1', 66, 500), item('Diagnóstico del robot', 66, 494),
    item('Respuesta inicial', 186, 500), item('esquema y explicación', 186, 494),
    item('• Identifica orientación', 297, 500), item('• Propone datos', 297, 494),
    item('Lista de cotejo', 436, 500), item('diagnóstica', 436, 494),
    item('D', 570, 500), item('diagnóstica', 574, 500), item('0% (diagnóstica)', 608, 500),
    item('Preguntas guía', 667, 500), item('2', 40, 450), item('Actividad 1.2', 66, 450),
    item('Clasificación de vectores', 66, 444), item('Diagrama', 186, 450),
    item('• Compara dirección', 297, 450), item('Rúbrica breve', 436, 450),
    item('F', 570, 450), item('formativa', 574, 450), item('5 puntos', 608, 450),
    item('Corrección dialogada', 667, 450),
    item('3', 40, 400), item('Actividad 2.1', 66, 400), item('Aspiradora robot', 66, 394),
    item('Desplazamientos', 186, 400), item('y justificación', 186, 394),
    item('• Representa en orden', 297, 400), item('Rúbrica analítica', 436, 400),
    item('S', 570, 400), item('sumativa', 574, 400), item('10 puntos', 608, 400), item('Retroalimentación', 667, 400),
    item('4', 40, 350), item('Actividad 3', 66, 350), item('Escher y producto por escalar', 66, 344),
    item('Análisis escrito', 186, 350), item('y representación', 186, 344),
    item('• Distingue escalares', 297, 350), item('Rúbrica', 436, 350),
    item('S', 570, 350), item('sumativa', 574, 350), item('10 puntos', 608, 350), item('Comentarios', 667, 350),
  ];
  const result = proposeSequenceFromPdfPages([sequencePage, activityPage, page]);
  const diagnostic = result.activities.find(activity => activity.code === '1.1')?.assessmentInstrument;
  assert.equal(diagnostic?.kind, 'checklist');
  assert.equal(diagnostic?.scored, false);
  assert.equal(diagnostic?.maxPoints, null);
  assert.equal(diagnostic?.relatedIndicatorText, 'emplea lenguaje matemático inicial para describir el desplazamiento.');
  assert.equal(diagnostic?.relatedCompetencyText, 'resolución de problemas; comunicativa; pensamiento lógico, creativo y crítico.');
  assert.equal(diagnostic?.criteria.length, 5);
  const halfPoint = result.activities.find(activity => activity.code === '1.2')?.assessmentInstrument;
  assert.equal(halfPoint?.maxPoints, 5);
  assert.equal(halfPoint?.relatedIndicatorText, 'emplea notación para diferenciar vectores.');
  assert.equal(halfPoint?.relatedCompetencyText, 'comunicativa; pensamiento lógico, creativo y crítico.');
  assert.deepEqual(halfPoint?.levels.map(level => level.points), [0, 0.5, 1]);
  assert.equal(halfPoint?.criteria.length, 5);
  const twoPoint = halfPoint ? result.activities.find(activity => activity.code === '2.1')?.assessmentInstrument : undefined;
  assert.deepEqual(twoPoint?.levels.map(level => level.points), [0, 1, 2]);
  const threePoint = result.activities.find(activity => activity.code === '3')?.assessmentInstrument;
  assert.equal(threePoint?.levels.length, 3);
  assert.equal(result.finalAssessment?.internalMaxPoints, 100);
  assert.equal(result.finalAssessment?.periodPoints, 10);
  assert.equal(result.finalAssessment?.instrument.criteria.length, 5);
});

test('la revisión conserva los datos estructurados de cada actividad al guardar y volver a leer la base', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, today: () => '2026-11-15' });
    const owner = 'sequence-import-roundtrip';
    await service.bootstrap(owner);
    const proposal = {
      source: 'uploaded', sourceName: 'secuencia-p1.pdf', sourceText: 'Contenido del PDF', reviewed: true,
      indicators: [{ id: 'i1', code: 'I1', label: 'Usa lenguaje matemático.', competency: 'comunicativa' }],
      activities: [{
        id: 'a1', code: '1.1', theme: 'Vectores', title: 'Situación del robot', lessonType: null,
        description: '', evidence: 'Esquema y explicación', indicatorIds: ['i1'], period: 'P2',
        evaluationPurpose: 'diagnostica', plannedPoints: null, plannedPercent: 0,
        instrument: 'Lista de cotejo', evaluationCriteria: ['Identifica el recorrido.', 'Explica la estrategia.'],
        feedback: 'Aclaración de ideas previas.',
        assessmentInstrument: { annexNumber: 1, title: 'Lista de cotejo diagnóstica', kind: 'checklist', criteria: ['Identifica el recorrido.'], levels: [], maxPoints: null, scoringNote: 'Uso diagnóstico; no se pondera.', scored: false, relatedIndicatorText: 'Emplea lenguaje matemático inicial.', relatedCompetencyText: 'resolución de problemas; comunicativa.' },
      }],
      finalAssessment: { title: 'Evaluación final individual', period: 'P1', internalMaxPoints: 100, periodPoints: 10, instrument: { annexNumber: 12, title: 'Escala de valoración – evaluación final individual', kind: 'exam_guide', criteria: ['Resuelve operaciones.'], levels: [], maxPoints: null, scoringNote: '100 internos; aporta 10 puntos.', scored: true } },
    };
    await service.saveCurriculumSequence(owner, proposal);
    const saved = (await service.bootstrap(owner)).curriculumSequence;
    assert.ok(saved?.reviewed);
    assert.deepEqual(saved.activities[0], proposal.activities[0]);
    assert.deepEqual(saved.indicators[0], proposal.indicators[0]);
    assert.deepEqual(saved.finalAssessment, proposal.finalAssessment);
    const courses = (await service.bootstrap(owner)).courses;
    await assert.rejects(service.createSharedActivity(owner, {
      courseIds: courses.map(course => course.id),
      activity: { category: 'sequence', title: 'No calificar diagnóstico', date: '2026-11-15', maxPoints: 10, sequenceCode: '1.1', requestId: 'diagnostic-zero-rejection' },
    }), /diagnóstica sin ponderación/);
  } finally {
    await db.close();
  }
});

test('separa el catálogo de indicadores, activa períodos de planificación sin mover la captura y valida la competencia al calificar', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, today: () => '2026-11-15' });
    const owner = 'unclassified-unused-indicator';
    const bootstrap = await service.bootstrap(owner);
    const unresolvedId = 'indicator-i6-unresolved';
    const sequence = {
      source: 'uploaded' as const, sourceName: 'secuencia.pdf', sourceText: '', reviewed: true, activePlanningPeriod: 'P2' as const,
      indicators: [
        { id: 'indicator-i1', code: 'I1', label: 'Usa razonamiento matemático.', competency: 'logico_matematica' as const },
        { id: unresolvedId, code: 'I6', label: 'Integra la tecnología.', competency: null },
      ],
      activities: [{ id: 'sequence-1-1', code: '1.1', theme: 'Vectores', title: 'Exploración inicial', lessonType: null, description: 'Exploración de conceptos iniciales.', evidence: '', indicatorIds: [], period: '' }],
    };

    const saved = await service.saveCurriculumSequence(owner, sequence);
    assert.equal(saved.reviewed, true, 'un indicador no usado no debe bloquear la secuencia completa');
    assert.equal(saved.indicators.find(item => item.id === unresolvedId)?.competency, null, 'no se inventa la competencia pendiente');
    assert.equal(saved.activities[0]?.indicatorIds.length, 0, 'la revisión de secuencia no asigna indicadores a una actividad evaluable');
    assert.equal(saved.activePlanningPeriod, 'P2', 'el período de planificación queda guardado en la secuencia');
    assert.equal((await service.bootstrap(owner)).plan.period, bootstrap.plan.period, 'activar el período de planificación no cambia el período activo de captura');

    const created = await service.createSharedActivity(owner, {
      courseIds: [bootstrap.courses[0]!.id],
      activity: { category: 'sequence', title: 'Actividad vinculada', date: '2026-11-15', maxPoints: 5, sequenceActivityId: 'sequence-1-1', requestId: 'create-unresolved-indicator-test' },
    });
    await assert.rejects(service.configureActivityEvaluation(owner, {
      requestId: 'configure-unresolved-indicator-test', activityId: created[0]!.id, revision: created[0]!.revision,
      scoringMode: 'points', instrument: 'Puntaje directo', manualIndicators: [],
      indicatorPoints: [{ indicatorId: unresolvedId, points: 5 }], rubric: [],
    }), /Asigna una competencia al indicador/);

    const savedWithoutIndicatorAssignment = await service.saveCurriculumSequence(owner, {
      ...saved,
      activePlanningPeriod: 'P3',
      activities: [{ ...saved.activities[0]!, indicatorIds: [] }],
    });
    assert.equal(savedWithoutIndicatorAssignment.activePlanningPeriod, 'P3', 'se puede cambiar el período activo para distribuir la secuencia');
  } finally {
    await db.close();
  }
});

test('el modo sin secuencia se conserva y habilita la captura manual de actividades', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, today: () => '2026-11-15' });
    const owner = 'manual-activity-workflow';
    await service.bootstrap(owner);
    const manualMode = await service.saveCurriculumSequence(owner, { source: 'manual', sourceName: '', sourceText: '', reviewed: false, planningMode: 'manual', activities: [], indicators: [] });
    assert.equal(manualMode.planningMode, 'manual');
    assert.equal(manualMode.reviewed, false, 'La decisión de no usar secuencia no debe fingir una revisión aprobada.');
    assert.deepEqual(manualMode.activities, []);
    assert.equal((await service.bootstrap(owner)).curriculumSequence?.planningMode, 'manual');
  } finally {
    await db.close();
  }
});

test('el servicio guarda, valida y calcula una rúbrica fuente de tres niveles sin enviarla al catálogo global', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, today: () => '2026-11-15' });
    const owner = 'source-rubric-variable-levels';
    const bootstrap = await service.bootstrap(owner);
    const course = bootstrap.courses[0];
    const criteria = ['Compara dirección, sentido y módulo.', 'Clasifica los vectores.', 'Representa los vectores.', 'Justifica la clasificación.', 'Usa notación correcta.'];
    const levels = [
      { label: 'No logrado', points: 0, description: 'no logrado' },
      { label: 'Parcialmente logrado', points: 0.5, description: 'parcialmente logrado' },
      { label: 'Logrado', points: 1, description: 'logrado' },
    ];
    const sequenceActivity = { id: 'activity-1-2', code: '1.2', theme: 'Vectores', title: 'Clasificación de vectores', lessonType: 'ejercicios' as const, description: '', evidence: 'Diagrama', indicatorIds: ['indicator-1'], period: 'P2', evaluationPurpose: 'formativa' as const, plannedPoints: 5, plannedPercent: null, instrument: 'Rúbrica breve · Anexo 2', evaluationCriteria: criteria, feedback: '', assessmentInstrument: { annexNumber: 2, title: 'Rúbrica breve – Actividad 1.2', kind: 'rubric' as const, criteria, levels, maxPoints: 5, scoringNote: 'Cada criterio vale 1 punto: logrado=1; parcialmente logrado=0.5; no logrado=0.', scored: true } };
    await service.saveCurriculumSequence(owner, { source: 'uploaded', sourceName: 'secuencia.pdf', sourceText: '', reviewed: true, activities: [sequenceActivity], indicators: [{ id: 'indicator-1', code: 'I2', label: 'Aplica razonamientos matemáticos.', competency: 'logico_matematica' }] });
    const created = await service.createSharedActivity(owner, { courseIds: [course.id], activity: { category: 'sequence', title: 'Clasificación de vectores', date: '2026-11-15', maxPoints: 5, sequenceCode: '1.2', sequenceActivityId: sequenceActivity.id, requestId: 'variable-levels-create' } });
    const activity = created[0];
    const rubric = criteria.map((label, index) => ({ id: `sequence:${sequenceActivity.id}:${index + 1}`, label: index===0?'Compara correctamente dirección, sentido y módulo.':label, indicatorId: 'indicator-1', weight: 1, levels: levels.map((level,levelIndex)=>({...level,description:levelIndex===2&&index===0?'Logrado con explicación clara.':level.description})) }));
    const configured = await service.configureActivityEvaluation(owner, { requestId: 'variable-levels-configure', activityId: activity.id, revision: activity.revision, scoringMode: 'rubric', instrument: sequenceActivity.assessmentInstrument.title, indicatorPoints: [{ indicatorId: 'indicator-1', points: 5 }], rubric });
    assert.equal(configured[0].rubric.length, 5);
    assert.equal(configured[0].rubric[0].label,'Compara correctamente dirección, sentido y módulo.','el docente puede ajustar el criterio importado antes de confirmar la matriz');
    assert.equal(configured[0].rubric[0].levels[2]?.description,'Logrado con explicación clara.','el docente puede adaptar el descriptor sin romper el vínculo con el anexo');
    assert.deepEqual(configured[0].rubric[0].levels.map(level => level.points), [0, 0.5, 1]);
    assert.equal((await service.bootstrap(owner)).criteriaCatalog.length, 0, 'los criterios del anexo no contaminan el catálogo reutilizable de cuatro niveles');
    const row = (await service.grades(owner, activity.id)).rows[0];
    const criterionLevels = Object.fromEntries(rubric.map(item => [item.id, 1]));
    await service.saveGrades(owner, { requestId: 'variable-levels-grade', activityId: activity.id, revision: configured[0].revision, rows: [{ studentId: row.studentId, score: null, criterionLevels }] });
    const saved = (await service.grades(owner, activity.id)).rows.find(item => item.studentId === row.studentId);
    assert.equal(saved?.score, 2.5);
    await assert.rejects(service.saveGrades(owner, { requestId: 'variable-levels-out-of-range', activityId: activity.id, revision: configured[0].revision + 1, rows: [{ studentId: row.studentId, score: null, criterionLevels: Object.fromEntries(rubric.map(item => [item.id, 3])) }] }), /nivel elegido.*no existe/);
  } finally {
    await db.close();
  }
});

test('una matriz de actividad conserva su escala propia de cinco niveles y llega al mismo registro de notas', async () => {
  const db = await createTestDatabase();
  try {
    const service = new RegistroService(db, { demo: true, today: () => '2026-11-15' });
    const owner = 'activity-specific-five-level-matrix';
    const bootstrap = await service.bootstrap(owner);
    const course = bootstrap.courses.find(item => item.code === '5A')!;
    await service.saveCurriculumSequence(owner, { source: 'manual', sourceName: '', sourceText: '', reviewed: false, planningMode: 'manual', activities: [], indicators: [] });

    const created = (await service.createSharedActivity(owner, {
      courseIds: [course.id],
      activity: { category: 'sequence', title: 'Matriz de niveles propios', date: '2026-11-15', maxPoints: 10, scoringMode: 'rubric', rubric: [], requestId: 'activity-five-levels-create' },
    }))[0]!;
    const indicatorId = 'manual:indicator-1';
    const criterionId = `activity:${created.sharedId ?? created.id}:criterion:1`;
    const levels = [
      { label: 'Preformal', points: 1, description: 'No identifica el procedimiento.' },
      { label: 'Receptivo', points: 2, description: 'Reconoce los datos con ayuda.' },
      { label: 'Resolutivo', points: 3, description: 'Resuelve el ejercicio con apoyo.' },
      { label: 'Autónomo', points: 4, description: 'Resuelve con procedimiento correcto.' },
      { label: 'Estratégico', points: 5, description: 'Resuelve, verifica y justifica.' },
    ];
    const configured = (await service.configureActivityEvaluation(owner, {
      requestId: 'activity-five-levels-configure',
      activityId: created.id,
      revision: created.revision,
      scoringMode: 'rubric',
      instrument: 'Escala de logro de cinco niveles',
      manualIndicators: [{ id: indicatorId, code: 'I1', label: 'Resuelve y justifica el procedimiento.', competency: 'logico_matematica' }],
      indicatorPoints: [{ indicatorId, points: 10 }],
      rubric: [{ id: criterionId, label: 'Resolución y justificación', indicatorId, weight: 2, levels }],
    }))[0]!;

    assert.deepEqual(configured.rubric[0]?.levels.map(level => [level.label, level.points]), levels.map(level => [level.label, level.points]));
    assert.equal((await service.bootstrap(owner)).criteriaCatalog.length, 0, 'la escala de esta actividad no altera el catálogo reutilizable');
    const rows = (await service.grades(owner, created.id)).rows;
    await service.saveGrades(owner, {
      requestId: 'activity-five-levels-grade',
      activityId: created.id,
      revision: configured.revision,
      rows: [{ studentId: rows[0]!.studentId, score: null, criterionLevels: { [criterionId]: 4 } }],
    });
    const saved = (await service.grades(owner, created.id)).rows.find(item => item.studentId === rows[0]!.studentId);
    assert.equal(saved?.score, 10, 'el nivel estratégico se escala al máximo de diez de la actividad');
  } finally {
    await db.close();
  }
});
