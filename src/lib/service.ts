import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DBAdapter } from "./db";
import { Activity, ActivityCategoryKey, ActivityIndicatorPoint, ActivityInput, AppError, AttendanceInput, AttendanceRow, AttendanceView, AuditEntry, Bootstrap, CategoryReport, CompetencyKey, CompetencyScore, COMPETENCY_GROUPS, COURSE_SIZES, Course, CourseRegisterSummary, EvaluationCriterion, EvaluationPlan, GradeRow, GradesInput, GradesView, IndicatorUsageRecord, RubricCriterion, RosterRow, SaveReceipt, ServiceOptions, SharedActivityInput, Student, StudentReport, TeacherLedgerSummary, SequenceActivity, SequencePlan } from "./model";
import { payloadHash, plan, requireDate, round, rubricMaximum, rubricScore, sessionStatus, todayInSchool } from "./engine";
import classCalendar from "./data/class-schedule-2026-27.json";

type Row = Record<string, unknown>;
const uid = z.string().uuid();
const text = z.string().max(4000);
const attendanceSchema = z.object({ requestId: z.string().min(1).max(200), courseId: uid, date: z.string(), block: z.number().int().min(1).max(12), revision: z.number().int().min(0), lessonType: z.enum(["teoria", "practica", "ejercicios", "repaso", "correcciones", "actividad_escolar"]), topic: text.optional(), notes: text.optional(), rows: z.array(z.object({ studentId: uid, status: z.enum(["P", "A", "T", "E", "R"]).nullable(), behavior: z.number().finite().min(0).max(10000).nullable().optional(), comment: text.optional() })).max(1000) });
const gradesSchema = z.object({ requestId: z.string().min(1).max(200), activityId: uid, revision: z.number().int().min(0), rows: z.array(z.object({ studentId: uid, score: z.number().finite().min(0).max(10000).nullable(), criterionLevels: z.record(z.string(), z.number().int().min(0).max(5)).nullable().optional(), comment: text.optional() })).max(1000) });
const competencyKey = z.enum(COMPETENCY_GROUPS.map(x => x.key) as [CompetencyKey, ...CompetencyKey[]]);
const rubricLevelSchema = z.object({ label: z.string().trim().min(1).max(100), points: z.number().finite().min(0), description: z.string().max(1000).optional() });
const rubricLevelsSchema = z.array(rubricLevelSchema).min(2).max(6);
const sourceAssessmentSchema = z.object({ annexNumber:z.number().int().min(1).max(99), title:z.string().max(500), kind:z.enum(["checklist","rubric","scale","exam_guide"]), criteria:z.array(z.string().max(1000)).max(100), levels:rubricLevelsSchema.or(z.array(rubricLevelSchema).length(0)), maxPoints:z.number().finite().nonnegative().max(10000).nullable(), scoringNote:z.string().max(2000), scored:z.boolean(), relatedIndicatorText:z.string().max(2000).optional(), relatedCompetencyText:z.string().max(2000).optional() });
const finalAssessmentSchema = z.object({ title:z.string().max(250), period:z.string().max(2), internalMaxPoints:z.number().finite().positive().max(10000).nullable(), periodPoints:z.number().finite().nonnegative().max(10000).nullable(), instrument:sourceAssessmentSchema });
const activitySchema = z.object({ courseId: uid, category: z.enum(["exam", "participation", "notebook", "sequence", "homework", "extra"]), title: z.string().trim().min(1).max(250), date: z.string(), block: z.number().int().min(1).max(12).optional(), maxPoints: z.number().finite().positive().max(10000), scoringMode: z.enum(["points", "rubric"]).optional(), rubric: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(200), competency: competencyKey.nullable().optional(), indicator: z.string().max(500).optional(), weight: z.number().finite().positive().max(10000).optional(), levels: rubricLevelsSchema })).optional(), description: text.optional(), sequenceCode: z.string().max(80).optional(), sequenceActivityId: z.string().min(1).max(100).optional(), evidence: z.string().max(1000).optional(), instrument: z.string().max(250).optional(), purpose: z.string().max(500).optional(), competency: competencyKey.nullable().optional(), indicator: z.string().max(500).optional(), requestId: z.string().min(1).max(200).optional() });
const sharedActivitySchema = z.object({ courseIds: z.array(uid).min(1).max(20), activity: activitySchema.omit({ courseId: true }).extend({ requestId: z.string().min(1).max(200) }) });
const sequenceActivitySchema = z.object({ id:z.string().min(1).max(100), code:z.string().max(80), theme:z.string().max(250), title:z.string().trim().max(250), lessonType:z.enum(["teoria","practica","ejercicios","repaso","correcciones","actividad_escolar"]).nullable(), description:z.string().max(4000), evidence:z.string().max(1000), indicatorIds:z.array(z.string().min(1).max(100)).max(100), period:z.string().max(2).optional(), evaluationPurpose:z.enum(["diagnostica","formativa","sumativa","formativa_sumativa"]).nullable().optional(), plannedPoints:z.number().finite().nonnegative().max(10000).nullable().optional(), plannedPercent:z.number().finite().min(0).max(100).nullable().optional(), instrument:z.string().max(1000).optional(), evaluationCriteria:z.array(z.string().max(1000)).max(100).optional(), feedback:z.string().max(2000).optional(), assessmentInstrument:sourceAssessmentSchema.optional() });
const sequenceSchema = z.object({ source: z.enum(["manual","uploaded"]), sourceName: z.string().max(250), sourceText: z.string().max(80000), reviewed: z.boolean(), planningMode:z.enum(["sequence","manual"]).optional(), activePlanningPeriod:z.enum(["P1","P2","P3","P4"]).nullable().optional(), activities: z.array(sequenceActivitySchema).max(300), indicators: z.array(z.object({ id:z.string().min(1).max(100), code:z.string().max(80), label:z.string().trim().max(500), competency:competencyKey.nullable() })).max(300), finalAssessment:finalAssessmentSchema.optional() });
const planSchema = z.object({ period: z.string(), startDate: z.string(), endDate: z.string(), status: z.enum(["provisional", "confirmed"]), note: z.string().max(4000), categories: z.array(z.object({ key: z.enum(["exam", "participation", "notebook", "sequence", "homework"]), label: z.string().trim().min(1).max(200), group: z.string().trim().min(1).max(100).optional(), weight: z.number().finite(), expectedRaw: z.number().finite().nullable(), dailyMax: z.number().finite().nullable(), targetSessions: z.number().int().nullable(), competency: competencyKey.nullable().optional() })).length(5), sequence: sequenceSchema.optional() });
const criterionSchema = z.object({ id: uid.optional(), label: z.string().trim().min(1).max(200), levels: z.array(z.object({label:z.string().trim().min(1).max(100),points:z.number().finite(),description:z.string().max(1000)})).length(4) });
const criterionImportSchema = z.object({ criteria: z.array(criterionSchema.omit({ id: true })).min(1).max(50) });
const rosterRowSchema = z.object({ externalId: z.string().trim().min(1).max(200), number: z.number().int().positive().max(10000), name: z.string().trim().min(1).max(250) });
const rosterBatchesSchema = z.array(z.object({ courseId: uid, rows: z.array(rosterRowSchema).min(1).max(250) })).min(1).max(20);
const activityEvaluationSchema = z.object({ requestId:z.string().min(1).max(200), activityId:uid, revision:z.number().int().min(0), scoringMode:z.enum(["points","rubric"]), instrument:z.string().max(250), manualIndicators:z.array(z.object({id:z.string().min(1).max(100),code:z.string().max(80),label:z.string().trim().min(1).max(500),competency:competencyKey})).max(100).optional().default([]), indicatorPoints:z.array(z.object({indicatorId:z.string().min(1).max(100),points:z.number().finite().positive()})).max(100), rubric:z.array(z.object({id:z.string().min(1).max(100),label:z.string().trim().min(1).max(200),competency:competencyKey.nullable().optional(),indicator:z.string().max(500).optional(),indicatorId:z.string().min(1).max(100).optional(),weight:z.number().finite().positive().max(10000).optional(),levels:rubricLevelsSchema})).max(100) });
const courseSchema = z.object({ code:z.string().trim().min(1).max(12).regex(/^[A-Za-z0-9_-]+$/), name:z.string().trim().min(1).max(120), startDate:z.string(), endDate:z.string(), weekly:z.array(z.object({weekday:z.number().int().min(1).max(7),blocks:z.array(z.number().int().min(1).max(12)).min(1).max(12)})).min(1).max(7).optional(), noClassDates:z.array(z.string()).max(100).default([]) });
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new AppError(400, "Datos inválidos: " + r.error.issues[0].message); return r.data; }
function findLinkedSequenceActivity(sequence: SequencePlan | null | undefined, id: string | null | undefined, code: string | undefined, evaluationPeriod: string | null | undefined): SequenceActivity | undefined {
 if (!sequence) return undefined;
 if (id) return sequence.activities.find(item => item.id === id);
 if (!code || code === "MANUAL") return undefined;
 const matches = sequence.activities.filter(item => item.code === code);
 return matches.find(item => item.period === evaluationPeriod) ?? (matches.length === 1 ? matches[0] : undefined);
}
function rejectUnscoredDiagnostic(source: SequenceActivity | undefined) {
 if (source?.evaluationPurpose === "diagnostica" && !(Number(source.plannedPoints) > 0 || Number(source.plannedPercent) > 0)) {
  throw new AppError(400, "La secuencia marca esta actividad como diagnóstica sin ponderación. Consérvala en la secuencia; no la conviertas en una nota.", "DIAGNOSTIC_NOT_GRADED");
 }
}
function unclassifiedIndicatorsUsedByActivities(sequence: Pick<SequencePlan, "activities" | "indicators">) {
 const usedIds = new Set(sequence.activities.flatMap(item => item.indicatorIds));
 return sequence.indicators.filter(item => usedIds.has(item.id) && !item.competency);
}
function num(value: unknown) { return value === null || value === undefined ? null : Number(value); }
function str(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function json<T>(value: unknown, fallback: T): T { return value === null || value === undefined ? fallback : typeof value === "string" ? JSON.parse(value) as T : value as T; }
function student(r: Row): Student { return { id: str(r.id), courseId: str(r.course_id), externalId: str(r.external_id), number: Number(r.number), name: str(r.name), active: Boolean(r.active) }; }
function activity(r: Row): Activity { return { id: str(r.id), courseId: str(r.course_id), sharedId: str(r.shared_id) || null, period: str(r.period), category: r.category as Activity["category"], title: str(r.title), date: str(r.date), createdAt: str(r.created_at) || null, block: Number(r.block), maxPoints: Number(r.max_points), scoringMode: r.scoring_mode as Activity["scoringMode"], rubric: json(r.rubric, []), indicatorPoints: json(r.indicator_points, []), description: str(r.description), sequenceCode: str(r.sequence_code), sequenceActivityId: str(r.sequence_activity_id) || null, sequencePlannedPeriod: str(r.sequence_planned_period) || null, evidence: str(r.evidence), instrument: str(r.instrument), purpose: str(r.activity_purpose), competency: str(r.competency) as CompetencyKey || null, indicator: str(r.indicator), revision: Number(r.revision) }; }
const activityFields = "id,course_id,shared_id,period,category,title,activity_date::text AS date,created_at::text AS created_at,block,max_points,scoring_mode,rubric,indicator_points,description,sequence_code,sequence_activity_id,sequence_planned_period,evidence,instrument,activity_purpose,competency,indicator,revision";
const defaultCompetency: Record<ActivityCategoryKey, CompetencyKey> = { exam: "logico_matematica", participation: "desarrollo_personal", notebook: "logico_matematica", sequence: "logico_matematica", homework: "logico_matematica", extra: "logico_matematica" };
function defaultForCategory(key: ActivityCategoryKey): CompetencyKey { return defaultCompetency[key] ?? "logico_matematica"; }
function normalizedPlan(value: EvaluationPlan): EvaluationPlan { return { ...value, categories: value.categories.map(c => ({ ...c, competency: c.competency ?? defaultForCategory(c.key) })) }; }
function mergeLegacySequences(plans: EvaluationPlan[]): SequencePlan | null {
 const legacyPlans = plans.filter(item => item.sequence);
 if (!legacyPlans.length) return null;
 const activities = legacyPlans.flatMap(item => (item.sequence?.activities ?? []).map(activity => ({ ...activity, id: `legacy:${item.period}:${activity.id.slice(0,80)}`, period: activity.period || item.period })));
 const indicators = [...new Map(legacyPlans.flatMap(item => item.sequence?.indicators ?? []).map(indicator => [indicator.id,indicator])).values()];
 return { source: legacyPlans.some(item => item.sequence?.source === "uploaded") ? "uploaded" : "manual", sourceName: "Secuencias de períodos anteriores", sourceText: legacyPlans.map(item => item.sequence?.sourceText ?? "").filter(Boolean).join("\n\n").slice(0,80000), reviewed: legacyPlans.every(item => Boolean(item.sequence?.reviewed)), activities, indicators };
}
function competencyName(key: CompetencyKey) { return COMPETENCY_GROUPS.find(x => x.key === key)?.label ?? key; }
const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
function criterionMaximum(criterion:RubricCriterion){return Math.max(...criterion.levels.map(level=>level.points))*(criterion.weight??1);}
function indicatorRubricRatio(rubric:RubricCriterion[],levels:Record<string,number>|null,indicatorId:string){
 const criteria=rubric.filter(item=>item.indicatorId===indicatorId);if(!criteria.length||!levels||criteria.some(item=>!Number.isInteger(levels[item.id])||levels[item.id]<0||levels[item.id]>=item.levels.length))return null;
 const maximum=criteria.reduce((sum,item)=>sum+criterionMaximum(item),0);
 const earned=criteria.reduce((sum,item)=>sum+item.levels[levels[item.id]].points*(item.weight??1),0);
 return maximum?Math.max(0,Math.min(1,earned/maximum)):null;
}
function allocatedRubricScore(rubric:RubricCriterion[],levels:Record<string,number>,allocations:ActivityIndicatorPoint[]){
 return round(allocations.reduce((sum,allocation)=>sum+(indicatorRubricRatio(rubric,levels,allocation.indicatorId)??0)*allocation.points,0));
}

export class RegistroService {
 constructor(private db: DBAdapter, private options: ServiceOptions = {}) {}
 private today() { return this.options.today?.() ?? todayInSchool(); }
 private validateOwner(ownerId: string) { if (typeof ownerId !== "string" || ownerId.length < 1 || ownerId.length > 200) throw new AppError(401, "La sesión de usuario no es válida."); }
 private async ensureOwner(ownerId: string) {
  this.validateOwner(ownerId);
  await this.db.transaction(async tx => {
   const created = await tx.query("INSERT INTO workspaces(owner_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING owner_id", [ownerId]);
   if (created.rows.length) {
    const initialPlan = plan();
    await tx.query("INSERT INTO evaluation_plans(owner_id,period,config,active) VALUES($1,$2,$3::jsonb,true)", [ownerId, initialPlan.period, JSON.stringify(initialPlan)]);
    if (this.options.demo && this.options.seedDemoRoster !== false) for (const [code, size] of Object.entries(COURSE_SIZES)) {
     const id = randomUUID(); await tx.query("INSERT INTO courses(id,owner_id,code,name) VALUES($1,$2,$3,$4)", [id, ownerId, code, "5.º " + code.slice(1)]);
     for (let n = 1; n <= size; n++) await tx.query("INSERT INTO students(id,owner_id,course_id,external_id,number,name) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), ownerId, id, `${code}-${String(n).padStart(2, "0")}`, n, `Estudiante ${code} ${String(n).padStart(2, "0")}`]);
    }
   }
   const seeded = await tx.query("SELECT 1 FROM scheduled_sessions WHERE owner_id=$1 LIMIT 1", [ownerId]);
   if (!seeded.rows.length) {
    const courseIds = new Map((await tx.query("SELECT id,code FROM courses WHERE owner_id=$1", [ownerId])).rows.map(row => [str(row.code), str(row.id)]));
    const rows = classCalendar.sessions.filter(slot => courseIds.has(slot.courseCode));
    const params: unknown[] = [];
    const values = rows.map((slot,index) => {
     const courseId = courseIds.get(slot.courseCode)!;
     const start = index * 4 + 1;
     params.push(ownerId,courseId,slot.date,slot.block);
     return `($${start},$${start+1},$${start+2}::date,$${start+3}::integer)`;
    });
    if (values.length) await tx.query(`INSERT INTO scheduled_sessions(owner_id,course_id,session_date,block) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`, params);
   }
  });
 }
 private async currentPlan(ownerId: string, tx = this.db): Promise<EvaluationPlan> { const r = await tx.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 AND active=true", [ownerId]); if (!r.rows.length) throw new AppError(409, "Falta el plan evaluativo activo."); return normalizedPlan(json(r.rows[0].config, plan())); }
 private async planForPeriod(ownerId: string, period: string, tx = this.db): Promise<EvaluationPlan> { const r = await tx.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 AND period=$2", [ownerId, period]); if (!r.rows.length) throw new AppError(404, `No hay un plan guardado para ${period}.`, "NOT_FOUND"); return normalizedPlan(json(r.rows[0].config, plan())); }
 private async curriculumSequence(ownerId:string,tx=this.db):Promise<Bootstrap["curriculumSequence"]> {
  const row=(await tx.query("SELECT config FROM curriculum_sequences WHERE owner_id=$1",[ownerId])).rows[0];
  if(row)return json<Bootstrap["curriculumSequence"]>(row.config,null);
  const legacyRows=(await tx.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 ORDER BY period",[ownerId])).rows;
  return mergeLegacySequences(legacyRows.map(item=>normalizedPlan(json(item.config,plan()))));
 }
 private async requireCourse(ownerId: string, courseId: string, tx = this.db) { parse(uid,courseId); const r = await tx.query("SELECT id,code,name FROM courses WHERE owner_id=$1 AND id=$2", [ownerId, courseId]); if (!r.rows.length) throw new AppError(404, "El curso no pertenece a este registro.", "NOT_FOUND"); return r.rows[0]; }
 private async roster(ownerId: string, courseId: string, tx = this.db) { return (await tx.query("SELECT id,course_id,external_id,number,name,active FROM students WHERE owner_id=$1 AND course_id=$2 ORDER BY number,id", [ownerId, courseId])).rows.map(student); }
 private validateStudents(rows: { studentId: string }[], roster: Student[]) { const valid = new Set(roster.map(x => x.id)), seen = new Set<string>(); for (const row of rows) { if (!valid.has(row.studentId)) throw new AppError(400, "Hay un estudiante que no pertenece a este curso.", "CROSS_COURSE"); if (seen.has(row.studentId)) throw new AppError(400, "Un estudiante aparece más de una vez en el lote."); seen.add(row.studentId); } }
 private async log(tx: DBAdapter, ownerId: string, operation: string, entityId: string, before: unknown, after: unknown) { await tx.query("INSERT INTO audit_entries(id,owner_id,operation,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [randomUUID(), ownerId, operation, entityId, JSON.stringify(before), JSON.stringify(after)]); }
 private async evaluationCriteria(ownerId:string,tx:DBAdapter=this.db,activeOnly=true):Promise<EvaluationCriterion[]>{
  const criteria=(await tx.query(`SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 ${activeOnly?"AND active=true":""} ORDER BY label,id`,[ownerId])).rows;
  if(!criteria.length)return [];
  const rows=(await tx.query("SELECT criterion_id,level_label,points,descriptor FROM evaluation_criterion_values WHERE owner_id=$1 ORDER BY criterion_id,level_position",[ownerId])).rows;
  const values=new Map<string,EvaluationCriterion['levels']>();
  for(const row of rows){const id=str(row.criterion_id);const list=values.get(id)??[];list.push({label:str(row.level_label),points:Number(row.points),description:str(row.descriptor)});values.set(id,list);}
  return criteria.map(row=>({id:str(row.id),label:str(row.label),levels:values.get(str(row.id))??json(row.levels,[]),active:Boolean(row.active)}));
 }
 private async persistActivityCriteria(ownerId:string,activityId:string,rubric:RubricCriterion[],tx:DBAdapter):Promise<void>{
  await tx.query("DELETE FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2",[ownerId,activityId]);
  if(!rubric.length)return;
  const catalogIds=new Set((await tx.query("SELECT id FROM evaluation_criteria WHERE owner_id=$1",[ownerId])).rows.map(row=>str(row.id)));
  for(const [index,item] of rubric.entries())await tx.query("INSERT INTO activity_criteria(owner_id,activity_id,criterion_key,catalog_criterion_id,criterion_label,indicator_id,competency,weight,position,levels_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)",[ownerId,activityId,item.id,catalogIds.has(item.id)?item.id:null,item.label,item.indicatorId??"",item.competency??"",item.weight??1,index+1,JSON.stringify(item.levels)]);
 }
 private async activityWithCriteria(ownerId:string,row:Row,tx:DBAdapter=this.db):Promise<Activity>{
  const base=activity(row);const assignments=(await tx.query("SELECT criterion_key,criterion_label,indicator_id,competency,weight,levels_snapshot FROM activity_criteria WHERE owner_id=$1 AND activity_id=$2 ORDER BY position",[ownerId,base.id])).rows;
  if(!assignments.length)return base;
  if(assignments.length!==base.rubric.length)throw new AppError(500,"Los criterios relacionados con la actividad no coinciden con su comprobante de valoración.","ACTIVITY_CRITERIA_MISMATCH");
  const rubric:RubricCriterion[]=assignments.map(item=>{const indicatorId=str(item.indicator_id);const indicator=base.indicatorPoints.find(point=>point.indicatorId===indicatorId)?.label??"";return {id:str(item.criterion_key),label:str(item.criterion_label),indicatorId,indicator,competency:str(item.competency) as CompetencyKey,weight:Number(item.weight),levels:json(item.levels_snapshot,[])};});
  return {...base,rubric};
 }
 private async operation<T extends SaveReceipt>(ownerId: string, requestId: string, payload: unknown, work: (tx: DBAdapter, operationId: string) => Promise<T>): Promise<T> {
  const hash = payloadHash(payload);
  return this.db.transaction(async tx => {
   const id = randomUUID();
   const insert = await tx.query("INSERT INTO save_operations(id,owner_id,request_id,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,request_id) DO NOTHING RETURNING id", [id, ownerId, requestId, hash]);
   if (!insert.rows.length) {
    const existing = (await tx.query("SELECT payload_hash,receipt FROM save_operations WHERE owner_id=$1 AND request_id=$2", [ownerId, requestId])).rows[0];
    if (!existing || existing.payload_hash !== hash) throw new AppError(409, "Este identificador de guardado ya se utilizó con otros datos.", "IDEMPOTENCY_CONFLICT");
    const receipt = json<T | null>(existing.receipt, null); if (!receipt) throw new AppError(409, "El guardado está en curso. Reintenta con el mismo identificador.");
    return { ...receipt, replayed: true };
   }
   const receipt = await work(tx, id);
   await tx.query("UPDATE save_operations SET receipt=$3::jsonb WHERE owner_id=$1 AND request_id=$2", [ownerId, requestId, JSON.stringify(receipt)]);
   return receipt;
  });
 }

 async bootstrap(ownerId: string): Promise<Bootstrap> {
  await this.ensureOwner(ownerId);
  const courses: Course[] = [];
  const cr = await this.db.query("SELECT id,code,name FROM courses WHERE owner_id=$1 ORDER BY code", [ownerId]);
  for (const c of cr.rows) courses.push({ id: str(c.id), code: str(c.code), name: str(c.name), students: await this.roster(ownerId, str(c.id)) });
  const current = await this.currentPlan(ownerId);
  const plans = (await this.db.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 ORDER BY period", [ownerId])).rows.map(row => normalizedPlan(json(row.config, plan())));
  const curriculumSequence=await this.curriculumSequence(ownerId);
  const criteriaCatalog=await this.evaluationCriteria(ownerId);
  const activityRows=(await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 ORDER BY period,activity_date,title,id`,[ownerId])).rows;
  const activities=await Promise.all(activityRows.map(row=>this.activityWithCriteria(ownerId,row)));
  return { courses, activities, plan: current, plans, curriculumSequence, criteriaCatalog, today: this.today(), demo: Boolean(this.options.demo), demoNote: this.options.demoNote, ownerId };
 }

 async saveEvaluationCriterion(ownerId:string,input:unknown):Promise<EvaluationCriterion>{
  const value=parse(criterionSchema,input);await this.ensureOwner(ownerId);
  const labels=value.levels.map(level=>level.label.trim().toLocaleLowerCase());
  const points=value.levels.map(level=>level.points);
  if(new Set(labels).size!==4||points.some((point,index)=>point!==index+1))throw new AppError(400,"Usa cuatro niveles distintos, ordenados de 1 a 4: Insuficiente, Suficiente, Bueno y Excelente.");
  const levels=value.levels.map((level,index)=>({...level,label:["Insuficiente","Suficiente","Bueno","Excelente"][index],description:level.description.trim()}));
  const id=value.id??randomUUID();
  return this.db.transaction(async tx=>{
   const existing=(await tx.query("SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 AND id=$2",[ownerId,id])).rows[0];
    if((await tx.query("SELECT id FROM evaluation_criteria WHERE owner_id=$1 AND lower(label)=lower($2) AND id<>$3",[ownerId,value.label.trim(),id])).rows.length)throw new AppError(409,"Ya existe un criterio con ese nombre.");
   const before=existing?{id:str(existing.id),label:str(existing.label),levels:json(existing.levels,[]),active:Boolean(existing.active)}:null;
   await tx.query("INSERT INTO evaluation_criteria(id,owner_id,label,levels,active) VALUES($1,$2,$3,$4::jsonb,true) ON CONFLICT(id) DO UPDATE SET label=EXCLUDED.label,levels=EXCLUDED.levels,active=true,updated_at=now() WHERE evaluation_criteria.owner_id=EXCLUDED.owner_id",[id,ownerId,value.label.trim(),JSON.stringify(levels)]);
   await tx.query("DELETE FROM evaluation_criterion_values WHERE owner_id=$1 AND criterion_id=$2",[ownerId,id]);
   for(const [index,level] of levels.entries())await tx.query("INSERT INTO evaluation_criterion_values(owner_id,criterion_id,level_position,level_label,points,descriptor) VALUES($1,$2,$3,$4,$5,$6)",[ownerId,id,index+1,level.label,level.points,level.description]);
   const after={id,label:value.label.trim(),levels,active:true};await this.log(tx,ownerId,existing?"criterion.updated":"criterion.created",id,before,after);return after;
  });
 }

 async importEvaluationCriteria(ownerId:string,input:unknown):Promise<{criteria:EvaluationCriterion[];imported:number;unchanged:number}>{
  const value=parse(criterionImportSchema,input);await this.ensureOwner(ownerId);
  const expectedLabels=['Insuficiente','Suficiente','Bueno','Excelente'];
  const seen=new Set<string>();
  const criteria=value.criteria.map(item=>{
   const key=item.label.trim().toLocaleLowerCase();
   if(seen.has(key))throw new AppError(400,`El libro repite el criterio “${item.label}”.`);
   seen.add(key);
   if(item.levels.some((level,index)=>level.label.trim()!==expectedLabels[index]||level.points!==index+1||!level.description.trim()))throw new AppError(400,`El criterio “${item.label}” debe tener cuatro descriptores completos en el orden Insuficiente, Suficiente, Bueno y Excelente (1–4).`);
   return {label:item.label.trim(),levels:item.levels.map((level,index)=>({label:expectedLabels[index],points:index+1,description:level.description.trim()}))};
  });
  return this.db.transaction(async tx=>{
   const prepared:{criterion:EvaluationCriterion;existing:boolean;before:unknown}[]=[];
   for(const item of criteria){
    const result=await tx.query("SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 AND lower(label)=lower($2)",[ownerId,item.label]);
    const old=result.rows[0];
    if(old){
     const existingLevels=json<RubricCriterion['levels']>(old.levels,[]);
     const same=str(old.label)===item.label&&JSON.stringify(existingLevels)===JSON.stringify(item.levels);
     if(!same||!Boolean(old.active))throw new AppError(409,`Ya existe “${item.label}” con otro contenido o retirado. Revísalo antes de importar; no se hicieron cambios.`);
     prepared.push({criterion:{id:str(old.id),label:str(old.label),levels:existingLevels,active:true},existing:true,before:null});
    }else{
     prepared.push({criterion:{id:randomUUID(),...item,active:true},existing:false,before:null});
    }
   }
   for(const item of prepared){
    if(item.existing)continue;
    await tx.query("INSERT INTO evaluation_criteria(id,owner_id,label,levels,active) VALUES($1,$2,$3,$4::jsonb,true)",[item.criterion.id,ownerId,item.criterion.label,JSON.stringify(item.criterion.levels)]);
    for(const [index,level] of item.criterion.levels.entries())await tx.query("INSERT INTO evaluation_criterion_values(owner_id,criterion_id,level_position,level_label,points,descriptor) VALUES($1,$2,$3,$4,$5,$6)",[ownerId,item.criterion.id,index+1,level.label,level.points,level.description??""]);
    await this.log(tx,ownerId,"criterion.imported",item.criterion.id,null,item.criterion);
   }
   return {criteria:prepared.map(item=>item.criterion),imported:prepared.filter(item=>!item.existing).length,unchanged:prepared.filter(item=>item.existing).length};
  });
 }

 async archiveEvaluationCriterion(ownerId:string,criterionId:string){
  parse(uid,criterionId);await this.ensureOwner(ownerId);
  return this.db.transaction(async tx=>{const row=(await tx.query("SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 AND id=$2",[ownerId,criterionId])).rows[0];if(!row)throw new AppError(404,"El criterio no pertenece a este registro.","NOT_FOUND");const before={id:str(row.id),label:str(row.label),levels:json(row.levels,[]),active:Boolean(row.active)};await tx.query("UPDATE evaluation_criteria SET active=false,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,criterionId]);const after={...before,active:false};await this.log(tx,ownerId,"criterion.archived",criterionId,before,after);return after;});
 }

 async createCourse(ownerId:string,input:unknown):Promise<Course>{
  const value=parse(courseSchema,input);await this.ensureOwner(ownerId);const code=value.code.toLocaleUpperCase();
  requireDate(value.startDate);requireDate(value.endDate);
  if(value.endDate<=value.startDate||value.endDate>'2028-06-30')throw new AppError(400,"El rango del horario debe terminar después del inicio y no pasar del 30 de junio de 2028.");
  const weekly=value.weekly??[];
  if(new Set(weekly.map(item=>item.weekday)).size!==weekly.length||weekly.some(item=>new Set(item.blocks).size!==item.blocks.length))throw new AppError(400,"No repitas días ni bloques en el horario.");
  const noClassDates=new Set(value.noClassDates);for(const date of noClassDates){requireDate(date);if(date<value.startDate||date>value.endDate)throw new AppError(400,"Las fechas sin clase deben quedar dentro del horario.");}
  return this.db.transaction(async tx=>{
   if((await tx.query("SELECT 1 FROM courses WHERE owner_id=$1 AND upper(code)=upper($2)",[ownerId,code])).rows.length)throw new AppError(409,"Ya existe un curso con ese código.");
   const id=randomUUID();await tx.query("INSERT INTO courses(id,owner_id,code,name) VALUES($1,$2,$3,$4)",[id,ownerId,code,value.name.trim()]);
   const hasLoadedCourseCalendar=classCalendar.sessions.some(slot=>slot.courseCode===code&&slot.date>=value.startDate&&slot.date<=value.endDate);
   const loadedSlots=classCalendar.sessions.filter(slot=>slot.courseCode===code&&slot.date>=value.startDate&&slot.date<=value.endDate&&!noClassDates.has(slot.date));
   const slots:{date:string;block:number}[]=loadedSlots.map(slot=>({date:slot.date,block:slot.block}));
   if(!hasLoadedCourseCalendar&&weekly.length){
    const weeklyMap=new Map(weekly.map(item=>[item.weekday,item.blocks]));
    const cursor=new Date(value.startDate+'T12:00:00Z');const end=new Date(value.endDate+'T12:00:00Z');
    for(;cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
     const weekday=cursor.getUTCDay()||7;const blocks=weeklyMap.get(weekday);if(!blocks)continue;
     const date=cursor.toISOString().slice(0,10);if(noClassDates.has(date))continue;
     for(const block of blocks)slots.push({date,block});
    }
   }
   if(slots.length>7000)throw new AppError(400,"El horario es demasiado amplio. Reduce el rango o los bloques por semana.");
   const params:unknown[]=[];
   const values=slots.map((slot,index)=>{const start=index*4+1;params.push(ownerId,id,slot.date,slot.block);return `($${start},$${start+1},$${start+2}::date,$${start+3}::integer)`;});
   if(values.length)await tx.query(`INSERT INTO scheduled_sessions(owner_id,course_id,session_date,block) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,params);
   const after={id,code,name:value.name.trim(),students:[]};await this.log(tx,ownerId,"course.created",id,null,{...after,startDate:value.startDate,endDate:value.endDate,calendarSource:hasLoadedCourseCalendar?"preloaded_daily_calendar":weekly.length?"manual_weekly":"none",noClassDates:[...noClassDates],scheduledSlots:slots.length});return after;
  });
 }

 async activatePlan(ownerId: string, period: string): Promise<EvaluationPlan> {
  await this.ensureOwner(ownerId);
  const value = parse(z.string().trim().min(1).max(80), period);
  return this.db.transaction(async tx => {
   await tx.query("SELECT owner_id FROM workspaces WHERE owner_id=$1 FOR UPDATE", [ownerId]);
   const target = await tx.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 AND period=$2", [ownerId, value]);
   if (!target.rows.length) throw new AppError(404, "Ese período todavía no está guardado.", "NOT_FOUND");
   const before = await this.currentPlan(ownerId, tx);
   const selected = normalizedPlan(json(target.rows[0].config, plan()));
   if (before.period !== selected.period) {
    await tx.query("UPDATE evaluation_plans SET active=false WHERE owner_id=$1 AND active=true", [ownerId]);
    await tx.query("UPDATE evaluation_plans SET active=true WHERE owner_id=$1 AND period=$2", [ownerId, value]);
    await this.log(tx, ownerId, "plan.activated", value, before, selected);
   }
   return selected;
  });
 }
 private async attendanceView(ownerId: string, courseId: string, date: string, block: number, tx: DBAdapter): Promise<AttendanceView> {
  const sessions = await tx.query("SELECT id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4", [ownerId, courseId, date, block]);
  const s = sessions.rows[0]; const roster = await this.roster(ownerId, courseId, tx);
  const calendarSlot = await tx.query("SELECT 1 FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4", [ownerId,courseId,date,block]);
  const courseCode=await tx.query("SELECT code FROM courses WHERE owner_id=$1 AND id=$2",[ownerId,courseId]);
  const through=courseCode.rows[0]&&['5A','5B','5C'].includes(str(courseCode.rows[0].code))?{rows:[{date:classCalendar.through}]}:await tx.query("SELECT max(session_date)::text AS date FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2",[ownerId,courseId]);
  const saved = s ? (await tx.query("SELECT student_id,status,behavior,comment FROM attendance WHERE owner_id=$1 AND session_id=$2", [ownerId, s.id])).rows : [];
  const withdrawals = await tx.query("SELECT a.student_id,min(cs.session_date)::text AS date FROM attendance a JOIN class_sessions cs ON cs.id=a.session_id AND cs.owner_id=a.owner_id WHERE a.owner_id=$1 AND cs.course_id=$2 AND a.status='R' GROUP BY a.student_id", [ownerId,courseId]);
  const withdrawnFrom = new Map(withdrawals.rows.map(row=>[str(row.student_id),str(row.date)]));
  const byId = new Map(saved.map(x => [str(x.student_id), x]));
  const rows: AttendanceRow[] = roster.filter(x => x.active || byId.has(x.id)).map(x => { const row = byId.get(x.id); const status = withdrawnFrom.has(x.id) && date >= withdrawnFrom.get(x.id)! ? "R" : row?.status as AttendanceRow["status"] ?? null; return { studentId: x.id, number: x.number, name: x.name, status, behavior: status === "R" ? null : num(row?.behavior), comment: str(row?.comment) }; });
  const scheduled = calendarSlot.rows.length > 0;
  return { session: { id: s ? str(s.id) : null, courseId, date, block, lessonType: s?.lesson_type as AttendanceView["session"]["lessonType"] ?? "teoria", topic: str(s?.topic), notes: str(s?.notes), revision: Number(s?.revision ?? 0), scheduled, calendarThrough: str(through.rows[0]?.date)||classCalendar.through, status: sessionStatus(date, rows.map(x => x.status), this.today(), scheduled) }, rows };
 }
 async attendance(ownerId: string, courseId: string, date: string, block: number): Promise<AttendanceView> { await this.ensureOwner(ownerId); requireDate(date); if (!Number.isInteger(block) || block < 1 || block > 12) throw new AppError(400, "El bloque debe estar entre 1 y 12."); await this.requireCourse(ownerId, courseId); return this.attendanceView(ownerId, courseId, date, block, this.db); }
 async registerSummary(ownerId: string, courseId: string): Promise<CourseRegisterSummary> {
  await this.ensureOwner(ownerId);
  const c = await this.requireCourse(ownerId, courseId);
  const calendarThrough=['5A','5B','5C'].includes(str(c.code))?{rows:[{date:classCalendar.through}]}:await this.db.query("SELECT max(session_date)::text AS date FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2",[ownerId,courseId]);
  const roster = await this.roster(ownerId, courseId);
  const result = await this.db.query(`SELECT slots.session_date::text AS date,slots.block,slots.scheduled,s.id,s.lesson_type,s.topic,a.student_id,a.status,a.behavior,a.behavior_max,a.comment
   FROM (
    SELECT session_date,block,true AS scheduled FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date >= $3
    UNION
    SELECT s.session_date,s.block,EXISTS(SELECT 1 FROM scheduled_sessions cal WHERE cal.owner_id=s.owner_id AND cal.course_id=s.course_id AND cal.session_date=s.session_date AND cal.block=s.block) AS scheduled
     FROM class_sessions s WHERE s.owner_id=$1 AND s.course_id=$2 AND s.session_date >= $3
   ) slots
   LEFT JOIN class_sessions s ON s.owner_id=$1 AND s.course_id=$2 AND s.session_date=slots.session_date AND s.block=slots.block
   LEFT JOIN attendance a ON a.session_id=s.id AND a.owner_id=$1
   ORDER BY slots.session_date,slots.block,a.student_id`, [ownerId, courseId, "2026-10-20"]);
  type SessionDraft = { id: string; date: string; block: number; scheduled: boolean; lessonType: AttendanceView["session"]["lessonType"]; topic: string; marks: AttendanceRow["status"][]; rows: { studentId: string; status: AttendanceRow["status"]; behavior: number | null; behaviorMax: number | null; comment: string }[] };
  const withdrawnFrom = new Map<string,string>();
  for (const row of result.rows) if (row.student_id && row.status === "R" && !withdrawnFrom.has(str(row.student_id))) withdrawnFrom.set(str(row.student_id),str(row.date));
  const sessions = new Map<string, SessionDraft>();
  for (const r of result.rows) {
   const id = `${str(r.date)}:${Number(r.block)}`;
   let s = sessions.get(id);
   if (!s) { s = { id, date: str(r.date), block: Number(r.block), scheduled: Boolean(r.scheduled), lessonType: r.lesson_type as SessionDraft["lessonType"] ?? "teoria", topic: str(r.topic), marks: [], rows: [] }; sessions.set(id, s); }
   if (r.student_id) {
    const studentId = str(r.student_id);
    const retirementDate = withdrawnFrom.get(studentId);
    const status = retirementDate && str(r.date) >= retirementDate ? "R" : r.status as AttendanceRow["status"] ?? null;
    const behavior = status === "R" ? null : num(r.behavior);
    s.marks.push(status);
    s.rows.push({ studentId, status, behavior, behaviorMax: status === "R" ? null : num(r.behavior_max), comment: str(r.comment) });
   }
  }
  const today = this.today();
  const summaryRows = new Map(roster.map(student => [student.id, { student, present: 0, absent: 0, late: 0, excused: 0, withdrawn: 0, pending: 0, sessions: 0, behaviorSum: 0, behaviorMax: 0, behaviorCount: 0, behaviorComments: 0 }]));
  const sessionRows: CourseRegisterSummary["sessions"] = [];
  type MonthStudent = { student: Student; marks: AttendanceRow["status"][]; present: number; absent: number; late: number; excused: number; withdrawn: number; pending: number };
  type MonthDraft = { key: string; label: string; startDate: string; endDate: string; taught: number; notTaught: number; slots: { date: string; block: number }[]; rows: Map<string, MonthStudent> };
  const monthly = new Map<string, MonthDraft>();
  type WeekStudent = { student: Student; marks: AttendanceRow["status"][]; present: number; absent: number; late: number; excused: number; withdrawn: number; pending: number };
  type WeekDraft = { startDate: string; endDate: string; taught: number; notTaught: number; slots: { date: string; block: number }[]; rows: Map<string, WeekStudent> };
  const weekly = new Map<string, WeekDraft>();
  for (const s of sessions.values()) {
   const status = sessionStatus(s.date, s.marks, today, s.scheduled);
   const byStudent = new Map(s.rows.map(row => [row.studentId,row]));
   const counts = { P: 0, A: 0, T: 0, E: 0, marked: 0, behaviorRecorded: 0 };
   if (status === "impartida") {
    for (const [studentId, student] of summaryRows) {
     const recorded = byStudent.get(studentId);
     const retirementDate = withdrawnFrom.get(studentId);
     const mark = retirementDate && s.date >= retirementDate ? "R" : recorded?.status ?? null;
     const behavior = mark === "R" ? null : recorded?.behavior ?? null;
     if (mark !== "R") student.sessions++;
     if (mark === "P") { counts.P++; student.present++; }
     else if (mark === "A") { counts.A++; student.absent++; }
     else if (mark === "T") { counts.T++; student.late++; }
     else if (mark === "E") { counts.E++; student.excused++; }
     else if (mark === "R") student.withdrawn++;
     else student.pending++;
     if (mark !== null) counts.marked++;
     if (behavior !== null && mark !== "A" && mark !== "E" && mark !== "R") {
      student.behaviorSum += behavior;
      student.behaviorMax += recorded?.behaviorMax ?? 10;
      student.behaviorCount++;
      counts.behaviorRecorded++;
     }
     if (recorded?.comment.trim()) student.behaviorComments++;
    }
   }
   sessionRows.push({ date: s.date, block: s.block, lessonType: s.lessonType, topic: s.topic, status, scheduled: s.scheduled, present: counts.P, absent: counts.A, late: counts.T, excused: counts.E, marked: counts.marked, behaviorRecorded: counts.behaviorRecorded });
   const monthKey = s.date.slice(0, 7);
   let month = monthly.get(monthKey);
   if (!month) {
    const year = Number(monthKey.slice(0,4)), monthNumber = Number(monthKey.slice(5,7));
    const monthLastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    month = { key: monthKey, label: `${monthNames[monthNumber-1]} ${year}`, startDate: `${monthKey}-01`, endDate: `${monthKey}-${String(monthLastDay).padStart(2,"0")}`, taught: 0, notTaught: 0, slots: [], rows: new Map(roster.map(student => [student.id, { student, marks: [], present: 0, absent: 0, late: 0, excused: 0, withdrawn: 0, pending: 0 }])) };
    monthly.set(monthKey, month);
   }
   if (status === "impartida") {
    month.taught++;
    month.slots.push({ date: s.date, block: s.block });
    for (const monthlyRow of month.rows.values()) {
     const retirementDate = withdrawnFrom.get(monthlyRow.student.id);
     const mark = retirementDate && s.date >= retirementDate ? "R" : byStudent.get(monthlyRow.student.id)?.status ?? null;
     monthlyRow.marks.push(mark);
     if (mark === "P") monthlyRow.present++;
     else if (mark === "A") monthlyRow.absent++;
     else if (mark === "T") monthlyRow.late++;
     else if (mark === "E") monthlyRow.excused++;
     else if (mark === "R") monthlyRow.withdrawn++;
     else monthlyRow.pending++;
    }
   } else if (status === "no_impartida") month.notTaught++;
   const monday = new Date(`${s.date}T00:00:00Z`);
   monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
   const startDate = monday.toISOString().slice(0, 10);
   let week = weekly.get(startDate);
   if (!week) {
    const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
    week = { startDate, endDate: sunday.toISOString().slice(0, 10), taught: 0, notTaught: 0, slots: [], rows: new Map(roster.map(student => [student.id, { student, marks: [], present: 0, absent: 0, late: 0, excused: 0, withdrawn: 0, pending: 0 }])) };
    weekly.set(startDate, week);
   }
   if (status === "impartida") {
    week.taught++;
    week.slots.push({ date: s.date, block: s.block });
    for (const weeklyRow of week.rows.values()) {
     const retirementDate = withdrawnFrom.get(weeklyRow.student.id);
     const mark = retirementDate && s.date >= retirementDate ? "R" : byStudent.get(weeklyRow.student.id)?.status ?? null;
     weeklyRow.marks.push(mark);
     if (mark === "P") weeklyRow.present++;
     else if (mark === "A") weeklyRow.absent++;
     else if (mark === "T") weeklyRow.late++;
     else if (mark === "E") weeklyRow.excused++;
     else if (mark === "R") weeklyRow.withdrawn++;
     else weeklyRow.pending++;
    }
   } else if (status === "no_impartida") week.notTaught++;
  }
  sessionRows.sort((a,b)=>a.date.localeCompare(b.date)||a.block-b.block);
  const rows: CourseRegisterSummary["rows"] = [...summaryRows.values()].filter(r=>r.student.active||r.sessions>0).map(r=>{
   const workedDays = r.sessions;
   const attendanceCount = r.present+r.late-Math.floor(r.late/3);
   return { student:r.student,present:r.present,absent:r.absent,late:r.late,excused:r.excused,withdrawn:r.withdrawn,pending:r.pending,sessions:r.sessions,attendancePercent:workedDays&&r.pending===0?round(attendanceCount/workedDays*100):null,behaviorAverage:r.behaviorCount?round(r.behaviorSum/r.behaviorCount):null,behaviorPercent:r.behaviorMax?round(r.behaviorSum/r.behaviorMax*100):null,behaviorCount:r.behaviorCount,behaviorComments:r.behaviorComments };
  });
  const taught = sessionRows.filter(s=>s.status==="impartida").length;
  const months: CourseRegisterSummary["months"] = [...monthly.values()].sort((a,b)=>a.key.localeCompare(b.key)).map(month => ({
   key: month.key, label: month.label, startDate: month.startDate, endDate: month.endDate, taught: month.taught, notTaught: month.notTaught, slots: month.slots,
   rows: [...month.rows.values()].filter(row=>row.student.active||month.taught>0).map(row=>{
    const absenceEquivalent = row.absent + Math.floor(row.late/3);
    const totalAttendance = row.present + row.late - Math.floor(row.late/3);
    const workedDays = month.taught-row.withdrawn;
    return { student:row.student,marks:row.marks,present:row.present,absent:row.absent,late:row.late,excused:row.excused,withdrawn:row.withdrawn,pending:row.pending,attended:row.present+row.late,totalAttendance,absenceEquivalent,attendancePercent:workedDays&&row.pending===0?round(totalAttendance/workedDays*100):null };
   })
  }));
  const weeks: CourseRegisterSummary["weeks"] = [...weekly.values()].sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(week => ({
   ...week,
   rows: [...week.rows.values()].filter(row=>row.student.active||week.taught>0).map(row=>{
    const totalAttendance = row.present + row.late - Math.floor(row.late/3);
    const workedDays = week.taught-row.withdrawn;
    return {student:row.student,marks:row.marks,present:row.present,absent:row.absent,late:row.late,excused:row.excused,withdrawn:row.withdrawn,pending:row.pending,attended:row.present+row.late,totalAttendance,attendancePercent:workedDays&&row.pending===0?round(totalAttendance/workedDays*100):null};
   })
  }));
  return { course:{id:str(c.id),code:str(c.code),name:str(c.name)}, calendarThrough:str(calendarThrough.rows[0]?.date)||classCalendar.through, totals:{sessions:sessionRows.length,taught,notTaught:sessionRows.filter(s=>s.status==="no_impartida").length,scheduled:sessionRows.filter(s=>s.status==="programada").length,notScheduled:sessionRows.filter(s=>s.status==="no_programada").length}, sessions:sessionRows, months, weeks, rows };
 }
 async saveAttendance(ownerId: string, input: AttendanceInput): Promise<SaveReceipt> {
  const v = parse(attendanceSchema, input); requireDate(v.date); await this.ensureOwner(ownerId);
  if (v.date > this.today() && v.rows.some(r => r.status !== null || r.behavior !== null && r.behavior !== undefined)) throw new AppError(400, "Una sesión futura permanece programada: no admite asistencia ni conducta todavía.");
  return this.operation(ownerId, v.requestId, { operation: "attendance", ...v }, async (tx, operationId) => {
   await this.requireCourse(ownerId, v.courseId, tx); const roster = await this.roster(ownerId, v.courseId, tx); this.validateStudents(v.rows, roster);
   const p = await this.currentPlan(ownerId, tx); const behaviorMax = p.categories.find(c => c.key === "participation")?.dailyMax ?? 10;
   if (v.rows.some(r => r.behavior !== null && r.behavior !== undefined && r.behavior > behaviorMax)) throw new AppError(400, `La valoración diaria debe estar entre 0 y ${behaviorMax}.`);
   await tx.query("INSERT INTO class_sessions(id,owner_id,course_id,session_date,block) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,course_id,session_date,block) DO NOTHING", [randomUUID(), ownerId, v.courseId, v.date, v.block]);
   const locked = (await tx.query("SELECT id,revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4 FOR UPDATE", [ownerId, v.courseId, v.date, v.block])).rows[0];
   if (Number(locked.revision) !== v.revision) throw new AppError(409, "La sesión cambió desde otra pestaña. Recarga conservando tu borrador.", "REVISION_CONFLICT");
   const before = await this.attendanceView(ownerId, v.courseId, v.date, v.block, tx);
   for (const r of v.rows) {
    const behavior = r.status === "A" || r.status === "E" || r.status === "R" ? null : r.behavior ?? null;
    await tx.query("INSERT INTO attendance(owner_id,course_id,session_id,student_id,status,behavior,behavior_max,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,behavior=EXCLUDED.behavior,behavior_max=EXCLUDED.behavior_max,comment=EXCLUDED.comment,updated_at=now()", [ownerId, v.courseId, locked.id, r.studentId, r.status, behavior, behaviorMax, r.comment ?? ""]);
   }
   const revision = v.revision + 1;
   await tx.query("UPDATE class_sessions SET lesson_type=$3,topic=$4,notes=$5,revision=$6,updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, locked.id, v.lessonType, v.topic ?? "", v.notes ?? "", revision]);
   const after = await this.attendanceView(ownerId, v.courseId, v.date, v.block, tx); await this.log(tx, ownerId, "attendance.saved", str(locked.id), before, after);
   return { requestId: v.requestId, operationId, savedRows: v.rows.length, revision, entityId: str(locked.id), replayed: false, savedAt: new Date().toISOString(), status: after.session.status };
  });
 }

 async createActivity(ownerId: string, input: ActivityInput): Promise<Activity> {
  const v = parse(activitySchema, input); requireDate(v.date); await this.ensureOwner(ownerId);
  const mode = v.scoringMode ?? "points", criteria = v.rubric ?? [];
  if (mode !== "rubric" && criteria.length) throw new AppError(400, "Una actividad de puntos directos no utiliza criterios de rúbrica.");
  const create = async (tx: DBAdapter) => {
   await this.requireCourse(ownerId, v.courseId, tx); const current = await this.currentPlan(ownerId, tx);
   const sequence = await this.curriculumSequence(ownerId,tx) ?? current.sequence;
   const linkedSequenceActivity = findLinkedSequenceActivity(sequence, v.sequenceActivityId, v.sequenceCode, current.period);
   if (v.sequenceActivityId && !linkedSequenceActivity) throw new AppError(400, "El vínculo no coincide con una actividad de la secuencia revisada. Actualiza la secuencia y vuelve a elegir el tema.", "SEQUENCE_LINK_NOT_FOUND");
   rejectUnscoredDiagnostic(linkedSequenceActivity);
    if (v.category === "notebook" && (v.date < current.startDate || v.date > current.endDate)) throw new AppError(400, "La revisión diaria de libreta debe corresponder a una sesión del período.");
   const categoryCompetency = current.categories.find(c => c.key === v.category)?.competency ?? null;
   const activityCompetency = v.competency ?? categoryCompetency ?? defaultForCategory(v.category);
   const preparedCriteria = criteria.map(c => ({ ...c, competency: c.competency ?? activityCompetency, weight: c.weight ?? 1 }));
   if (mode === "rubric") { rubricMaximum(preparedCriteria); if (preparedCriteria.some(c => !c.competency)) throw new AppError(400, "Asigna cada criterio a una competencia antes de guardar la rúbrica."); if (preparedCriteria.some(c => c.levels.some(level => !level.description?.trim()))) throw new AppError(400, "Completa el descriptor de cada nivel de la rúbrica."); }
   if (mode === "points" && !activityCompetency) throw new AppError(400, "Asigna una competencia a esta actividad de puntos directos.");
   if (v.category === "notebook" && (await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND course_id=$2 AND category='notebook' AND activity_date=$3 AND block=$4", [ownerId, v.courseId, v.date, v.block ?? 1])).rows.length) throw new AppError(409, "Ya existe una revisión diaria de libreta para esta fecha y bloque.");
   if (v.category === "notebook" && v.maxPoints !== (current.categories.find(c => c.key === "notebook")?.dailyMax ?? 2)) throw new AppError(400, "El máximo de la revisión diaria debe coincidir con su escala en el plan.");
   const id = randomUUID();
   await tx.query("INSERT INTO activities(id,owner_id,course_id,shared_id,period,category,title,activity_date,block,max_points,scoring_mode,rubric,description,sequence_code,sequence_activity_id,sequence_planned_period,evidence,instrument,activity_purpose,competency,indicator) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)", [id, ownerId, v.courseId, current.period, v.category, v.title, v.date, v.block ?? 1, v.maxPoints, mode, JSON.stringify(preparedCriteria), v.description ?? "", linkedSequenceActivity?.code ?? v.sequenceCode ?? "", linkedSequenceActivity?.id ?? null, linkedSequenceActivity?.period ?? "", v.evidence ?? "", v.instrument ?? "", v.purpose ?? "", activityCompetency ?? "", v.indicator ?? ""]);
   await this.persistActivityCriteria(ownerId,id,preparedCriteria,tx);
   const result = await this.activityWithCriteria(ownerId,(await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0],tx);
   await this.log(tx, ownerId, "activity.created", id, null, result); return result;
  };
  if (!v.requestId) return this.db.transaction(create);
  const receipt = await this.operation(ownerId, v.requestId, { operation: "activity.create", ...v }, async (tx, operationId) => { const a = await create(tx); return { requestId: v.requestId!, operationId, savedRows: 1, revision: a.revision, entityId: a.id, replayed: false, savedAt: new Date().toISOString() }; });
  return (await this.gradesView(ownerId, receipt.entityId, this.db)).activity;
 }

 async createSharedActivity(ownerId: string, input: SharedActivityInput): Promise<Activity[]> {
  const v = parse(sharedActivitySchema, input);
  if (new Set(v.courseIds).size !== v.courseIds.length) throw new AppError(400, "La actividad común repite un curso.");
  requireDate(v.activity.date); await this.ensureOwner(ownerId);
  const first = parse(activitySchema, { ...v.activity, courseId: v.courseIds[0] });
  const mode = first.scoringMode ?? "points", criteria = first.rubric ?? [];
  if (mode !== "rubric" && criteria.length) throw new AppError(400, "Una actividad de puntos directos no utiliza criterios de rúbrica.");
  const sharedId = randomUUID();
  const receipt = await this.operation(ownerId, first.requestId!, { operation: "activity.create.shared", courseIds: v.courseIds, activity: first }, async (tx, operationId) => {
   const current = await this.currentPlan(ownerId, tx);
   const sequence = await this.curriculumSequence(ownerId,tx) ?? current.sequence;
   const linkedSequenceActivity = findLinkedSequenceActivity(sequence, first.sequenceActivityId, first.sequenceCode, current.period);
   if (first.sequenceActivityId && !linkedSequenceActivity) throw new AppError(400, "El vínculo no coincide con una actividad de la secuencia revisada. Actualiza la secuencia y vuelve a elegir el tema.", "SEQUENCE_LINK_NOT_FOUND");
   rejectUnscoredDiagnostic(linkedSequenceActivity);
    if (first.category === "notebook" && (first.date < current.startDate || first.date > current.endDate)) throw new AppError(400, "La revisión diaria de libreta debe corresponder a una sesión del período.");
   for (const courseId of v.courseIds) await this.requireCourse(ownerId, courseId, tx);
   const categoryCompetency = current.categories.find(c => c.key === first.category)?.competency ?? null;
   const activityCompetency = first.competency ?? categoryCompetency ?? defaultForCategory(first.category);
   const preparedCriteria = criteria.map(c => ({ ...c, competency: c.competency ?? activityCompetency, weight: c.weight ?? 1 }));
   if (mode === "rubric") {
    rubricMaximum(preparedCriteria);
    if (preparedCriteria.some(c => !c.competency)) throw new AppError(400, "Asigna cada criterio a una competencia antes de guardar la rúbrica.");
    if (preparedCriteria.some(c => c.levels.some(level => !level.description?.trim()))) throw new AppError(400, "Completa el descriptor de cada nivel de la rúbrica.");
   }
   if (mode === "points" && !activityCompetency) throw new AppError(400, "Asigna una competencia a esta actividad de puntos directos.");
   if (first.category === "notebook" && first.maxPoints !== (current.categories.find(c => c.key === "notebook")?.dailyMax ?? 2)) throw new AppError(400, "El máximo de la revisión diaria debe coincidir con su escala en el plan.");
   for (const courseId of v.courseIds) {
    if (first.category === "notebook" && (await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND course_id=$2 AND category='notebook' AND activity_date=$3 AND block=$4", [ownerId, courseId, first.date, first.block ?? 1])).rows.length) throw new AppError(409, `Ya existe una revisión diaria de libreta para ${courseId} en esta fecha y bloque.`);
    const id = randomUUID();
    await tx.query("INSERT INTO activities(id,owner_id,course_id,shared_id,period,category,title,activity_date,block,max_points,scoring_mode,rubric,description,sequence_code,sequence_activity_id,sequence_planned_period,evidence,instrument,activity_purpose,competency,indicator) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21)", [id, ownerId, courseId, sharedId, current.period, first.category, first.title, first.date, first.block ?? 1, first.maxPoints, mode, JSON.stringify(preparedCriteria), first.description ?? "", linkedSequenceActivity?.code ?? first.sequenceCode ?? "", linkedSequenceActivity?.id ?? null, linkedSequenceActivity?.period ?? "", first.evidence ?? "", first.instrument ?? "", first.purpose ?? "", activityCompetency ?? "", first.indicator ?? ""]);
    await this.persistActivityCriteria(ownerId,id,preparedCriteria,tx);
    const created = await this.activityWithCriteria(ownerId,(await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0],tx);
    await this.log(tx, ownerId, "activity.created.shared", id, null, created);
   }
   return { requestId: first.requestId!, operationId, savedRows: v.courseIds.length, revision: 0, entityId: sharedId, replayed: false, savedAt: new Date().toISOString() };
  });
  const result = await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND shared_id=$2 ORDER BY course_id`, [ownerId, receipt.entityId]);
  return Promise.all(result.rows.map(row=>this.activityWithCriteria(ownerId,row)));
 }

 async configureActivityEvaluation(ownerId:string,input:unknown):Promise<Activity[]>{
  const value=parse(activityEvaluationSchema,input);await this.ensureOwner(ownerId);
  const receipt=await this.operation(ownerId,value.requestId,{operation:"activity.evaluation.configure",...value},async(tx,operationId)=>{
   const result=await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2 FOR UPDATE`,[ownerId,value.activityId]);
   if(!result.rows.length)throw new AppError(404,"La actividad no pertenece a este registro.","NOT_FOUND");
   const current=await this.activityWithCriteria(ownerId,result.rows[0],tx);if(current.revision!==value.revision)throw new AppError(409,"La actividad cambió desde que abriste esta configuración. Recarga y vuelve a revisarla.","STALE_REVISION");
   const existingGrades=await tx.query("SELECT 1 FROM grades WHERE owner_id=$1 AND activity_id IN (SELECT id FROM activities WHERE owner_id=$1 AND (id=$2 OR shared_id=$3)) LIMIT 1",[ownerId,current.id,current.sharedId]);
   if(existingGrades.rows.length)throw new AppError(409,"Ya se calificó esta actividad. Para cambiar su valoración, primero crea una revisión nueva; las notas guardadas no se recalcularán silenciosamente.","ALREADY_GRADED");
    const planForActivity=await this.planForPeriod(ownerId,current.period,tx);const globalSequence=await this.curriculumSequence(ownerId,tx);const sourceSequence=globalSequence??planForActivity.sequence;const useSequence=Boolean(sourceSequence?.reviewed);const plannedIndicators=useSequence?sourceSequence!.indicators:[];
    const linkedSequenceActivity=useSequence?findLinkedSequenceActivity(sourceSequence,current.sequenceActivityId,current.sequenceCode,current.sequencePlannedPeriod??current.period):null;
    if(!useSequence&&(current.sequenceActivityId||current.sequenceCode))throw new AppError(409,"Esta actividad está vinculada a una secuencia. Revísala antes de modificar su valoración.","SEQUENCE_NOT_REVIEWED");
   const indicatorById=new Map(plannedIndicators.map(item=>[item.id,item]));
   const manualById=new Map(value.manualIndicators.map(item=>[item.id,item]));
   if(new Set(value.manualIndicators.map(item=>item.id)).size!==value.manualIndicators.length)throw new AppError(400,"Un indicador manual aparece más de una vez.");
   const allocationIds=new Set<string>();let allocationTotal=0;
   const allocations:ActivityIndicatorPoint[]=value.indicatorPoints.map(item=>{
    if(allocationIds.has(item.indicatorId))throw new AppError(400,"Un indicador aparece más de una vez en el reparto.");allocationIds.add(item.indicatorId);
    const planned=useSequence?indicatorById.get(item.indicatorId):manualById.get(item.indicatorId);
    if(!planned)throw new AppError(400,useSequence?"Cada indicador debe pertenecer a la secuencia revisada del período activo.":"Define el indicador y su competencia en esta actividad manual.");
    if(!planned.competency)throw new AppError(400,`Asigna una competencia al indicador “${planned.code||planned.label}” antes de calificar actividades.`);
    allocationTotal+=item.points;return {indicatorId:planned.id,code:planned.code,label:planned.label,competency:planned.competency,points:round(item.points)};
   });
   if(!allocations.length)throw new AppError(400,"Asigna al menos un indicador a la actividad.");
   if(linkedSequenceActivity?.indicatorIds.length&&allocations.some(item=>!linkedSequenceActivity.indicatorIds.includes(item.indicatorId)))throw new AppError(400,"La actividad solo puede recibir puntos de indicadores vinculados a su clase de la secuencia.");
   if(round(allocationTotal)!==round(current.maxPoints))throw new AppError(400,`Los puntos asignados a indicadores deben sumar ${current.maxPoints}; ahora suman ${round(allocationTotal)}.`);
   let rubric:RubricCriterion[]=[];let catalog=new Map<string,EvaluationCriterion>();
   if(value.scoringMode==="rubric"){
    if(!value.rubric.length)throw new AppError(400,"Selecciona al menos un criterio para valorar la actividad.");
    const rubricIds=new Set<string>();
    const catalogRows=await this.evaluationCriteria(ownerId,tx);catalog=new Map(catalogRows.map(item=>[item.id,item]));
    const sourceInstrument=linkedSequenceActivity?.assessmentInstrument;
    rubric=value.rubric.map(item=>{
     if(rubricIds.has(item.id))throw new AppError(400,"No repitas un criterio en la misma rúbrica.");rubricIds.add(item.id);
     const sourcePrefix=linkedSequenceActivity?`sequence:${linkedSequenceActivity.id}:`:null;
     const sourceIndex=sourcePrefix&&item.id.startsWith(sourcePrefix)?Number(item.id.slice(sourcePrefix.length))-1:-1;
     const isSourceCriterion=sourceIndex>=0;
     if(item.id.startsWith("sequence:")&&!isSourceCriterion)throw new AppError(400,"El criterio importado no pertenece al instrumento de la secuencia vinculada.");
     if(isSourceCriterion){
      const expectedLabel=sourceInstrument?.criteria[sourceIndex];
      const expectedLevels=sourceInstrument?.levels??[];
      const sameLevels=item.levels.length===expectedLevels.length&&item.levels.every((level,index)=>level.label===expectedLevels[index]?.label&&level.points===expectedLevels[index]?.points&&(level.description??"").trim()===(expectedLevels[index]?.description??"").trim());
      if(!sourceInstrument?.scored||sourceInstrument.kind==="checklist"||!expectedLabel||item.label!==expectedLabel||!sameLevels)throw new AppError(400,"El criterio o su escala ya no coincide con el anexo revisado. Vuelve a cargar el instrumento fuente.");
     }else if(!catalog.has(item.id))throw new AppError(400,`El criterio “${item.label}” ya no está en el catálogo activo. Actualiza la selección antes de guardar.`);
     const allocation=allocations.find(row=>row.indicatorId===item.indicatorId);if(!allocation)throw new AppError(400,`El criterio “${item.label}” debe vincularse con uno de los indicadores asignados.`);
     const catalogCriterion=catalog.get(item.id);const currentLabel=isSourceCriterion?item.label:catalogCriterion!.label;const currentLevels=isSourceCriterion?item.levels:catalogCriterion!.levels;
     if(currentLevels.some(level=>!level.description?.trim()))throw new AppError(400,"Completa los descriptores de cada nivel.");
     return {...item,label:currentLabel,indicator:allocation.label,competency:allocation.competency,weight:item.weight??1,levels:currentLevels.map(level=>({...level,label:level.label.trim(),description:level.description?.trim()??""}))};
    });
    rubricMaximum(rubric);
    for(const allocation of allocations)if(!rubric.some(item=>item.indicatorId===allocation.indicatorId))throw new AppError(400,`Añade un criterio que permita valorar el indicador “${allocation.label}”.`);
   } else if(value.rubric.length)throw new AppError(400,"La calificación directa no puede guardar criterios de rúbrica.");
   const instrument=value.instrument.trim()||(value.scoringMode==="rubric"?"Rúbrica analítica":"Puntaje directo");
   const ids=current.sharedId
    ?(await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND shared_id=$2 FOR UPDATE",[ownerId,current.sharedId])).rows.map(row=>str(row.id))
    :[current.id];
   const revision=current.revision+1;
   for(const id of ids){
    await tx.query("UPDATE activities SET scoring_mode=$3,rubric=$4::jsonb,indicator_points=$5::jsonb,instrument=$6,revision=$7,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,id,value.scoringMode,JSON.stringify(rubric),JSON.stringify(allocations),instrument,revision]);
    await this.persistActivityCriteria(ownerId,id,rubric,tx);
    await this.log(tx,ownerId,"activity.evaluation.configured",id,{scoringMode:current.scoringMode,rubric:current.rubric,indicatorPoints:current.indicatorPoints},{scoringMode:value.scoringMode,rubric,indicatorPoints:allocations,instrument,revision});
   }
   return {requestId:value.requestId,operationId,savedRows:ids.length,revision,entityId:current.sharedId??current.id,replayed:false,savedAt:new Date().toISOString()};
  });
  const query=receipt.entityId===value.activityId
   ?await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2 ORDER BY course_id`,[ownerId,value.activityId])
   :await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND shared_id=$2 ORDER BY course_id`,[ownerId,receipt.entityId]);
  return Promise.all(query.rows.map(row=>this.activityWithCriteria(ownerId,row)));
 }

 async savePlanSequence(ownerId:string,period:string,sequence:NonNullable<EvaluationPlan["sequence"]>):Promise<EvaluationPlan>{
  const current=await this.planForPeriod(ownerId,period);
  const parsed=parse(sequenceSchema,sequence);
  const indicatorIds=new Set(parsed.indicators.map(item=>item.id));
  if(indicatorIds.size!==parsed.indicators.length)throw new AppError(400,"La secuencia repite el identificador de un indicador.");
  const activityIds=new Set(parsed.activities.map(item=>item.id));
  if(activityIds.size!==parsed.activities.length)throw new AppError(400,"La secuencia repite una actividad.");
  for(const item of parsed.activities)if(item.indicatorIds.some(id=>!indicatorIds.has(id)))throw new AppError(400,`La actividad “${item.title}” menciona un indicador que no está en el catálogo del período.`);
  if(parsed.reviewed&&parsed.activities.some(item=>!item.title.trim()))throw new AppError(400,"Completa el título de cada actividad antes de confirmar la revisión.");
  if(parsed.reviewed&&unclassifiedIndicatorsUsedByActivities(parsed).length)throw new AppError(400,"Asigna una competencia a cada indicador vinculado a una actividad antes de confirmar la revisión.");
  const dependent=(await this.db.query("SELECT id,indicator_points FROM activities WHERE owner_id=$1 AND period=$2",[ownerId,period])).rows;
  const preservedIds=new Set(parsed.indicators.map(item=>item.id));
  for(const row of dependent)for(const allocation of json<ActivityIndicatorPoint[]>(row.indicator_points,[]))if(!preservedIds.has(allocation.indicatorId))throw new AppError(409,"No se puede quitar un indicador que ya está asignado a una actividad. Conserva el identificador o crea una versión nueva de la secuencia.","INDICATOR_IN_USE");
  const clean=normalizedPlan({...current,sequence:parsed});
  return this.db.transaction(async tx=>{
   const before=await this.planForPeriod(ownerId,period,tx);
   await tx.query("UPDATE evaluation_plans SET config=$3::jsonb,revision=revision+1 WHERE owner_id=$1 AND period=$2",[ownerId,period,JSON.stringify(clean)]);
   await this.log(tx,ownerId,"plan.sequence.saved",period,before,clean);
   return clean;
  });
 }

 async saveCurriculumSequence(ownerId:string,input:unknown):Promise<NonNullable<Bootstrap["curriculumSequence"]>>{
  const parsed=parse(sequenceSchema,input);await this.ensureOwner(ownerId);
  const indicatorIds=new Set(parsed.indicators.map(item=>item.id));
  if(indicatorIds.size!==parsed.indicators.length)throw new AppError(400,"La secuencia repite el identificador de un indicador.");
  const activityIds=new Set(parsed.activities.map(item=>item.id));
  if(activityIds.size!==parsed.activities.length)throw new AppError(400,"La secuencia repite una actividad.");
  const periodCodes=new Set<string>();
  for(const item of parsed.activities){
   if(item.indicatorIds.some(id=>!indicatorIds.has(id)))throw new AppError(400,`La actividad “${item.title}” menciona un indicador que no está en el catálogo anual.`);
    if(item.period&&!['P1','P2','P3','P4'].includes(item.period))throw new AppError(400,`El período asignado a “${item.title||'la actividad'}” no es válido.`);
   if(parsed.reviewed){
     if(!item.title.trim())throw new AppError(400,'Completa el nombre de cada actividad antes de confirmar la revisión.');
     if(!(item.description.trim()||item.theme.trim()))throw new AppError(400,`Describe qué se trabajará en “${item.title}” antes de confirmar la revisión.`);
     if(item.period&&item.code.trim()){const key=`${item.period}:${item.code.trim().toLocaleLowerCase()}`;if(periodCodes.has(key))throw new AppError(400,`El código ${item.code} está repetido dentro de ${item.period}.`);periodCodes.add(key);}
   }
  }
   if(parsed.reviewed&&!parsed.activities.length)throw new AppError(400,"Añade al menos una actividad antes de confirmar la revisión de la secuencia.");
  const current=await this.curriculumSequence(ownerId);
   if(current){
    const dependent=(await this.db.query("SELECT indicator_points FROM activities WHERE owner_id=$1",[ownerId])).rows;
    const preservedIds=new Set(parsed.indicators.map(item=>item.id));
    for(const row of dependent)for(const allocation of json<ActivityIndicatorPoint[]>(row.indicator_points,[]))if(!preservedIds.has(allocation.indicatorId))throw new AppError(409,"No se puede retirar un indicador que ya está asignado a una actividad calificada. Conserva el identificador o crea una versión nueva de la secuencia.","INDICATOR_IN_USE");
   }
  return this.db.transaction(async tx=>{
   await tx.query("INSERT INTO curriculum_sequences(owner_id,config,revision,updated_at) VALUES($1,$2::jsonb,0,now()) ON CONFLICT(owner_id) DO UPDATE SET config=EXCLUDED.config,revision=curriculum_sequences.revision+1,updated_at=now()",[ownerId,JSON.stringify(parsed)]);
   await this.log(tx,ownerId,current?"curriculum.sequence.updated":"curriculum.sequence.created",ownerId,current,parsed);
   return parsed;
  });
 }

 async teacherLedger(ownerId: string, requestedPeriod?: string): Promise<TeacherLedgerSummary> {
  await this.ensureOwner(ownerId);
  const p = requestedPeriod ? await this.planForPeriod(ownerId, requestedPeriod) : await this.currentPlan(ownerId);
  const availablePeriods = (await this.db.query("SELECT period FROM evaluation_plans WHERE owner_id=$1 ORDER BY period", [ownerId])).rows.map(row=>str(row.period));
  const courseRows = (await this.db.query("SELECT id,code,name FROM courses WHERE owner_id=$1 ORDER BY code", [ownerId])).rows;
  const activityRowsRaw=(await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND period=$2 ORDER BY activity_date,title,id`,[ownerId,p.period])).rows;
  const activityRows=await Promise.all(activityRowsRaw.map(row=>this.activityWithCriteria(ownerId,row)));
  const categoryLabels = new Map<string,string>([...p.categories.map(category => [category.key,category.label] as const),["extra","Puntos extra"]]);
  const columns = new Map<string,TeacherLedgerSummary["groups"][number]["columns"][number]>();
  const columnKeysByActivity = new Map<string,string[]>();
  const sharedKey = (item: Activity) => item.sharedId ? `shared:${item.sharedId}` : `activity:${item.id}`;
  const activityCompetency = (item: Activity) => item.competency ?? p.categories.find(category=>category.key===item.category)?.competency ?? defaultForCategory(item.category);

  for (const item of activityRows) {
   const baseKey = sharedKey(item);
   const rubricMaximumPoints = item.rubric.reduce((sum,criterion)=>sum+Math.max(...criterion.levels.map(level=>level.points))*(criterion.weight??1),0);
   const activityColumnKeys: string[] = [];
    if (item.scoringMode === "rubric" && item.rubric.length) {
    for (const criterion of item.rubric) {
     const key = `${baseKey}:criterion:${criterion.id}`;
      const criterionMax = criterionMaximum(criterion);
      const allocation=item.indicatorPoints.find(row=>row.indicatorId===criterion.indicatorId);
      const groupMaximum=allocation?item.rubric.filter(row=>row.indicatorId===allocation.indicatorId).reduce((sum,row)=>sum+criterionMaximum(row),0):rubricMaximumPoints;
      const columnMaximum=allocation?allocation.points*criterionMax/(groupMaximum||1):item.maxPoints*criterionMax/(rubricMaximumPoints||1);
     const column = columns.get(key);
     const courseIds = column?.courseIds ?? [];
     if (!courseIds.includes(item.courseId)) courseIds.push(item.courseId);
      columns.set(key,{key,label:`${item.title} · ${criterion.label}`,category:item.category,categoryLabel:categoryLabels.get(item.category)??item.category,competency:allocation?.competency??criterion.competency??activityCompetency(item),kind:"criterion",date:item.date,maxPoints:round(columnMaximum),courseIds});
     activityColumnKeys.push(key);
    }
    } else if(item.indicatorPoints.length) {
     for(const allocation of item.indicatorPoints){
      const key=`${baseKey}:indicator:${allocation.indicatorId}`;const column=columns.get(key);const courseIds=column?.courseIds??[];
      if(!courseIds.includes(item.courseId))courseIds.push(item.courseId);
      columns.set(key,{key,label:`${item.title} · ${allocation.code||allocation.label}`,category:item.category,categoryLabel:categoryLabels.get(item.category)??item.category,competency:allocation.competency,kind:"activity",date:item.date,maxPoints:allocation.points,courseIds});activityColumnKeys.push(key);
     }
   } else {
    const key = baseKey;
    const column = columns.get(key);
    const courseIds = column?.courseIds ?? [];
    if (!courseIds.includes(item.courseId)) courseIds.push(item.courseId);
    columns.set(key,{key,label:item.title,category:item.category,categoryLabel:categoryLabels.get(item.category)??item.category,competency:activityCompetency(item),kind:"activity",date:item.date,maxPoints:item.maxPoints,courseIds});
    activityColumnKeys.push(key);
   }
   columnKeysByActivity.set(item.id,activityColumnKeys);
  }

  const participation = p.categories.find(category=>category.key==="participation");
  const behaviorKey="behavior:period";
  columns.set(behaviorKey,{key:behaviorKey,label:"Disciplina / comportamiento",category:"behavior",categoryLabel:"Conducta diaria",competency:participation?.competency??defaultForCategory("participation"),kind:"behavior",date:null,maxPoints:participation?.dailyMax??10,courseIds:courseRows.map(course=>str(course.id))});
  const allColumns=[...columns.values()];
  const groups=COMPETENCY_GROUPS.map(group=>({key:group.key,label:group.label,columns:allColumns.filter(column=>column.competency===group.key).sort((a,b)=>(a.date??"").localeCompare(b.date??"")||a.category.localeCompare(b.category)||a.label.localeCompare(b.label))})).filter(group=>group.columns.length);

  const rows: TeacherLedgerSummary["rows"]=[];
  for (const c of courseRows) {
   const course={id:str(c.id),code:str(c.code),name:str(c.name)};
   const roster=await this.roster(ownerId,course.id);
   for (const student of roster) {
    const report=await this.report(ownerId,course.id,student.id,p.period);
    const scores:TeacherLedgerSummary["rows"][number]["scores"]=allColumns.map(column=>({key:column.key,points:null,possible:column.maxPoints,state:column.courseIds.includes(course.id)?"pending":"not_applicable",pending:column.courseIds.includes(course.id)?1:0}));
    const scoreByKey=new Map(scores.map(score=>[score.key,score]));
    for (const grade of report.grades) {
     const gradeColumnKeys=columnKeysByActivity.get(grade.activityId)??[];
      if (grade.rubric.length&&gradeColumnKeys.length) {
      grade.rubric.forEach((criterion,index)=>{
       const key=gradeColumnKeys[index],column=columns.get(key);
       if(!column||!scoreByKey.has(key))return;
       const selected=grade.criterionLevels?.[criterion.id];
       const level=Number.isInteger(selected)?criterion.levels[selected!]:undefined;
       const allocation=grade.indicatorPoints.find(row=>row.indicatorId===criterion.indicatorId);
       const group=allocation?grade.rubric.filter(row=>row.indicatorId===allocation.indicatorId):grade.rubric;
       const maximum=group.reduce((sum,item)=>sum+criterionMaximum(item),0);
       const selectedPoints=level?round((allocation?.points??grade.maxPoints)*(level.points*(criterion.weight??1))/(maximum||1)):null;
       scoreByKey.set(key,{key,points:selectedPoints,possible:column.maxPoints,state:!grade.included?"excluded":selectedPoints===null?"pending":"graded",pending:selectedPoints===null?1:0,comment:grade.comment||undefined});
      });
      } else if(grade.indicatorPoints.length&&gradeColumnKeys.length>1){
       grade.indicatorPoints.forEach((allocation,index)=>{const key=gradeColumnKeys[index],column=columns.get(key);if(!column||!scoreByKey.has(key))return;const points=grade.score===null?null:round(grade.score*allocation.points/grade.maxPoints);scoreByKey.set(key,{key,points,possible:column.maxPoints,state:!grade.included?"excluded":points===null?"pending":"graded",pending:points===null?1:0,comment:grade.comment||undefined});});
     } else {
      const key=gradeColumnKeys[0],column=columns.get(key);
      if(!column||!scoreByKey.has(key))continue;
      scoreByKey.set(key,{key,points:grade.score,possible:column.maxPoints,state:!grade.included?"excluded":grade.score===null?"pending":"graded",pending:grade.score===null?1:0,comment:grade.comment||undefined});
     }
    }
    const sessions=report.timeline.filter(item=>item.sessionStatus==="impartida");
    const behaviorValues=sessions.filter(item=>item.status!=="A"&&item.status!=="E").map(item=>item.behavior);
    const behaviorPoints=round(behaviorValues.reduce<number>((sum,value)=>sum+(value??0),0));
    const behaviorPossible=round(behaviorValues.length*(participation?.dailyMax??10));
    const behaviorPending=behaviorValues.filter(value=>value===null).length;
    const behaviorGraded=behaviorValues.length-behaviorPending;
    scoreByKey.set(behaviorKey,{key:behaviorKey,points:behaviorGraded?behaviorPoints:null,possible:behaviorPossible,state:behaviorPossible===0?"not_applicable":behaviorPending?"pending":"graded",pending:behaviorPending});
    const finalScores=[...scoreByKey.values()];
    const counted=finalScores.filter(score=>score.state!=="excluded"&&score.state!=="not_applicable");
    const rawTotal=round(counted.reduce((sum,score)=>sum+(score.points??0),0));
    const rawPossible=round(counted.reduce((sum,score)=>sum+score.possible,0));
    const observations=[...report.grades.filter(item=>item.comment.trim()).map(item=>`${item.title}: ${item.comment.trim()}`),...report.timeline.filter(item=>item.comment.trim()).map(item=>`${item.date} · Disciplina: ${item.comment.trim()}`)];
    rows.push({course,student,categories:report.categories,scores:finalScores,rawTotal,rawPossible,bonusPoints:report.bonusPoints,bonusPossible:report.bonusPossible,weightedTotal:report.total??report.provisionalTotal,finalized:report.total!==null,observations});
   }
  }
  return {period:p.period,availablePeriods,categories:p.categories.map(({key,label,group,weight,expectedRaw})=>({key,label,group,weight,expectedRaw})),groups,rows,note:"El libro conserva cada actividad y cada criterio bajo su competencia. El resumen convierte cada categoría a su peso asignado; las categorías con el mismo grupo se muestran en una columna y conservan su desglose. Las valoraciones diarias usan solo sesiones impartidas. Los pendientes no son cero y las clases no impartidas no entran en esos promedios."};
 }
 private async gradesView(ownerId: string, activityId: string, tx: DBAdapter): Promise<GradesView> {
  parse(uid,activityId);
  const result = await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2`, [ownerId, activityId]); if (!result.rows.length) throw new AppError(404, "La actividad no pertenece a este registro.", "NOT_FOUND");
  const a = await this.activityWithCriteria(ownerId,result.rows[0],tx); const roster = await this.roster(ownerId, a.courseId, tx); const saved = (await tx.query("SELECT student_id,score,criterion_levels,comment FROM grades WHERE owner_id=$1 AND activity_id=$2", [ownerId, activityId])).rows; const byId = new Map(saved.map(r => [str(r.student_id), r]));
  const savedRatings=(await tx.query("SELECT student_id,criterion_key,level_position FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2 ORDER BY student_id,criterion_key",[ownerId,activityId])).rows;
  const levelsByStudent=new Map<string,Record<string,number>>();for(const rating of savedRatings){const studentId=str(rating.student_id);const levels=levelsByStudent.get(studentId)??{};levels[str(rating.criterion_key)]=Number(rating.level_position);levelsByStudent.set(studentId,levels);}
  const rows: GradeRow[] = roster.filter(x => x.active || byId.has(x.id)).map(x => { const r = byId.get(x.id); const normalized=levelsByStudent.get(x.id); return { studentId: x.id, number: x.number, name: x.name, score: num(r?.score), criterionLevels: normalized&&Object.keys(normalized).length?normalized:json(r?.criterion_levels, null), comment: str(r?.comment) }; });
  return { activity: a, rows };
 }
 async grades(ownerId: string, activityId: string): Promise<GradesView> { await this.ensureOwner(ownerId); return this.gradesView(ownerId, activityId, this.db); }
 async indicatorUsage(ownerId:string):Promise<IndicatorUsageRecord[]>{
  await this.ensureOwner(ownerId);
  const activities=(await this.db.query(`SELECT a.id,a.shared_id,a.course_id,c.code AS course_code,a.period,a.title,a.max_points,a.indicator_points FROM activities a JOIN courses c ON c.id=a.course_id AND c.owner_id=a.owner_id WHERE a.owner_id=$1 ORDER BY a.period,a.activity_date,a.title,a.course_id`,[ownerId])).rows;
  const gradeRows=(await this.db.query(`SELECT activity_id,COUNT(*) FILTER (WHERE score IS NOT NULL)::integer AS graded_students,COUNT(*) FILTER (WHERE score IS NOT NULL OR (jsonb_typeof(criterion_levels)='object' AND criterion_levels<>'{}'::jsonb) OR comment<>'')::integer AS students_with_data FROM grades WHERE owner_id=$1 GROUP BY activity_id`,[ownerId])).rows;
  const rosterRows=(await this.db.query(`SELECT course_id,COUNT(*)::integer AS students_in_course FROM students WHERE owner_id=$1 AND active=true GROUP BY course_id`,[ownerId])).rows;
  const gradesByActivity=new Map(gradeRows.map(row=>[str(row.activity_id),row]));
  const rosterByCourse=new Map(rosterRows.map(row=>[str(row.course_id),Number(row.students_in_course)||0]));
  const records:IndicatorUsageRecord[]=[];
  for(const activity of activities){
   const activityId=str(activity.id),sharedId=str(activity.shared_id),courseId=str(activity.course_id),grade=gradesByActivity.get(activityId);
   const allocations=json<ActivityIndicatorPoint[]>(activity.indicator_points,[]);
   for(const allocation of allocations)records.push({indicatorId:allocation.indicatorId,code:allocation.code,label:allocation.label,competency:allocation.competency,assignmentId:sharedId||activityId,activityId,courseId,courseCode:str(activity.course_code),period:str(activity.period),title:str(activity.title),maxPoints:Number(activity.max_points)||0,points:Number(allocation.points)||0,studentsWithData:Number(grade?.students_with_data)||0,gradedStudents:Number(grade?.graded_students)||0,studentsInCourse:rosterByCourse.get(courseId)||0});
  }
  return records;
 }
 async saveGrades(ownerId: string, input: GradesInput): Promise<SaveReceipt> {
  const v = parse(gradesSchema, input); await this.ensureOwner(ownerId);
  return this.operation(ownerId, v.requestId, { operation: "grades", ...v }, async (tx, operationId) => {
   const locked = await tx.query("SELECT id,revision FROM activities WHERE owner_id=$1 AND id=$2 FOR UPDATE", [ownerId, v.activityId]); if (!locked.rows.length) throw new AppError(404, "La actividad no pertenece a este registro.", "NOT_FOUND");
   if (Number(locked.rows[0].revision) !== v.revision) throw new AppError(409, "Las notas cambiaron desde otra pestaña. Recarga conservando tu borrador.", "REVISION_CONFLICT");
   const before = await this.gradesView(ownerId, v.activityId, tx), a = before.activity; this.validateStudents(v.rows, await this.roster(ownerId, a.courseId, tx));
   const periodPlan=await this.planForPeriod(ownerId,a.period,tx);
    const reviewedSequence=await this.curriculumSequence(ownerId,tx)??periodPlan.sequence;
    if(a.category!=="notebook"&&a.category!=="participation"&&reviewedSequence?.reviewed&&reviewedSequence.indicators.length&&!a.indicatorPoints.length)throw new AppError(409,"Esta actividad todavía no está distribuida por indicador. Configura la valoración antes de guardar calificaciones.","EVALUATION_NOT_CONFIGURED");
   const normalized = v.rows.map(r => { let score = r.score; const levels = r.criterionLevels ?? null; if (a.scoringMode === "rubric") { if (levels) { for(const [criterionId,index] of Object.entries(levels)){const criterion=a.rubric.find(item=>item.id===criterionId);if(!criterion)throw new AppError(400,"La selección contiene un criterio que no pertenece a la rúbrica.");if(!Number.isInteger(index)||index<0||index>=criterion.levels.length)throw new AppError(400,`El nivel elegido para “${criterion.label}” no existe.`);} if(Object.keys(levels).length===a.rubric.length)rubricScore(a.rubric,levels); score = Object.keys(levels).length === a.rubric.length ? a.indicatorPoints.length ? allocatedRubricScore(a.rubric,levels,a.indicatorPoints) : round(rubricScore(a.rubric, levels) / rubricMaximum(a.rubric) * a.maxPoints) : null; } else if (score !== null) throw new AppError(400, "La rúbrica necesita un nivel seleccionado para cada criterio."); } else if (levels) throw new AppError(400, "La actividad utiliza puntos directos, no niveles."); if (score !== null && score > a.maxPoints) throw new AppError(400, `La nota no puede superar ${a.maxPoints}.`); return { ...r, score, levels }; });
   for (const r of normalized) {
    await tx.query("INSERT INTO grades(owner_id,course_id,activity_id,student_id,score,criterion_levels,comment) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(activity_id,student_id) DO UPDATE SET score=EXCLUDED.score,criterion_levels=EXCLUDED.criterion_levels,comment=EXCLUDED.comment,updated_at=now()", [ownerId, a.courseId, a.id, r.studentId, r.score, JSON.stringify(r.levels), r.comment ?? ""]);
    await tx.query("DELETE FROM grade_criterion_ratings WHERE owner_id=$1 AND activity_id=$2 AND student_id=$3",[ownerId,a.id,r.studentId]);
    if(r.levels)for(const [criterionKey,index] of Object.entries(r.levels)){const criterion=a.rubric.find(item=>item.id===criterionKey)!;const level=criterion.levels[index];await tx.query("INSERT INTO grade_criterion_ratings(owner_id,activity_id,student_id,criterion_key,level_position,level_label,points,descriptor) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[ownerId,a.id,r.studentId,criterionKey,index,level.label,level.points,level.description??""]);}
   }
   const revision = v.revision + 1; await tx.query("UPDATE activities SET revision=$3,updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, a.id, revision]);
   const after = await this.gradesView(ownerId, a.id, tx); await this.log(tx, ownerId, "grades.saved", a.id, before, after);
   return { requestId: v.requestId, operationId, savedRows: v.rows.length, revision, entityId: a.id, replayed: false, savedAt: new Date().toISOString() };
  });
 }

 private async reviewRosterBatches(ownerId: string, batches: z.infer<typeof rosterBatchesSchema>, tx: DBAdapter) {
  const seenCourses = new Set<string>();
  const conflictingNumbers = new Map<string, Set<number>>();
  const reviews: { courseId: string; courseCode: string; rows: RosterRow[]; before: Student[]; added: number; updated: number; total: number; retained: number }[] = [];
  for (const batch of batches) {
   if (seenCourses.has(batch.courseId)) throw new AppError(400, "El archivo intenta importar dos listas al mismo curso.");
   seenCourses.add(batch.courseId);
   const course = await this.requireCourse(ownerId, batch.courseId, tx);
   const before = await this.roster(ownerId, batch.courseId, tx);
   const externalIds = new Set<string>(), incomingNumbers = new Set<number>();
   for (const row of batch.rows) {
    if (externalIds.has(row.externalId)) throw new AppError(400, `La lista de ${str(course.code)} repite un identificador de estudiante.`);
    if (incomingNumbers.has(row.number)) throw new AppError(400, `La lista de ${str(course.code)} repite el número ${row.number}.`);
    externalIds.add(row.externalId); incomingNumbers.add(row.number);
   }
   const currentByExternalId = new Map(before.map(student => [student.externalId, student]));
   const finalNumbers = new Map<string, { number: number; externalId: string; incoming: boolean }>();
   for (const student of before) finalNumbers.set(student.externalId, { number: student.number, externalId: student.externalId, incoming: false });
   for (const row of batch.rows) finalNumbers.set(row.externalId, { number: row.number, externalId: row.externalId, incoming: true });
   const numberOwners = new Map<number, { externalId: string; incoming: boolean }>();
   for (const item of finalNumbers.values()) {
    const existing = numberOwners.get(item.number);
    if (existing && existing.externalId !== item.externalId && (existing.incoming || item.incoming)) {
     const code = str(course.code), numbers = conflictingNumbers.get(code) ?? new Set<number>(); numbers.add(item.number); conflictingNumbers.set(code, numbers);
    }
    numberOwners.set(item.number, item);
   }
   const added = batch.rows.filter(row => !currentByExternalId.has(row.externalId)).length;
   const updated = batch.rows.length - added;
   const retained = before.filter(student => !externalIds.has(student.externalId)).length;
   reviews.push({ courseId: batch.courseId, courseCode: str(course.code), rows: batch.rows, before, added, updated, total: batch.rows.length, retained });
  }
  const conflicts = [...conflictingNumbers].map(([courseCode, numbers]) => ({ courseCode, message: `Los números ${[...numbers].sort((a,b)=>a-b).join(", ")} ya están asignados a otras identidades. No se mezclaron estudiantes ni se modificó ninguna lista.` }));
  return { reviews, conflicts };
 }

 async previewRosterImport(ownerId: string, input: unknown) {
  const batches = parse(rosterBatchesSchema, input);
  await this.ensureOwner(ownerId);
  return this.db.transaction(async tx => {
   const { reviews, conflicts } = await this.reviewRosterBatches(ownerId, batches, tx);
   return { courses: reviews.map(({ courseId, courseCode, added, updated, total, retained }) => ({ courseId, courseCode, added, updated, total, retained })), conflicts };
  });
 }

 async importRosters(ownerId: string, input: unknown) {
  const batches = parse(rosterBatchesSchema, input);
  await this.ensureOwner(ownerId);
  return this.db.transaction(async tx => {
   const { reviews, conflicts } = await this.reviewRosterBatches(ownerId, batches, tx);
   if (conflicts.length) throw new AppError(409, conflicts[0].message, "ROSTER_IDENTITY_CONFLICT");
   const results = [];
   for (const review of reviews) {
    for (const row of review.rows) await tx.query("INSERT INTO students(id,owner_id,course_id,external_id,number,name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,course_id,external_id) DO UPDATE SET number=EXCLUDED.number,name=EXCLUDED.name,active=true", [randomUUID(), ownerId, review.courseId, row.externalId, row.number, row.name]);
    const after = await this.roster(ownerId, review.courseId, tx);
    await this.log(tx, ownerId, "roster.imported", review.courseId, review.before, after);
    results.push({ courseId: review.courseId, courseCode: review.courseCode, added: review.added, updated: review.updated, total: review.total, retained: review.retained });
   }
   return { courses: results, students: results.reduce((sum, item) => sum + item.total, 0) };
  });
 }

 async importRoster(ownerId: string, courseId: string, rows: RosterRow[]) {
  await this.importRosters(ownerId, [{ courseId, rows }]);
  return this.roster(ownerId, courseId);
 }
 async updatePlan(ownerId: string, input: EvaluationPlan): Promise<EvaluationPlan> {
  const parsed = parse(planSchema,input);
  input = { ...parsed, categories: parsed.categories.map(c => ({ ...c, competency: c.competency ?? defaultForCategory(c.key) })) as EvaluationPlan["categories"] };
  await this.ensureOwner(ownerId);
  if (!input || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(input.period) || !Array.isArray(input.categories) || input.categories.length !== 5 || new Set(input.categories.map(c => c.key)).size !== 5) throw new AppError(400, "El plan requiere un período y sus cinco categorías.");
  requireDate(input.startDate); requireDate(input.endDate); if (input.startDate > input.endDate) throw new AppError(400, "El período termina antes de empezar.");
  const keys = new Set(plan().categories.map(c => c.key)); let total = 0;
  for (const c of input.categories) { if (!keys.has(c.key) || !c.label?.trim() || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100 || c.expectedRaw !== null && (!Number.isFinite(c.expectedRaw) || c.expectedRaw <= 0) || c.dailyMax !== null && (!Number.isFinite(c.dailyMax) || c.dailyMax <= 0 || c.dailyMax > 10000) || c.targetSessions !== null && (!Number.isInteger(c.targetSessions) || c.targetSessions < 1)) throw new AppError(400, "Revisa pesos, máximos y número de sesiones del plan."); total += c.weight; }
  if (round(total) !== 100) throw new AppError(400, "Los pesos del período deben sumar 100.");
  if (input.status !== "provisional" && input.status !== "confirmed") throw new AppError(400, "El estado del plan no es válido.");
  if (input.status === "confirmed" && input.categories.some(c => c.dailyMax === null && c.expectedRaw === null)) throw new AppError(400, "Completa el máximo bruto previsto de cada categoría antes de confirmar el plan.");
  const categories: EvaluationPlan["categories"] = input.categories.map(c => ({ key: c.key, label: c.label.trim(), ...(c.group ? { group: c.group.trim() } : {}), weight: c.weight, expectedRaw: c.expectedRaw, dailyMax: c.dailyMax, targetSessions: c.targetSessions, competency: c.competency ?? defaultForCategory(c.key) }));
  const clean: EvaluationPlan = normalizedPlan({ period: input.period, startDate: input.startDate, endDate: input.endDate, status: input.status, categories, note: str(input.note).slice(0,4000), ...(input.sequence?{sequence:input.sequence}:{}) });
  return this.db.transaction(async tx => {
   await tx.query("SELECT owner_id FROM workspaces WHERE owner_id=$1 FOR UPDATE",[ownerId]);
   const before = await this.currentPlan(ownerId, tx);
   const saved = clean.period !== before.period && clean.note === before.note
    ? { ...clean, note: `Copia de ${before.period}. Revisa fechas, pesos, máximos y clases previstas antes de registrar notas.` }
    : clean;
   await tx.query("UPDATE evaluation_plans SET active=false WHERE owner_id=$1 AND active=true", [ownerId]);
   await tx.query("INSERT INTO evaluation_plans(owner_id,period,config,active) VALUES($1,$2,$3::jsonb,true) ON CONFLICT(owner_id,period) DO UPDATE SET config=EXCLUDED.config,active=true,revision=evaluation_plans.revision+1", [ownerId, saved.period, JSON.stringify(saved)]);
   await this.log(tx, ownerId, "plan.updated", saved.period, before, saved);
   return saved;
  });
 }

 async audit(ownerId: string): Promise<AuditEntry[]> { await this.ensureOwner(ownerId); return (await this.db.query("SELECT id,operation,entity_id,created_at::text AS created_at,before_data,after_data FROM audit_entries WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200", [ownerId])).rows.map(r => ({ id: str(r.id), operation: str(r.operation), entityId: str(r.entity_id), createdAt: str(r.created_at), before: json(r.before_data, null), after: json(r.after_data, null) })); }
 async exportData(ownerId: string) { await this.ensureOwner(ownerId); return this.db.transaction(async tx => { const read = async (table: string, fields: string) => (await tx.query(`SELECT ${fields} FROM ${table} WHERE owner_id=$1`, [ownerId])).rows; return { format: "registro-docente/v1", exportedAt: new Date().toISOString(), ownerId, plans: await read("evaluation_plans", "period,config,active,revision"), courses: await read("courses", "id,code,name"), students: await read("students", "id,course_id,external_id,number,name,active"), scheduledSessions: await read("scheduled_sessions", "course_id,session_date::text AS date,block"), sessions: await read("class_sessions", "id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision"), attendance: await read("attendance", "course_id,session_id,student_id,status,behavior,behavior_max,comment"), activities: await read("activities", activityFields), criteria: await read("evaluation_criteria", "id,label,levels,active,updated_at::text"), criterionValues: await read("evaluation_criterion_values", "criterion_id,level_position,level_label,points,descriptor"), activityCriteria: await read("activity_criteria", "activity_id,criterion_key,catalog_criterion_id,criterion_label,indicator_id,competency,weight,position,levels_snapshot"), grades: await read("grades", "course_id,activity_id,student_id,score,criterion_levels,comment"), criterionRatings: await read("grade_criterion_ratings", "activity_id,student_id,criterion_key,level_position,level_label,points,descriptor"), audit: await read("audit_entries", "id,operation,entity_id,created_at::text,before_data,after_data") }; }); }

 async report(ownerId: string, courseId: string, studentId: string, requestedPeriod?: string): Promise<StudentReport> {
  await this.ensureOwner(ownerId); const c = await this.requireCourse(ownerId, courseId); const person = (await this.roster(ownerId, courseId)).find(s => s.id === studentId); if (!person) throw new AppError(404, "El estudiante no pertenece a este curso.", "NOT_FOUND"); const p = requestedPeriod ? await this.planForPeriod(ownerId, requestedPeriod) : await this.currentPlan(ownerId);
  const sessions = (await this.db.query("SELECT s.id,s.session_date::text AS date,s.block,a.status,a.behavior,a.behavior_max,a.comment,EXISTS(SELECT 1 FROM scheduled_sessions cal WHERE cal.owner_id=s.owner_id AND cal.course_id=s.course_id AND cal.session_date=s.session_date AND cal.block=s.block) AS scheduled,(SELECT count(*) FROM attendance marks WHERE marks.session_id=s.id AND marks.owner_id=s.owner_id AND marks.status IN ('P','A','T','E')) AS mark_count FROM class_sessions s LEFT JOIN attendance a ON a.session_id=s.id AND a.student_id=$3 AND a.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.course_id=$2 AND s.session_date BETWEEN $4 AND $5 ORDER BY s.session_date,s.block", [ownerId, courseId, studentId, p.startDate, p.endDate])).rows;
  const withdrawal = await this.db.query("SELECT min(s.session_date)::text AS date FROM attendance a JOIN class_sessions s ON s.id=a.session_id AND s.owner_id=a.owner_id WHERE a.owner_id=$1 AND s.course_id=$2 AND a.student_id=$3 AND a.status='R'", [ownerId,courseId,studentId]);
  const withdrawnFrom = str(withdrawal.rows[0]?.date) || null;
  const effectiveSessions: Row[] = sessions.map(row=>({...row,status:withdrawnFrom&&str(row.date)>=withdrawnFrom?"R":row.status as AttendanceRow["status"]??null}));
  const taught = effectiveSessions.filter(s => Number(s.mark_count) > 0);
  const stats = { present: 0, absent: 0, late: 0, excused: 0, pending: 0, sessions: 0, percent: null as number | null };
  for (const s of taught) { if (s.status === "R") continue; stats.sessions++; if (s.status === "P") stats.present++; else if (s.status === "A") stats.absent++; else if (s.status === "T") stats.late++; else if (s.status === "E") stats.excused++; else stats.pending++; }
  const creditedAttendance = stats.present + stats.late - Math.floor(stats.late / 3);
  stats.percent = stats.sessions && stats.pending === 0 ? round(creditedAttendance / stats.sessions * 100) : null;
  const gradeRecords = (await this.db.query(`SELECT a.id AS activity_id,a.title,a.activity_date::text AS date,a.block,a.category,a.max_points,a.scoring_mode,a.rubric,a.indicator_points,a.competency,a.indicator,a.sequence_code,a.sequence_activity_id,a.sequence_planned_period,a.evidence,a.instrument,a.activity_purpose,g.score,g.criterion_levels,g.comment FROM activities a LEFT JOIN grades g ON g.activity_id=a.id AND g.student_id=$3 AND g.owner_id=a.owner_id WHERE a.owner_id=$1 AND a.course_id=$2 AND a.period=$4 ORDER BY a.activity_date,a.title`, [ownerId, courseId, studentId, p.period])).rows;
  const sessionKeys = new Set(taught.map(s => `${str(s.date)}:${Number(s.block)}`));
  const grades: StudentReport["grades"] = gradeRecords.map(r => ({ studentId, number: person.number, name: person.name, score: num(r.score), criterionLevels: json(r.criterion_levels, null), comment: str(r.comment), activityId: str(r.activity_id), title: str(r.title), date: str(r.date), category: r.category as Activity["category"], maxPoints: Number(r.max_points), included: r.category !== "notebook" || sessionKeys.has(`${str(r.date)}:${Number(r.block)}`) && !(withdrawnFrom && str(r.date) >= withdrawnFrom), rubric: json(r.rubric, []), indicatorPoints: json(r.indicator_points, []), scoringMode: r.scoring_mode as 'points'|'rubric', competency: (str(r.competency) as CompetencyKey) || (p.categories.find(cat => cat.key === r.category)?.competency ?? (r.category === "extra" ? defaultForCategory("extra") : null)), sequenceCode: str(r.sequence_code), sequenceActivityId: str(r.sequence_activity_id) || null, sequencePlannedPeriod: str(r.sequence_planned_period) || null, evidence: str(r.evidence), instrument: str(r.instrument), purpose: str(r.activity_purpose) }));
  const bonusActivities=grades.filter(g=>g.category==="extra");
  const bonusPoints=round(bonusActivities.reduce((sum,g)=>sum+(g.score??0),0));
  const bonusPossible=round(bonusActivities.reduce((sum,g)=>sum+g.maxPoints,0));
  const categories: CategoryReport[] = p.categories.map(cat => {
   if (cat.key === "participation" || cat.key === "notebook") {
    const max = cat.dailyMax ?? (cat.key === "participation" ? 10 : 2);
    const dailySessions = cat.key === "participation" ? taught.filter(s => s.status !== "A" && s.status !== "E" && s.status !== "R") : taught.filter(s => s.status !== "R");
    const scores = dailySessions.map(s => cat.key === "participation" ? num(s.behavior) : grades.find(g => g.category === "notebook" && g.date === str(s.date) && Number(gradeRecords.find(r => r.activity_id === g.activityId)?.block) === Number(s.block))?.score ?? null);
    const maxima = dailySessions.map(row => cat.key === "participation" ? num(row.behavior_max) ?? max : max);
    const participationActivities = cat.key === "participation" ? grades.filter(g => g.category === "participation" && g.included) : [];
    const dailyEarned = scores.reduce<number>((sum, v) => sum + (v ?? 0), 0), dailyPossible = maxima.reduce((sum,n) => sum+n,0);
    const activityEarned = participationActivities.reduce((sum,g) => sum + (g.score ?? 0),0), activityPossible = participationActivities.reduce((sum,g) => sum + g.maxPoints,0);
    const rawEarned = round(dailyEarned + activityEarned), rawPossible = round(dailyPossible + activityPossible), target = cat.expectedRaw ?? round(dailyPossible + activityPossible);
    const observedDenominator = round(maxima.reduce((sum,m,i) => sum+(scores[i] === null ? 0 : m),0));
    const observed = round(observedDenominator + participationActivities.reduce((sum,g) => sum + (g.score === null ? 0 : g.maxPoints),0));
    const graded = scores.filter(x => x !== null).length + participationActivities.filter(g => g.score !== null).length;
    const pending = scores.filter(x => x === null).length + participationActivities.filter(g => g.score === null).length;
    return { key: cat.key, label: cat.label, group: cat.group, weight: cat.weight, rawEarned, rawPossible, expectedRaw: target, graded, pending, denominator: target, points: observed && target && rawPossible <= target ? round(rawEarned / target * cat.weight) : null, observedDenominator: observed, observedPercent: observed ? round(rawEarned / observed * 100) : null, planIncomplete: !target || rawPossible !== target, provisional: p.status !== "confirmed" || !target || pending > 0 || rawPossible !== target };
   }
   const relevant = grades.filter(g => g.category === cat.key), rawEarned = round(relevant.reduce((sum, g) => sum + (g.score ?? 0), 0)), rawPossible = round(relevant.reduce((sum, g) => sum + g.maxPoints, 0)), target = cat.expectedRaw ?? rawPossible;
   const observedDenominator = round(relevant.reduce((sum,g) => sum+(g.score === null ? 0 : g.maxPoints),0));
   return { key: cat.key, label: cat.label, group: cat.group, weight: cat.weight, rawEarned, rawPossible, expectedRaw: target, graded: relevant.filter(g => g.score !== null).length, pending: relevant.filter(g => g.score === null).length, denominator: target, points: observedDenominator && target && rawPossible <= target ? round(rawEarned / target * cat.weight) : null, observedDenominator, observedPercent: observedDenominator ? round(rawEarned / observedDenominator * 100) : null, planIncomplete: rawPossible !== target, provisional: p.status !== "confirmed" || relevant.some(g => g.score === null) || rawPossible !== target };
  });
  const competencyValues = new Map<CompetencyKey, { points: number; possible: number; graded: number; pending: number }>();
  const addCompetency = (key: CompetencyKey | null, points: number, possible: number, graded: number, pending: number) => {
   if (!key) return;
   const current = competencyValues.get(key) ?? { points: 0, possible: 0, graded: 0, pending: 0 };
   current.points += points; current.possible += possible; current.graded += graded; current.pending += pending;
   competencyValues.set(key, current);
  };
  for (const g of grades) {
   if (!g.included || g.category === "notebook") continue;
   if(g.indicatorPoints.length){
    for(const allocation of g.indicatorPoints){
     const ratio=g.scoringMode==="rubric"?indicatorRubricRatio(g.rubric,g.criterionLevels,allocation.indicatorId):g.score===null?null:g.score/g.maxPoints;
     addCompetency(allocation.competency,ratio===null?0:round(ratio*allocation.points),allocation.points,ratio===null?0:1,ratio===null?1:0);
    }
   } else if (g.rubric.length) {
    const maximum = g.rubric.reduce((sum, criterion) => sum + Math.max(...criterion.levels.map(level => level.points)) * (criterion.weight ?? 1), 0);
    for (const criterion of g.rubric) {
     const weight = criterion.weight ?? 1;
     const criterionMaximum = Math.max(...criterion.levels.map(level => level.points)) * weight;
     const levelIndex = g.criterionLevels?.[criterion.id];
     const validLevel = Number.isInteger(levelIndex) && levelIndex! >= 0 && levelIndex! < criterion.levels.length;
     const earned = validLevel ? criterion.levels[levelIndex!].points * weight : null;
     addCompetency(criterion.competency ?? g.competency, earned === null || !maximum ? 0 : g.maxPoints * earned / maximum, maximum ? g.maxPoints * criterionMaximum / maximum : 0, earned === null ? 0 : 1, earned === null ? 1 : 0);
    }
   } else {
    addCompetency(g.competency, g.score ?? 0, g.maxPoints, g.score === null ? 0 : 1, g.score === null ? 1 : 0);
   }
  }
  const notebookCategory = p.categories.find(cat => cat.key === "notebook");
  if (notebookCategory?.competency) for (const s of taught) {
   const daily = grades.find(g => g.category === "notebook" && g.date === str(s.date) && Number(gradeRecords.find(r => r.activity_id === g.activityId)?.block) === Number(s.block));
   addCompetency(notebookCategory.competency, daily?.score ?? 0, notebookCategory.dailyMax ?? 2, daily?.score === null || daily?.score === undefined ? 0 : 1, daily?.score === null || daily?.score === undefined ? 1 : 0);
  }
  const participationCategory = p.categories.find(cat => cat.key === "participation");
  if (participationCategory?.competency) for (const s of taught.filter(item => item.status !== "A" && item.status !== "E" && item.status !== "R")) {
   const behavior = num(s.behavior);
   addCompetency(participationCategory.competency, behavior ?? 0, num(s.behavior_max) ?? participationCategory.dailyMax ?? 10, behavior === null ? 0 : 1, behavior === null ? 1 : 0);
  }
  const competencies: CompetencyScore[] = COMPETENCY_GROUPS.filter(group => competencyValues.has(group.key)).map(group => {
   const value = competencyValues.get(group.key)!;
   return { key: group.key, label: group.label, points: round(value.points), possible: round(value.possible), percentage: value.possible ? round(value.points / value.possible * 100) : null, graded: value.graded, pending: value.pending };
  });
  const known = categories.filter(c => c.points !== null); const complete = p.status === "confirmed" && categories.every(c => !c.provisional && c.points !== null && c.pending === 0);
  return { student: person, course: { id: str(c.id), code: str(c.code), name: str(c.name) }, plan: p, attendance: stats, categories, competencies, bonusPoints, bonusPossible, total: complete ? round(categories.reduce((sum, c) => sum + (c.points ?? 0), 0)+bonusPoints) : null, provisionalTotal: known.length ? round(known.reduce((sum, c) => sum + (c.points ?? 0), 0)+bonusPoints) : bonusPoints ? bonusPoints : null, grades, timeline: effectiveSessions.map(s => ({ date: str(s.date), block: Number(s.block), status: s.status as AttendanceRow["status"] ?? null, behavior: s.status === "A" || s.status === "E" || s.status === "R" ? null : num(s.behavior), comment: str(s.comment), sessionStatus: sessionStatus(str(s.date), Number(s.mark_count) ? ["P"] : [], this.today(), Boolean(s.scheduled)) })), notices: ["Solo las sesiones del horario con marcas de asistencia cuentan como impartidas. Una fecha fuera del calendario no se convierte en ausencia ni en clase no impartida.", "El porcentaje usa las sesiones trabajadas; las excusas quedan registradas por separado, tres tardanzas equivalen a una ausencia y R se aplica desde la fecha de retiro.", "Las ausencias, excusas y retiros no generan una nota de conducta; el promedio usa las sesiones que sí permiten valorar el comportamiento.", "El resumen por competencia suma puntos asignados a criterios; el cálculo de nota final por categoría sigue separado.", "Los puntos extra se suman aparte de las cinco categorías y no cambian sus máximos.", "La nota final permanece pendiente mientras falten actividades, calificaciones o sesiones previstas.", ...(grades.some(g => !g.included && g.score !== null) ? ["Hay notas de libreta conservadas en fechas sin clase impartida; no se incluyen en el cálculo diario."] : [])] };
 }

 async competencySummary(ownerId: string, courseId: string) {
  await this.ensureOwner(ownerId);
  const course = await this.requireCourse(ownerId, courseId);
  const students = await this.roster(ownerId, courseId);
  const reports: StudentReport[] = [];
  for (const student of students) reports.push(await this.report(ownerId, courseId, student.id));
  const groups = COMPETENCY_GROUPS.filter(group => reports.some(report => report.competencies.some(item => item.key === group.key))).map(({ key, label }) => ({ key, label }));
  return {
   course: { id: str(course.id), code: str(course.code), name: str(course.name) },
   period: reports[0]?.plan.period ?? (await this.currentPlan(ownerId)).period,
   groups,
   rows: reports.map(report => ({
    student: report.student,
    competencies: report.competencies,
    points: round(report.competencies.reduce((sum, item) => sum + item.points, 0)),
    possible: round(report.competencies.reduce((sum, item) => sum + item.possible, 0)),
   })),
   note: "La suma por fila reúne los puntos de evidencias asignadas a competencias. Las notas de categoría siguen calculándose con los pesos del período; pendientes no se convierten en cero.",
  };
 }
}
