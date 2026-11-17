export const PERIOD_START = "2026-10-20";
export const PERIOD_END = "2027-01-20";
export const COURSE_SIZES = { "5A": 21, "5B": 19, "5C": 21 } as const;
export const CATEGORY_KEYS = ["exam", "participation", "notebook", "sequence", "homework"] as const;
export type CategoryKey = typeof CATEGORY_KEYS[number];
export type ActivityCategoryKey = CategoryKey | "extra";
export const COMPETENCY_GROUPS = [
 { key: "comunicativa", label: "Competencia comunicativa" },
 { key: "logico_matematica", label: "Competencia lógico-matemática" },
 { key: "resolucion", label: "Resolución de problemas" },
 { key: "etica_ciudadana", label: "Ética y ciudadanía" },
 { key: "cientifica_tecnologica", label: "Científica y tecnológica" },
 { key: "ambiental_salud", label: "Ambiental y de la salud" },
 { key: "desarrollo_personal", label: "Desarrollo personal y espiritual" },
] as const;
export type CompetencyKey = typeof COMPETENCY_GROUPS[number]["key"];
export type AttendanceMark = "P" | "A" | "T" | "E" | "R" | null;
export type LessonType = "teoria" | "practica" | "ejercicios" | "repaso" | "correcciones" | "actividad_escolar";
export type EvaluationPurpose = "diagnostica" | "formativa" | "sumativa" | "formativa_sumativa";
export type SessionStatus = "programada" | "no_impartida" | "impartida" | "no_programada";
export interface Student { id: string; courseId: string; externalId: string; number: number; name: string; active: boolean }
export interface Course { id: string; code: string; name: string; students: Student[] }
export interface Category { key: CategoryKey; label: string; group?: string; weight: number; expectedRaw: number | null; dailyMax: number | null; targetSessions: number | null; competency: CompetencyKey | null }
export interface SequenceIndicator { id: string; code: string; label: string; competency: CompetencyKey | null }
export interface SourceAssessmentInstrument { annexNumber: number; title: string; kind: "checklist" | "rubric" | "scale" | "exam_guide"; criteria: string[]; levels: RubricLevel[]; maxPoints: number | null; scoringNote: string; scored: boolean; relatedIndicatorText?: string; relatedCompetencyText?: string }
export interface SequenceFinalAssessment { title: string; period: string; internalMaxPoints: number | null; periodPoints: number | null; instrument: SourceAssessmentInstrument }
export interface SequenceActivity { id: string; code: string; theme: string; title: string; lessonType: LessonType | null; description: string; evidence: string; indicatorIds: string[]; period?: string; evaluationPurpose?: EvaluationPurpose | null; plannedPoints?: number | null; plannedPercent?: number | null; instrument?: string; evaluationCriteria?: string[]; feedback?: string; assessmentInstrument?: SourceAssessmentInstrument }
export interface SequencePeriodAssignment { activityId: string; period: "P1" | "P2" | "P3" | "P4" }
export interface SequencePlan { source: "manual" | "uploaded"; sourceName: string; sourceText: string; reviewed: boolean; planningMode?: "sequence" | "manual"; activePlanningPeriod?: "P1" | "P2" | "P3" | "P4" | null; periodAssignments?: SequencePeriodAssignment[]; activities: SequenceActivity[]; indicators: SequenceIndicator[]; finalAssessment?: SequenceFinalAssessment }
export interface EvaluationPlan { period: string; startDate: string; endDate: string; status: "provisional" | "confirmed"; categories: Category[]; note: string; sequence?: SequencePlan }
export interface AttendanceRow { studentId: string; number: number; name: string; status: AttendanceMark; behavior: number | null; comment: string }
export interface ClassSession { id: string | null; courseId: string; date: string; block: number; lessonType: LessonType; topic: string; notes: string; revision: number; scheduled: boolean; calendarThrough: string; status: SessionStatus }
export interface AttendanceView { session: ClassSession; rows: AttendanceRow[] }
export interface CourseRegisterSummary {
 course: Pick<Course,"id"|"code"|"name">;
 calendarThrough: string;
 totals: { sessions: number; taught: number; notTaught: number; scheduled: number; notScheduled: number };
 sessions: { date: string; block: number; lessonType: LessonType; topic: string; status: SessionStatus; scheduled: boolean; present: number; absent: number; late: number; excused: number; marked: number; behaviorRecorded: number }[];
 months: { key: string; label: string; startDate: string; endDate: string; taught: number; notTaught: number; slots: { date: string; block: number }[]; rows: { student: Student; marks: AttendanceMark[]; present: number; absent: number; late: number; excused: number; withdrawn: number; pending: number; attended: number; totalAttendance: number; absenceEquivalent: number; attendancePercent: number | null }[] }[];
 weeks: { startDate: string; endDate: string; taught: number; notTaught: number; slots: { date: string; block: number }[]; rows: { student: Student; marks: AttendanceMark[]; present: number; absent: number; late: number; excused: number; withdrawn: number; pending: number; attended: number; totalAttendance: number; attendancePercent: number | null }[] }[];
 rows: { student: Student; present: number; absent: number; late: number; excused: number; withdrawn: number; pending: number; sessions: number; attendancePercent: number | null; behaviorAverage: number | null; behaviorPercent: number | null; behaviorCount: number; behaviorComments: number }[];
}
export interface AttendanceInput { requestId: string; courseId: string; date: string; block: number; revision: number; lessonType: LessonType; topic?: string; notes?: string; rows: { studentId: string; status: AttendanceMark; behavior?: number | null; comment?: string }[] }
export interface RubricLevel { label: string; points: number; description?: string }
export interface RubricCriterion { id: string; label: string; levels: RubricLevel[]; competency?: CompetencyKey | null; indicator?: string; indicatorId?: string; weight?: number }
export interface ActivityIndicatorPoint { indicatorId: string; code: string; label: string; competency: CompetencyKey; points: number }
export interface IndicatorUsageRecord { indicatorId: string; code: string; label: string; competency: CompetencyKey; assignmentId: string; activityId: string; courseId: string; courseCode: string; period: string; title: string; maxPoints: number; points: number; studentsWithData: number; gradedStudents: number; studentsInCourse: number }
export interface EvaluationCriterion { id: string; label: string; levels: RubricLevel[]; active: boolean }
export interface Activity { id: string; courseId: string; sharedId: string | null; period: string; category: ActivityCategoryKey; title: string; date: string; createdAt: string | null; block: number; maxPoints: number; scoringMode: "points" | "rubric"; rubric: RubricCriterion[]; indicatorPoints: ActivityIndicatorPoint[]; description: string; sequenceCode: string; sequenceActivityId?: string | null; sequencePlannedPeriod?: string | null; evidence: string; instrument: string; purpose: string; competency: CompetencyKey | null; indicator: string; revision: number }
export interface ActivityInput { courseId: string; category: ActivityCategoryKey; title: string; date: string; block?: number; maxPoints: number; scoringMode?: "points" | "rubric"; rubric?: RubricCriterion[]; description?: string; sequenceCode?: string; sequenceActivityId?: string; evidence?: string; instrument?: string; purpose?: string; competency?: CompetencyKey | null; indicator?: string; requestId?: string }
export interface SharedActivityInput { courseIds: string[]; activity: Omit<ActivityInput,"courseId"> }
export interface GradeRow { studentId: string; number: number; name: string; score: number | null; criterionLevels: Record<string, number> | null; comment: string }
export interface GradesView { activity: Activity; rows: GradeRow[] }
export interface GradesInput { requestId: string; activityId: string; revision: number; rows: { studentId: string; score: number | null; criterionLevels?: Record<string, number> | null; comment?: string }[] }
export interface SaveReceipt { requestId: string; operationId: string; savedRows: number; revision: number; entityId: string; replayed: boolean; savedAt: string; status?: SessionStatus }
export interface RosterRow { externalId: string; number: number; name: string }
export interface AuditEntry { id: string; operation: string; entityId: string; createdAt: string; before: unknown; after: unknown }
export interface Bootstrap { courses: Course[]; activities: Activity[]; plan: EvaluationPlan; plans: EvaluationPlan[]; curriculumSequence: SequencePlan | null; criteriaCatalog: EvaluationCriterion[]; today: string; demo: boolean; demoNote?: string; ownerId: string }
export interface CategoryReport { key: CategoryKey; label: string; group?: string; weight: number; rawEarned: number; rawPossible: number; expectedRaw: number | null; graded: number; pending: number; denominator: number | null; points: number | null; observedDenominator: number; observedPercent: number | null; planIncomplete: boolean; provisional: boolean }
export interface CompetencyScore { key: CompetencyKey; label: string; points: number; possible: number; percentage: number | null; graded: number; pending: number }
export interface CourseCompetencySummary { course: { id: string; code: string; name: string }; period: string; groups: { key: CompetencyKey; label: string }[]; rows: { student: Student; competencies: CompetencyScore[]; points: number; possible: number }[]; note: string }
export interface TeacherLedgerColumn {
 key: string;
 label: string;
 category: ActivityCategoryKey | "behavior";
 categoryLabel: string;
 competency: CompetencyKey;
 kind: "activity" | "criterion" | "behavior";
 date: string | null;
 maxPoints: number;
 courseIds: string[];
}
export interface TeacherLedgerScore {
 key: string;
 points: number | null;
 possible: number;
 state: "graded" | "pending" | "excluded" | "not_applicable";
 pending: number;
 comment?: string;
}
export interface TeacherLedgerSummary {
 period: string;
 availablePeriods: string[];
 categories: Pick<CategoryReport,"key"|"label"|"group"|"weight"|"expectedRaw">[];
 groups: { key: CompetencyKey; label: string; columns: TeacherLedgerColumn[] }[];
 rows: { course: Pick<Course,"id"|"code"|"name">; student: Student; categories: CategoryReport[]; scores: TeacherLedgerScore[]; rawTotal: number; rawPossible: number; bonusPoints: number; bonusPossible: number; weightedTotal: number | null; finalized: boolean; observations: string[] }[];
 note: string;
}
export interface StudentReport { student: Student; course: { id: string; code: string; name: string }; plan: EvaluationPlan; attendance: { present: number; absent: number; late: number; excused: number; pending: number; sessions: number; percent: number | null }; categories: CategoryReport[]; competencies: CompetencyScore[]; bonusPoints: number; bonusPossible: number; total: number | null; provisionalTotal: number | null; grades: (GradeRow & { activityId: string; title: string; date: string; category: ActivityCategoryKey; maxPoints: number; included: boolean; rubric: RubricCriterion[]; indicatorPoints: ActivityIndicatorPoint[]; scoringMode: 'points'|'rubric'; competency: CompetencyKey | null; sequenceCode: string; sequenceActivityId?: string | null; sequencePlannedPeriod?: string | null; evidence: string; instrument: string; purpose: string })[]; timeline: { date: string; block: number; status: AttendanceMark; behavior: number | null; comment: string; sessionStatus: SessionStatus }[]; notices: string[] }
export interface ServiceOptions { demo?: boolean; seedDemoRoster?: boolean; today?: () => string; demoNote?: string }
export class AppError extends Error { constructor(public status: number, message: string, public code = "VALIDATION") { super(message); this.name = "AppError"; } }
