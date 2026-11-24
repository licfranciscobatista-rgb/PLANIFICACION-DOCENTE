import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DBAdapter } from './db';
import { AppError, CATEGORY_KEYS, COMPETENCY_GROUPS, type PeriodSheetCaptureKey, type PeriodSheetPlan, type PeriodSheetResult } from './model';
import { requireDate, round } from './engine';

const periodSchema=z.enum(['P1','P2','P3','P4']);
const points=z.number().finite().min(0).max(100).refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'Usa como máximo dos decimales.');
const columnSchema=z.object({id:z.string().uuid(),label:z.string().trim().min(1).max(160),maxPoints:points.refine(n=>n>0),date:z.string().nullable(),category:z.enum([...CATEGORY_KEYS,'extra']).nullable().optional(),group:z.string().trim().max(100).nullable().optional(),competency:z.enum(COMPETENCY_GROUPS.map(item=>item.key) as [typeof COMPETENCY_GROUPS[number]['key'],...typeof COMPETENCY_GROUPS[number]['key'][]]).nullable().optional(),captureKey:z.enum(['participation','discipline','exam','notebook']).optional()});
const planSchema=z.object({period:periodSchema,revision:z.number().int().min(0),enabled:z.boolean(),columns:z.array(columnSchema).max(100)});
const gradesSchema=z.object({period:periodSchema,revision:z.number().int().min(0),courseId:z.string().uuid(),rows:z.array(z.object({studentId:z.string().uuid(),scores:z.record(z.string().uuid(),points.nullable())})).max(1000)});
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const result=schema.safeParse(input);if(!result.success)throw new AppError(400,result.error.issues[0].message);return result.data;}
export async function readPeriodSheet(db:DBAdapter,owner:string,period:string):Promise<PeriodSheetPlan>{
  if(!periodSchema.safeParse(period).success)return {period,revision:0,enabled:false,columns:[]};
  const row=(await db.query('SELECT revision,enabled,columns FROM period_score_plans WHERE owner_id=$1 AND period=$2',[owner,period])).rows[0];
  return {period,revision:Number(row?.revision??0),enabled:Boolean(row?.enabled),columns:row?(typeof row.columns==='string'?JSON.parse(row.columns):row.columns) as PeriodSheetPlan['columns']:[]};
}
export function periodSheetResult(plan:PeriodSheetPlan,scores:Record<string,number|null>,categoryWeights:Record<string,number>={}):PeriodSheetResult {
  const values=plan.columns.map(column=>scores[column.id]??null);
  const total=values.some(value=>value!==null)?round(values.reduce<number>((sum,value)=>sum+(value??0),0)):null;
  const planned=round(plan.columns.reduce((sum,column)=>sum+column.maxPoints,0));
  const pending=values.filter(value=>value===null).length;
  const categories=plan.columns.some(column=>Boolean(column.category))
    ?[...new Set(plan.columns.flatMap(column=>column.category?[column.category]:[]))].map(category=>{
      const columns=plan.columns.filter(column=>column.category===category);
      const dimensionColumns=columns.filter(column=>column.captureKey==='participation'||column.captureKey==='discipline');
      if(category==='participation'&&dimensionColumns.length){
        const dimensions=[...new Set(dimensionColumns.map(column=>column.captureKey as PeriodSheetCaptureKey))];
        const pending=dimensionColumns.filter(column=>scores[column.id]===null||scores[column.id]===undefined).length;
        const possible=round(dimensions.reduce((sum,dimension)=>sum+(categoryWeights[`participation:${dimension}`]??0),0));
        const earned=round(dimensions.reduce((sum,dimension)=>{
          const group=dimensionColumns.filter(column=>column.captureKey===dimension);
          const rawPossible=group.reduce((total,column)=>total+column.maxPoints,0);
          const rawEarned=group.reduce((total,column)=>total+(scores[column.id]??0),0);
          const weight=categoryWeights[`participation:${dimension}`]??0;
          return sum+(rawPossible?rawEarned/rawPossible*weight:0);
        },0));
        return {category,earned,possible,weight:possible,points:earned,pending,complete:pending===0};
      }
      const possible=round(columns.reduce((sum,column)=>sum+column.maxPoints,0));
      const categoryPending=columns.filter(column=>scores[column.id]===null||scores[column.id]===undefined).length;
      const earned=round(columns.reduce((sum,column)=>sum+(scores[column.id]??0),0));
      const weight=category==='extra'?null:categoryWeights[category]??null;
      return {category,earned,possible,weight,points:earned,pending:categoryPending,complete:categoryPending===0&&(weight===null||possible===weight)};
    })
    :undefined;
  const categorized=Boolean(categories?.length);
  return {columns:plan.columns,scores:Object.fromEntries(plan.columns.map(column=>[column.id,scores[column.id]??null])),plannedPoints:planned,pending,accumulated:total,total:!categorized&&planned===100&&pending===0?total:null,...(categories?{categories}:{})};
}
export async function studentPeriodSheet(db:DBAdapter,owner:string,period:string,studentId:string,categoryWeights:Record<string,number>={}):Promise<PeriodSheetResult|undefined>{
  const plan=await readPeriodSheet(db,owner,period);if(!plan.enabled)return;
  const grades=(await db.query('SELECT column_id,score FROM period_scores WHERE owner_id=$1 AND period=$2 AND student_id=$3',[owner,period,studentId])).rows;
  return periodSheetResult(plan,Object.fromEntries(grades.map(row=>[String(row.column_id),row.score===null?null:Number(row.score)])),categoryWeights);
}
async function lockPlan(db:DBAdapter,owner:string,period:string,revision:number){
  await db.query('INSERT INTO period_score_plans(owner_id,period) VALUES($1,$2) ON CONFLICT DO NOTHING',[owner,period]);
  await db.query('SELECT revision FROM period_score_plans WHERE owner_id=$1 AND period=$2 FOR UPDATE',[owner,period]);
  const before=await readPeriodSheet(db,owner,period);
  if(before.revision!==revision)throw new AppError(409,'El cuadro cambió en otra sesión. Recarga antes de guardar; tu borrador sigue visible.');
  return before;
}
async function audit(db:DBAdapter,owner:string,period:string,operation:string,before:unknown,after:unknown){
  await db.query('INSERT INTO audit_entries(id,owner_id,operation,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[randomUUID(),owner,operation,period,JSON.stringify(before),JSON.stringify(after)]);
}
export async function savePeriodSheetPlan(db:DBAdapter,owner:string,input:unknown,categoryWeights:Record<string,number>={}){
  const value=parse(planSchema,input);
  if(new Set(value.columns.map(column=>column.id)).size!==value.columns.length)throw new AppError(400,'No repitas columnas.');
  const categorized=value.columns.some(column=>Boolean(column.category));
  for(const column of value.columns){
    if(!column.captureKey)continue;
    const expectedCategory=column.captureKey==='participation'||column.captureKey==='discipline'?'participation':column.captureKey;
    if(column.category!==expectedCategory)throw new AppError(400,`La captura de ${column.captureKey} debe estar asignada a ${expectedCategory}.`);
    if((column.captureKey==='participation'||column.captureKey==='discipline')&&!(categoryWeights[`participation:${column.captureKey}`]>0))throw new AppError(400,'Configura primero el reparto de los 15 puntos entre participación, comportamiento y disciplina.');
  }
  const participationColumns=value.columns.filter(column=>column.category==='participation');
  if(participationColumns.some(column=>column.captureKey==='participation'||column.captureKey==='discipline')&&participationColumns.some(column=>column.captureKey!=='participation'&&column.captureKey!=='discipline'))throw new AppError(400,'No combines una columna directa de Participación/Disciplina con una valoración diaria completa. Usa una sola modalidad para esos 15 puntos.');
  if(categorized&&value.columns.some(column=>!column.category))throw new AppError(400,'Asigna una categoría a cada columna para combinar el cuadro con las actividades.');
  if(!categorized&&round(value.columns.reduce((sum,column)=>sum+column.maxPoints,0))>100)throw new AppError(400,'Las columnas no pueden sumar más de 100 puntos.');
  if(categorized){
    const plannedByCategory=new Map<string,number>();
    for(const column of value.columns)if(column.category!=='extra'&&column.captureKey!=='participation'&&column.captureKey!=='discipline')plannedByCategory.set(column.category!,round((plannedByCategory.get(column.category!)??0)+column.maxPoints));
    for(const [category,planned] of plannedByCategory){const weight=categoryWeights[category];if(weight===undefined)throw new AppError(400,`No se encontró el peso de la categoría ${category} en el plan del período.`);if(planned>weight)throw new AppError(400,`Las columnas de ${category} suman ${planned} puntos y superan sus ${weight} puntos disponibles. Ajusta los máximos antes de guardar.`);}
  }
  if(value.enabled&&!value.columns.length)throw new AppError(400,'Añade al menos una columna para calificar.');
  for(const column of value.columns)if(column.date)requireDate(column.date);
  return db.transaction(async tx=>{
    const before=await lockPlan(tx,owner,value.period,value.revision);
    if(!value.enabled&&!(await tx.query('SELECT period FROM evaluation_plans WHERE owner_id=$1 AND period=$2',[owner,value.period])).rows.length)throw new AppError(400,'Antes de volver a las actividades, configura su plan para este período.');
    const recorded=(await tx.query('SELECT column_id,max(score) AS maximum FROM period_scores WHERE owner_id=$1 AND period=$2 AND score IS NOT NULL GROUP BY column_id',[owner,value.period])).rows;
    for(const record of recorded){const column=value.columns.find(column=>column.id===String(record.column_id));if(!column||column.maxPoints<Number(record.maximum))throw new AppError(409,'Esta columna ya tiene notas. Consérvala y no reduzcas su máximo por debajo de las notas guardadas.');}
    const after={...value,revision:before.revision+1};
    await tx.query('UPDATE period_score_plans SET columns=$1::jsonb,enabled=$2,revision=$3 WHERE owner_id=$4 AND period=$5',[JSON.stringify(value.columns),value.enabled,after.revision,owner,value.period]);
    await audit(tx,owner,value.period,'period-sheet.configured',before,after);return after;
  });
}
export async function savePeriodSheetGrades(db:DBAdapter,owner:string,input:unknown){
  const value=parse(gradesSchema,input);
  return db.transaction(async tx=>{
    const plan=await lockPlan(tx,owner,value.period,value.revision);
    if(!(await tx.query('SELECT id FROM courses WHERE owner_id=$1 AND id=$2',[owner,value.courseId])).rows.length)throw new AppError(404,'El curso no pertenece a este registro.');
    if(!plan.columns.length)throw new AppError(400,'Configura primero las columnas del período.');
    const roster=(await tx.query('SELECT id FROM students WHERE owner_id=$1 AND course_id=$2',[owner,value.courseId])).rows;
    const members=new Set(roster.map(row=>String(row.id))),seen=new Set<string>();
    const old=(await tx.query('SELECT student_id,column_id,score FROM period_scores WHERE owner_id=$1 AND period=$2 AND course_id=$3',[owner,value.period,value.courseId])).rows;
    for(const row of value.rows){
      if(!members.has(row.studentId)||seen.has(row.studentId))throw new AppError(400,'La lista contiene un estudiante ajeno o repetido.');seen.add(row.studentId);
      for(const [id,score] of Object.entries(row.scores)){
        const column=plan.columns.find(column=>column.id===id);
        if(!column||score!==null&&score>column.maxPoints)throw new AppError(400,'Revisa la columna y su puntuación máxima.');
        await tx.query('INSERT INTO period_scores(owner_id,period,course_id,student_id,column_id,score) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,period,course_id,student_id,column_id) DO UPDATE SET score=EXCLUDED.score',[owner,value.period,value.courseId,row.studentId,id,score]);
      }
    }
    await tx.query('UPDATE period_score_plans SET revision=revision+1 WHERE owner_id=$1 AND period=$2',[owner,value.period]);
    await audit(tx,owner,value.period,'period-sheet.graded',old,value);
    return {revision:plan.revision+1,savedRows:value.rows.length};
  });
}
