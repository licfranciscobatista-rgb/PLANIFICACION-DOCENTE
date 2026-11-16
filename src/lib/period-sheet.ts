import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DBAdapter } from './db';
import { AppError, type PeriodSheetPlan, type PeriodSheetResult } from './model';
import { requireDate, round } from './engine';

const periodSchema=z.enum(['P1','P2','P3','P4']);
const points=z.number().finite().min(0).max(100).refine(n=>Math.abs(n*100-Math.round(n*100))<0.000001,'Usa como máximo dos decimales.');
const columnSchema=z.object({id:z.string().uuid(),label:z.string().trim().min(1).max(160),maxPoints:points.refine(n=>n>0),date:z.string().nullable()});
const planSchema=z.object({period:periodSchema,revision:z.number().int().min(0),enabled:z.boolean(),columns:z.array(columnSchema).max(100)});
const gradesSchema=z.object({period:periodSchema,revision:z.number().int().min(0),courseId:z.string().uuid(),rows:z.array(z.object({studentId:z.string().uuid(),scores:z.record(z.string().uuid(),points.nullable())})).max(1000)});
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const result=schema.safeParse(input);if(!result.success)throw new AppError(400,result.error.issues[0].message);return result.data;}
export async function readPeriodSheet(db:DBAdapter,owner:string,period:string):Promise<PeriodSheetPlan>{
  if(!periodSchema.safeParse(period).success)return {period,revision:0,enabled:false,columns:[]};
  const row=(await db.query('SELECT revision,enabled,columns FROM period_score_plans WHERE owner_id=$1 AND period=$2',[owner,period])).rows[0];
  return {period,revision:Number(row?.revision??0),enabled:Boolean(row?.enabled),columns:row?(typeof row.columns==='string'?JSON.parse(row.columns):row.columns) as PeriodSheetPlan['columns']:[]};
}
export function periodSheetResult(plan:PeriodSheetPlan,scores:Record<string,number|null>):PeriodSheetResult {
  const values=plan.columns.map(column=>scores[column.id]??null);
  const total=values.some(value=>value!==null)?round(values.reduce<number>((sum,value)=>sum+(value??0),0)):null;
  const planned=round(plan.columns.reduce((sum,column)=>sum+column.maxPoints,0));
  const pending=values.filter(value=>value===null).length;
  return {columns:plan.columns,scores:Object.fromEntries(plan.columns.map(column=>[column.id,scores[column.id]??null])),plannedPoints:planned,pending,accumulated:total,total:planned===100&&pending===0?total:null};
}
export async function studentPeriodSheet(db:DBAdapter,owner:string,period:string,studentId:string):Promise<PeriodSheetResult|undefined>{
  const plan=await readPeriodSheet(db,owner,period);if(!plan.enabled)return;
  const grades=(await db.query('SELECT column_id,score FROM period_scores WHERE owner_id=$1 AND period=$2 AND student_id=$3',[owner,period,studentId])).rows;
  return periodSheetResult(plan,Object.fromEntries(grades.map(row=>[String(row.column_id),row.score===null?null:Number(row.score)])));
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
export async function savePeriodSheetPlan(db:DBAdapter,owner:string,input:unknown){
  const value=parse(planSchema,input);
  if(new Set(value.columns.map(column=>column.id)).size!==value.columns.length)throw new AppError(400,'No repitas columnas.');
  if(round(value.columns.reduce((sum,column)=>sum+column.maxPoints,0))>100)throw new AppError(400,'Las columnas no pueden sumar más de 100 puntos.');
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
