import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DBAdapter } from "./db";
import { Activity, ActivityInput, AppError, AttendanceInput, AttendanceRow, AttendanceView, AuditEntry, Bootstrap, CategoryReport, COURSE_SIZES, Course, EvaluationPlan, GradeRow, GradesInput, GradesView, RosterRow, SaveReceipt, ServiceOptions, Student, StudentReport } from "./model";
import { payloadHash, plan, requireDate, round, rubricMaximum, rubricScore, sessionStatus, todayInSchool } from "./engine";

type Row = Record<string, unknown>;
const uid = z.string().uuid();
const text = z.string().max(4000);
const attendanceSchema = z.object({ requestId: z.string().min(1).max(200), courseId: uid, date: z.string(), block: z.number().int().min(1).max(12), revision: z.number().int().min(0), lessonType: z.enum(["teoria", "practica", "ejercicios", "repaso", "correcciones", "actividad_escolar"]), topic: text.optional(), notes: text.optional(), rows: z.array(z.object({ studentId: uid, status: z.enum(["P", "A", "T", "E"]).nullable(), behavior: z.number().finite().min(0).max(10000).nullable().optional(), comment: text.optional() })).max(1000) });
const gradesSchema = z.object({ requestId: z.string().min(1).max(200), activityId: uid, revision: z.number().int().min(0), rows: z.array(z.object({ studentId: uid, score: z.number().finite().min(0).max(10000).nullable(), criterionLevels: z.record(z.string(), z.number().int().min(0).max(3)).nullable().optional(), comment: text.optional() })).max(1000) });
const activitySchema = z.object({ courseId: uid, category: z.enum(["exam", "participation", "notebook", "sequence", "homework"]), title: z.string().trim().min(1).max(250), date: z.string(), block: z.number().int().min(1).max(12).optional(), maxPoints: z.number().finite().positive().max(10000), scoringMode: z.enum(["points", "rubric"]).optional(), rubric: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().trim().min(1).max(200), levels: z.array(z.object({ label: z.string().trim().min(1).max(100), points: z.number().finite() })) })).optional(), description: text.optional(), requestId: z.string().min(1).max(200).optional() });
const planSchema = z.object({ period: z.string(), startDate: z.string(), endDate: z.string(), status: z.enum(["provisional", "confirmed"]), note: z.string().max(4000), categories: z.array(z.object({ key: z.enum(["exam", "participation", "notebook", "sequence", "homework"]), label: z.string().trim().min(1).max(200), weight: z.number().finite(), expectedRaw: z.number().finite().nullable(), dailyMax: z.number().finite().nullable(), targetSessions: z.number().int().nullable() })).length(5) });
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new AppError(400, "Datos inválidos: " + r.error.issues[0].message); return r.data; }
function num(value: unknown) { return value === null || value === undefined ? null : Number(value); }
function str(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function json<T>(value: unknown, fallback: T): T { return value === null || value === undefined ? fallback : typeof value === "string" ? JSON.parse(value) as T : value as T; }
function student(r: Row): Student { return { id: str(r.id), courseId: str(r.course_id), externalId: str(r.external_id), number: Number(r.number), name: str(r.name), active: Boolean(r.active) }; }
function activity(r: Row): Activity { return { id: str(r.id), courseId: str(r.course_id), period: str(r.period), category: r.category as Activity["category"], title: str(r.title), date: str(r.date), block: Number(r.block), maxPoints: Number(r.max_points), scoringMode: r.scoring_mode as Activity["scoringMode"], rubric: json(r.rubric, []), description: str(r.description), revision: Number(r.revision) }; }
const activityFields = "id,course_id,period,category,title,activity_date::text AS date,block,max_points,scoring_mode,rubric,description,revision";

export class RegistroService {
 constructor(private db: DBAdapter, private options: ServiceOptions = {}) {}
 private today() { return this.options.today?.() ?? todayInSchool(); }
 private validateOwner(ownerId: string) { if (typeof ownerId !== "string" || ownerId.length < 1 || ownerId.length > 200) throw new AppError(401, "La sesión de usuario no es válida."); }
 private async ensureOwner(ownerId: string) {
  this.validateOwner(ownerId);
  await this.db.transaction(async tx => {
   const created = await tx.query("INSERT INTO workspaces(owner_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING owner_id", [ownerId]);
   if (!created.rows.length) return;
   const initialPlan = plan();
   await tx.query("INSERT INTO evaluation_plans(owner_id,period,config,active) VALUES($1,$2,$3::jsonb,true)", [ownerId, initialPlan.period, JSON.stringify(initialPlan)]);
   for (const [code, size] of Object.entries(COURSE_SIZES)) {
    const id = randomUUID(); await tx.query("INSERT INTO courses(id,owner_id,code,name) VALUES($1,$2,$3,$4)", [id, ownerId, code, "5.º " + code.slice(1)]);
    if (this.options.demo) for (let n = 1; n <= size; n++) await tx.query("INSERT INTO students(id,owner_id,course_id,external_id,number,name) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), ownerId, id, `${code}-${String(n).padStart(2, "0")}`, n, `Estudiante ${code} ${String(n).padStart(2, "0")}`]);
   }
  });
 }
 private async currentPlan(ownerId: string, tx = this.db): Promise<EvaluationPlan> { const r = await tx.query("SELECT config FROM evaluation_plans WHERE owner_id=$1 AND active=true", [ownerId]); if (!r.rows.length) throw new AppError(409, "Falta el plan evaluativo activo."); return json(r.rows[0].config, plan()); }
 private async requireCourse(ownerId: string, courseId: string, tx = this.db) { parse(uid,courseId); const r = await tx.query("SELECT id,code,name FROM courses WHERE owner_id=$1 AND id=$2", [ownerId, courseId]); if (!r.rows.length) throw new AppError(404, "El curso no pertenece a este registro.", "NOT_FOUND"); return r.rows[0]; }
 private async roster(ownerId: string, courseId: string, tx = this.db) { return (await tx.query("SELECT id,course_id,external_id,number,name,active FROM students WHERE owner_id=$1 AND course_id=$2 ORDER BY number,id", [ownerId, courseId])).rows.map(student); }
 private validateStudents(rows: { studentId: string }[], roster: Student[]) { const valid = new Set(roster.map(x => x.id)), seen = new Set<string>(); for (const row of rows) { if (!valid.has(row.studentId)) throw new AppError(400, "Hay un estudiante que no pertenece a este curso.", "CROSS_COURSE"); if (seen.has(row.studentId)) throw new AppError(400, "Un estudiante aparece más de una vez en el lote."); seen.add(row.studentId); } }
 private async log(tx: DBAdapter, ownerId: string, operation: string, entityId: string, before: unknown, after: unknown) { await tx.query("INSERT INTO audit_entries(id,owner_id,operation,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)", [randomUUID(), ownerId, operation, entityId, JSON.stringify(before), JSON.stringify(after)]); }
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
  return { courses, activities: (await this.db.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND period=$2 ORDER BY activity_date,title`, [ownerId, current.period])).rows.map(activity), plan: current, today: this.today(), demo: Boolean(this.options.demo), ownerId };
 }
 private async attendanceView(ownerId: string, courseId: string, date: string, block: number, tx: DBAdapter): Promise<AttendanceView> {
  const sessions = await tx.query("SELECT id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3 AND block=$4", [ownerId, courseId, date, block]);
  const s = sessions.rows[0]; const roster = await this.roster(ownerId, courseId, tx);
  const saved = s ? (await tx.query("SELECT student_id,status,behavior,comment FROM attendance WHERE owner_id=$1 AND session_id=$2", [ownerId, s.id])).rows : [];
  const byId = new Map(saved.map(x => [str(x.student_id), x]));
  const rows: AttendanceRow[] = roster.filter(x => x.active || byId.has(x.id)).map(x => { const row = byId.get(x.id); return { studentId: x.id, number: x.number, name: x.name, status: row?.status as AttendanceRow["status"] ?? null, behavior: num(row?.behavior), comment: str(row?.comment) }; });
  return { session: { id: s ? str(s.id) : null, courseId, date, block, lessonType: s?.lesson_type as AttendanceView["session"]["lessonType"] ?? "teoria", topic: str(s?.topic), notes: str(s?.notes), revision: Number(s?.revision ?? 0), status: sessionStatus(date, rows.map(x => x.status), this.today()) }, rows };
 }
 async attendance(ownerId: string, courseId: string, date: string, block: number): Promise<AttendanceView> { await this.ensureOwner(ownerId); requireDate(date); if (!Number.isInteger(block) || block < 1 || block > 12) throw new AppError(400, "El bloque debe estar entre 1 y 12."); await this.requireCourse(ownerId, courseId); return this.attendanceView(ownerId, courseId, date, block, this.db); }
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
   for (const r of v.rows) await tx.query("INSERT INTO attendance(owner_id,course_id,session_id,student_id,status,behavior,behavior_max,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(session_id,student_id) DO UPDATE SET status=EXCLUDED.status,behavior=EXCLUDED.behavior,behavior_max=EXCLUDED.behavior_max,comment=EXCLUDED.comment,updated_at=now()", [ownerId, v.courseId, locked.id, r.studentId, r.status, r.behavior ?? null, behaviorMax, r.comment ?? ""]);
   const revision = v.revision + 1;
   await tx.query("UPDATE class_sessions SET lesson_type=$3,topic=$4,notes=$5,revision=$6,updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, locked.id, v.lessonType, v.topic ?? "", v.notes ?? "", revision]);
   const after = await this.attendanceView(ownerId, v.courseId, v.date, v.block, tx); await this.log(tx, ownerId, "attendance.saved", str(locked.id), before, after);
   return { requestId: v.requestId, operationId, savedRows: v.rows.length, revision, entityId: str(locked.id), replayed: false, savedAt: new Date().toISOString(), status: after.session.status };
  });
 }

 async createActivity(ownerId: string, input: ActivityInput): Promise<Activity> {
  const v = parse(activitySchema, input); requireDate(v.date); await this.ensureOwner(ownerId);
  const mode = v.scoringMode ?? "points", criteria = v.rubric ?? [];
  if (mode === "rubric") rubricMaximum(criteria); else if (criteria.length) throw new AppError(400, "Una actividad de puntos directos no utiliza criterios de rúbrica.");
  if (v.category === "participation") throw new AppError(400, "La participación y conducta diaria se registra junto a la asistencia, para conservar una sola fuente de datos.");
  const create = async (tx: DBAdapter) => {
   await this.requireCourse(ownerId, v.courseId, tx); const current = await this.currentPlan(ownerId, tx);
   if (v.date < current.startDate || v.date > current.endDate) throw new AppError(400, "La actividad no está dentro de las fechas del período activo. Configura el período correspondiente.");
   if (v.category === "notebook" && (await tx.query("SELECT id FROM activities WHERE owner_id=$1 AND course_id=$2 AND category='notebook' AND activity_date=$3 AND block=$4", [ownerId, v.courseId, v.date, v.block ?? 1])).rows.length) throw new AppError(409, "Ya existe una revisión diaria de libreta para esta fecha y bloque.");
   if (v.category === "notebook" && v.maxPoints !== (current.categories.find(c => c.key === "notebook")?.dailyMax ?? 2)) throw new AppError(400, "El máximo de la revisión diaria debe coincidir con su escala en el plan.");
   const id = randomUUID();
   await tx.query("INSERT INTO activities(id,owner_id,course_id,period,category,title,activity_date,block,max_points,scoring_mode,rubric,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)", [id, ownerId, v.courseId, current.period, v.category, v.title, v.date, v.block ?? 1, v.maxPoints, mode, JSON.stringify(criteria), v.description ?? ""]);
   const result = activity((await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2`, [ownerId, id])).rows[0]);
   await this.log(tx, ownerId, "activity.created", id, null, result); return result;
  };
  if (!v.requestId) return this.db.transaction(create);
  const receipt = await this.operation(ownerId, v.requestId, { operation: "activity.create", ...v }, async (tx, operationId) => { const a = await create(tx); return { requestId: v.requestId!, operationId, savedRows: 1, revision: a.revision, entityId: a.id, replayed: false, savedAt: new Date().toISOString() }; });
  return (await this.gradesView(ownerId, receipt.entityId, this.db)).activity;
 }
 private async gradesView(ownerId: string, activityId: string, tx: DBAdapter): Promise<GradesView> {
  parse(uid,activityId);
  const result = await tx.query(`SELECT ${activityFields} FROM activities WHERE owner_id=$1 AND id=$2`, [ownerId, activityId]); if (!result.rows.length) throw new AppError(404, "La actividad no pertenece a este registro.", "NOT_FOUND");
  const a = activity(result.rows[0]); const roster = await this.roster(ownerId, a.courseId, tx); const saved = (await tx.query("SELECT student_id,score,criterion_levels,comment FROM grades WHERE owner_id=$1 AND activity_id=$2", [ownerId, activityId])).rows; const byId = new Map(saved.map(r => [str(r.student_id), r]));
  const rows: GradeRow[] = roster.filter(x => x.active || byId.has(x.id)).map(x => { const r = byId.get(x.id); return { studentId: x.id, number: x.number, name: x.name, score: num(r?.score), criterionLevels: json(r?.criterion_levels, null), comment: str(r?.comment) }; });
  return { activity: a, rows };
 }
 async grades(ownerId: string, activityId: string): Promise<GradesView> { await this.ensureOwner(ownerId); return this.gradesView(ownerId, activityId, this.db); }
 async saveGrades(ownerId: string, input: GradesInput): Promise<SaveReceipt> {
  const v = parse(gradesSchema, input); await this.ensureOwner(ownerId);
  return this.operation(ownerId, v.requestId, { operation: "grades", ...v }, async (tx, operationId) => {
   const locked = await tx.query("SELECT id,revision FROM activities WHERE owner_id=$1 AND id=$2 FOR UPDATE", [ownerId, v.activityId]); if (!locked.rows.length) throw new AppError(404, "La actividad no pertenece a este registro.", "NOT_FOUND");
   if (Number(locked.rows[0].revision) !== v.revision) throw new AppError(409, "Las notas cambiaron desde otra pestaña. Recarga conservando tu borrador.", "REVISION_CONFLICT");
   const before = await this.gradesView(ownerId, v.activityId, tx), a = before.activity; this.validateStudents(v.rows, await this.roster(ownerId, a.courseId, tx));
   const normalized = v.rows.map(r => { let score = r.score; const levels = r.criterionLevels ?? null; if (a.scoringMode === "rubric") { if (levels) { if (Object.keys(levels).some(key => !a.rubric.some(c => c.id === key))) throw new AppError(400, "La selección contiene un criterio que no pertenece a la rúbrica."); score = Object.keys(levels).length === a.rubric.length ? round(rubricScore(a.rubric, levels) / rubricMaximum(a.rubric) * a.maxPoints) : null; } else if (score !== null) throw new AppError(400, "La rúbrica necesita un nivel seleccionado para cada criterio."); } else if (levels) throw new AppError(400, "La actividad utiliza puntos directos, no niveles."); if (score !== null && score > a.maxPoints) throw new AppError(400, `La nota no puede superar ${a.maxPoints}.`); return { ...r, score, levels }; });
   for (const r of normalized) await tx.query("INSERT INTO grades(owner_id,course_id,activity_id,student_id,score,criterion_levels,comment) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(activity_id,student_id) DO UPDATE SET score=EXCLUDED.score,criterion_levels=EXCLUDED.criterion_levels,comment=EXCLUDED.comment,updated_at=now()", [ownerId, a.courseId, a.id, r.studentId, r.score, JSON.stringify(r.levels), r.comment ?? ""]);
   const revision = v.revision + 1; await tx.query("UPDATE activities SET revision=$3,updated_at=now() WHERE owner_id=$1 AND id=$2", [ownerId, a.id, revision]);
   const after = await this.gradesView(ownerId, a.id, tx); await this.log(tx, ownerId, "grades.saved", a.id, before, after);
   return { requestId: v.requestId, operationId, savedRows: v.rows.length, revision, entityId: a.id, replayed: false, savedAt: new Date().toISOString() };
  });
 }

 async importRoster(ownerId: string, courseId: string, rows: RosterRow[]) {
  const v = parse(z.array(z.object({ externalId: z.string().trim().min(1).max(200), number: z.number().int().positive().max(10000), name: z.string().trim().min(1).max(250) })).min(1).max(1000), rows);
  if (new Set(v.map(x => x.externalId)).size !== v.length) throw new AppError(400, "El archivo repite identificadores externos dentro del mismo curso.");
  await this.ensureOwner(ownerId);
  return this.db.transaction(async tx => { await this.requireCourse(ownerId, courseId, tx); const before = await this.roster(ownerId, courseId, tx); for (const r of v) await tx.query("INSERT INTO students(id,owner_id,course_id,external_id,number,name) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,course_id,external_id) DO UPDATE SET number=EXCLUDED.number,name=EXCLUDED.name,active=true", [randomUUID(), ownerId, courseId, r.externalId, r.number, r.name]); const after = await this.roster(ownerId, courseId, tx); await this.log(tx, ownerId, "roster.imported", courseId, before, after); return after; });
 }
 async updatePlan(ownerId: string, input: EvaluationPlan): Promise<EvaluationPlan> {
  input = parse(planSchema,input);
  await this.ensureOwner(ownerId);
  if (!input || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(input.period) || !Array.isArray(input.categories) || input.categories.length !== 5 || new Set(input.categories.map(c => c.key)).size !== 5) throw new AppError(400, "El plan requiere un período y sus cinco categorías.");
  requireDate(input.startDate); requireDate(input.endDate); if (input.startDate > input.endDate) throw new AppError(400, "El período termina antes de empezar.");
  const keys = new Set(plan().categories.map(c => c.key)); let total = 0;
  for (const c of input.categories) { if (!keys.has(c.key) || !c.label?.trim() || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 100 || c.expectedRaw !== null && (!Number.isFinite(c.expectedRaw) || c.expectedRaw <= 0) || c.dailyMax !== null && (!Number.isFinite(c.dailyMax) || c.dailyMax <= 0 || c.dailyMax > 10000) || c.targetSessions !== null && (!Number.isInteger(c.targetSessions) || c.targetSessions < 1)) throw new AppError(400, "Revisa pesos, máximos y número de sesiones del plan."); total += c.weight; }
  if (round(total) !== 100) throw new AppError(400, "Los pesos del período deben sumar 100.");
  if (input.status !== "provisional" && input.status !== "confirmed") throw new AppError(400, "El estado del plan no es válido.");
  if (input.status === "confirmed" && input.categories.some(c => c.dailyMax !== null && (!c.targetSessions || c.targetSessions < 1))) throw new AppError(400, "Para confirmar el plan, define cuántas clases se esperan en libreta y participación/conducta.");
  if (input.status === "confirmed" && input.categories.some(c => c.dailyMax === null && c.expectedRaw === null)) throw new AppError(400, "Completa el máximo bruto previsto de cada categoría antes de confirmar el plan.");
  const clean: EvaluationPlan = { period: input.period, startDate: input.startDate, endDate: input.endDate, status: input.status, categories: input.categories.map(c => ({ ...c, label: c.label.trim() })), note: str(input.note).slice(0,4000) };
  return this.db.transaction(async tx => { await tx.query("SELECT owner_id FROM workspaces WHERE owner_id=$1 FOR UPDATE",[ownerId]); const before = await this.currentPlan(ownerId, tx); await tx.query("UPDATE evaluation_plans SET active=false WHERE owner_id=$1 AND active=true", [ownerId]); await tx.query("INSERT INTO evaluation_plans(owner_id,period,config,active) VALUES($1,$2,$3::jsonb,true) ON CONFLICT(owner_id,period) DO UPDATE SET config=EXCLUDED.config,active=true,revision=evaluation_plans.revision+1", [ownerId, clean.period, JSON.stringify(clean)]); await this.log(tx, ownerId, "plan.updated", clean.period, before, clean); return clean; });
 }

 async audit(ownerId: string): Promise<AuditEntry[]> { await this.ensureOwner(ownerId); return (await this.db.query("SELECT id,operation,entity_id,created_at::text AS created_at,before_data,after_data FROM audit_entries WHERE owner_id=$1 ORDER BY created_at DESC,id DESC LIMIT 200", [ownerId])).rows.map(r => ({ id: str(r.id), operation: str(r.operation), entityId: str(r.entity_id), createdAt: str(r.created_at), before: json(r.before_data, null), after: json(r.after_data, null) })); }
 async exportData(ownerId: string) { await this.ensureOwner(ownerId); return this.db.transaction(async tx => { const read = async (table: string, fields: string) => (await tx.query(`SELECT ${fields} FROM ${table} WHERE owner_id=$1`, [ownerId])).rows; return { format: "registro-docente/v1", exportedAt: new Date().toISOString(), ownerId, plans: await read("evaluation_plans", "period,config,active,revision"), courses: await read("courses", "id,code,name"), students: await read("students", "id,course_id,external_id,number,name,active"), sessions: await read("class_sessions", "id,course_id,session_date::text AS date,block,lesson_type,topic,notes,revision"), attendance: await read("attendance", "course_id,session_id,student_id,status,behavior,behavior_max,comment"), activities: await read("activities", activityFields), grades: await read("grades", "course_id,activity_id,student_id,score,criterion_levels,comment"), audit: await read("audit_entries", "id,operation,entity_id,created_at::text,before_data,after_data") }; }); }

 async report(ownerId: string, courseId: string, studentId: string): Promise<StudentReport> {
  await this.ensureOwner(ownerId); const c = await this.requireCourse(ownerId, courseId); const person = (await this.roster(ownerId, courseId)).find(s => s.id === studentId); if (!person) throw new AppError(404, "El estudiante no pertenece a este curso.", "NOT_FOUND"); const p = await this.currentPlan(ownerId);
  const sessions = (await this.db.query("SELECT s.id,s.session_date::text AS date,s.block,a.status,a.behavior,a.behavior_max,(SELECT count(*) FROM attendance marks WHERE marks.session_id=s.id AND marks.owner_id=s.owner_id AND marks.status IS NOT NULL) AS mark_count FROM class_sessions s LEFT JOIN attendance a ON a.session_id=s.id AND a.student_id=$3 AND a.owner_id=s.owner_id WHERE s.owner_id=$1 AND s.course_id=$2 AND s.session_date BETWEEN $4 AND $5 ORDER BY s.session_date,s.block", [ownerId, courseId, studentId, p.startDate, p.endDate])).rows;
  const taught = sessions.filter(s => str(s.date) <= this.today() && Number(s.mark_count) > 0);
  const stats = { present: 0, absent: 0, late: 0, excused: 0, pending: 0, sessions: taught.length, percent: null as number | null };
  for (const s of taught) { if (s.status === "P") stats.present++; else if (s.status === "A") stats.absent++; else if (s.status === "T") stats.late++; else if (s.status === "E") stats.excused++; else stats.pending++; }
  const denominator = stats.present + stats.absent + stats.late; stats.percent = denominator ? round((stats.present + stats.late) / denominator * 100) : null;
  const gradeRecords = (await this.db.query(`SELECT a.id AS activity_id,a.title,a.activity_date::text AS date,a.block,a.category,a.max_points,g.score,g.criterion_levels,g.comment FROM activities a LEFT JOIN grades g ON g.activity_id=a.id AND g.student_id=$3 AND g.owner_id=a.owner_id WHERE a.owner_id=$1 AND a.course_id=$2 AND a.period=$4 ORDER BY a.activity_date,a.title`, [ownerId, courseId, studentId, p.period])).rows;
  const sessionKeys = new Set(taught.map(s => `${str(s.date)}:${Number(s.block)}`));
  const grades: StudentReport["grades"] = gradeRecords.map(r => ({ studentId, number: person.number, name: person.name, score: num(r.score), criterionLevels: json(r.criterion_levels, null), comment: str(r.comment), activityId: str(r.activity_id), title: str(r.title), date: str(r.date), category: r.category as Activity["category"], maxPoints: Number(r.max_points), included: r.category !== "notebook" || sessionKeys.has(`${str(r.date)}:${Number(r.block)}`) }));
  const categories: CategoryReport[] = p.categories.map(cat => {
   if (cat.key === "participation" || cat.key === "notebook") {
    const max = cat.dailyMax ?? (cat.key === "participation" ? 10 : 2);
    const scores = cat.key === "participation" ? taught.map(s => num(s.behavior)) : taught.map(s => grades.find(g => g.category === "notebook" && g.date === str(s.date) && Number(gradeRecords.find(r => r.activity_id === g.activityId)?.block) === Number(s.block))?.score ?? null);
    const maxima = taught.map(row => cat.key === "participation" ? num(row.behavior_max) ?? max : max);
    const rawEarned = round(scores.reduce<number>((sum, v) => sum + (v ?? 0), 0)), rawPossible = round(maxima.reduce((sum,n) => sum+n,0)), target = cat.targetSessions ? round(taught.length > cat.targetSessions ? cat.targetSessions*max : rawPossible + (cat.targetSessions-taught.length)*max) : null;
    const observedDenominator = round(maxima.reduce((sum,m,i) => sum+(scores[i] === null ? 0 : m),0));
    return { key: cat.key, label: cat.label, weight: cat.weight, rawEarned, rawPossible, expectedRaw: target, graded: scores.filter(x => x !== null).length, pending: cat.targetSessions ? Math.max(cat.targetSessions - scores.filter(x => x !== null).length, 0) : scores.filter(x => x === null).length, denominator: target, points: observedDenominator && target && rawPossible <= target ? round(rawEarned / target * cat.weight) : null, observedDenominator, observedPercent: observedDenominator ? round(rawEarned / observedDenominator * 100) : null, planIncomplete: !target || taught.length !== cat.targetSessions, provisional: p.status !== "confirmed" || !target || taught.length !== cat.targetSessions || scores.some(x => x === null) };
   }
   const relevant = grades.filter(g => g.category === cat.key), rawEarned = round(relevant.reduce((sum, g) => sum + (g.score ?? 0), 0)), rawPossible = round(relevant.reduce((sum, g) => sum + g.maxPoints, 0)), target = cat.expectedRaw;
   const observedDenominator = round(relevant.reduce((sum,g) => sum+(g.score === null ? 0 : g.maxPoints),0));
   return { key: cat.key, label: cat.label, weight: cat.weight, rawEarned, rawPossible, expectedRaw: target, graded: relevant.filter(g => g.score !== null).length, pending: relevant.filter(g => g.score === null).length, denominator: target, points: observedDenominator && target && rawPossible <= target ? round(rawEarned / target * cat.weight) : null, observedDenominator, observedPercent: observedDenominator ? round(rawEarned / observedDenominator * 100) : null, planIncomplete: rawPossible !== target, provisional: p.status !== "confirmed" || relevant.some(g => g.score === null) || rawPossible !== target };
  });
  const known = categories.filter(c => c.points !== null); const complete = p.status === "confirmed" && categories.every(c => !c.provisional && c.points !== null && c.pending === 0);
  return { student: person, course: { id: str(c.id), code: str(c.code), name: str(c.name) }, plan: p, attendance: stats, categories, total: complete ? round(categories.reduce((sum, c) => sum + (c.points ?? 0), 0)) : null, provisionalTotal: known.length ? round(known.reduce((sum, c) => sum + (c.points ?? 0), 0)) : null, grades, timeline: sessions.map(s => ({ date: str(s.date), block: Number(s.block), status: s.status as AttendanceRow["status"] ?? null, behavior: num(s.behavior), sessionStatus: str(s.date) > this.today() ? "programada" : Number(s.mark_count) ? "impartida" : "no_impartida" })), notices: ["Solo las sesiones con marcas de asistencia cuentan como impartidas. Guardar notas no cambia esa condición.", "El porcentaje de asistencia excluye excusas y marcas pendientes; estas se muestran por separado.", "La nota final permanece pendiente mientras falten actividades, calificaciones o confirmación del plan y sus sesiones.", ...(grades.some(g => !g.included && g.score !== null) ? ["Hay notas de libreta conservadas en fechas sin clase impartida; no se incluyen en el cálculo diario."] : [])] };
 }
}
