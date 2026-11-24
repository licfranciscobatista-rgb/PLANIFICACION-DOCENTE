import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createTestDatabase } from '../src/lib/db';
import { RegistroService } from '../src/lib/service';

const root=path.resolve('.local');
const directory=path.join(root,`period-sheet-${randomUUID()}`);
let db:Awaited<ReturnType<typeof createTestDatabase>>;
let service:RegistroService;
before(async()=>{await mkdir(directory,{recursive:true});db=await createTestDatabase(path.join(directory,'postgres'));service=new RegistroService(db,{today:()=> '2026-11-16'});});
after(async()=>{await db?.close();assert.ok(directory.startsWith(root+path.sep));assert.ok(path.basename(directory).startsWith('period-sheet-'));await rm(directory,{recursive:true,force:true});});
async function fixture(){
 const owner=`sheet-${randomUUID()}`;
 const course=await service.createCourse(owner,{code:'5A',name:'Prueba',startDate:'2026-10-20',endDate:'2026-11-30'});
 const other=await service.createCourse(owner,{code:'5B',name:'Otro',startDate:'2026-10-20',endDate:'2026-11-30'});
 const students=await service.importRoster(owner,course.id,[{externalId:'a',number:1,name:'Ana'},{externalId:'b',number:2,name:'Luis'}]);
 const outsiders=await service.importRoster(owner,other.id,[{externalId:'a',number:1,name:'Beatriz'}]);
 return {owner,course,other,students,outsiders};
}
const column=(label:string,maxPoints:number,date:string|null=null)=>({id:randomUUID(),label,maxPoints,date});

test('una sola nota sobre 100, cero real y vacío pendiente; informe y libro usan la misma fuente',async()=>{
 const {owner,course,students}=await fixture();const col=column('Nota del período',100);
 const original=await service.report(owner,course.id,students[0].id);
 const plan=await service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[col]});
 await service.savePeriodSheetGrades(owner,{period:'P2',courseId:course.id,revision:plan.revision,rows:[{studentId:students[0].id,scores:{[col.id]:0}}]});
 const view=await service.periodSheet(owner,'P2',course.id);
 assert.equal(view.rows[0].result.total,0);assert.equal(view.rows[1].result.accumulated,null);assert.equal(view.rows[1].result.total,null);
 const report=await service.report(owner,course.id,students[0].id);assert.equal(report.total,0);assert.equal(report.provisionalTotal,0);assert.deepEqual(report.attendance,original.attendance);
 const ledger=await service.teacherLedger(owner,'P2');assert.equal(ledger.rows.find(row=>row.student.id===students[0].id)?.weightedTotal,0);assert.ok(ledger.directPlan?.enabled);
 assert.equal(ledger.rows.find(row=>row.student.id===students[1].id)?.weightedTotal,null);
});

test('partes libres con y sin fecha acumulan hasta 100 sin normalizar ni duplicar actividades',async()=>{
 const {owner,course,students}=await fixture();const first=column('Libreta',30,'2026-11-02'),second=column('Examen',70);
 const activity=await service.createActivity(owner,{courseId:course.id,category:'exam',title:'Anterior',date:'2026-11-01',maxPoints:10,requestId:randomUUID()});
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:activity.id,revision:0,rows:[{studentId:students[0].id,score:10}]});
 const previous=await service.report(owner,course.id,students[0].id);
 let plan=await service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[first]});
 let saved=await service.savePeriodSheetGrades(owner,{period:'P2',courseId:course.id,revision:plan.revision,rows:[{studentId:students[0].id,scores:{[first.id]:25}}]});
 let report=await service.report(owner,course.id,students[0].id);assert.equal(report.provisionalTotal,25);assert.equal(report.total,null);assert.equal(report.directEvaluation?.plannedPoints,30);
 plan=await service.savePeriodSheetPlan(owner,{...plan,revision:saved.revision,columns:[second,{...first,label:'Libreta revisada'}]});
 saved=await service.savePeriodSheetGrades(owner,{period:'P2',courseId:course.id,revision:plan.revision,rows:[{studentId:students[0].id,scores:{[second.id]:65}}]});
 report=await service.report(owner,course.id,students[0].id);assert.equal(report.total,90);assert.equal(report.directEvaluation?.scores[first.id],25);assert.equal(report.grades.find(row=>row.activityId===activity.id)?.score,10);
 assert.equal((await service.grades(owner,activity.id)).rows.find(row=>row.studentId===students[0].id)?.score,10);
 await service.savePeriodSheetPlan(owner,{...plan,revision:saved.revision,enabled:false});
 assert.equal((await service.report(owner,course.id,students[0].id)).provisionalTotal,previous.provisionalTotal);
 assert.equal((await service.periodSheet(owner,'P2',course.id)).rows[0].result.total,90);
});

test('las capturas directas de varias categorías se integran al mismo libro sin duplicar sus actividades',async()=>{
 const {owner,course,students}=await fixture();
 const exam={...column('Examen directo',35),category:'exam'},notebook={...column('Nota global de libreta',20),category:'notebook'};
 const activity=await service.createActivity(owner,{courseId:course.id,category:'exam',title:'Examen ya preparado',date:'2026-11-02',maxPoints:10,requestId:randomUUID()});
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:activity.id,revision:0,rows:[{studentId:students[0].id,score:10}]});
 await assert.rejects(service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[{...exam,maxPoints:36},notebook]}),/superan sus 35 puntos/);
 const plan=await service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[exam,notebook]});
 await service.savePeriodSheetGrades(owner,{period:'P2',courseId:course.id,revision:plan.revision,rows:[{studentId:students[0].id,scores:{[exam.id]:18,[notebook.id]:17}},{studentId:students[1].id,scores:{[exam.id]:0,[notebook.id]:0}}]});
 const report=await service.report(owner,course.id,students[0].id,'P2');
 assert.equal(report.directEvaluationMode,'combined');
 assert.equal(report.categories.find(item=>item.key==='exam')?.points,18);
 assert.equal(report.categories.find(item=>item.key==='notebook')?.points,17);
 assert.equal(report.grades.find(item=>item.activityId===activity.id)?.score,10);
 assert.equal(report.grades.find(item=>item.activityId===activity.id)?.countedInPeriod,false);
 const ledger=await service.teacherLedger(owner,'P2');
 assert.ok(ledger.directPlan?.enabled);
 assert.equal(ledger.rows.find(row=>row.student.id===students[0].id)?.categories.find(item=>item.key==='exam')?.points,18);
 const activityColumn=ledger.groups.flatMap(group=>group.columns).find(item=>item.key===`activity:${activity.id}`)!;
 assert.equal(ledger.rows.find(row=>row.student.id===students[0].id)?.scores.find(item=>item.key===activityColumn.key)?.state,'not_counted');
 const directView=await service.periodSheet(owner,'P2',course.id);
 assert.equal(directView.categories.find(item=>item.key==='notebook')?.weight,20);
 assert.equal(directView.rows[0].result.categories?.find(item=>item.category==='notebook')?.earned,17);
});

test('Participación, Disciplina, Examen y Libreta llegan a la matriz sin duplicar actividades ni borrar Comportamiento diario',async()=>{
 const {owner,course,students}=await fixture();
 const initial=await service.bootstrap(owner);const period=initial.plan.period;
 const configured=await service.updatePlan(owner,{...initial.plan,status:'confirmed',categories:initial.plan.categories.map(category=>category.key==='participation'?{...category,dailyWeights:{participation:40,behavior:40,discipline:20}}:category)});
 const examWeight=configured.categories.find(category=>category.key==='exam')!.weight;
 const notebookWeight=configured.categories.find(category=>category.key==='notebook')!.weight;
 const examActivity=await service.createActivity(owner,{courseId:course.id,category:'exam',title:'Examen ya preparado',date:configured.startDate,maxPoints:10,requestId:randomUUID()});
 await service.saveGrades(owner,{requestId:randomUUID(),activityId:examActivity.id,revision:examActivity.revision,rows:[{studentId:students[0].id,score:10}]});

 const attendance=await service.saveAttendance(owner,{requestId:randomUUID(),courseId:course.id,date:configured.startDate,block:1,revision:0,lessonType:'teoria',topic:'Clase de prueba',rows:students.map(student=>({studentId:student.id,status:'P'}))});
 const session=await service.attendance(owner,course.id,configured.startDate,1);
 await service.saveDailyAssessment(owner,{requestId:randomUUID(),courseId:course.id,date:configured.startDate,block:1,revision:attendance.revision,assessmentRevision:session.session.assessmentRevision,rows:students.map(student=>({studentId:student.id,participation:8,behavior:7,discipline:5,comment:''}))});

 const participation=column('Participación',10),discipline=column('Disciplina',10),exam=column('Examen directo',examWeight),notebook=column('Libreta global',notebookWeight);
 const columns=[
  {...participation,category:'participation' as const,captureKey:'participation' as const},
  {...discipline,category:'participation' as const,captureKey:'discipline' as const},
  {...exam,category:'exam' as const,captureKey:'exam' as const},
  {...notebook,category:'notebook' as const,captureKey:'notebook' as const},
 ];
 const plan=await service.savePeriodSheetPlan(owner,{period,revision:0,enabled:true,columns});
 await service.savePeriodSheetGrades(owner,{period,courseId:course.id,revision:plan.revision,rows:[{studentId:students[0].id,scores:{[participation.id]:8,[discipline.id]:5,[exam.id]:20,[notebook.id]:15}}]});

 const report=await service.report(owner,course.id,students[0].id,period);
 const participationCategory=report.categories.find(item=>item.key==='participation')!;
 assert.equal(participationCategory.points,10.5,'Combina los tres componentes internos de los 15 puntos');
 assert.deepEqual(participationCategory.dailyBreakdown,{
  participation:{percentage:40,rawEarned:8,rawPossible:10,points:4.8},
  behavior:{percentage:40,rawEarned:7,rawPossible:10,points:4.2},
  discipline:{percentage:20,rawEarned:5,rawPossible:10,points:1.5},
 });
 assert.equal(report.categories.find(item=>item.key==='exam')?.points,20);
 assert.equal(report.categories.find(item=>item.key==='notebook')?.points,15);
 assert.equal(report.grades.find(item=>item.activityId===examActivity.id)?.score,10,'La nota de actividad permanece guardada');
 assert.equal(report.grades.find(item=>item.activityId===examActivity.id)?.countedInPeriod,false,'No suma dos veces al usar la captura directa de Examen');

 const ledger=await service.teacherLedger(owner,period);
 const row=ledger.rows.find(item=>item.student.id===students[0].id)!;
 assert.equal(row.categories.find(item=>item.key==='participation')?.points,10.5);
 assert.equal(row.categories.find(item=>item.key==='exam')?.points,20);
 assert.equal(row.categories.find(item=>item.key==='notebook')?.points,15);
 const persisted=await service.periodSheet(owner,period,course.id);
 assert.deepEqual(persisted.plan.columns.map(item=>item.captureKey),['participation','discipline','exam','notebook']);
});

test('rechaza capturas de Participación/Disciplina sin reparto configurado y no mezcla modalidad diaria con directa',async()=>{
 const {owner,course}=await fixture();const participation=column('Participación',10);
 await assert.rejects(service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[{...participation,category:'participation',captureKey:'participation'}]}),/Configura primero el reparto/);
 const initial=await service.bootstrap(owner);
 await service.updatePlan(owner,{...initial.plan,status:'confirmed',categories:initial.plan.categories.map(category=>category.key==='participation'?{...category,dailyWeights:{participation:40,behavior:40,discipline:20}}:category)});
 const direct={...participation,category:'participation' as const,captureKey:'participation' as const};
 const legacy={...column('Valoración completa',15),category:'participation' as const};
 await assert.rejects(service.savePeriodSheetPlan(owner,{period:initial.plan.period,revision:0,enabled:true,columns:[direct,legacy]}),/No combines una columna directa/);
});

test('no mezcla propietarios, cursos ni períodos; funciona sin configurar un plan de actividades',async()=>{
 const {owner,course,other,students,outsiders}=await fixture();const col=column('Evaluación',100);
 const plan=await service.savePeriodSheetPlan(owner,{period:'P3',revision:0,enabled:true,columns:[col]});
 await assert.rejects(service.savePeriodSheetGrades(owner,{period:'P3',revision:plan.revision,courseId:course.id,rows:[{studentId:outsiders[0].id,scores:{[col.id]:80}}]}));
 await service.savePeriodSheetGrades(owner,{period:'P3',revision:plan.revision,courseId:course.id,rows:[{studentId:students[0].id,scores:{[col.id]:80}}]});
 assert.equal((await service.periodSheet(owner,'P3',other.id)).rows[0].result.total,null);
 assert.equal((await service.periodSheet(owner,'P2',course.id)).plan.enabled,false);
 await assert.rejects(service.periodSheet('different-owner','P3',course.id));
 assert.equal((await service.teacherLedger(owner,'P3')).rows.find(row=>row.student.id===students[0].id)?.weightedTotal,80);
 const exported=await service.exportData(owner);assert.equal(exported.periodScores.length,1);assert.equal(exported.periodScorePlans.length,1);
});

test('máximos, concurrencia y errores revierten el lote completo y protegen notas existentes',async()=>{
 const {owner,course,students}=await fixture();const col=column('Nota',100);
 await assert.rejects(service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[col,column('Exceso',1)]}));
 await assert.rejects(service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[{...col,date:'2026-02-31'}]}));
 const plan=await service.savePeriodSheetPlan(owner,{period:'P2',revision:0,enabled:true,columns:[col]});
 await assert.rejects(service.savePeriodSheetGrades(owner,{period:'P2',revision:plan.revision,courseId:course.id,rows:[{studentId:students[0].id,scores:{[col.id]:50}},{studentId:students[1].id,scores:{[col.id]:101}}]}));
 assert.equal((await service.periodSheet(owner,'P2',course.id)).rows[0].result.total,null);
 const saved=await service.savePeriodSheetGrades(owner,{period:'P2',revision:plan.revision,courseId:course.id,rows:[{studentId:students[0].id,scores:{[col.id]:90}}]});
 await assert.rejects(service.savePeriodSheetGrades(owner,{period:'P2',revision:plan.revision,courseId:course.id,rows:[{studentId:students[0].id,scores:{[col.id]:10}}]}),/otra sesión/);
 await assert.rejects(service.savePeriodSheetPlan(owner,{...plan,revision:saved.revision,columns:[{...col,maxPoints:80}]}),/ya tiene notas/);
 await assert.rejects(service.savePeriodSheetPlan(owner,{...plan,revision:saved.revision,columns:[column('Nueva',100)]}),/ya tiene notas/);
 assert.equal((await service.periodSheet(owner,'P2',course.id)).rows[0].result.total,90);
});
