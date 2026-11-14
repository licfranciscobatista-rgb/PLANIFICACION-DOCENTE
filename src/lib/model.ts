export const PERIOD_START = "2026-10-20";
export const PERIOD_END = "2027-01-20";
export const COURSE_SIZES = { "5A": 21, "5B": 19, "5C": 21 } as const;
export const CATEGORY_KEYS = ["exam", "participation", "notebook", "sequence", "homework"] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];
export type AttendanceMark = "P" | "A" | "T" | "E" | null;
export type LessonType = "teoria" | "practica" | "ejercicios" | "repaso" | "correcciones" | "actividad_escolar";
export type SessionStatus = "programada" | "no_impartida" | "impartida";
export interface Student { id: string; courseId: string; externalId: string; number: number; name: string; active: boolean }
export interface Course { id: string; code: string; name: string; students: Student[] }
export interface Category { key: CategoryKey; label: string; weight: number; expectedRaw: number | null; dailyMax: number | null; targetSessions: number | null }
export interface EvaluationPlan { period: string; startDate: string; endDate: string; status: "provisional" | "confirmed"; categories: Category[]; note: string }
export interface AttendanceRow { studentId: string; number: number; name: string; status: AttendanceMark; behavior: number | null; comment: string }
export interface ClassSession { id: string | null; courseId: string; date: string; block: number; lessonType: LessonType; topic: string; notes: string; revision: number; status: SessionStatus }
export interface AttendanceView { session: ClassSession; rows: AttendanceRow[] }
export interface AttendanceInput { requestId: string; courseId: string; date: string; block: number; revision: number; lessonType: LessonType; topic?: string; notes?: string; rows: { studentId: string; status: AttendanceMark; behavior?: number | null; comment?: string }[] }
export interface RubricLevel { label: string; points: number }
export interface RubricCriterion { id: string; label: string; levels: RubricLevel[] }
export interface Activity { id: string; courseId: string; period: string; category: CategoryKey; title: string; date: string; block: number; maxPoints: number; scoringMode: "points" | "rubric"; rubric: RubricCriterion[]; description: string; revision: number }
export interface ActivityInput { courseId: string; category: CategoryKey; title: string; date: string; block?: number; maxPoints: number; scoringMode?: "points" | "rubric"; rubric?: RubricCriterion[]; description?: string; requestId?: string }
export interface GradeRow { studentId: string; number: number; name: string; score: number | null; criterionLevels: Record<string, number> | null; comment: string }
export interface GradesView { activity: Activity; rows: GradeRow[] }
export interface GradesInput { requestId: string; activityId: string; revision: number; rows: { studentId: string; score: number | null; criterionLevels?: Record<string, number> | null; comment?: string }[] }
export interface SaveReceipt { requestId: string; operationId: string; savedRows: number; revision: number; entityId: string; replayed: boolean; savedAt: string; status?: SessionStatus }
export interface RosterRow { externalId: string; number: number; name: string }
export interface AuditEntry { id: string; operation: string; entityId: string; createdAt: string; before: unknown; after: unknown }
export interface Bootstrap { courses: Course[]; activities: Activity[]; plan: EvaluationPlan; today: string; demo: boolean; ownerId: string }
export interface CategoryReport { key: CategoryKey; label: string; weight: number; rawEarned: number; rawPossible: number; expectedRaw: number | null; graded: number; pending: number; denominator: number | null; points: number | null; observedDenominator: number; observedPercent: number | null; planIncomplete: boolean; provisional: boolean }
export interface StudentReport { student: Student; course: { id: string; code: string; name: string }; plan: EvaluationPlan; attendance: { present: number; absent: number; late: number; excused: number; pending: number; sessions: number; percent: number | null }; categories: CategoryReport[]; total: number | null; provisionalTotal: number | null; grades: (GradeRow & { activityId: string; title: string; date: string; category: CategoryKey; maxPoints: number; included: boolean })[]; timeline: { date: string; block: number; status: AttendanceMark; behavior: number | null; sessionStatus: SessionStatus }[]; notices: string[] }
export interface ServiceOptions { demo?: boolean; today?: () => string }
export class AppError extends Error { constructor(public status: number, message: string, public code = "VALIDATION") { super(message); this.name = "AppError"; } }
