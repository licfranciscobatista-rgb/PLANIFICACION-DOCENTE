import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DBAdapter } from "./db";
import { Activity, ActivityCategoryKey, ActivityIndicatorPoint, ActivityInput, AppError, AttendanceImportEntry, AttendanceImportRecord, AttendanceImportReceipt, AttendanceInput, AttendanceRow, AttendanceView, AuditEntry, Bootstrap, CategoryReport, CompetencyKey, CompetencyScore, COMPETENCY_GROUPS, COURSE_SIZES, Course, CourseRegisterSummary, CourseSequencePlanView, DailyAssessmentInput, EvaluationCriterion, EvaluationPlan, GradeRow, GradesInput, GradesView, IndicatorUsageRecord, PERIOD_START, RubricCriterion, RosterRow, SaveReceipt, ServiceOptions, SharedActivityInput, Student, StudentReport, TeacherLedgerSummary, SequenceActivity, SequencePlan } from "./model";
import { payloadHash, plan, requireDate, round, rubricMaximum, rubricScore, sessionStatus, todayInSchool } from "./engine";
import classCalendar from "./data/class-schedule-2026-27.json";
import { readPeriodSheet, periodSheetResult, studentPeriodSheet, savePeriodSheetPlan, savePeriodSheetGrades } from './period-sheet';

type Row = Record<string, unknown>;
const uid = z.string().uuid();
const text = z.string().max(4000);
const attendanceSchema = z.object({ requestId: z.string().min(1).max(200), courseId: uid, date: z.string(), block: z.number().int().min(1).max(12), revision: z.number().int().min(0), lessonType: z.enum(["teoria", "practica", "ejercicios", "repaso", "correcciones", "actividad_escolar", "importada"]), topic: text.optional(), notes: text.optional(), rows: z.array(z.object({ studentId: uid, status: z.enum(["P", "A", "T", "E", "R"]).nullable(), behavior: z.number().finite().min(0).max(10000).nullable().optional(), discipline: z.number().finite().min(0).max(10000).nullable().optional(), participation: z.number().finite().min(0).max(10000).nullable().optional(), dailyAssessmentRequired:z.boolean().optional(), comment: text.optional() })).max(1000) });
const dailyAssessmentSchema = z.object({ requestId:z.string().min(1).max(200),courseId:uid,date:z.string(),block:z.number().int().min(1).max(12),revision:z.number().int().min(0),assessmentRevision:z.number().int().min(0),rows:z.array(z.object({studentId:uid,participation:z.number().finite().min(0).max(10000).nullable(),behavior:z.number().finite().min(0).max(10000).nullable(),discipline:z.number().finite().min(0).max(10000).nullable(),comment:z.string().max(500).optional()})).max(1000) });
const gradesSchema = z.object({ requestId: z.string().min(1).max(200), activityId: uid, revision: z.number().int().min(0), rows: z.array(z.object({ studentId: uid, score: z.number().finite().min(0).max(10000).nullable(), criterionLevels: z.record(z.string(), z.number().int().min(0).max(5)).nullable().optional(), comment: text.optional() })).max(1000) });
const competencyKey = z.enum(COMPETENCY_GROUPS.map(x => x.key) as [CompetencyKey, ...CompetencyKey[]]);
const rubricLevelSchema = z.object({ label: z.string().trim().min(1).max(100), points: z.number().finite().min(0), description: z.string().max(1000).optional() });
const rubricLevelsSchema = z.array(rubricLevelSchema).min(2).max(6);
const sourceAssessmentSchema = z.object({ annexNumber:z.number().int().min(1).max(99), title:z.string().max(500), kind:z.enum(["checklist","rubric","scale","exam_guide"]), criteria:z.array(z.string().max(1000)).max(100), levels:rubricLevelsSchema.or(z.array(rubricLevelSchema).length(0)), maxPoints:z.number().finite().nonnegative().max(10000).nullable(), scoringNote:z.string().max(2000), scored:z.boolean(), relatedIndicatorText:z.string().max(2000).optional(), relatedCompetencyText:z.string().max(2000).optional() });
const finalAssessmentSchema = z.object({ title:z.string().max(250), period:z.string().max(2), internalMaxPoints:z.number().finite().positive().max(10000).nullable(), periodPoints:z.number().finite().nonnegative().max(10000).nullable(), instrument:sourceAssessmentSchema });
const activitySchema = z.object({ courseId: uid, period:z.enum(["P1","P2","P3","P4"]).optional(), coursePlanId:uid.optional(), category: z.enum(["exam", "participation", "notebook", "sequence", "homework", "extra"]), title: z.string().trim().min(1).max(250), date: z.string(), block: z.number().int().min(1).max(12).optional(), maxPoints: z.number().finite().positive().max(10000), scoringMode: z.enum(["points", "rubric"]).optional(), rubric: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(200), competency: competencyKey.nullable().optional(), indicator: z.string().max(500).optional(), weight: z.number().finite().positive().max(10000).optional(), levels: rubricLevelsSchema })).optional(), description: text.optional(), sequenceCode: z.string().max(80).optional(), sequenceActivityId: z.string().min(1).max(100).optional(), evidence: z.string().max(1000).optional(), instrument: z.string().max(250).optional(), purpose: z.string().max(500).optional(), competency: competencyKey.nullable().optional(), indicator: z.string().max(500).optional(), requestId: z.string().min(1).max(200).optional() });
const sharedActivitySchema = z.object({ courseIds: z.array(uid).min(1).max(20), activity: activitySchema.omit({ courseId: true }).extend({ requestId: z.string().min(1).max(200) }) });
const courseSequencePlanSchema = z.object({requestId:z.string().min(1).max(200),id:uid.optional(),revision:z.number().int().min(0).optional(),courseId:uid,sequenceActivityId:z.string().trim().min(1).max(100),startDate:z.string(),endDate:z.string(),assessmentPeriod:z.enum(["P1","P2","P3","P4"]).nullable(),assessmentCategory:z.enum(["exam","sequence","homework","extra"]).nullable(),assessmentMethod:z.enum(["pending","points","rubric"]),assessmentFormat:z.string().trim().max(100)});
const sequenceActivitySchema = z.object({ id:z.string().min(1).max(100), code:z.string().max(80), theme:z.string().max(250), title:z.string().trim().max(250), lessonType:z.enum(["teoria","practica","ejercicios","repaso","correcciones","actividad_escolar"]).nullable(), description:z.string().max(4000), evidence:z.string().max(1000), indicatorIds:z.array(z.string().min(1).max(100)).max(100), period:z.string().max(2).optional(), evaluationPurpose:z.enum(["diagnostica","formativa","sumativa","formativa_sumativa"]).nullable().optional(), plannedPoints:z.number().finite().nonnegative().max(10000).nullable().optional(), plannedPercent:z.number().finite().min(0).max(100).nullable().optional(), instrument:z.string().max(1000).optional(), evaluationCriteria:z.array(z.string().max(1000)).max(100).optional(), feedback:z.string().max(2000).optional(), assessmentInstrument:sourceAssessmentSchema.optional() });
const sequenceSchema = z.object({ source: z.enum(["manual","uploaded"]), sourceName: z.string().max(250), sourceText: z.string().max(80000), reviewed: z.boolean(), planningMode:z.enum(["sequence","manual"]).optional(), activePlanningPeriod:z.enum(["P1","P2","P3","P4"]).nullable().optional(), periodAssignments:z.array(z.object({activityId:z.string().min(1).max(100),period:z.enum(["P1","P2","P3","P4"])})).max(1200).optional(), activities: z.array(sequenceActivitySchema).max(300), indicators: z.array(z.object({ id:z.string().min(1).max(100), code:z.string().max(80), label:z.string().trim().max(500), competency:competencyKey.nullable() })).max(300), finalAssessment:finalAssessmentSchema.optional() });
const dailyWeightsSchema=z.object({participation:z.number().finite().min(0).max(100),behavior:z.number().finite().min(0).max(100),discipline:z.number().finite().min(0).max(100)});
const planSchema = z.object({ period: z.string(), startDate: z.string(), endDate: z.string(), status: z.enum(["provisional", "confirmed"]), note: z.string().max(4000), categories: z.array(z.object({ key: z.enum(["exam", "participation", "notebook", "sequence", "homework"]), label: z.string().trim().min(1).max(200), group: z.string().trim().min(1).max(100).optional(), weight: z.number().finite(), expectedRaw: z.number().finite().nullable(), dailyMax: z.number().finite().nullable(), targetSessions: z.number().int().nullable(), competency: competencyKey.nullable().optional(), dailyWeights:dailyWeightsSchema.nullable().optional() })).length(5), sequence: sequenceSchema.optional() });
const criterionSchema = z.object({ id: uid.optional(), label: z.string().trim().min(1).max(200), levels: z.array(z.object({label:z.string().trim().min(1).max(100),points:z.number().finite(),description:z.string().max(1000)})).length(4) });
const criterionImportSchema = z.object({ criteria: z.array(criterionSchema.omit({ id: true })).min(1).max(50) });
const rosterRowSchema = z.object({ externalId: z.string().trim().min(1).max(200), number: z.number().int().positive().max(10000), name: z.string().trim().min(1).max(250) });
const rosterBatchesSchema = z.array(z.object({ courseId: uid, rows: z.array(rosterRowSchema).min(1).max(250) })).min(1).max(20);
const attendanceImportRowSchema = z.object({ courseId: uid, date: z.string(), block: z.number().int().min(1).max(12), studentId: uid, status: z.enum(["P", "A", "T", "E", "R"]), sourceSheet: z.string().min(1).max(200), sourceRow: z.number().int().positive(), sourceStudentName: z.string().max(250), sourceStudentNumber: z.number().int().positive().nullable() });
const attendanceImportRowsSchema = z.array(attendanceImportRowSchema).min(1).max(30_000);
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
function plannedPeriodForEvaluation(sequence: SequencePlan | null | undefined, item: SequenceActivity | undefined, evaluationPeriod: string): string {
 if (!item) return "";
 const assigned = sequence?.periodAssignments?.some(row => row.activityId === item.id && row.period === evaluationPeriod) ?? false;
 return assigned ? evaluationPeriod : item.period ?? "";
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
function periodSheetWeights(categories:EvaluationPlan["categories"]){
 const weights:Record<string,number>={};
 for(const category of categories){weights[category.key]=category.weight;if(category.key==="participation"&&category.dailyWeights){weights["participation:participation"]=category.weight*category.dailyWeights.participation/100;weights["participation:discipline"]=category.weight*category.dailyWeights.discipline/100;}}
 return weights;
}
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
  const [criteriaResult,valuesResult]=await Promise.all([
   tx.query(`SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 ${activeOnly?"AND active=true":""} ORDER BY label,id`,[ownerId]),
   tx.query("SELECT criterion_id,level_label,points,descriptor FROM evaluation_criterion_values WHERE owner_id=$1 ORDER BY criterion_id,level_position",[ownerId]),
  ]);
  const criteria=criteriaResult.rows;
  if(!criteria.length)return [];
  const rows=valuesResult.rows;
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
 private async activitiesWithCriteria(ownerId:string,rows:Row[]):Promise<Activity[]>{
  const activities=rows.map(activity);
  if(!activities.length)return [];
  const assignments=(await this.db.query("SELECT activity_id,criterion_key,criterion_label,indicator_id,competency,weight,position,levels_snapshot FROM activity_criteria WHERE owner_id=$1 AND activity_id=ANY($2::uuid[]) ORDER BY activity_id,position",[ownerId,activities.map(item=>item.id)])).rows;
  const byActivity=new Map<string,Row[]>();
  for(const assignment of assignments){const id=str(assignment.activity_id);const list=byActivity.get(id)??[];list.push(assignment);byActivity.set(id,list);}
  return activities.map(base=>{
   const related=byActivity.get(base.id)??[];
   if(!related.length)return base;
   if(related.length!==base.rubric.length)throw new AppError(500,"Los criterios relacionados con la actividad no coinciden con su comprobante de valoración.","ACTIVITY_CRITERIA_MISMATCH");
   const rubric:RubricCriterion[]=related.map(item=>{const indicatorId=str(item.indicator_id);const indicator=base.indicatorPoints.find(point=>point.indicatorId===indicatorId)?.label??"";return {id:str(item.criterion_key),label:str(item.criterion_label),indicatorId,indicator,competency:str(item.competency) as CompetencyKey,weight:Number(item.weight),levels:json(item.levels_snapshot,[])};});
   return {...base,rubric};
  });
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
  const [courseResult,studentsResult,current,plansResult,curriculumSequence,criteriaCatalog,activityResult]=await Promise.all([
   this.db.query("SELECT id,code,name FROM courses WHERE owner_id=$1 ORDER BY code", [ownerId]),
   this.db.query("SELECT id,course_id,external_id,number,name,active FROM students WHERE owner_id=$1 ORDER BY course_id,number,id",[ownerId]),
   this.currentPlan(ownerId),
   this.db.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 ORDER BY period", [ownerId]),
   this.curriculumSequence(ownerId),
   this.evaluationCriteria(ownerId),
   this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 ORDER BY period,activity_date,title,id`,[ownerId]),
  ]);
  const studentsByCourse=new Map<string,Student[]>();
  for(const row of studentsResult.rows){const item=student(row);const list=studentsByCourse.get(item.courseId)??[];list.push(item);studentsByCourse.set(item.courseId,list);}
  const courses:Course[]=courseResult.rows.map(row=>{const id=str(row.id);return {id,code:str(row.code),name:str(row.name),students:studentsByCourse.get(id)??[]};});
  const plans=plansResult.rows.map(row=>normalizedPlan(json(row.config,plan())));
  const activities=await this.activitiesWithCriteria(ownerId,activityResult.rows);
  return { courses, activities, plan: current, plans, curriculumSequence, criteriaCatalog, today: this.today(), demo: Boolean(this.options.demo), demoNote: this.options.demoNote, ownerId };
 }

 async saveEvaluationCriterion(ownerId:string,input:unknown):Promise<EvaluationCriterion>{
  const value=parse(criterionSchema,input);await this.ensureOwner(ownerId);
  const labels=value.levels.map(level=>level.label.trim().toLocaleLowerCase());
  const points=value.levels.map(level=>level.points);
  if(new Set(labels).size!==4||labels.some((label,index)=>label!==["insuficiente","suficiente","bueno","excelente"][index])||points.some((point,index)=>index>0&&point<=points[index-1]!))throw new AppError(400,"Usa los cuatro niveles del Excel en su orden y con valores crecientes; el valor inicial sugerido para Insuficiente es 0.");
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
   const points=item.levels.map(level=>level.points);
   if(item.levels.some((level,index)=>level.label.trim()!==expectedLabels[index]||!level.description.trim())||points[0]!==0||points.some((point,index)=>index>0&&point<=points[index-1]!))throw new AppError(400,`El criterio “${item.label}” debe tener cuatro descriptores completos en el orden Insuficiente, Suficiente, Bueno y Excelente; Insuficiente vale 0 y los demás valores deben crecer.`);
   return {label:item.label.trim(),levels:item.levels.map((level,index)=>({label:expectedLabels[index],points:level.points,description:level.description.trim()}))};
  });
  return this.db.transaction(async tx=>{
   const prepared:{criterion:EvaluationCriterion;existing:boolean;migrateLegacyDefaults:boolean;before:unknown}[]=[];
   for(const item of criteria){
    const result=await tx.query("SELECT id,label,levels,active FROM evaluation_criteria WHERE owner_id=$1 AND lower(label)=lower($2)",[ownerId,item.label]);
    const old=result.rows[0];
    if(old){
     const existingLevels=json<RubricCriterion['levels']>(old.levels,[]);
     const same=str(old.label)===item.label&&JSON.stringify(existingLevels)===JSON.stringify(item.levels);
     const legacyDefault=existingLevels.length===4&&existingLevels.every((level,index)=>level.label===item.levels[index]?.label&&level.points===index+1&&level.description===item.levels[index]?.description);
     if((!same&&!legacyDefault)||!Boolean(old.active))throw new AppError(409,`Ya existe “${item.label}” con otro contenido o retirado. Revísalo antes de importar; no se hicieron cambios.`);
     prepared.push({criterion:{id:str(old.id),label:str(old.label),levels:same?existingLevels:item.levels,active:true},existing:true,migrateLegacyDefaults:!same&&legacyDefault,before:same?null:existingLevels});
    }else{
     prepared.push({criterion:{id:randomUUID(),...item,active:true},existing:false,migrateLegacyDefaults:false,before:null});
    }
   }
   for(const item of prepared){
    if(item.existing&&!item.migrateLegacyDefaults)continue;
    if(item.migrateLegacyDefaults){
     await tx.query("UPDATE evaluation_criteria SET levels=$3::jsonb,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,item.criterion.id,JSON.stringify(item.criterion.levels)]);
     await tx.query("DELETE FROM evaluation_criterion_values WHERE owner_id=$1 AND criterion_id=$2",[ownerId,item.criterion.id]);
    }
    if(!item.existing)await tx.query("INSERT INTO evaluation_criteria(id,owner_id,label,levels,active) VALUES($1,$2,$3,$4::jsonb,true)",[item.criterion.id,ownerId,item.criterion.label,JSON.stringify(item.criterion.levels)]);
    for(const [index,level] of item.criterion.levels.entries())await tx.query("INSERT INTO evaluation_criterion_values(owner_id,criterion_id,level_position,level_label,points,descriptor) VALUES($1,$2,$3,$4,$5,$6)",[ownerId,item.criterion.id,index+1,level.label,level.points,level.description??""]);
    await this.log(tx,ownerId,item.migrateLegacyDefaults?"criterion.imported-defaults.updated":"criterion.imported",item.criterion.id,item.before,item.criterion);
   }
   return {criteria:prepared.map(item=>item.criterion),imported:prepared.filter(item=>!item.existing||item.migrateLegacyDefaults).length,unchanged:prepared.filter(item=>item.existing&&!item.migrateLegacyDefaults).length};
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

 async courseSequencePlans(ownerId:string,courseId:string):Promise<CourseSequencePlanView[]>{
  await this.ensureOwner(ownerId);await this.requireCourse(ownerId,courseId);
  const [planRows,sequence]=await Promise.all([
   this.db.query(`SELECT p.id,p.course_id,p.sequence_activity_id,p.start_date::text AS start_date,p.end_date::text AS end_date,p.assessment_period,p.assessment_category,p.assessment_method,p.assessment_format,p.activity_id,p.revision,p.active,p.created_at::text AS created_at,a.title AS activity_title,a.scoring_mode,a.rubric,a.indicator_points,a.instrument FROM course_sequence_plans p LEFT JOIN activities a ON a.owner_id=p.owner_id AND a.course_id=p.course_id AND a.id=p.activity_id WHERE p.owner_id=$1 AND p.course_id=$2 AND p.active=true ORDER BY p.start_date,p.end_date,p.created_at,p.id`,[ownerId,courseId]),
   this.curriculumSequence(ownerId),
  ]);
  if(!planRows.rows.length)return [];
  const start=planRows.rows.reduce((min,row)=>str(row.start_date)<min?str(row.start_date):min,str(planRows.rows[0]!.start_date));
  const slots=(await this.db.query(`SELECT s.session_date::text AS date,s.block,cs.lesson_type,COUNT(a.student_id) FILTER(WHERE a.status IS NOT NULL AND a.status<>'R')::integer AS marked FROM scheduled_sessions s LEFT JOIN class_sessions cs ON cs.owner_id=s.owner_id AND cs.course_id=s.course_id AND cs.session_date=s.session_date AND cs.block=s.block LEFT JOIN attendance a ON a.owner_id=cs.owner_id AND a.session_id=cs.id WHERE s.owner_id=$1 AND s.course_id=$2 AND s.session_date >= $3 GROUP BY s.session_date,s.block,cs.lesson_type ORDER BY s.session_date,s.block`,[ownerId,courseId,start])).rows;
  const items=sequence?.activities??[];const today=this.today();
  return planRows.rows.map(row=>{
   const item=items.find(value=>value.id===str(row.sequence_activity_id));
   const from=str(row.start_date),to=str(row.end_date);const covered=slots.filter(slot=>str(slot.date)>=from&&str(slot.date)<=to);
   const past=covered.filter(slot=>str(slot.date)<=today);const schoolActivitySessions=past.filter(slot=>Number(slot.marked)>0&&str(slot.lesson_type)==="actividad_escolar").length;
   const taughtSessions=past.filter(slot=>Number(slot.marked)>0&&str(slot.lesson_type)!=="actividad_escolar").length;
   const missedSessions=past.filter(slot=>Number(slot.marked)===0||str(slot.lesson_type)==="actividad_escolar").length;
   const activityExists=Boolean(row.activity_id&&row.activity_title);
   const ready=row.scoring_mode==="rubric"?json<RubricCriterion[]>(row.rubric,[]).length>0&&json<ActivityIndicatorPoint[]>(row.indicator_points,[]).length>0:Boolean(str(row.instrument).trim());
   const future=slots.filter(slot=>str(slot.date)>to&&str(slot.date)>today);const recoverySlot=missedSessions?future[Math.min(missedSessions,future.length)-1]:undefined;
   return {id:str(row.id),courseId:str(row.course_id),sequenceActivityId:str(row.sequence_activity_id),startDate:from,endDate:to,assessmentPeriod:(str(row.assessment_period)||null) as CourseSequencePlanView["assessmentPeriod"],assessmentCategory:(str(row.assessment_category)||null) as CourseSequencePlanView["assessmentCategory"],assessmentMethod:str(row.assessment_method) as CourseSequencePlanView["assessmentMethod"],assessmentFormat:str(row.assessment_format),activityId:row.activity_id?str(row.activity_id):null,revision:Number(row.revision),active:Boolean(row.active),createdAt:row.created_at?str(row.created_at):null,sequenceCode:item?.code??"",sequenceTitle:item?.title??"Actividad de secuencia ya no disponible",activityTitle:activityExists?str(row.activity_title):null,activityReady:activityExists&&ready,scheduledSessions:covered.length,taughtSessions,missedSessions,schoolActivitySessions,nextSessionDate:recoverySlot?str(recoverySlot.date):null};
  });
 }

 async saveCourseSequencePlan(ownerId:string,input:unknown):Promise<CourseSequencePlanView>{
  const value=parse(courseSequencePlanSchema,input);requireDate(value.startDate);requireDate(value.endDate);if(value.endDate<value.startDate)throw new AppError(400,"La semana final no puede ser anterior a la semana inicial.");await this.ensureOwner(ownerId);
  const receipt=await this.operation(ownerId,value.requestId,{operation:"course.sequence-plan.save",...value},async(tx,operationId)=>{
   await this.requireCourse(ownerId,value.courseId,tx);
   if(value.assessmentPeriod)await this.planForPeriod(ownerId,value.assessmentPeriod,tx);
   const sequence=await this.curriculumSequence(ownerId,tx);if(!sequence?.reviewed)throw new AppError(409,"Confirma la secuencia antes de planificar sus actividades por curso.","SEQUENCE_NOT_REVIEWED");
   const linked=sequence.activities.find(item=>item.id===value.sequenceActivityId);if(!linked)throw new AppError(400,"La actividad seleccionada ya no pertenece a la secuencia actual.","SEQUENCE_LINK_NOT_FOUND");
   const before=value.id?(await tx.query("SELECT id,course_id,sequence_activity_id,start_date::text AS start_date,end_date::text AS end_date,assessment_period,assessment_category,assessment_method,assessment_format,activity_id,revision FROM course_sequence_plans WHERE owner_id=$1 AND course_id=$2 AND id=$3 FOR UPDATE",[ownerId,value.courseId,value.id])).rows[0]:null;
   if(value.id&&!before)throw new AppError(404,"No se encontró esta planificación para el curso.","NOT_FOUND");
   if(before&&Number(before.revision)!==value.revision)throw new AppError(409,"La planificación cambió desde que la abriste. Recarga y vuelve a guardarla.","STALE_REVISION");
   if(before?.activity_id){
    const graded=(await tx.query("SELECT 1 FROM grades WHERE owner_id=$1 AND activity_id=$2 LIMIT 1",[ownerId,str(before.activity_id)])).rows.length>0;
    if(graded&&(str(before.sequence_activity_id)!==value.sequenceActivityId||str(before.assessment_period)!==(value.assessmentPeriod??"")||str(before.start_date)!==value.startDate||str(before.end_date)!==value.endDate))throw new AppError(409,"Esta planificación ya tiene calificaciones guardadas. Conserva su historial y crea otra planificación para cambiar fechas o actividad.","PLAN_HAS_GRADES");
   }
   const id=value.id??randomUUID();const revision=before?Number(before.revision)+1:0;
   if(before){
    await tx.query("UPDATE course_sequence_plans SET sequence_activity_id=$4,start_date=$5::date,end_date=$6::date,assessment_period=$7,assessment_category=$8,assessment_method=$9,assessment_format=$10,revision=$11,updated_at=now() WHERE owner_id=$1 AND course_id=$2 AND id=$3",[ownerId,value.courseId,id,value.sequenceActivityId,value.startDate,value.endDate,value.assessmentPeriod,value.assessmentCategory,value.assessmentMethod,value.assessmentFormat,revision]);
   }else{
    await tx.query("INSERT INTO course_sequence_plans(id,owner_id,course_id,sequence_activity_id,start_date,end_date,assessment_period,assessment_category,assessment_method,assessment_format,revision) VALUES($1,$2,$3,$4,$5::date,$6::date,$7,$8,$9,$10,0)",[id,ownerId,value.courseId,value.sequenceActivityId,value.startDate,value.endDate,value.assessmentPeriod,value.assessmentCategory,value.assessmentMethod,value.assessmentFormat]);
   }
   await this.log(tx,ownerId,"course.sequence-plan.saved",id,before??null,{id,courseId:value.courseId,sequenceActivityId:value.sequenceActivityId,startDate:value.startDate,endDate:value.endDate,assessmentPeriod:value.assessmentPeriod,assessmentCategory:value.assessmentCategory,assessmentMethod:value.assessmentMethod,assessmentFormat:value.assessmentFormat,revision});
   return {requestId:value.requestId,operationId,savedRows:1,revision,entityId:id,replayed:false,savedAt:new Date().toISOString()};
  });
  const plans=await this.courseSequencePlans(ownerId,value.courseId);const saved=plans.find(item=>item.id===receipt.entityId);if(!saved)throw new AppError(500,"La planificación se guardó pero no pudo volver a leerse.");return saved;
 }

 async archiveCourseSequencePlan(ownerId:string,input:unknown):Promise<void>{
  const value=parse(z.object({requestId:z.string().min(1).max(200),id:uid,courseId:uid,revision:z.number().int().min(0)}),input);await this.ensureOwner(ownerId);
  await this.operation(ownerId,value.requestId,{operation:"course.sequence-plan.archive",...value},async(tx,operationId)=>{
   const row=(await tx.query("SELECT id,revision,activity_id FROM course_sequence_plans WHERE owner_id=$1 AND course_id=$2 AND id=$3 AND active=true FOR UPDATE",[ownerId,value.courseId,value.id])).rows[0];if(!row)throw new AppError(404,"No se encontró esta planificación activa.","NOT_FOUND");if(Number(row.revision)!==value.revision)throw new AppError(409,"La planificación cambió. Recarga antes de archivarla.","STALE_REVISION");
   if(row.activity_id&&(await tx.query("SELECT 1 FROM grades WHERE owner_id=$1 AND activity_id=$2 LIMIT 1",[ownerId,str(row.activity_id)])).rows.length)throw new AppError(409,"Esta planificación ya tiene notas. No se archiva para conservar el historial.","PLAN_HAS_GRADES");
   await tx.query("UPDATE course_sequence_plans SET active=false,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND course_id=$2 AND id=$3",[ownerId,value.courseId,value.id]);await this.log(tx,ownerId,"course.sequence-plan.archived",value.id,row,{active:false,revision:value.revision+1});return {requestId:value.requestId,operationId,savedRows:1,revision:value.revision+1,entityId:value.id,replayed:false,savedAt:new Date().toISOString()};
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
  const sessions = await tx.query("SELECT id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision,assessment_revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4", [ownerId, courseId, date, block]);
  const s = sessions.rows[0]; const roster = await this.roster(ownerId, courseId, tx);
  const calendarSlot = await tx.query("SELECT 1 FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4", [ownerId,courseId,date,block]);
  const courseCode=await tx.query("SELECT code FROM courses WHERE owner_id=$1 AND id=$2",[ownerId,courseId]);
  const through=courseCode.rows[0]&&['5A','5B','5C'].includes(str(courseCode.rows[0].code))?{rows:[{date:classCalendar.through}]}:await tx.query("SELECT max(session_date)::text AS date FROM scheduled_sessions WHERE owner_id=$1 AND course_id=$2",[ownerId,courseId]);
  const saved = s ? (await tx.query("SELECT student_id,status,behavior,behavior_max,participation,participation_max,discipline,discipline_max,daily_assessment_required,comment FROM attendance WHERE owner_id=$1 AND session_id=$2", [ownerId, s.id])).rows : [];
  const withdrawals = await tx.query("SELECT a.student_id,min(cs.session_date)::text AS date FROM attendance a JOIN class_sessions cs ON cs.id=a.session_id AND cs.owner_id=a.owner_id WHERE a.owner_id=$1 AND cs.course_id=$2 AND a.status='R' GROUP BY a.student_id", [ownerId,courseId]);
  const withdrawnFrom = new Map(withdrawals.rows.map(row=>[str(row.student_id),str(row.date)]));
  const byId = new Map(saved.map(x => [str(x.student_id), x]));
  const rows: AttendanceRow[] = roster.filter(x => x.active || byId.has(x.id)).map(x => { const row = byId.get(x.id); const status = withdrawnFrom.has(x.id) && date >= withdrawnFrom.get(x.id)! ? "R" : row?.status as AttendanceRow["status"] ?? null; const eligible=status==="P"||status==="T"; return { studentId: x.id, number: x.number, name: x.name, status, behavior: eligible ? num(row?.behavior) : null, discipline: eligible ? num(row?.discipline) : null, participation: eligible ? num(row?.participation) : null, participationMax: eligible ? num(row?.participation_max) : null, dailyAssessmentRequired: eligible && Boolean(row?.daily_assessment_required), comment: str(row?.comment) }; });
  const scheduled = calendarSlot.rows.length > 0;
  return { session: { id: s ? str(s.id) : null, courseId, date, block, lessonType: s?.lesson_type as AttendanceView["session"]["lessonType"] ?? "teoria", topic: str(s?.topic), notes: str(s?.notes), revision: Number(s?.revision ?? 0), assessmentRevision:Number(s?.assessment_revision??0), scheduled, calendarThrough: str(through.rows[0]?.date)||classCalendar.through, status: sessionStatus(date, rows.map(x => x.status), this.today(), scheduled) }, rows };
 }
 private async buildAttendanceImportReview(ownerId:string,fileName:string,sourceFingerprint:string,rows:AttendanceImportRecord[],tx:DBAdapter){
  if(!/^[a-f0-9]{64}$/i.test(sourceFingerprint))throw new AppError(400,"No pude verificar la huella del archivo Excel.");
  const rowKeys=new Set<string>();
  const sessions=new Map<string,{courseId:string;courseCode:string;date:string;block:number;revision:number;assessmentRevision:number;id:string|null;lessonType:string|null;topic:string;notes:string;rows:Map<string,Row|null>}>();
  const courses=new Map<string,{code:string;roster:Student[]}>();
  const sortedRows=[...rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)||a.date.localeCompare(b.date)||a.block-b.block||a.studentId.localeCompare(b.studentId));
  for(const row of sortedRows){
   requireDate(row.date);
   if(row.date>this.today())throw new AppError(400,"El libro contiene fechas futuras. Revisa el período antes de importar asistencia.","FUTURE_ATTENDANCE");
   const key=`${row.courseId}:${row.date}:${row.block}:${row.studentId}`;
   if(rowKeys.has(key))throw new AppError(400,"El libro repite a un estudiante en la misma fecha y bloque. Resuelve ese duplicado antes de importar.","DUPLICATE_SOURCE_ROW");
   rowKeys.add(key);
   if(!courses.has(row.courseId)){
    const course=await this.requireCourse(ownerId,row.courseId,tx);
    courses.set(row.courseId,{code:str(course.code),roster:await this.roster(ownerId,row.courseId,tx)});
   }
   const course=courses.get(row.courseId)!;
   if(!course.roster.some(student=>student.id===row.studentId))throw new AppError(400,"Una fila vinculada no pertenece al curso seleccionado.","CROSS_COURSE");
   const sessionKey=`${row.courseId}:${row.date}:${row.block}`;
   if(!sessions.has(sessionKey))sessions.set(sessionKey,{courseId:row.courseId,courseCode:course.code,date:row.date,block:row.block,revision:0,assessmentRevision:0,id:null,lessonType:null,topic:"",notes:"",rows:new Map()});
  }
  if(!sortedRows.length)throw new AppError(400,"No hay marcas válidas para revisar en el archivo.");
  const courseIds=[...courses.keys()];
  const start=sortedRows.reduce((value,row)=>row.date<value?row.date:value,sortedRows[0]!.date),end=sortedRows.reduce((value,row)=>row.date>value?row.date:value,sortedRows[0]!.date);
  const existing=(await tx.query("SELECT cs.course_id,cs.session_date::text AS date,cs.block,cs.id AS session_id,cs.revision,cs.assessment_revision,cs.lesson_type,cs.topic,cs.notes,a.student_id,a.status,a.behavior,a.behavior_max,a.participation,a.participation_max,a.discipline,a.discipline_max,a.daily_assessment_required,a.comment FROM class_sessions cs LEFT JOIN attendance a ON a.owner_id=cs.owner_id AND a.session_id=cs.id WHERE cs.owner_id=$1 AND cs.course_id=ANY($2::uuid[]) AND cs.session_date BETWEEN $3 AND $4 ORDER BY cs.session_date,cs.block,a.student_id",[ownerId,courseIds,start,end])).rows;
  const attendanceSnapshot=(row:Row|null)=>row?{status:row.status===null?null:str(row.status),behavior:row.behavior===null?null:Number(row.behavior),behaviorMax:Number(row.behavior_max),participation:row.participation===null?null:Number(row.participation),participationMax:Number(row.participation_max),discipline:row.discipline===null?null:Number(row.discipline),disciplineMax:Number(row.discipline_max),dailyAssessmentRequired:Boolean(row.daily_assessment_required),comment:str(row.comment)}:null;
  for(const value of existing){
   const date=str(value.date).slice(0,10),courseId=str(value.course_id),block=Number(value.block),key=`${courseId}:${date}:${block}`,session=sessions.get(key);
   if(!session)continue;
   session.id=str(value.session_id);session.revision=Number(value.revision);session.assessmentRevision=Number(value.assessment_revision);session.lessonType=str(value.lesson_type);session.topic=str(value.topic);session.notes=str(value.notes);
   if(value.student_id)session.rows.set(str(value.student_id),attendanceSnapshot(value));
  }
  const entries:AttendanceImportEntry[]=[];
  const state=[] as unknown[];
  for(const row of sortedRows){
   const session=sessions.get(`${row.courseId}:${row.date}:${row.block}`)!;
   const before=session.rows.get(row.studentId)??null;
   const existingStatus=before?.status as AttendanceImportEntry["existingStatus"]??null;
   const outcome=existingStatus===row.status?"same":existingStatus===null?"new":"conflict";
   const student=courses.get(row.courseId)!.roster.find(value=>value.id===row.studentId)!;
   const key=`${row.courseId}:${row.date}:${row.block}:${row.studentId}`;
   entries.push({...row,courseCode:courses.get(row.courseId)!.code,studentName:student.name,studentNumber:student.number,existingStatus,outcome,revision:session.revision,key});
   state.push({key,outcome,revision:session.revision,assessmentRevision:session.assessmentRevision,sessionId:session.id,lessonType:session.lessonType,topic:session.topic,notes:session.notes,before});
  }
  const previewId=payloadHash({fileName,sourceFingerprint,rows:sortedRows,state});
  const preview={previewId,fileName,summary:{sourceRows:rows.length,mappedRows:entries.length,newRows:entries.filter(row=>row.outcome==="new").length,sameRows:entries.filter(row=>row.outcome==="same").length,conflictingRows:entries.filter(row=>row.outcome==="conflict").length,sessions:sessions.size},entries};
  return {preview,sessions,attendanceSnapshot};
 }
 async previewAttendanceImport(ownerId:string,input:unknown){
  const value=parse(z.object({fileName:z.string().trim().min(1).max(200),sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/i),rows:attendanceImportRowsSchema}),input);
  await this.ensureOwner(ownerId);
  return this.db.transaction(async tx=>(await this.buildAttendanceImportReview(ownerId,value.fileName,value.sourceFingerprint,value.rows,tx)).preview);
 }
 async importAttendance(ownerId:string,input:unknown):Promise<AttendanceImportReceipt>{
  const value=parse(z.object({requestId:z.string().min(1).max(200),previewId:z.string().regex(/^[a-f0-9]{64}$/i),fileName:z.string().trim().min(1).max(200),sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/i),replaceConflicts:z.boolean(),confirmWithdrawals:z.boolean(),rows:attendanceImportRowsSchema}),input);
  await this.ensureOwner(ownerId);
  return this.operation(ownerId,value.requestId,{...value},async(tx,operationId)=>{
   const {preview,sessions,attendanceSnapshot}=await this.buildAttendanceImportReview(ownerId,value.fileName,value.sourceFingerprint,value.rows,tx);
   if(preview.previewId!==value.previewId)throw new AppError(409,"Los registros o la base cambiaron desde la vista previa. Analiza el Excel otra vez; no se guardó nada.","IMPORT_PREVIEW_STALE");
   const eligible=preview.entries.filter(entry=>entry.outcome==="new"||(entry.outcome==="conflict"&&value.replaceConflicts));
   const withdrawalsSkipped=eligible.filter(entry=>entry.status==="R"&&!value.confirmWithdrawals).length;
   const actionable=eligible.filter(entry=>entry.status!=="R"||value.confirmWithdrawals);
   if(!actionable.length)throw new AppError(409,withdrawalsSkipped?"Las marcas R requieren confirmar que el estudiante se retiró y que eso afecta el registro desde esa fecha.":"No hay marcas nuevas para importar. Los registros iguales se conservaron y los conflictos no se reemplazaron.","NOTHING_TO_IMPORT");
   const bySession=new Map<string,AttendanceImportEntry[]>();
   for(const entry of actionable){const key=`${entry.courseId}:${entry.date}:${entry.block}`,list=bySession.get(key)??[];list.push(entry);bySession.set(key,list);}
   const batchId=randomUUID();
   const restoreSessions=[] as unknown[];
   const summary={imported:actionable.length,replaced:actionable.filter(entry=>entry.outcome==="conflict").length,unchanged:preview.summary.sameRows,conflictsKept:preview.summary.conflictingRows-actionable.filter(entry=>entry.outcome==="conflict").length,sessions:bySession.size,fileName:value.fileName,courseIds:[...new Set(actionable.map(entry=>entry.courseId))],courseCodes:[...new Set(actionable.map(entry=>entry.courseCode))],withdrawals:actionable.filter(entry=>entry.status==="R").length,withdrawalsSkipped};
   for(const [sessionKey,entries] of bySession){
    const first=entries[0]!;let snapshot=sessions.get(sessionKey)!;
    const beforeSession=snapshot.id?{id:snapshot.id,lessonType:snapshot.lessonType,topic:snapshot.topic,notes:snapshot.notes,revision:snapshot.revision,assessmentRevision:snapshot.assessmentRevision}:null;
    if(!snapshot.id){
     const created=(await tx.query("INSERT INTO class_sessions(id,owner_id,course_id,session_date,block,lesson_type,topic,notes,revision) VALUES($1,$2,$3,$4,$5,'importada','','',0) RETURNING id,revision,assessment_revision,lesson_type,topic,notes",[randomUUID(),ownerId,first.courseId,first.date,first.block])).rows[0]!;
     snapshot={...snapshot,id:str(created.id),revision:Number(created.revision),assessmentRevision:Number(created.assessment_revision),lessonType:str(created.lesson_type),topic:str(created.topic),notes:str(created.notes)};
    }
    const beforeRows=[] as {studentId:string;row:unknown}[];
    const afterRows=[] as {studentId:string;row:unknown}[];
    for(const entry of entries){
     const before=snapshot.rows.get(entry.studentId)??null;
     beforeRows.push({studentId:entry.studentId,row:before});
     await tx.query("INSERT INTO attendance(owner_id,course_id,session_id,student_id,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,behavior=CASE WHEN EXCLUDED.status IN ('A','E','R') THEN NULL ELSE attendance.behavior END,participation=CASE WHEN EXCLUDED.status IN ('A','E','R') THEN NULL ELSE attendance.participation END,discipline=CASE WHEN EXCLUDED.status IN ('A','E','R') THEN NULL ELSE attendance.discipline END,daily_assessment_required=CASE WHEN EXCLUDED.status IN ('A','E','R') THEN false ELSE attendance.daily_assessment_required END,updated_at=now()",[ownerId,entry.courseId,snapshot.id,entry.studentId,entry.status]);
     const after=(await tx.query("SELECT status,behavior,behavior_max,participation,participation_max,discipline,discipline_max,daily_assessment_required,comment FROM attendance WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,snapshot.id,entry.studentId])).rows[0]!;
     afterRows.push({studentId:entry.studentId,row:attendanceSnapshot(after)});
    }
    const afterRevision=snapshot.revision+1;
    await tx.query("UPDATE class_sessions SET revision=$3,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,snapshot.id,afterRevision]);
    const afterSession={id:snapshot.id,lessonType:snapshot.lessonType,topic:snapshot.topic,notes:snapshot.notes,revision:afterRevision,assessmentRevision:snapshot.assessmentRevision};
    restoreSessions.push({courseId:first.courseId,date:first.date,block:first.block,beforeSession,afterSession,beforeRows,afterRows});
    await this.log(tx,ownerId,"attendance.imported",str(snapshot.id),{fileName:value.fileName,rows:beforeRows},{fileName:value.fileName,rows:afterRows});
   }
   await tx.query("INSERT INTO attendance_import_batches(id,owner_id,file_name,summary,restoration) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)",[batchId,ownerId,value.fileName,JSON.stringify(summary),JSON.stringify({sessions:restoreSessions})]);
   const receipt:AttendanceImportReceipt={requestId:value.requestId,operationId,entityId:batchId,batchId,savedRows:actionable.length,revision:1,replayed:false,savedAt:new Date().toISOString(),imported:summary.imported,replaced:summary.replaced,unchanged:summary.unchanged,conflictsKept:summary.conflictsKept,withdrawalsSkipped,sessions:summary.sessions};
   return receipt;
  });
 }
 async revertAttendanceImport(ownerId:string,batchId:string){
  await this.ensureOwner(ownerId);parse(uid,batchId);
  return this.db.transaction(async tx=>{
   const batch=(await tx.query("SELECT id,file_name,summary,restoration,status FROM attendance_import_batches WHERE owner_id=$1 AND id=$2 FOR UPDATE",[ownerId,batchId])).rows[0];
   if(!batch)throw new AppError(404,"No encontré esa importación de asistencia.","NOT_FOUND");
   if(str(batch.status)==="reverted")return {batchId,reverted:0,alreadyReverted:true};
   const restoration=json<{sessions:{courseId:string;date:string;block:number;beforeSession:{id:string;lessonType:string;topic:string;notes:string;revision:number;assessmentRevision:number}|null;afterSession:{id:string;lessonType:string;topic:string;notes:string;revision:number;assessmentRevision:number};beforeRows:{studentId:string;row:Row|null}[];afterRows:{studentId:string;row:Row|null}[]}[]}>(batch.restoration,{sessions:[]});
   const normalizeRow=(row:Row|null)=>row?{status:row.status===null?null:str(row.status),behavior:row.behavior===null?null:Number(row.behavior),behaviorMax:Number(row.behavior_max),participation:row.participation===null?null:Number(row.participation),participationMax:Number(row.participation_max),discipline:row.discipline===null?null:Number(row.discipline),disciplineMax:Number(row.discipline_max),dailyAssessmentRequired:Boolean(row.daily_assessment_required),comment:str(row.comment)}:null;
   const conflicts:string[]=[];
   for(const session of restoration.sessions){
    const current=(await tx.query("SELECT id,revision,assessment_revision,lesson_type,topic,notes FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4 FOR UPDATE",[ownerId,session.courseId,session.date,session.block])).rows[0];
    if(!current||str(current.id)!==session.afterSession.id||Number(current.revision)!==session.afterSession.revision||Number(current.assessment_revision)!==session.afterSession.assessmentRevision||str(current.lesson_type)!==session.afterSession.lessonType||str(current.topic)!==session.afterSession.topic||str(current.notes)!==session.afterSession.notes){conflicts.push(`${session.date} bloque ${session.block}`);continue;}
    for(const expected of session.afterRows){
     const currentRow=(await tx.query("SELECT status,behavior,behavior_max,participation,participation_max,discipline,discipline_max,daily_assessment_required,comment FROM attendance WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,session.afterSession.id,expected.studentId])).rows[0]??null;
     if(payloadHash(normalizeRow(currentRow))!==payloadHash(expected.row))conflicts.push(`${session.date} bloque ${session.block}, estudiante ${expected.studentId.slice(0,8)}`);
    }
    if(!session.beforeSession){
     const currentCount=Number((await tx.query("SELECT count(*)::int AS count FROM attendance WHERE owner_id=$1 AND session_id=$2",[ownerId,session.afterSession.id])).rows[0]?.count??0);
     if(currentCount!==session.afterRows.length)conflicts.push(`${session.date} bloque ${session.block}, contiene registros posteriores`);
    }
   }
   if(conflicts.length)throw new AppError(409,`No deshice nada porque hay cambios posteriores en: ${conflicts.slice(0,8).join('; ')}${conflicts.length>8?'…':''}.`,"IMPORT_REVERT_CONFLICT");
   let reverted=0;
   for(const session of restoration.sessions){
    const sessionId=session.afterSession.id;
    for(const before of session.beforeRows){
     if(!before.row)await tx.query("DELETE FROM attendance WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,sessionId,before.studentId]);
     else await tx.query("UPDATE attendance SET status=$4,behavior=$5,behavior_max=$6,participation=$7,participation_max=$8,discipline=$9,discipline_max=$10,daily_assessment_required=$11,comment=$12,updated_at=now() WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,sessionId,before.studentId,before.row.status,before.row.behavior,before.row.behaviorMax,before.row.participation,before.row.participationMax,before.row.discipline,before.row.disciplineMax,before.row.dailyAssessmentRequired,before.row.comment]);
     reverted++;
    }
    if(!session.beforeSession)await tx.query("DELETE FROM class_sessions WHERE owner_id=$1 AND id=$2",[ownerId,sessionId]);
    else await tx.query("UPDATE class_sessions SET lesson_type=$3,topic=$4,notes=$5,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,sessionId,session.beforeSession.lessonType,session.beforeSession.topic,session.beforeSession.notes]);
    await this.log(tx,ownerId,"attendance.import.reverted",sessionId,{fileName:str(batch.file_name),rows:session.afterRows},{fileName:str(batch.file_name),restored:session.beforeRows});
   }
   await tx.query("UPDATE attendance_import_batches SET status='reverted',reverted_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,batchId]);
   return {batchId,reverted,alreadyReverted:false};
  });
 }
 async attendanceImports(ownerId:string){
  await this.ensureOwner(ownerId);
  return (await this.db.query("SELECT id,file_name,summary,status,created_at::text AS created_at,reverted_at::text AS reverted_at FROM attendance_import_batches WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 30",[ownerId])).rows.map(row=>({id:str(row.id),fileName:str(row.file_name),summary:json<Record<string,unknown>>(row.summary,{}),status:str(row.status),createdAt:str(row.created_at),revertedAt:row.reverted_at?str(row.reverted_at):null}));
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
   ORDER BY slots.session_date,slots.block,a.student_id`, [ownerId, courseId, PERIOD_START]);
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
  if (v.date > this.today() && v.rows.some(r => r.status !== null || r.behavior !== null && r.behavior !== undefined || r.discipline!==null&&r.discipline!==undefined || r.participation!==null&&r.participation!==undefined)) throw new AppError(400, "Una sesión futura permanece programada: no admite asistencia ni valoraciones todavía.");
  return this.operation(ownerId, v.requestId, { operation: "attendance", ...v }, async (tx, operationId) => {
   await this.requireCourse(ownerId, v.courseId, tx); const roster = await this.roster(ownerId, v.courseId, tx); this.validateStudents(v.rows, roster);
   const p = await this.currentPlan(ownerId, tx); const behaviorMax = p.categories.find(c => c.key === "participation")?.dailyMax ?? 10;
   if (v.rows.some(r => [r.behavior,r.discipline,r.participation].some(value=>value!==null&&value!==undefined&&value>behaviorMax))) throw new AppError(400, `Las valoraciones diarias deben estar entre 0 y ${behaviorMax}.`);
   await tx.query("INSERT INTO class_sessions(id,owner_id,course_id,session_date,block) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,course_id,session_date,block) DO NOTHING", [randomUUID(), ownerId, v.courseId, v.date, v.block]);
   const locked = (await tx.query("SELECT id,revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4 FOR UPDATE", [ownerId, v.courseId, v.date, v.block])).rows[0];
   if (Number(locked.revision) !== v.revision) throw new AppError(409, "La sesión cambió desde otra pestaña. Recarga conservando tu borrador.", "REVISION_CONFLICT");
   const before = await this.attendanceView(ownerId, v.courseId, v.date, v.block, tx);
   for (const r of v.rows) {
    const ineligible = r.status === null || r.status === "A" || r.status === "E" || r.status === "R";
    await tx.query("INSERT INTO attendance(owner_id,course_id,session_id,student_id,status,behavior,behavior_max,participation,participation_max,discipline,discipline_max,daily_assessment_required,comment) VALUES($1,$2,$3,$4,$5,CASE WHEN NOT $7 AND $8 THEN $9::numeric ELSE NULL::numeric END,$6,CASE WHEN NOT $7 AND $10 THEN $11::numeric ELSE NULL::numeric END,$6,CASE WHEN NOT $7 AND $14 THEN $15::numeric ELSE NULL::numeric END,$6,(NOT $7 AND ($8 OR $10 OR $14)),CASE WHEN $12 THEN $13 ELSE '' END) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,behavior=CASE WHEN $7 THEN NULL ELSE CASE WHEN $8 THEN EXCLUDED.behavior ELSE attendance.behavior END END,behavior_max=EXCLUDED.behavior_max,participation=CASE WHEN $7 THEN NULL ELSE CASE WHEN $10 THEN EXCLUDED.participation ELSE attendance.participation END END,participation_max=EXCLUDED.participation_max,discipline=CASE WHEN $7 THEN NULL ELSE CASE WHEN $14 THEN EXCLUDED.discipline ELSE attendance.discipline END END,discipline_max=EXCLUDED.discipline_max,daily_assessment_required=CASE WHEN $7 THEN false WHEN $8 OR $10 OR $14 THEN true ELSE attendance.daily_assessment_required END,comment=CASE WHEN $12 THEN EXCLUDED.comment ELSE attendance.comment END,updated_at=now()", [ownerId, v.courseId, locked.id, r.studentId, r.status, behaviorMax, ineligible, r.behavior!==undefined, r.behavior??null, r.participation!==undefined, r.participation??null, r.comment!==undefined, r.comment??"", r.discipline!==undefined, r.discipline??null]);
   }
   const revision = v.revision + 1;
   await tx.query("UPDATE class_sessions SET lesson_type=$3,topic=$4,notes=$5,revision=$6,updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, locked.id, v.lessonType, v.topic ?? "", v.notes ?? "", revision]);
   const after = await this.attendanceView(ownerId, v.courseId, v.date, v.block, tx); await this.log(tx, ownerId, "attendance.saved", str(locked.id), before, after);
   return { requestId: v.requestId, operationId, savedRows: v.rows.length, revision, entityId: str(locked.id), replayed: false, savedAt: new Date().toISOString(), status: after.session.status };
  });
 }

 async saveDailyAssessment(ownerId:string,input:DailyAssessmentInput):Promise<SaveReceipt>{
  const v=parse(dailyAssessmentSchema,input);requireDate(v.date);await this.ensureOwner(ownerId);
  if(v.date>this.today())throw new AppError(400,"Una sesión futura permanece programada: no admite participación, comportamiento ni disciplina todavía.");
  return this.operation(ownerId,v.requestId,{operation:"daily-assessment",...v},async(tx,operationId)=>{
   await this.requireCourse(ownerId,v.courseId,tx);const roster=await this.roster(ownerId,v.courseId,tx);this.validateStudents(v.rows,roster);
   const locked=(await tx.query("SELECT id,revision,assessment_revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4 FOR UPDATE",[ownerId,v.courseId,v.date,v.block])).rows[0];
   if(!locked)throw new AppError(409,"Primero confirma la asistencia de este curso, fecha y bloque.","ATTENDANCE_REQUIRED");
   if(Number(locked.revision)!==v.revision)throw new AppError(409,"La asistencia cambió desde que abriste la valoración. Conserva el borrador y vuelve a abrirla.","REVISION_CONFLICT");
   if(Number(locked.assessment_revision)!==v.assessmentRevision)throw new AppError(409,"La participación o conducta cambió desde otra pestaña. Conserva el borrador y vuelve a cargar la valoración.","ASSESSMENT_REVISION_CONFLICT");
   const plan=await this.currentPlan(ownerId,tx);const max=plan.categories.find(category=>category.key==="participation")?.dailyMax??10;
   if(v.rows.some(row=>[row.behavior,row.discipline,row.participation].some(value=>value!==null&&value>max)))throw new AppError(400,`Cada valoración debe estar entre 0 y ${max} puntos.`);
   const before=await this.attendanceView(ownerId,v.courseId,v.date,v.block,tx);
   if(!before.rows.some(row=>row.status==="P"||row.status==="T"))throw new AppError(409,"No hay estudiantes presentes o tardíos para valorar en este bloque.","NO_ASSESSABLE_STUDENTS");
   for(const row of v.rows){
    const current=before.rows.find(item=>item.studentId===row.studentId);
    const eligible=current?.status==="P"||current?.status==="T";
    if(!eligible){
     await tx.query("UPDATE attendance SET behavior=NULL,participation=NULL,discipline=NULL,daily_assessment_required=false,comment='',updated_at=now() WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,locked.id,row.studentId]);
     continue;
    }
    await tx.query("UPDATE attendance SET behavior=$4,behavior_max=$5,participation=$6,participation_max=$5,discipline=$7,discipline_max=$5,daily_assessment_required=true,comment=$8,updated_at=now() WHERE owner_id=$1 AND session_id=$2 AND student_id=$3",[ownerId,locked.id,row.studentId,row.behavior,max,row.participation,row.discipline,row.comment??""]);
   }
   const revision=v.assessmentRevision+1;
   await tx.query("UPDATE class_sessions SET assessment_revision=$3,updated_at=now() WHERE owner_id=$1 AND id=$2",[ownerId,locked.id,revision]);
   const after=await this.attendanceView(ownerId,v.courseId,v.date,v.block,tx);await this.log(tx,ownerId,"daily-assessment.saved",str(locked.id),before,after);
   return {requestId:v.requestId,operationId,savedRows:v.rows.length,revision,entityId:str(locked.id),replayed:false,savedAt:new Date().toISOString(),status:after.session.status};
  });
 }

 async createActivity(ownerId: string, input: ActivityInput): Promise<Activity> {
  const v = parse(activitySchema, input); requireDate(v.date); await this.ensureOwner(ownerId);
  const mode = v.scoringMode ?? "points", criteria = v.rubric ?? [];
  if (mode !== "rubric" && criteria.length) throw new AppError(400, "Una actividad de puntos directos no utiliza criterios de rúbrica.");
  const create = async (tx: DBAdapter) => {
   await this.requireCourse(ownerId, v.courseId, tx); const current = await this.currentPlan(ownerId, tx);
   const targetPeriod=v.period??current.period;const targetPlan=targetPeriod===current.period?current:await this.planForPeriod(ownerId,targetPeriod,tx);
   const sequence = await this.curriculumSequence(ownerId,tx) ?? targetPlan.sequence;
   const linkedSequenceActivity = findLinkedSequenceActivity(sequence, v.sequenceActivityId, v.sequenceCode, targetPeriod);
   if (v.sequenceActivityId && !linkedSequenceActivity) throw new AppError(400, "El vínculo no coincide con una actividad de la secuencia revisada. Actualiza la secuencia y vuelve a elegir el tema.", "SEQUENCE_LINK_NOT_FOUND");
   rejectUnscoredDiagnostic(linkedSequenceActivity);
    if (v.category === "notebook" && (v.date < targetPlan.startDate || v.date > targetPlan.endDate)) throw new AppError(400, "La revisión diaria de libreta debe corresponder a una sesión del período.");
   const categoryCompetency = targetPlan.categories.find(c => c.key === v.category)?.competency ?? null;
   const activityCompetency = v.competency ?? categoryCompetency ?? defaultForCategory(v.category);
   const preparedCriteria = criteria.map(c => ({ ...c, competency: c.competency ?? activityCompetency, weight: c.weight ?? 1 }));
   if (mode === "rubric" && preparedCriteria.length) { rubricMaximum(preparedCriteria); if (preparedCriteria.some(c => !c.competency)) throw new AppError(400, "Asigna cada criterio a una competencia antes de guardar la rúbrica."); if (preparedCriteria.some(c => c.levels.some(level => !level.description?.trim()))) throw new AppError(400, "Completa el descriptor de cada nivel de la rúbrica."); }
   if (mode === "points" && !activityCompetency) throw new AppError(400, "Asigna una competencia a esta actividad de puntos directos.");
   if (v.category === "notebook" && (await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND course_id=$2 AND category='notebook' AND activity_date=$3 AND block=$4", [ownerId, v.courseId, v.date, v.block ?? 1])).rows.length) throw new AppError(409, "Ya existe una revisión diaria de libreta para esta fecha y bloque.");
   if (v.category === "notebook" && v.maxPoints !== (targetPlan.categories.find(c => c.key === "notebook")?.dailyMax ?? 2)) throw new AppError(400, "El máximo de la revisión diaria debe coincidir con su escala en el plan.");
   let coursePlan:Row|undefined;
   if(v.coursePlanId){
    coursePlan=(await tx.query("SELECT id,sequence_activity_id,assessment_period,assessment_category,activity_id,revision FROM course_sequence_plans WHERE owner_id=$1 AND course_id=$2 AND id=$3 AND active=true FOR UPDATE",[ownerId,v.courseId,v.coursePlanId])).rows[0];
    if(!coursePlan)throw new AppError(404,"No se encontró el plan de clase de este curso.","COURSE_PLAN_NOT_FOUND");
    if(str(coursePlan.sequence_activity_id)!==(v.sequenceActivityId??"")||str(coursePlan.assessment_period)!==targetPeriod)throw new AppError(409,"El contenido o período de nota cambió en el plan del curso. Actualízalo antes de crear la evaluación.","COURSE_PLAN_CHANGED");
    if(coursePlan.activity_id)throw new AppError(409,"Este plan ya tiene una evaluación vinculada. Ábrela desde Cursos para continuar.","COURSE_PLAN_ALREADY_LINKED");
   }
   const id = randomUUID();
   await tx.query("INSERT INTO activities(id,owner_id,course_id,shared_id,period,category,title,activity_date,block,max_points,scoring_mode,rubric,description,sequence_code,sequence_activity_id,sequence_planned_period,evidence,instrument,activity_purpose,competency,indicator) VALUES($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)", [id, ownerId, v.courseId, targetPeriod, v.category, v.title, v.date, v.block ?? 1, v.maxPoints, mode, JSON.stringify(preparedCriteria), v.description ?? "", linkedSequenceActivity?.code ?? v.sequenceCode ?? "", linkedSequenceActivity?.id ?? null, plannedPeriodForEvaluation(sequence,linkedSequenceActivity,targetPeriod), v.evidence ?? "", v.instrument ?? "", v.purpose ?? "", activityCompetency ?? "", v.indicator ?? ""]);
   if(coursePlan){const revision=Number(coursePlan.revision)+1;await tx.query("UPDATE course_sequence_plans SET activity_id=$4,assessment_category=$5,assessment_method=$6,revision=$7,updated_at=now() WHERE owner_id=$1 AND course_id=$2 AND id=$3",[ownerId,v.courseId,str(coursePlan.id),id,v.category,mode,revision]);await this.log(tx,ownerId,"course.sequence-plan.evaluation-linked",str(coursePlan.id),coursePlan,{activityId:id,period:targetPeriod,assessmentCategory:v.category,assessmentMethod:mode,revision});}
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
   if (mode === "rubric" && preparedCriteria.length) {
    rubricMaximum(preparedCriteria);
    if (preparedCriteria.some(c => !c.competency)) throw new AppError(400, "Asigna cada criterio a una competencia antes de guardar la rúbrica.");
    if (preparedCriteria.some(c => c.levels.some(level => !level.description?.trim()))) throw new AppError(400, "Completa el descriptor de cada nivel de la rúbrica.");
   }
   if (mode === "points" && !activityCompetency) throw new AppError(400, "Asigna una competencia a esta actividad de puntos directos.");
   if (first.category === "notebook" && first.maxPoints !== (current.categories.find(c => c.key === "notebook")?.dailyMax ?? 2)) throw new AppError(400, "El máximo de la revisión diaria debe coincidir con su escala en el plan.");
   for (const courseId of v.courseIds) {
    if (first.category === "notebook" && (await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND course_id=$2 AND category='notebook' AND activity_date=$3 AND block=$4", [ownerId, courseId, first.date, first.block ?? 1])).rows.length) throw new AppError(409, `Ya existe una revisión diaria de libreta para ${courseId} en esta fecha y bloque.`);
    const id = randomUUID();
    await tx.query("INSERT INTO activities(id,owner_id,course_id,shared_id,period,category,title,activity_date,block,max_points,scoring_mode,rubric,description,sequence_code,sequence_activity_id,sequence_planned_period,evidence,instrument,activity_purpose,competency,indicator) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,$20,$21)", [id, ownerId, courseId, sharedId, current.period, first.category, first.title, first.date, first.block ?? 1, first.maxPoints, mode, JSON.stringify(preparedCriteria), first.description ?? "", linkedSequenceActivity?.code ?? first.sequenceCode ?? "", linkedSequenceActivity?.id ?? null, plannedPeriodForEvaluation(sequence,linkedSequenceActivity,current.period), first.evidence ?? "", first.instrument ?? "", first.purpose ?? "", activityCompetency ?? "", first.indicator ?? ""]);
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
   if(value.scoringMode==="rubric"&&!allocations.length)throw new AppError(400,"Selecciona al menos un indicador para la rúbrica.");
   if(linkedSequenceActivity?.indicatorIds.length&&allocations.some(item=>!linkedSequenceActivity.indicatorIds.includes(item.indicatorId)))throw new AppError(400,"La actividad solo puede recibir puntos de indicadores vinculados a su clase de la secuencia.");
   if(allocations.length&&round(allocationTotal)!==round(current.maxPoints))throw new AppError(400,`Los puntos asignados a indicadores deben sumar ${current.maxPoints}; ahora suman ${round(allocationTotal)}.`);
   let rubric:RubricCriterion[]=[];let catalog=new Map<string,EvaluationCriterion>();
   if(value.scoringMode==="rubric"){
    if(!value.rubric.length)throw new AppError(400,"Selecciona al menos un criterio para valorar la actividad.");
    const rubricIds=new Set<string>();
    const catalogRows=await this.evaluationCriteria(ownerId,tx);catalog=new Map(catalogRows.map(item=>[item.id,item]));
    const sourceInstrument=linkedSequenceActivity?.assessmentInstrument;
    const activityCriterionPrefix=`activity:${current.sharedId??current.id}:`;
    rubric=value.rubric.map(item=>{
     if(rubricIds.has(item.id))throw new AppError(400,"No repitas un criterio en la misma rúbrica.");rubricIds.add(item.id);
     const sourcePrefix=linkedSequenceActivity?`sequence:${linkedSequenceActivity.id}:`:null;
     const sourceIndex=sourcePrefix&&item.id.startsWith(sourcePrefix)?Number(item.id.slice(sourcePrefix.length))-1:-1;
     const isSourceCriterion=sourceIndex>=0;
     const isActivityCriterion=item.id.startsWith(activityCriterionPrefix);
     if(item.id.startsWith("activity:")&&!isActivityCriterion)throw new AppError(400,"El criterio local no pertenece a esta actividad.");
     if(item.id.startsWith("sequence:")&&!isSourceCriterion)throw new AppError(400,"El criterio importado no pertenece al instrumento de la secuencia vinculada.");
     if(isSourceCriterion){
      const expectedLabel=sourceInstrument?.criteria[sourceIndex];
      if(!sourceInstrument?.scored||sourceInstrument.kind==="checklist"||!expectedLabel)throw new AppError(400,"Este criterio no pertenece a un instrumento puntuable de la secuencia revisada.");
     }else if(!isActivityCriterion&&!catalog.has(item.id))throw new AppError(400,`El criterio “${item.label}” ya no está en el catálogo activo. Actualiza la selección antes de guardar.`);
     const allocation=allocations.find(row=>row.indicatorId===item.indicatorId);if(!allocation)throw new AppError(400,`El criterio “${item.label}” debe vincularse con uno de los indicadores asignados.`);
     const catalogCriterion=catalog.get(item.id);const currentLabel=isSourceCriterion||isActivityCriterion?item.label:catalogCriterion!.label;const currentLevels=isSourceCriterion?item.levels:isActivityCriterion?item.levels:catalogCriterion!.levels;
     if(currentLevels.some(level=>!level.description?.trim()))throw new AppError(400,"Completa los descriptores de cada nivel.");
     return {...item,label:currentLabel,indicator:allocation.label,competency:allocation.competency,weight:item.weight??1,levels:currentLevels.map(level=>({...level,label:level.label.trim(),description:level.description?.trim()??""}))};
    });
    const rubricMaximumValue=rubricMaximum(rubric);
    if(rubric.every(item=>item.id.startsWith(activityCriterionPrefix))&&round(rubricMaximumValue)!==round(current.maxPoints))throw new AppError(400,`El valor de los criterios debe sumar ${current.maxPoints} puntos; ahora suma ${rubricMaximumValue}.`);
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
  const assignmentKeys=new Set<string>();
  for(const assignment of parsed.periodAssignments??[]){
   if(!activityIds.has(assignment.activityId))throw new AppError(400,"Una asignación de período apunta a una actividad que no existe en la secuencia.");
   const key=`${assignment.activityId}:${assignment.period}`;
   if(assignmentKeys.has(key))throw new AppError(400,"Una actividad aparece repetida en la misma lista de período.");
   assignmentKeys.add(key);
  }
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
  const selectedPeriod=requestedPeriod??(await this.currentPlan(ownerId)).period;
  const directPlan=await readPeriodSheet(this.db,ownerId,selectedPeriod);
  const availablePeriods = (await this.db.query("SELECT period FROM evaluation_plans WHERE owner_id=$1 UNION SELECT period FROM period_score_plans WHERE owner_id=$1 ORDER BY period", [ownerId])).rows.map(row=>str(row.period));
  const courseRows = (await this.db.query("SELECT id,code,name FROM courses WHERE owner_id=$1 ORDER BY code", [ownerId])).rows;
  if(directPlan.enabled&&!directPlan.columns.some(column=>Boolean(column.category))){
   const rows:TeacherLedgerSummary['rows']=[];
   for(const course of courseRows){
    const sheet=await this.periodSheet(ownerId,selectedPeriod,str(course.id));
    for(const row of sheet.rows)rows.push({course:{id:str(course.id),code:str(course.code),name:str(course.name)},student:row.student,categories:[],scores:directPlan.columns.map(column=>({key:column.id,points:row.result.scores[column.id],possible:column.maxPoints,state:row.result.scores[column.id]===null?'pending':'graded',pending:row.result.scores[column.id]===null?1:0})),rawTotal:row.result.accumulated??0,rawPossible:row.result.plannedPoints,bonusPoints:0,bonusPossible:0,weightedTotal:row.result.accumulated,finalized:row.result.total!==null,observations:row.result.pending?[`${row.result.pending} valoraciones pendientes`]:[]});
   }
   return {period:selectedPeriod,availablePeriods,categories:[],groups:[],rows,directPlan,note:'El cuadro del período es la fuente de la nota. Sus columnas suman directamente hasta 100; las actividades anteriores se conservan sin añadirse otra vez.'};
  }
  const p = requestedPeriod ? await this.planForPeriod(ownerId, requestedPeriod) : await this.currentPlan(ownerId);
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

  const directCategories=new Set(directPlan.enabled?directPlan.columns.flatMap(column=>column.category&&column.captureKey!=='participation'&&column.captureKey!=='discipline'?[column.category]:[]):[]);
  if(directPlan.enabled)for(const item of directPlan.columns){
   if(!item.category)continue;
   const key=`period:${item.id}`;
   columns.set(key,{key,label:item.label,category:item.category,categoryLabel:categoryLabels.get(item.category)??item.category,competency:item.competency??null,...(item.group?{group:item.group}:{}),kind:"period-score",date:item.date,maxPoints:item.maxPoints,courseIds:courseRows.map(course=>str(course.id))});
  }

  const participation = p.categories.find(category=>category.key==="participation");
  const behaviorKey="behavior:period";
  const participationKey="participation:period",disciplineKey="discipline:period";
  columns.set(participationKey,{key:participationKey,label:"Participación diaria",category:"participation",categoryLabel:"Valoración diaria",competency:participation?.competency??defaultForCategory("participation"),kind:"participation",date:null,maxPoints:participation?.dailyMax??10,courseIds:courseRows.map(course=>str(course.id))});
  columns.set(behaviorKey,{key:behaviorKey,label:"Comportamiento diario",category:"behavior",categoryLabel:"Valoración diaria",competency:participation?.competency??defaultForCategory("participation"),kind:"behavior",date:null,maxPoints:participation?.dailyMax??10,courseIds:courseRows.map(course=>str(course.id))});
  columns.set(disciplineKey,{key:disciplineKey,label:"Disciplina diaria",category:"discipline",categoryLabel:"Valoración diaria",competency:participation?.competency??defaultForCategory("participation"),kind:"discipline",date:null,maxPoints:participation?.dailyMax??10,courseIds:courseRows.map(course=>str(course.id))});
  const allColumns=[...columns.values()];
  const groupMap=new Map<string,{key:string;label:string;columns:TeacherLedgerSummary["groups"][number]["columns"]}>();
  for(const column of allColumns){
   const competency=column.competency?COMPETENCY_GROUPS.find(item=>item.key===column.competency):undefined;
   const label=column.group?.trim()||competency?.label||column.categoryLabel;
   const key=column.group?.trim()?`custom:${column.group.trim().toLocaleLowerCase()}`:column.competency??`category:${column.category}`;
   const group=groupMap.get(key)??{key,label,columns:[]};group.columns.push(column);groupMap.set(key,group);
  }
  const groups=[...groupMap.values()].map(group=>({...group,columns:group.columns.sort((a,b)=>(a.date??"").localeCompare(b.date??"")||a.category.localeCompare(b.category)||a.label.localeCompare(b.label))}));

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
     if(directCategories.has(grade.category)||grade.countedInPeriod===false){
      for(const key of gradeColumnKeys){const column=columns.get(key);if(!column||!scoreByKey.has(key))continue;scoreByKey.set(key,{key,points:grade.score,possible:column.maxPoints,state:grade.included?"not_counted":"excluded",pending:0,comment:grade.comment||undefined});}
      continue;
     }
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
    const sessions=report.timeline.filter(item=>item.sessionStatus==="impartida"&&item.status!=="R");
    const dailyMax=participation?.dailyMax??10;
    const participationValues=sessions.map(item=>item.status==="A"||item.status==="E"?0:item.participation);
    const participationPoints=round(participationValues.reduce<number>((sum,value)=>sum+(value??0),0));
    const participationPossible=round(participationValues.length*dailyMax);
    const participationPending=participationValues.filter(value=>value===null).length;
    const participationGraded=participationValues.length-participationPending;
    scoreByKey.set(participationKey,{key:participationKey,points:participationGraded?participationPoints:null,possible:participationPossible,state:participationPossible===0?"not_applicable":participationPending?"pending":"graded",pending:participationPending});
    const behaviorSessions=sessions.filter(item=>item.status==="P"||item.status==="T"||item.status===null);
    const behaviorValues=behaviorSessions.map(item=>item.behavior);
    const behaviorPoints=round(behaviorValues.reduce<number>((sum,value)=>sum+(value??0),0));
    const behaviorPossible=round(behaviorValues.length*dailyMax);
    const behaviorPending=behaviorValues.filter(value=>value===null).length;
    const behaviorGraded=behaviorValues.length-behaviorPending;
    scoreByKey.set(behaviorKey,{key:behaviorKey,points:behaviorGraded?behaviorPoints:null,possible:behaviorPossible,state:behaviorPossible===0?"not_applicable":behaviorPending?"pending":"graded",pending:behaviorPending});
    const disciplineValues=behaviorSessions.map(item=>item.discipline);
    const disciplinePoints=round(disciplineValues.reduce<number>((sum,value)=>sum+(value??0),0));
    const disciplinePossible=round(disciplineValues.length*dailyMax);
    const disciplinePending=disciplineValues.filter(value=>value===null).length;
    const disciplineGraded=disciplineValues.length-disciplinePending;
    scoreByKey.set(disciplineKey,{key:disciplineKey,points:disciplineGraded?disciplinePoints:null,possible:disciplinePossible,state:disciplinePossible===0?"not_applicable":disciplinePending?"pending":"graded",pending:disciplinePending});
    if(report.directEvaluation)for(const item of report.directEvaluation.columns){
     if(!item.category)continue;
     const key=`period:${item.id}`,points=report.directEvaluation.scores[item.id]??null;
     const componentCapture=item.captureKey==='participation'||item.captureKey==='discipline';
     scoreByKey.set(key,{key,points,possible:item.maxPoints,state:componentCapture?"not_counted":points===null?"pending":"graded",pending:componentCapture?0:points===null?1:0});
    }
    const finalScores=[...scoreByKey.values()];
    const counted=finalScores.filter(score=>score.state!=="excluded"&&score.state!=="not_applicable"&&score.state!=="not_counted");
    const rawTotal=round(counted.reduce((sum,score)=>sum+(score.points??0),0));
    const rawPossible=round(counted.reduce((sum,score)=>sum+score.possible,0));
    const observations=[...report.grades.filter(item=>item.comment.trim()).map(item=>`${item.title}: ${item.comment.trim()}`),...report.timeline.filter(item=>item.comment.trim()).map(item=>`${item.date} · Registro diario: ${item.comment.trim()}`)];
    rows.push({course,student,categories:report.categories,scores:finalScores,rawTotal,rawPossible,bonusPoints:report.bonusPoints,bonusPossible:report.bonusPossible,weightedTotal:report.total??report.provisionalTotal,finalized:report.total!==null,observations});
   }
  }
  return {period:p.period,availablePeriods,categories:p.categories.map(({key,label,group,weight,expectedRaw})=>({key,label,group,weight,expectedRaw})),groups,rows,...(directPlan.enabled?{directPlan}:{}),note:directPlan.enabled?"El cuadro directo y las actividades alimentan la misma matriz. Una categoría con columnas directas no vuelve a sumar sus actividades; las demás categorías siguen su cálculo habitual. Los puntos extra se agregan aparte.":"El libro conserva cada actividad y cada criterio bajo su competencia. El resumen convierte cada categoría a su peso asignado; las categorías con el mismo grupo se muestran en una columna y conservan su desglose. Las valoraciones diarias usan solo sesiones impartidas. Los pendientes no son cero y las clases no impartidas no entran en esos promedios."};
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
   if(a.scoringMode==="rubric"&&!a.rubric.length)throw new AppError(409,"La rúbrica todavía no está configurada. Define sus criterios antes de capturar calificaciones.","EVALUATION_NOT_CONFIGURED");
   if(a.scoringMode==="rubric"&&a.category!=="notebook"&&a.category!=="participation"&&reviewedSequence?.reviewed&&reviewedSequence.indicators.length&&!a.indicatorPoints.length)throw new AppError(409,"Esta actividad todavía no está distribuida por indicador. Configura la rúbrica antes de guardar calificaciones.","EVALUATION_NOT_CONFIGURED");
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

 async manageRoster(ownerId: string, input: unknown) {
  const rowSchema=z.object({id:uid,name:z.string().trim().min(1).max(250),number:z.number().int().positive().max(10000)});
  const value=parse(z.object({courseId:uid,before:z.array(rowSchema).max(1000),rows:z.array(rowSchema).max(1000)}),input);
  await this.ensureOwner(ownerId);
  return this.db.transaction(async tx=>{
   await this.requireCourse(ownerId,value.courseId,tx);
   await tx.query('SELECT id FROM students WHERE owner_id=$1 AND course_id=$2 FOR UPDATE',[ownerId,value.courseId]);
   const before=await this.roster(ownerId,value.courseId,tx);
   const snapshot=(rows:{id:string;name:string;number:number}[])=>JSON.stringify(rows.map(({id,name,number})=>({id,name,number})).sort((a,b)=>a.id.localeCompare(b.id)));
   if(snapshot(before)!==snapshot(value.before))throw new AppError(409,'La lista cambió desde que la abriste. Recarga Cursos antes de volver a editar.');
   const ids=new Set(value.rows.map(row=>row.id));
   if(ids.size!==value.rows.length||ids.size!==before.length||before.some(row=>!ids.has(row.id)))throw new AppError(400,'La administración debe conservar los mismos estudiantes del curso.');
   if(new Set(value.rows.map(row=>row.number)).size!==value.rows.length)throw new AppError(400,'Cada estudiante debe tener un lugar distinto.');
   for(const row of value.rows)await tx.query('UPDATE students SET name=$1,number=$2 WHERE owner_id=$3 AND course_id=$4 AND id=$5',[row.name,row.number,ownerId,value.courseId,row.id]);
   const after=await this.roster(ownerId,value.courseId,tx);
   await this.log(tx,ownerId,'roster.managed',value.courseId,before,after);
   return after;
  });
 }

 async importRoster(ownerId: string, courseId: string, rows: RosterRow[]) {
  await this.importRosters(ownerId, [{ courseId, rows }]);
  return this.roster(ownerId, courseId);
 }
 async periodSheet(ownerId:string,period:string,courseId:string){
  await this.ensureOwner(ownerId);
  const sheetPlan=await readPeriodSheet(this.db,ownerId,period);
  let categories:{key:ActivityCategoryKey;label:string;weight:number;dailyMax:number|null;competency:CompetencyKey|null;group?:string;dailyWeights:EvaluationPlan["categories"][number]["dailyWeights"]}[]=[];let categoryWeights:Record<string,number>={};
  try{const evaluationPlan=await this.planForPeriod(ownerId,period);categories=evaluationPlan.categories.map(({key,label,weight,dailyMax,competency,group,dailyWeights})=>({key,label,weight,dailyMax,competency,dailyWeights,...(group?{group}:{})}));categoryWeights=periodSheetWeights(evaluationPlan.categories);}catch(error){if(!(error instanceof AppError&&error.status===404)||sheetPlan.columns.some(column=>Boolean(column.category)))throw error;}
  if(!courseId)return {plan:sheetPlan,courseId,categories,rows:[]};
  await this.requireCourse(ownerId,courseId);
  const roster=await this.roster(ownerId,courseId);
  const grades=(await this.db.query('SELECT student_id,column_id,score FROM period_scores WHERE owner_id=$1 AND period=$2 AND course_id=$3',[ownerId,period,courseId])).rows;
  return {plan:sheetPlan,courseId,categories,rows:roster.map(student=>({student,result:periodSheetResult(sheetPlan,Object.fromEntries(grades.filter(row=>row.student_id===student.id).map(row=>[str(row.column_id),num(row.score)])),categoryWeights)}))};
 }
 async savePeriodSheetPlan(ownerId:string,input:unknown){await this.ensureOwner(ownerId);const period=typeof input==='object'&&input!==null&&'period'in input?String((input as {period:unknown}).period):'';let categoryWeights:Record<string,number>={};try{const evaluationPlan=await this.planForPeriod(ownerId,period);categoryWeights=periodSheetWeights(evaluationPlan.categories);}catch(error){if(!(error instanceof AppError&&error.status===404))throw error;}return savePeriodSheetPlan(this.db,ownerId,input,categoryWeights);}
 async savePeriodSheetGrades(ownerId:string,input:unknown){await this.ensureOwner(ownerId);return savePeriodSheetGrades(this.db,ownerId,input);}

 async updatePlan(ownerId: string, input: EvaluationPlan): Promise<EvaluationPlan> {
  const parsed = parse(planSchema,input);
  input = { ...parsed, categories: parsed.categories.map(c => ({ ...c, competency: c.competency ?? defaultForCategory(c.key) })) as EvaluationPlan["categories"] };
  await this.ensureOwner(ownerId);
  if (!input || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(input.period) || !Array.isArray(input.categories) || input.categories.length !== 5 || new Set(input.categories.map(c => c.key)).size !== 5) throw new AppError(400, "El plan requiere un período y sus cinco categorías.");
  requireDate(input.startDate); requireDate(input.endDate); if (input.startDate > input.endDate) throw new AppError(400, "El período termina antes de empezar.");
  const keys = new Set(plan().categories.map(c => c.key)); let total = 0;
  for (const c of input.categories) { if (!keys.has(c.key) || !c.label?.trim() || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100 || c.expectedRaw !== null && (!Number.isFinite(c.expectedRaw) || c.expectedRaw <= 0) || c.dailyMax !== null && (!Number.isFinite(c.dailyMax) || c.dailyMax <= 0 || c.dailyMax > 10000) || c.targetSessions !== null && (!Number.isInteger(c.targetSessions) || c.targetSessions < 1)) throw new AppError(400, "Revisa pesos, máximos y número de sesiones del plan."); if(c.key==="participation"&&c.dailyWeights){const totalShare=c.dailyWeights.participation+c.dailyWeights.behavior+c.dailyWeights.discipline;if(round(totalShare)!==100||c.dailyWeights.behavior<=c.dailyWeights.discipline)throw new AppError(400,"La distribución diaria debe sumar 100%; comportamiento debe tener más porcentaje que disciplina.");} total += c.weight; }
  if (round(total) !== 100) throw new AppError(400, "Los pesos del período deben sumar 100.");
  if (input.status !== "provisional" && input.status !== "confirmed") throw new AppError(400, "El estado del plan no es válido.");
  if (input.status === "confirmed" && input.categories.some(c => c.dailyMax === null && c.expectedRaw === null)) throw new AppError(400, "Completa el máximo bruto previsto de cada categoría antes de confirmar el plan.");
  if(input.status==="confirmed"&&!input.categories.find(c=>c.key==="participation")?.dailyWeights)throw new AppError(400,"Distribuye los 100% internos entre participación, comportamiento y disciplina antes de confirmar el plan.");
  const categories: EvaluationPlan["categories"] = input.categories.map(c => ({ key: c.key, label: c.label.trim(), ...(c.group ? { group: c.group.trim() } : {}), weight: c.weight, expectedRaw: c.expectedRaw, dailyMax: c.dailyMax, targetSessions: c.targetSessions, competency: c.competency ?? defaultForCategory(c.key),...(c.key==="participation"?{dailyWeights:c.dailyWeights??null}:{}) }));
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
 async exportData(ownerId: string) { await this.ensureOwner(ownerId); return this.db.transaction(async tx => { const read = async (table: string, fields: string) => (await tx.query(`SELECT ${fields} FROM ${table} WHERE owner_id=$1`, [ownerId])).rows; return { format: "registro-docente/v1", exportedAt: new Date().toISOString(), ownerId, plans: await read("evaluation_plans", "period,config,active,revision"), courses: await read("courses", "id,code,name"), students: await read("students", "id,course_id,external_id,number,name,active"), scheduledSessions: await read("scheduled_sessions", "course_id,session_date::text AS date,block"), sessions: await read("class_sessions", "id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision"), attendance: await read("attendance", "course_id,session_id,student_id,status,behavior,behavior_max,comment"), activities: await read("activities", activityFields), courseSequencePlans: await read("course_sequence_plans", "id,course_id,sequence_activity_id,start_date::text AS start_date,end_date::text AS end_date,assessment_period,assessment_category,assessment_method,assessment_format,activity_id,revision,active,created_at::text"), criteria: await read("evaluation_criteria", "id,label,levels,active,updated_at::text"), criterionValues: await read("evaluation_criterion_values", "criterion_id,level_position,level_label,points,descriptor"), activityCriteria: await read("activity_criteria", "activity_id,criterion_key,catalog_criterion_id,criterion_label,indicator_id,competency,weight,position,levels_snapshot"), grades: await read("grades", "course_id,activity_id,student_id,score,criterion_levels,comment"), criterionRatings: await read("grade_criterion_ratings", "activity_id,student_id,criterion_key,level_position,level_label,points,descriptor"), periodScorePlans: await read("period_score_plans", "period,revision,enabled,columns"), periodScores: await read("period_scores", "period,course_id,student_id,column_id,score"), attendanceImportBatches: await read("attendance_import_batches", "id,file_name,summary,restoration,status,created_at::text,reverted_at::text"), audit: await read("audit_entries", "id,operation,entity_id,created_at::text,before_data,after_data") }; }); }

 async report(ownerId: string, courseId: string, studentId: string, requestedPeriod?: string): Promise<StudentReport> {
  await this.ensureOwner(ownerId); const c = await this.requireCourse(ownerId, courseId); const person = (await this.roster(ownerId, courseId)).find(s => s.id === studentId); if (!person) throw new AppError(404, "El estudiante no pertenece a este curso.", "NOT_FOUND"); const p = requestedPeriod ? await this.planForPeriod(ownerId, requestedPeriod) : await this.currentPlan(ownerId);
  const sessions = (await this.db.query("SELECT s.id,s.session_date::text AS date,s.block,a.status,a.behavior,a.behavior_max,a.participation,a.participation_max,a.discipline,a.discipline_max,a.daily_assessment_required,a.comment,EXISTS(SELECT 1 FROM scheduled_sessions cal WHERE cal.owner_id=s.owner_id AND cal.course_id=s.course_id AND cal.session_date=s.session_date AND cal.block=s.block) AS scheduled,(SELECT count(*) FROM attendance marks WHERE marks.session_id=s.id AND marks.owner_id=s.owner_id AND marks.status IN ('P','A','T','E')) AS mark_count FROM class_sessions s LEFT JOIN attendance a ON a.session_id=s.id AND a.student_id=$3 AND a.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.course_id=$2 AND s.session_date BETWEEN $4 AND $5 ORDER BY s.session_date,s.block", [ownerId, courseId, studentId, p.startDate, p.endDate])).rows;
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
  const directEvaluation=await studentPeriodSheet(this.db,ownerId,p.period,studentId,periodSheetWeights(p.categories));
  const isDimensionCapture=(column:{captureKey?:string})=>column.captureKey==='participation'||column.captureKey==='discipline';
  const directCategories=new Set(directEvaluation?.columns.flatMap(column=>column.category&&!isDimensionCapture(column)?[column.category]:[])??[]);
  const directParticipation=directEvaluation?.columns.filter(column=>column.category==='participation'&&column.captureKey==='participation')??[];
  const directDiscipline=directEvaluation?.columns.filter(column=>column.category==='participation'&&column.captureKey==='discipline')??[];
  const grades: StudentReport["grades"] = gradeRecords.map(r => ({ studentId, number: person.number, name: person.name, score: num(r.score), criterionLevels: json(r.criterion_levels, null), comment: str(r.comment), activityId: str(r.activity_id), title: str(r.title), date: str(r.date), category: r.category as Activity["category"], maxPoints: Number(r.max_points), included: r.category !== "notebook" || sessionKeys.has(`${str(r.date)}:${Number(r.block)}`) && !(withdrawnFrom && str(r.date) >= withdrawnFrom), countedInPeriod: (r.category !== "notebook" || sessionKeys.has(`${str(r.date)}:${Number(r.block)}`) && !(withdrawnFrom && str(r.date) >= withdrawnFrom)) && !directCategories.has(r.category as Activity["category"]) && !(r.category==='participation'&&directParticipation.length>0), rubric: json(r.rubric, []), indicatorPoints: json(r.indicator_points, []), scoringMode: r.scoring_mode as 'points'|'rubric', competency: (str(r.competency) as CompetencyKey) || (p.categories.find(cat => cat.key === r.category)?.competency ?? (r.category === "extra" ? defaultForCategory("extra") : null)), sequenceCode: str(r.sequence_code), sequenceActivityId: str(r.sequence_activity_id) || null, sequencePlannedPeriod: str(r.sequence_planned_period) || null, evidence: str(r.evidence), instrument: str(r.instrument), purpose: str(r.activity_purpose) }));
  const bonusActivities=grades.filter(g=>g.category==="extra");
  const directExtraColumns=directEvaluation?.columns.filter(column=>column.category==="extra")??[];
  const directExtraPoints=directExtraColumns.reduce((sum,column)=>sum+(directEvaluation?.scores[column.id]??0),0);
  const directExtraPossible=directExtraColumns.reduce((sum,column)=>sum+column.maxPoints,0);
  const bonusPoints=round(directCategories.has("extra")?directExtraPoints:bonusActivities.reduce((sum,g)=>sum+(g.score??0),0));
  const bonusPossible=round(directCategories.has("extra")?directExtraPossible:bonusActivities.reduce((sum,g)=>sum+g.maxPoints,0));
  const categories: CategoryReport[] = p.categories.map(cat => {
   const directColumns=directEvaluation?.columns.filter(column=>column.category===cat.key&&!isDimensionCapture(column))??[];
   if(directColumns.length){
    const rawPossible=round(directColumns.reduce((sum,column)=>sum+column.maxPoints,0));
    const graded=directColumns.filter(column=>directEvaluation?.scores[column.id]!==null&&directEvaluation?.scores[column.id]!==undefined).length;
    const pending=directColumns.length-graded;
    const rawEarned=round(directColumns.reduce((sum,column)=>sum+(directEvaluation?.scores[column.id]??0),0));
    const points=graded?rawEarned:null;
    const observedDenominator=round(directColumns.filter(column=>directEvaluation?.scores[column.id]!==null&&directEvaluation?.scores[column.id]!==undefined).reduce((sum,column)=>sum+column.maxPoints,0));
    return {key:cat.key,label:cat.label,group:cat.group,weight:cat.weight,rawEarned,rawPossible,expectedRaw:cat.weight,graded,pending,denominator:cat.weight,points,observedDenominator,observedPercent:observedDenominator?round(rawEarned/observedDenominator*100):null,planIncomplete:rawPossible!==cat.weight,provisional:p.status!=="confirmed"||pending>0||rawPossible!==cat.weight};
   }
   if (cat.key === "participation" && cat.dailyWeights) {
    const maximum=cat.dailyMax??10;const sessionsForDaily=taught.filter(item=>item.status!=="R");
    const rated=(key:"participation"|"behavior"|"discipline",eligible:(status:AttendanceRow["status"])=>boolean,absenceIsZero:boolean)=>{
     const entries=sessionsForDaily.flatMap(session=>{
      const status=session.status as AttendanceRow["status"]??null;
      if(status==="R")return [];
      if(absenceIsZero&&(status==="A"||status==="E"))return [{score:0,max:num(session.participation_max)??maximum}];
      if(status!==null&&!eligible(status))return [];
      const score=num(session[key]),max=num(session[key==="participation"?"participation_max":key==="behavior"?"behavior_max":"discipline_max"])??maximum;
      return [{score,max}];
     });
     return {earned:round(entries.reduce((sum,entry)=>sum+(entry.score??0),0)),possible:round(entries.reduce((sum,entry)=>sum+entry.max,0)),observed:round(entries.reduce((sum,entry)=>sum+(entry.score===null?0:entry.max),0)),graded:entries.filter(entry=>entry.score!==null).length,pending:entries.filter(entry=>entry.score===null).length};
    };
    let participation=rated("participation",status=>status==="P"||status==="T",true);
    const behavior=rated("behavior",status=>status==="P"||status==="T",false);
    let discipline=rated("discipline",status=>status==="P"||status==="T",false);
    const dimensionResult=(columns:typeof directParticipation)=>{
     const gradedColumns=columns.filter(column=>directEvaluation?.scores[column.id]!==null&&directEvaluation?.scores[column.id]!==undefined);
     return {earned:round(columns.reduce((sum,column)=>sum+(directEvaluation?.scores[column.id]??0),0)),possible:round(columns.reduce((sum,column)=>sum+column.maxPoints,0)),observed:round(gradedColumns.reduce((sum,column)=>sum+column.maxPoints,0)),graded:gradedColumns.length,pending:columns.length-gradedColumns.length};
    };
    if(directParticipation.length)participation=dimensionResult(directParticipation);
    if(directDiscipline.length)discipline=dimensionResult(directDiscipline);
    const activities=directParticipation.length?[]:grades.filter(grade=>grade.category==="participation"&&grade.included);
    participation.earned=round(participation.earned+activities.reduce((sum,grade)=>sum+(grade.score??0),0));
    participation.possible=round(participation.possible+activities.reduce((sum,grade)=>sum+grade.maxPoints,0));
    participation.observed=round(participation.observed+activities.reduce((sum,grade)=>sum+(grade.score===null?0:grade.maxPoints),0));
    participation.graded+=activities.filter(grade=>grade.score!==null).length;participation.pending+=activities.filter(grade=>grade.score===null).length;
    const shares=cat.dailyWeights;const sharePoints={participation:cat.weight*shares.participation/100,behavior:cat.weight*shares.behavior/100,discipline:cat.weight*shares.discipline/100};
    const pointFor=(earned:number,possible:number,share:number)=>possible?round(share*earned/possible):0;
    const dailyBreakdown={
     participation:{percentage:shares.participation,rawEarned:participation.earned,rawPossible:participation.possible,points:pointFor(participation.earned,participation.possible,sharePoints.participation)},
     behavior:{percentage:shares.behavior,rawEarned:behavior.earned,rawPossible:behavior.possible,points:pointFor(behavior.earned,behavior.possible,sharePoints.behavior)},
     discipline:{percentage:shares.discipline,rawEarned:discipline.earned,rawPossible:discipline.possible,points:pointFor(discipline.earned,discipline.possible,sharePoints.discipline)},
    };
    const rawEarned=round(participation.earned+behavior.earned+discipline.earned),rawPossible=round(participation.possible+behavior.possible+discipline.possible),observed=round(participation.observed+behavior.observed+discipline.observed);
    const pending=(shares.participation>0?participation.pending:0)+(shares.behavior>0?behavior.pending:0)+(shares.discipline>0?discipline.pending:0);
    const graded=(shares.participation>0?participation.graded:0)+(shares.behavior>0?behavior.graded:0)+(shares.discipline>0?discipline.graded:0);
    const points=rawPossible?round(dailyBreakdown.participation.points+dailyBreakdown.behavior.points+dailyBreakdown.discipline.points):null;
    const periodOpen=p.endDate>=this.today();
    return {key:cat.key,label:cat.label,group:cat.group,weight:cat.weight,rawEarned,rawPossible,expectedRaw:rawPossible,graded,pending,denominator:rawPossible,points,observedDenominator:observed,observedPercent:observed?round(rawEarned/observed*100):null,planIncomplete:!rawPossible,provisional:p.status!=="confirmed"||!rawPossible||pending>0||periodOpen,dailyBreakdown};
   }
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
    const noAllocation=cat.key==="participation";
    return { key: cat.key, label: cat.label, group: cat.group, weight: cat.weight, rawEarned, rawPossible, expectedRaw: target, graded, pending, denominator: target, points: noAllocation?null:observed && target && rawPossible <= target ? round(rawEarned / target * cat.weight) : null, observedDenominator: observed, observedPercent: observed ? round(rawEarned / observed * 100) : null, planIncomplete: !target || rawPossible !== target || noAllocation, provisional: p.status !== "confirmed" || !target || pending > 0 || rawPossible !== target || noAllocation };
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
   if (!g.included || g.countedInPeriod===false || g.category === "notebook") continue;
   if(directCategories.has(g.category))continue;
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
  if(directEvaluation)for(const column of directEvaluation.columns){if(!column.competency||!column.category||column.category==="extra")continue;const score=directEvaluation.scores[column.id];if(column.captureKey==='participation'||column.captureKey==='discipline'){const participationPlan=p.categories.find(category=>category.key==='participation');const share=participationPlan?.dailyWeights?participationPlan.weight*participationPlan.dailyWeights[column.captureKey]/100:0;const ratio=score===null||score===undefined?null:score/column.maxPoints;addCompetency(column.competency,ratio===null?0:round(ratio*share),share,ratio===null?0:1,ratio===null?1:0);}else addCompetency(column.competency,score??0,column.maxPoints,score===null||score===undefined?0:1,score===null||score===undefined?1:0);}
  const notebookCategory = p.categories.find(cat => cat.key === "notebook");
  if (!directCategories.has("notebook")&&notebookCategory?.competency) for (const s of taught) {
   const daily = grades.find(g => g.category === "notebook" && g.date === str(s.date) && Number(gradeRecords.find(r => r.activity_id === g.activityId)?.block) === Number(s.block));
   addCompetency(notebookCategory.competency, daily?.score ?? 0, notebookCategory.dailyMax ?? 2, daily?.score === null || daily?.score === undefined ? 0 : 1, daily?.score === null || daily?.score === undefined ? 1 : 0);
  }
  const participationCategory = p.categories.find(cat => cat.key === "participation");
  if (!directCategories.has("participation")&&participationCategory?.competency) for (const s of taught.filter(item => item.status !== "A" && item.status !== "E" && item.status !== "R")) {
   const behavior = num(s.behavior);
   addCompetency(participationCategory.competency, behavior ?? 0, num(s.behavior_max) ?? participationCategory.dailyMax ?? 10, behavior === null ? 0 : 1, behavior === null ? 1 : 0);
  }
  const competencies: CompetencyScore[] = COMPETENCY_GROUPS.filter(group => competencyValues.has(group.key)).map(group => {
   const value = competencyValues.get(group.key)!;
   return { key: group.key, label: group.label, points: round(value.points), possible: round(value.possible), percentage: value.possible ? round(value.points / value.possible * 100) : null, graded: value.graded, pending: value.pending };
  });
  const directEvaluationMode=directEvaluation?(directEvaluation.columns.some(column=>Boolean(column.category))?"combined":"exclusive"):undefined;
  const known = categories.filter(c => c.points !== null); const complete = p.status === "confirmed" && categories.every(c => !c.provisional && c.points !== null && c.pending === 0);
  const notices = directEvaluationMode==="exclusive"
   ? ["El cuadro directo determina la nota del período; las actividades y valoraciones diarias se conservan aparte y no se suman otra vez.", "Los vacíos permanecen pendientes. La nota directa se completa cuando hay 100 puntos distribuidos y todas las columnas tienen nota.", "La captura diaria conserva asistencia, participación, comportamiento y disciplina en sus registros, aunque este cuadro sea la fuente de la nota final."]
   : directEvaluationMode==="combined"
   ? ["Las columnas asignadas a una categoría entran directamente en esa parte de la matriz. Las actividades de esa misma categoría se conservan como evidencia, pero no se vuelven a sumar.", "Participación y Disciplina directas sustituyen solo su dimensión; Comportamiento diario conserva su cálculo dentro de los 15 puntos.", "Las columnas de cada categoría no pueden superar sus puntos disponibles; la distribución debe completar el máximo antes de cerrar la nota.", "Los puntos extra se suman aparte. Los campos vacíos siguen pendientes y un cero registrado sí cuenta como cero."]
   : ["Solo las sesiones del horario con marcas de asistencia cuentan como impartidas. Una fecha fuera del calendario no se convierte en ausencia ni en clase no impartida.", "El porcentaje usa las sesiones trabajadas; las excusas quedan registradas por separado, tres tardanzas equivalen a una ausencia y R se aplica desde la fecha de retiro.", "Participación obtiene cero cuando hay ausencia o excusa; comportamiento y disciplina no se valoran si el estudiante no asistió.", "El resumen por competencia suma puntos asignados a criterios; el cálculo de nota final por categoría sigue separado.", "Los puntos extra se suman aparte de las cinco categorías y no cambian sus máximos.", "La nota final permanece pendiente mientras falten actividades, calificaciones o sesiones previstas.", ...(grades.some(g => !g.included && g.score !== null) ? ["Hay notas de libreta conservadas en fechas sin clase impartida; no se incluyen en el cálculo diario."] : [])];
  return { student: person, course: { id: str(c.id), code: str(c.code), name: str(c.name) }, plan: p, attendance: stats, categories, competencies, ...(directEvaluation ? { directEvaluation,directEvaluationMode } : {}), bonusPoints: directEvaluationMode==="exclusive" ? 0 : bonusPoints, bonusPossible: directEvaluationMode==="exclusive" ? 0 : bonusPossible, total: directEvaluationMode==="exclusive" ? directEvaluation?.total??null : complete ? round(categories.reduce((sum, c) => sum + (c.points ?? 0), 0) + bonusPoints) : null, provisionalTotal: directEvaluationMode==="exclusive" ? directEvaluation?.accumulated??null : known.length ? round(known.reduce((sum, c) => sum + (c.points ?? 0), 0) + bonusPoints) : bonusPoints ? bonusPoints : null, grades, timeline: effectiveSessions.map(s => ({ date: str(s.date), block: Number(s.block), status: s.status as AttendanceRow["status"] ?? null, behavior: s.status === "A" || s.status === "E" || s.status === "R" ? null : num(s.behavior), discipline: s.status === "A" || s.status === "E" || s.status === "R" ? null : num(s.discipline), participation: s.status === "A" || s.status === "E" ? 0 : s.status === "R" ? null : num(s.participation), dailyAssessmentRequired: Boolean(s.daily_assessment_required), comment: str(s.comment), sessionStatus: sessionStatus(str(s.date), Number(s.mark_count) ? ["P"] : [], this.today(), Boolean(s.scheduled)) })), notices }; }

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
