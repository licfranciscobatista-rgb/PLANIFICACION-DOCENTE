import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createTestDatabase, initializeDatabase } from '../src/lib/db';
import { RegistroService } from '../src/lib/service';
import type { Activity, Course, EvaluationCriterion, EvaluationPlan, RubricLevel, SequencePlan } from '../src/lib/model';

const root=path.resolve('.local');
const directory=path.join(root,`complete-flow-${randomUUID()}`);
const databasePath=path.join(directory,'postgres');
const owner='complete-flow-teacher';
let service:RegistroService;
let db:Awaited<ReturnType<typeof createTestDatabase>>;

before(async()=>{await mkdir(directory,{recursive:true});db=await createTestDatabase(databasePath);service=new RegistroService(db,{demo:true,today:()=> '2026-11-15'});});
after(async()=>{await db?.close();const resolved=path.resolve(directory);assert.ok(resolved.startsWith(root+path.sep));assert.ok(path.basename(resolved).startsWith('complete-flow-'));await rm(resolved,{recursive:true,force:true});});

test('curso, horario, secuencia, catálogo, valoración por indicador y notas siguen un único flujo persistente',async()=>{
 const initial=await service.bootstrap(owner);
 assert.deepEqual(initial.courses.map(course=>course.code).sort(),['5A','5B','5C']);
 const custom=await service.createCourse(owner,{code:'6X',name:'Sexto X · Matemática',startDate:'2026-11-16',endDate:'2026-11-30',weekly:[{weekday:1,blocks:[2]},{weekday:3,blocks:[4]}],noClassDates:['2026-11-23']});
 assert.equal(custom.code,'6X');assert.equal(custom.students.length,0);
 const register=await service.registerSummary(owner,custom.id);
 assert.deepEqual(register.sessions.map(item=>`${item.date}:${item.block}`),['2026-11-16:2','2026-11-18:4','2026-11-25:4','2026-11-30:2']);
 assert.equal((await service.attendance(owner,custom.id,'2026-11-16',2)).session.scheduled,true);
 assert.equal((await service.attendance(owner,custom.id,'2026-11-23',2)).session.scheduled,false);

 const courses=(await service.bootstrap(owner)).courses.filter(course=>['5A','5B','5C'].includes(course.code));
 const period=(await service.bootstrap(owner)).plan;
 const indicatorOne={id:'ind-vector-components',code:'I1',label:'Representa los componentes de un vector',competency:'logico_matematica' as const};
 const indicatorTwo={id:'ind-vector-result',code:'I2',label:'Justifica la resultante',competency:'resolucion' as const};
 const sequence:SequencePlan={source:'manual',sourceName:'',sourceText:'',reviewed:true,indicators:[indicatorOne,indicatorTwo],activities:[{id:'seq-vector-21',code:'2.1',theme:'Vectores',title:'Suma de vectores',lessonType:'ejercicios',description:'Representación y suma',evidence:'Procedimiento y respuesta',indicatorIds:[indicatorOne.id,indicatorTwo.id]}]};
 await service.savePlanSequence(owner,period.period,sequence);
 assert.equal((await service.bootstrap(owner)).plan.sequence?.reviewed,true);

 const levels:RubricLevel[]=[{label:'Insuficiente',points:1,description:'No logra el desempeño.'},{label:'Suficiente',points:2,description:'Lo logra parcialmente.'},{label:'Bueno',points:3,description:'Lo logra correctamente.'},{label:'Excelente',points:4,description:'Lo logra y lo justifica.'}];
 const criterionA=await service.saveEvaluationCriterion(owner,{label:'Precisión del procedimiento',levels}) as EvaluationCriterion;
 const criterionB=await service.saveEvaluationCriterion(owner,{label:'Justificación matemática',levels}) as EvaluationCriterion;
 assert.equal((await service.bootstrap(owner)).criteriaCatalog.length,2);
 const criterionValues=await db.query('SELECT level_position,level_label,points,descriptor FROM evaluation_criterion_values WHERE owner_id=$1 AND criterion_id=$2 ORDER BY level_position',[owner,criterionA.id]);
 assert.deepEqual(criterionValues.rows.map(row=>[Number(row.level_position),row.level_label,Number(row.points),row.descriptor]),levels.map((level,index)=>[index+1,level.label,level.points,level.description]),'el catálogo guarda cada valoración/descripción como fila enlazada al criterio');

 const shared=await service.createSharedActivity(owner,{courseIds:courses.map(course=>course.id),activity:{category:'sequence',title:'Práctica de suma de vectores',date:'2026-11-16',maxPoints:10,sequenceCode:'2.1',description:'Resuelve y explica',evidence:'Procedimiento',requestId:randomUUID()}});
 assert.equal(shared.length,3);assert.equal(new Set(shared.map(item=>item.sharedId)).size,1);
 const first=shared.find(item=>item.courseId===courses.find(course=>course.code==='5A')!.id)!;
 const rubric:Activity['rubric']=[
  {id:criterionA.id,label:criterionA.label,indicatorId:indicatorOne.id,weight:1,levels:criterionA.levels,competency:indicatorOne.competency},
  {id:criterionB.id,label:criterionB.label,indicatorId:indicatorTwo.id,weight:1,levels:criterionB.levels,competency:indicatorTwo.competency},
 ];
 const staleClientRubric=rubric.map(item=>({...item,label:'Texto local desactualizado',levels:item.levels.map(level=>({...level,description:'Texto local que no debe reemplazar el catálogo.'}))}));
 await service.configureActivityEvaluation(owner,{requestId:randomUUID(),activityId:first.id,revision:first.revision,scoringMode:'rubric',instrument:'Rúbrica analítica',indicatorPoints:[{indicatorId:indicatorOne.id,points:6},{indicatorId:indicatorTwo.id,points:4}],rubric:staleClientRubric,applyToActivityIds:shared.filter(item=>item.id!==first.id).map(item=>item.id)});
 let configured=(await service.bootstrap(owner)).activities.filter(item=>item.sharedId===first.sharedId);
 assert.equal(configured.length,3);assert.equal(configured.filter(item=>item.scoringMode==='rubric'&&item.rubric.length===2&&item.indicatorPoints.length===2).length,3,'al crear una actividad compartida, su matriz inicial queda lista para la lista completa de cada curso');
 assert.deepEqual(configured.find(item=>item.courseId===first.courseId)!.rubric.map(item=>[item.label,item.levels[0].description]),[[criterionA.label,levels[0].description],[criterionB.label,levels[0].description]],'el servidor trae nombre y descriptores vigentes del catálogo al colocar los criterios en la actividad');
 for(const configuredActivity of configured.filter(item=>item.courseId===first.courseId)){
  const assignments=await db.query('SELECT criterion_key,catalog_criterion_id,indicator_id,position,levels_snapshot FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2 ORDER BY position',[owner,configuredActivity.id]);
  assert.equal(assignments.rows.length,2,'cada copia por curso recibe los criterios de la misma actividad');
  assert.deepEqual(assignments.rows.map(row=>[row.criterion_key,row.catalog_criterion_id,row.indicator_id,Number(row.position)]),[[criterionA.id,criterionA.id,indicatorOne.id,1],[criterionB.id,criterionB.id,indicatorTwo.id,2]]);
  const levelSnapshot=assignments.rows[0].levels_snapshot;assert.equal((Array.isArray(levelSnapshot)?levelSnapshot:JSON.parse(String(levelSnapshot))).length,4,'la actividad conserva la valoración que seleccionó del catálogo');
 }

 const courseB=courses.find(course=>course.code==='5B')!;const courseC=courses.find(course=>course.code==='5C')!;
 const bActivityBefore=configured.find(item=>item.courseId===courseB.id)!;
 await service.configureActivityEvaluation(owner,{requestId:randomUUID(),activityId:bActivityBefore.id,revision:bActivityBefore.revision,scoringMode:'points',instrument:'Puntaje directo',indicatorPoints:[],rubric:[]});
 configured=(await service.bootstrap(owner)).activities.filter(item=>item.sharedId===first.sharedId);
 assert.equal(configured.find(item=>item.courseId===courseB.id)?.scoringMode,'points','5B puede usar puntos directos para el mismo contenido');
 assert.equal(configured.find(item=>item.courseId===courseC.id)?.scoringMode,'rubric','cambiar solo 5B no modifica la preparación inicial independiente de 5C');
 assert.equal(configured.find(item=>item.courseId===courses.find(course=>course.code==='5A')!.id)?.scoringMode,'rubric','cambiar solo 5B conserva la rúbrica de 5A');

 const courseA=courses.find(course=>course.code==='5A')!;
 const aActivity=configured.find(item=>item.courseId===courseA.id)!;const bActivity=configured.find(item=>item.courseId===courseB.id)!;
 const aRows=(await service.grades(owner,aActivity.id)).rows;
 const bRows=(await service.grades(owner,bActivity.id)).rows;
 assert.equal(aRows.length,courseA.students.length,'una actividad de 5A abre la lista completa del curso en una sola matriz');
 assert.equal(new Set(aRows.map(row=>row.studentId)).size,courseA.students.length,'cada estudiante aparece una vez, no se duplica la actividad por alumno');
 const saveRows=(rows:typeof aRows,firstLevels:Record<string,number>)=>rows.map((student,index)=>({studentId:student.studentId,score:null,criterionLevels:index===0?firstLevels:null,comment:''}));
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:aActivity.id,revision:aActivity.revision,rows:saveRows(aRows,{[criterionA.id]:3,[criterionB.id]:1})});
 assert.equal(Number((await db.query('SELECT COUNT(*) AS total FROM grades WHERE owner_id=$1 AND activity_id=$2',[owner,aActivity.id])).rows[0]!.total),courseA.students.length,'un solo guardado incluye una fila de calificación por estudiante del curso');
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:bActivity.id,revision:bActivity.revision,rows:bRows.map((student,index)=>({studentId:student.studentId,score:index===0?7:null,criterionLevels:null,comment:''}))});
 const savedRatings=await db.query('SELECT criterion_key,level_position,level_label,points,descriptor FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2 AND student_id=$3 ORDER BY criterion_key',[owner,aActivity.id,courseA.students[0].id]);
 const expectedRatings=[[criterionA.id,3,'Excelente',4,'Lo logra y lo justifica.'],[criterionB.id,1,'Suficiente',2,'Lo logra parcialmente.']].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 assert.deepEqual(savedRatings.rows.map(row=>[row.criterion_key,Number(row.level_position),row.level_label,Number(row.points),row.descriptor]),expectedRatings,'cada selección del alumno queda en su propio registro relacionado con criterio y actividad');
 const revisedLevels=levels.map(level=>({...level,description:`Nueva versión del catálogo: ${level.description}`}));
 await service.saveEvaluationCriterion(owner,{id:criterionA.id,label:criterionA.label,levels:revisedLevels});
 const currentCatalog=(await service.bootstrap(owner)).criteriaCatalog.find(item=>item.id===criterionA.id)!;
 assert.equal(currentCatalog.levels[0].description,revisedLevels[0].description,'la edición crea los valores vigentes del catálogo');
 assert.equal((await service.grades(owner,aActivity.id)).activity.rubric.find(item=>item.id===criterionA.id)?.levels[0].description,levels[0].description,'editar el catálogo no cambia descriptores ya asignados a una actividad');
 const immutableRatings=await db.query('SELECT criterion_key,descriptor FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2 AND student_id=$3 ORDER BY criterion_key',[owner,aActivity.id,courseA.students[0].id]);
 assert.deepEqual(Object.fromEntries(immutableRatings.rows.map(row=>[row.criterion_key,row.descriptor])),{[criterionA.id]:levels[3].description,[criterionB.id]:levels[1].description},'editar el catálogo no reescribe la evidencia histórica de la calificación');
 assert.deepEqual((await service.grades(owner,aActivity.id)).rows.find(row=>row.studentId===courseA.students[0].id)?.criterionLevels,{[criterionA.id]:3,[criterionB.id]:1},'la lectura de captura recompone los niveles desde las filas normalizadas');
 const exported=await service.exportData(owner);
 assert.equal(exported.criteria.length,2,'la exportación incluye el catálogo de criterios');
 assert.equal(exported.criterionValues.length,8,'la exportación incluye cada nivel y descriptor del catálogo');
 assert.equal(exported.activityCriteria.filter(row=>row.activity_id===aActivity.id).length,2,'la exportación conserva los criterios asignados a esta actividad');
 assert.equal(exported.criterionRatings.filter(row=>row.activity_id===aActivity.id&&row.student_id===courseA.students[0].id).length,2,'la exportación conserva la selección de cada estudiante');
 await db.query('DELETE FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2',[owner,aActivity.id]);
 await db.query('DELETE FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2',[owner,aActivity.id]);
 await db.query('DELETE FROM evaluation_criterion_values WHERE owner_id=$1 AND criterion_id IN ($2,$3)',[owner,criterionA.id,criterionB.id]);
 await initializeDatabase(db);
 assert.equal((await db.query('SELECT criterion_key FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2',[owner,aActivity.id])).rows.length,2,'la migración recupera las relaciones de actividad guardadas anteriormente en JSON');
 assert.equal((await db.query('SELECT criterion_key FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2 AND student_id=$3',[owner,aActivity.id,courseA.students[0].id])).rows.length,2,'la migración recupera cada nivel de alumno desde el registro JSON anterior');

 const reportA=await service.report(owner,courseA.id,courseA.students[0].id);
 const reportB=await service.report(owner,courseB.id,courseB.students[0].id);
 assert.equal(reportA.grades.find(item=>item.activityId===aActivity.id)?.score,8);
 assert.equal(reportB.grades.find(item=>item.activityId===bActivity.id)?.score,7,'la nota directa de 5B llega al mismo reporte sin mezclarse con la rúbrica de 5A');
 assert.equal(bActivity.scoringMode,'points');assert.equal(bActivity.indicatorPoints.length,0);assert.equal(bActivity.rubric.length,0,'la configuración directa de 5B no conserva criterios ni ponderaciones de competencias');
 const competencyA=new Map(reportA.competencies.map(item=>[item.key,item]));
 assert.equal(competencyA.get('logico_matematica')?.points,6);assert.equal(competencyA.get('logico_matematica')?.possible,6);
 assert.equal(competencyA.get('resolucion')?.points,2);assert.equal(competencyA.get('resolucion')?.possible,4);
 const ledger=await service.teacherLedger(owner);
 const ledgerA=ledger.rows.find(row=>row.course.id===courseA.id&&row.student.id===courseA.students[0].id)!;
 const columns=ledger.groups.flatMap(group=>group.columns);
 const precisionColumn=columns.find(column=>column.label.includes('Precisión del procedimiento'))!;
 const justificationColumn=columns.find(column=>column.label.includes('Justificación matemática'))!;
 assert.equal(ledgerA.scores.find(score=>score.key===precisionColumn.key)?.points,6);
 assert.equal(ledgerA.scores.find(score=>score.key===precisionColumn.key)?.possible,6);
 assert.equal(ledgerA.scores.find(score=>score.key===justificationColumn.key)?.points,2);
 assert.equal(ledgerA.scores.find(score=>score.key===justificationColumn.key)?.possible,4);
 const courseMatrix=await service.teacherLedger(owner,period.period,courseA.id);
 assert.equal(new Set(courseMatrix.rows.map(row=>row.course.id)).size,1,'la matriz del curso solo contiene los estudiantes del curso abierto');
 assert.ok(courseMatrix.rows.every(row=>row.course.id===courseA.id));
 assert.ok(courseMatrix.groups.flatMap(group=>group.columns).every(column=>column.courseIds.includes(courseA.id)),'las columnas conservan sus evaluaciones asignadas al curso seleccionado');
 await assert.rejects(service.teacherLedger(owner,period.period,'00000000-0000-4000-8000-000000000000'),/curso/,'no debe abrir una matriz con un identificador inexistente');

 const planP1:EvaluationPlan={...period,categories:period.categories.map(item=>({...item})),period:'P1',startDate:'2026-10-20',endDate:'2026-11-01',sequence:undefined};
 await service.updatePlan(owner,planP1);
 await service.activatePlan(owner,'P2');
 await service.savePlanSequence(owner,'P1',{...sequence,activities:sequence.activities.map(item=>({...item,id:'seq-p1',title:'Secuencia P1'}))});
 assert.equal((await service.bootstrap(owner)).plan.period,'P2','guardar la secuencia de P1 no cambia el período activo');
 const mergedSequence=(await service.bootstrap(owner)).curriculumSequence!;
 assert.ok(mergedSequence.activities.some(item=>item.id==='legacy:P1:seq-p1'&&item.period==='P1'),'El flujo anual debe reconstruir y exponer vínculos de secuencias guardadas en planes anteriores.');
 assert.equal((await service.teacherLedger(owner,'P1')).period,'P1');
});

test('actividad común preparada queda fuera de notas hasta activarla por curso y conserva ese alcance',async()=>{
 const owner='course-scoped-grading-flow';
 const courses=(await service.bootstrap(owner)).courses;
 const fiveA=courses.find(course=>course.code==='5A')!;
 const fiveB=courses.find(course=>course.code==='5B')!;
 const created=await service.createSharedActivity(owner,{courseIds:[fiveA.id,fiveB.id],activity:{category:'exam',title:'Examen elegido por curso',date:'2026-11-20',maxPoints:10,instrument:'Puntaje directo',activeForGrading:false,requestId:randomUUID()}});
 const copyA=created.find(activity=>activity.courseId===fiveA.id)!;
 const copyB=created.find(activity=>activity.courseId===fiveB.id)!;
 assert.equal(copyA.activeForGrading,false);
 assert.equal(copyB.activeForGrading,false);
 await assert.rejects(service.grades(owner,copyA.id),/aún no está incluida/);
 await assert.rejects(service.saveGrades(owner,{requestId:randomUUID(),activityId:copyA.id,revision:copyA.revision,rows:[{studentId:fiveA.students[0]!.id,score:8}]}),/aún no está incluida/);
 const beforeReport=await service.report(owner,fiveA.id,fiveA.students[0]!.id);
 assert.ok(!beforeReport.grades.some(grade=>grade.activityId===copyA.id),'la actividad preparada no aparece como pendiente en el informe antes de elegirla');
 const beforeLedger=await service.teacherLedger(owner,'P2',fiveA.id);
 assert.ok(!beforeLedger.groups.flatMap(group=>group.columns).some(column=>column.label.includes('Examen elegido por curso')),'la actividad preparada no crea una columna evaluable antes de activarla');

 const activated=await service.setActivityGradingState(owner,{requestId:randomUUID(),activityId:copyA.id,revision:copyA.revision,active:true});
 assert.equal(activated.activeForGrading,true);
 assert.equal((await service.bootstrap(owner)).activities.find(activity=>activity.id===copyB.id)?.activeForGrading,false,'activar 5A no modifica la copia de 5B');
 assert.equal((await service.grades(owner,copyA.id)).rows.length,fiveA.students.length,'la matriz activa incluye a todo el curso en una sola captura');
 await assert.rejects(service.grades(owner,copyB.id),/aún no está incluida/);
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:copyA.id,revision:activated.revision,rows:[{studentId:fiveA.students[0]!.id,score:8}]});
 const afterReport=await service.report(owner,fiveA.id,fiveA.students[0]!.id);
 assert.equal(afterReport.grades.find(grade=>grade.activityId===copyA.id)?.score,8);
 await assert.rejects(service.setActivityGradingState(owner,{requestId:randomUUID(),activityId:copyA.id,revision:activated.revision+1,active:false}),/ya tiene notas/);
});

test('horario docente se guarda aislado por cuenta, valida franjas y propone bloques sin mezclarlos entre maestros',async()=>{
 const ownerA='timetable-teacher-a';const ownerB='timetable-teacher-b';
 const bootstrapA=await service.bootstrap(ownerA);const bootstrapB=await service.bootstrap(ownerB);
 const courseA=bootstrapA.courses.find(course=>course.code==='5A')!;
 const courseB=bootstrapB.courses.find(course=>course.code==='5A')!;
 assert.notEqual(courseA.id,courseB.id);
 assert.deepEqual(await service.teacherTimetable(ownerA),{revision:0,entries:[]});
 const first={id:randomUUID(),weekday:1,startTime:'08:00',endTime:'08:50',courseId:courseA.id,block:1};
 const second={id:randomUUID(),weekday:1,startTime:'09:00',endTime:'09:50',courseId:courseA.id,block:2};
 const saved=await service.saveTeacherTimetable(ownerA,{revision:0,entries:[first,second]});
 assert.equal(saved.revision,1);assert.deepEqual(saved.entries,[first,second]);
 assert.equal((await service.teacherTimetable(ownerA)).entries.length,2,'se conserva todo el horario en Neon/DB para esa cuenta');
 assert.deepEqual(await service.teacherTimetable(ownerB),{revision:0,entries:[]},'otro maestro no recibe las franjas del primero');
 await assert.rejects(service.saveTeacherTimetable(ownerA,{revision:1,entries:[first,{...second,startTime:'08:40',endTime:'09:30'}]}),/superponen/);
 await assert.rejects(service.saveTeacherTimetable(ownerA,{revision:1,entries:[{...first,endTime:'07:00'}]}),/hora final/);
 await assert.rejects(service.saveTeacherTimetable(ownerB,{revision:0,entries:[{...first,courseId:courseA.id}]}),/no pertenece/);
 await assert.rejects(service.saveTeacherTimetable(ownerA,{revision:0,entries:[]}),/cambió/);
 const cleared=await service.saveTeacherTimetable(ownerA,{revision:1,entries:[]});
 assert.equal(cleared.revision,2);assert.deepEqual(cleared.entries,[],'el docente puede vaciar y volver a configurar su horario');
 const exported=await service.exportData(ownerA);
 assert.equal((exported.teacherTimetable as {length:number}[]).length,1,'el respaldo exporta el horario del docente');
});

test('actividad manual sin secuencia conserva indicadores, competencias, rúbrica y notas en el libro',async()=>{
 const manualOwner='manual-activity-teacher';
 const bootstrap=await service.bootstrap(manualOwner);
 assert.equal(bootstrap.curriculumSequence,null);
 const course=bootstrap.courses.find(item=>item.code==='5A')!;
 const activity=await service.createActivity(manualOwner,{courseId:course.id,category:'sequence',title:'Exposición de suma de vectores',date:'2027-03-20',maxPoints:10});
 assert.equal(activity.sequenceActivityId,null);
 assert.equal(activity.sequenceCode,'');
 assert.equal(activity.date,'2027-03-20','La fecha de evaluación se conserva separada del momento de creación.');
 assert.ok(activity.createdAt&&Number.isFinite(Date.parse(activity.createdAt)),'El sistema registra automáticamente la fecha real en que se creó la actividad.');
 assert.notEqual(activity.createdAt?.slice(0,10),activity.date,'Crear una actividad futura no reescribe su fecha prevista de evaluación.');
 const levels:RubricLevel[]=[{label:'Insuficiente',points:1,description:'No evidencia el desempeño.'},{label:'Suficiente',points:2,description:'Lo evidencia parcialmente.'},{label:'Bueno',points:3,description:'Lo realiza correctamente.'},{label:'Excelente',points:4,description:'Lo realiza y justifica con precisión.'}];
 const representation=await service.saveEvaluationCriterion(manualOwner,{label:'Representación de los vectores',levels}) as EvaluationCriterion;
 const justification=await service.saveEvaluationCriterion(manualOwner,{label:'Justificación de la resultante',levels}) as EvaluationCriterion;
 const indicators=[
  {id:'manual:vector-representation',code:'I1',label:'Representa magnitud y dirección',competency:'logico_matematica' as const},
  {id:'manual:vector-justification',code:'I2',label:'Justifica el vector resultante',competency:'resolucion' as const},
 ];
 const rubric:Activity['rubric']=[
  {id:representation.id,label:representation.label,indicatorId:indicators[0].id,weight:1,levels:representation.levels},
  {id:justification.id,label:justification.label,indicatorId:indicators[1].id,weight:1,levels:justification.levels},
 ];
 const before=await service.report(manualOwner,course.id,course.students[0].id);
 const configured=await service.configureActivityEvaluation(manualOwner,{requestId:randomUUID(),activityId:activity.id,revision:activity.revision,scoringMode:'rubric',instrument:'Rúbrica analítica',manualIndicators:indicators,indicatorPoints:[{indicatorId:indicators[0].id,points:6},{indicatorId:indicators[1].id,points:4}],rubric});
 assert.equal(configured[0].indicatorPoints.length,2);
 assert.equal(configured[0].indicatorPoints[1].competency,'resolucion');
 const rows=(await service.grades(manualOwner,activity.id)).rows.map((row,index)=>({studentId:row.studentId,score:null,criterionLevels:index===0?{[representation.id]:3,[justification.id]:1}:null}));
 await service.saveGrades(manualOwner,{requestId:randomUUID(),activityId:activity.id,revision:configured[0].revision,rows});
 const report=await service.report(manualOwner,course.id,course.students[0].id);
 assert.equal(report.grades.find(item=>item.activityId===activity.id)?.score,8);
 const beforeCompetencies=new Map(before.competencies.map(item=>[item.key,item]));
 const afterCompetencies=new Map(report.competencies.map(item=>[item.key,item]));
 assert.equal(Math.round(((afterCompetencies.get('logico_matematica')?.points??0)-(beforeCompetencies.get('logico_matematica')?.points??0))*100)/100,6);
 assert.equal(Math.round(((afterCompetencies.get('resolucion')?.points??0)-(beforeCompetencies.get('resolucion')?.points??0))*100)/100,2);
 const ledger=await service.teacherLedger(manualOwner);
 const row=ledger.rows.find(item=>item.course.id===course.id&&item.student.id===course.students[0].id)!;
 const columns=ledger.groups.flatMap(group=>group.columns);
 assert.equal(row.scores.find(score=>score.key===columns.find(column=>column.label.includes('Representación de los vectores'))?.key)?.points,6);
 assert.equal(row.scores.find(score=>score.key===columns.find(column=>column.label.includes('Justificación de la resultante'))?.key)?.points,2);
});

test('criterios editables en la actividad aceptan puntos por criterio y llegan a la misma matriz que el puntaje directo',async()=>{
 const inlineOwner='inline-criteria-teacher';
 const bootstrap=await service.bootstrap(inlineOwner);
 const course=bootstrap.courses.find(item=>item.code==='5A')!;
 assert.equal(bootstrap.criteriaCatalog.length,0,'la rúbrica local no depende de tener criterios guardados en un catálogo global');
 const rubricActivity=await service.createActivity(inlineOwner,{courseId:course.id,category:'sequence',title:'Suma de vectores · rúbrica editable',date:'2026-11-18',maxPoints:10});
 const indicator={id:'manual:inline-vectors',code:'I1',label:'Representa y justifica la suma',competency:'logico_matematica' as const};
 const levels:RubricLevel[]=[{label:'Insuficiente',points:1,description:'No representa los vectores.'},{label:'Suficiente',points:2,description:'Representa con errores parciales.'},{label:'Bueno',points:3,description:'Representa correctamente.'},{label:'Excelente',points:4,description:'Representa y justifica con precisión.'}];
 const rubric:Activity['rubric']=[
  {id:`activity:${rubricActivity.id}:criterion:calculo`,label:'Cálculo de la resultante',indicatorId:indicator.id,weight:1,levels},
  {id:`activity:${rubricActivity.id}:criterion:justificacion`,label:'Justificación del procedimiento',indicatorId:indicator.id,weight:1.5,levels},
 ];
 const configured=await service.configureActivityEvaluation(inlineOwner,{requestId:randomUUID(),activityId:rubricActivity.id,revision:rubricActivity.revision,scoringMode:'rubric',instrument:'Rúbrica de suma',manualIndicators:[indicator],indicatorPoints:[{indicatorId:indicator.id,points:10}],rubric});
 assert.deepEqual(configured[0].rubric.map(item=>[item.label,item.weight]),[['Cálculo de la resultante',1],['Justificación del procedimiento',1.5]]);
 assert.equal(configured[0].rubric.reduce((sum,item)=>sum+Math.max(...item.levels.map(level=>level.points))*(item.weight??1),0),10,'los valores editados de cada criterio deben sumar el máximo de la actividad');
 const localRows=await db.query('SELECT catalog_criterion_id,criterion_label,levels_snapshot FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2 ORDER BY position',[inlineOwner,rubricActivity.id]);
 assert.deepEqual(localRows.rows.map(row=>[row.catalog_criterion_id,row.criterion_label]),[[null,'Cálculo de la resultante'],[null,'Justificación del procedimiento']]);
 assert.equal((await service.bootstrap(inlineOwner)).criteriaCatalog.length,0,'guardar una actividad no crea ni altera plantillas globales');
 const rubricRows=(await service.grades(inlineOwner,rubricActivity.id)).rows.map((row,index)=>({studentId:row.studentId,score:null,criterionLevels:index===0?{[rubric[0]!.id]:3,[rubric[1]!.id]:1}:null}));
 await service.saveGrades(inlineOwner,{requestId:randomUUID(),activityId:rubricActivity.id,revision:configured[0]!.revision,rows:rubricRows});

 const directActivity=await service.createActivity(inlineOwner,{courseId:course.id,category:'sequence',title:'Suma de vectores · puntos directos',date:'2026-11-19',maxPoints:10,competency:'logico_matematica'});
 const directConfigured=await service.configureActivityEvaluation(inlineOwner,{requestId:randomUUID(),activityId:directActivity.id,revision:directActivity.revision,scoringMode:'points',instrument:'Puntaje directo',indicatorPoints:[],rubric:[]});
 const directRows=(await service.grades(inlineOwner,directActivity.id)).rows.map((row,index)=>({studentId:row.studentId,score:index===0?6.5:null}));
 await service.saveGrades(inlineOwner,{requestId:randomUUID(),activityId:directActivity.id,revision:directConfigured[0]!.revision,rows:directRows});

 const firstStudent=course.students[0]!;
 const report=await service.report(inlineOwner,course.id,firstStudent.id);
 assert.equal(report.grades.find(item=>item.activityId===rubricActivity.id)?.score,7,'la selección de niveles calcula una nota sobre 10');
 assert.equal(report.grades.find(item=>item.activityId===directActivity.id)?.score,6.5,'el modo directo conserva la nota sobre 10');
 const ledger=await service.teacherLedger(inlineOwner);
 const logicalGroup=ledger.groups.find(group=>group.key==='logico_matematica')!;
 assert.ok(logicalGroup.columns.some(column=>column.label==='Suma de vectores · rúbrica editable · Cálculo de la resultante'));
 assert.ok(logicalGroup.columns.some(column=>column.label==='Suma de vectores · puntos directos'));
 const ledgerRow=ledger.rows.find(row=>row.course.id===course.id&&row.student.id===firstStudent.id)!;
 const firstCriterionColumn=logicalGroup.columns.find(column=>column.label.endsWith('Cálculo de la resultante'))!;
 const secondCriterionColumn=logicalGroup.columns.find(column=>column.label.endsWith('Justificación del procedimiento'))!;
 const directColumn=logicalGroup.columns.find(column=>column.label==='Suma de vectores · puntos directos')!;
 assert.deepEqual([ledgerRow.scores.find(score=>score.key===firstCriterionColumn.key)?.points,ledgerRow.scores.find(score=>score.key===firstCriterionColumn.key)?.possible],[4,4]);
 assert.deepEqual([ledgerRow.scores.find(score=>score.key===secondCriterionColumn.key)?.points,ledgerRow.scores.find(score=>score.key===secondCriterionColumn.key)?.possible],[3,6]);
 assert.deepEqual([ledgerRow.scores.find(score=>score.key===directColumn.key)?.points,ledgerRow.scores.find(score=>score.key===directColumn.key)?.possible],[6.5,10]);
});

test('la elección por competencias queda guardada como rúbrica pendiente y no se convierte en nota directa',async()=>{
 const owner='rubric-draft-choice';
 const bootstrap=await service.bootstrap(owner);
 const course=bootstrap.courses.find(item=>item.code==='5A')!;
 const created=await service.createSharedActivity(owner,{courseIds:[course.id],activity:{category:'sequence',title:'Actividad con matriz pendiente',date:'2026-11-20',maxPoints:10,scoringMode:'rubric',rubric:[],requestId:'save-rubric-choice'}});
 const activity=created[0]!;
 assert.equal(activity.scoringMode,'rubric');
 assert.equal(activity.rubric.length,0);
 assert.equal(activity.instrument,'','una rúbrica sin configurar no debe aparecer como puntaje directo');
 const student=(await service.grades(owner,activity.id)).rows[0]!;
 await assert.rejects(service.saveGrades(owner,{requestId:'cannot-grade-rubric-draft',activityId:activity.id,revision:activity.revision,rows:[{studentId:student.studentId,score:null}]}),/rúbrica todavía no está configurada/);
});

test('una actividad evaluada en P2 conserva el vínculo exacto con una clase planificada en P1',async()=>{
 const bootstrap=await service.bootstrap(owner);
 assert.equal(bootstrap.plan.period,'P2');
 const courses=bootstrap.courses.filter(course=>['5A','5B','5C'].includes(course.code));
 const indicatorOne={id:'ind-vector-components',code:'I1',label:'Representa los componentes de un vector',competency:'logico_matematica' as const};
 const indicatorTwo={id:'ind-vector-result',code:'I2',label:'Justifica la resultante',competency:'resolucion' as const};
 const matrixIndicator={id:'ind-matrix-operation',code:'I3',label:'Opera con matrices',competency:'logico_matematica' as const};
 const sequence:SequencePlan={source:'manual',sourceName:'',sourceText:'',reviewed:true,indicators:[indicatorOne,indicatorTwo,matrixIndicator],activities:[
  {id:'annual-vector-21',code:'2.1',theme:'Vectores',title:'Suma de vectores pendiente',lessonType:'ejercicios',description:'Resolver suma de vectores',evidence:'Procedimiento',indicatorIds:[indicatorOne.id,indicatorTwo.id],period:'P1'},
  {id:'annual-matrix-21',code:'2.1',theme:'Matrices',title:'Suma de matrices',lessonType:'ejercicios',description:'Resolver matrices',evidence:'Procedimiento',indicatorIds:[matrixIndicator.id],period:'P2'},
 ]};
 await service.saveCurriculumSequence(owner,sequence);
 const beforeBootstrap=await service.bootstrap(owner);
 const vector=beforeBootstrap.curriculumSequence!.activities.find(item=>item.id==='annual-vector-21')!;
 const course= courses.find(item=>item.code==='5A')!;
 const beforeReport=await service.report(owner,course.id,course.students[0].id,'P2');
 const attendanceBefore=await service.attendance(owner,course.id,'2026-11-15',1);
 const created=await service.createSharedActivity(owner,{courseIds:courses.map(item=>item.id),activity:{category:'sequence',title:'Evaluación de suma de vectores',date:'2026-11-15',maxPoints:10,sequenceCode:vector.code,sequenceActivityId:vector.id,requestId:randomUUID()}});
 assert.equal(created.length,3);
 assert.ok(created.every(item=>item.period==='P2'&&item.sequencePlannedPeriod==='P1'&&item.sequenceActivityId===vector.id&&item.sequenceCode==='2.1'));
 const courseActivity=created.find(item=>item.courseId===course.id)!;
 const configured=await service.configureActivityEvaluation(owner,{requestId:randomUUID(),activityId:courseActivity.id,revision:courseActivity.revision,scoringMode:'points',instrument:'Puntaje directo',indicatorPoints:[{indicatorId:indicatorOne.id,points:6},{indicatorId:indicatorTwo.id,points:4}],rubric:[]});
 const configuredActivity=configured.find(item=>item.courseId===course.id)!;
 assert.deepEqual(configuredActivity.indicatorPoints.map(item=>item.indicatorId),[indicatorOne.id,indicatorTwo.id]);
 const gradeRows=(await service.grades(owner,configuredActivity.id)).rows.map((row,index)=>({studentId:row.studentId,score:index===0?8:null,criterionLevels:null,comment:''}));
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:configuredActivity.id,revision:configuredActivity.revision,rows:gradeRows});
 const afterReport=await service.report(owner,course.id,course.students[0].id,'P2');
 const savedGrade=afterReport.grades.find(item=>item.activityId===configuredActivity.id)!;
 assert.equal(savedGrade.score,8);
 assert.equal(savedGrade.sequenceActivityId,vector.id);
 assert.equal(savedGrade.sequencePlannedPeriod,'P1');
 const beforeCompetencies=new Map(beforeReport.competencies.map(item=>[item.key,item]));
 const afterCompetencies=new Map(afterReport.competencies.map(item=>[item.key,item]));
 assert.equal(Math.round(((afterCompetencies.get('logico_matematica')?.points??0)-(beforeCompetencies.get('logico_matematica')?.points??0))*100)/100,4.8);
 assert.equal(Math.round(((afterCompetencies.get('resolucion')?.points??0)-(beforeCompetencies.get('resolucion')?.points??0))*100)/100,3.2);
 const attendanceAfter=await service.attendance(owner,course.id,'2026-11-15',1);
 assert.equal(attendanceAfter.session.id,attendanceBefore.session.id,'Crear y calificar no debe crear ni confirmar una asistencia.');
 assert.equal(attendanceAfter.session.status,attendanceBefore.session.status);
});

test('el plan de clase es independiente por curso y enlaza contenido P1 con evaluación P2 usando el calendario de asistencia',async()=>{
 const owner='course-specific-planning-flow';
 const course=await service.createCourse(owner,{code:'6Y',name:'Sexto Y · Ciencias',startDate:'2026-11-02',endDate:'2026-11-30',weekly:[{weekday:1,blocks:[1]},{weekday:3,blocks:[1]}]});
 const roster=await service.importRoster(owner,course.id,[{externalId:'s-1',number:1,name:'Estudiante Uno'},{externalId:'s-2',number:2,name:'Estudiante Dos'}]);
 const indicator={id:'course-plan-ind-1',code:'I1',label:'Explica el contenido',competency:'comunicativa' as const};
 const sequence:SequencePlan={source:'manual',sourceName:'',sourceText:'',reviewed:true,indicators:[indicator],activities:[{id:'course-plan-seq-1',code:'1.1',theme:'Contenido de P1',title:'Actividad que se atrasó',lessonType:'practica',description:'Resolver y explicar',evidence:'Trabajo del estudiante',indicatorIds:[indicator.id],period:'P1'}]};
 await service.saveCurriculumSequence(owner,sequence);
 const schoolDay=await service.attendance(owner,course.id,'2026-11-11',1);
 await service.saveAttendance(owner,{requestId:randomUUID(),courseId:course.id,date:'2026-11-11',block:1,revision:schoolDay.session.revision,lessonType:'actividad_escolar',topic:'Taller de lectura',rows:roster.map(student=>({studentId:student.id,status:'P'}))});
 const planned=await service.saveCourseSequencePlan(owner,{requestId:randomUUID(),courseId:course.id,sequenceActivityId:'course-plan-seq-1',startDate:'2026-11-09',endDate:'2026-11-11',assessmentPeriod:'P2',assessmentCategory:'exam',assessmentMethod:'points',assessmentFormat:'Examen'});
 assert.equal(planned.sequenceTitle,'Actividad que se atrasó');assert.equal(planned.assessmentPeriod,'P2');assert.equal(planned.assessmentCategory,'exam');
 const otherCourse=(await service.bootstrap(owner)).courses.find(item=>item.id!==course.id)!;
 assert.deepEqual(await service.courseSequencePlans(owner,otherCourse.id),[],'el calendario de un curso no copia los planes al resto');
 const suggestions=await service.courseSequencePlans(owner,course.id);
 assert.equal(suggestions[0]?.scheduledSessions,2);
 assert.equal(suggestions[0]?.missedSessions,2,'un día sin asistencia y un taller escolar cuentan como contenido no impartido');
 assert.equal(suggestions[0]?.schoolActivitySessions,1);
 assert.equal(suggestions[0]?.nextSessionDate,'2026-11-18','la recomendación desplaza el cierre tantas sesiones como se perdieron');
 const activity=await service.createActivity(owner,{requestId:randomUUID(),courseId:course.id,coursePlanId:planned.id,period:'P2',category:'exam',title:'Actividad que se atrasó',date:'2026-11-11',maxPoints:10,scoringMode:'points',sequenceActivityId:'course-plan-seq-1',instrument:'Puntaje directo',purpose:'Examen'});
 assert.equal(activity.period,'P2','el período de calificación lo elige el docente');
 assert.equal(activity.category,'exam','la planificación por curso decide a qué columna de calificación se acredita');
 assert.equal(activity.sequencePlannedPeriod,'P1','se conserva el período didáctico de la secuencia original');
 assert.equal(activity.courseId,course.id,'la evaluación se crea solo en el curso preparado');
 const planAfter=await service.courseSequencePlans(owner,course.id);
 assert.equal(planAfter[0]?.activityId,activity.id);assert.equal(planAfter[0]?.activityReady,true);
 const gradeRows=(await service.grades(owner,activity.id)).rows.map((student,index)=>({studentId:student.studentId,score:index===0?8:null,criterionLevels:null,comment:''}));
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:activity.id,revision:activity.revision,rows:gradeRows});
 const report=await service.report(owner,course.id,roster[0]!.id,'P2');
 assert.equal(report.grades.find(item=>item.activityId===activity.id)?.score,8,'la nota aparece en el P2 y conserva el vínculo al contenido P1');
 await assert.rejects(service.createActivity(owner,{requestId:randomUUID(),courseId:otherCourse.id,coursePlanId:planned.id,period:'P2',category:'sequence',title:'Debe rechazarse',date:'2026-11-11',maxPoints:10,scoringMode:'points',sequenceActivityId:'course-plan-seq-1'}),/plan de clase de este curso/);
});
