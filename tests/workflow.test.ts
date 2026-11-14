import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTestDatabase } from '../src/lib/db';
import { RegistroService } from '../src/lib/service';
import { AppError, type AttendanceInput, type Course, type RubricCriterion } from '../src/lib/model';
import { closeTo, expectedRecord, expectedStudent, teachingDates } from './oracle';

const root = path.resolve('.local');
const directory = path.join(root, `qa-${randomUUID()}`);
const databasePath = path.join(directory, 'postgres');
const owner = 'workflow-qa-teacher';
const today = () => '2026-12-01';
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let service: RegistroService;
let courses: Course[];
let verifiedAttendance = 0;
let verifiedGrades = 0;
let verifiedBehavior = 0;
const dates = teachingDates(30);

before(async () => {
  await mkdir(directory, { recursive: true });
  db = await createTestDatabase(databasePath);
  service = new RegistroService(db, { demo: true, today });
  courses = (await service.bootstrap(owner)).courses;
});

after(async () => {
  await db?.close();
  // This test only deletes the freshly generated QA directory within .local.
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(root + path.sep));
  assert.ok(path.basename(resolved).startsWith('qa-'));
  await rm(resolved, { recursive: true, force: true });
});

async function caseContext(label: string) {
  const actor = `qa-${label}`;
  const bootstrap = await service.bootstrap(actor);
  return { actor, courses: bootstrap.courses, course: bootstrap.courses[0] };
}

function attendanceInput(course: Course, overrides: Partial<AttendanceInput> = {}): AttendanceInput {
  return {
    requestId: randomUUID(), courseId: course.id, date: '2026-10-20', block: 1,
    revision: 0, lessonType: 'teoria', topic: 'Tema sintético',
    rows: course.students.map(student => ({ studentId: student.id, status: 'P', behavior: 7, comment: '' })),
    ...overrides,
  };
}

function isError(status: number | number[]) {
  const accepted = Array.isArray(status) ? status : [status];
  return (error: unknown) => error instanceof AppError && accepted.includes(error.status);
}

test('30 días por cada curso: destino y lectura de 1.830 asistencias, conductas y libretas', async () => {
  assert.deepEqual(courses.map(c => [c.code, c.students.length]).sort(), [['5A', 21], ['5B', 19], ['5C', 21]]);
  assert.equal(dates[0], '2026-10-20');
  for (const course of courses) {
    for (const [day, date] of dates.entries()) {
      const input = attendanceInput(course, {
        date,
        lessonType: ['teoria', 'practica', 'ejercicios', 'repaso', 'correcciones'][day % 5] as AttendanceInput['lessonType'],
        topic: `Tema QA ${course.code} ${day + 1}`,
        rows: course.students.map((student, index) => {
          const expected = expectedRecord(day, index);
          return { studentId: student.id, status: expected.status, behavior: expected.behavior, comment: expected.comment };
        }),
      });
      const receipt = await service.saveAttendance(owner, input);
      assert.equal(receipt.savedRows, course.students.length);
      assert.equal(receipt.status, 'impartida');
      const stored = await service.attendance(owner, course.id, date, 1);
      assert.equal(stored.session.courseId, course.id);
      assert.equal(stored.session.date, date);
      assert.equal(stored.session.status, 'impartida');
      for (const [index, student] of course.students.entries()) {
        const actual = stored.rows.find(row => row.studentId === student.id);
        const expected = expectedRecord(day, index);
        assert.ok(actual, `Falta ${student.id} de ${course.code} en ${date}`);
        assert.equal(actual.status, expected.status);
        assert.equal(actual.behavior, expected.behavior);
        assert.equal(actual.comment, expected.comment);
        verifiedAttendance += 1;
        verifiedBehavior += 1;
      }
      const activity = await service.createActivity(owner, {
        requestId: randomUUID(), courseId: course.id, category: 'notebook',
        title: `Libreta QA ${course.code} ${date}`, date, maxPoints: 2,
      });
      const grades = await service.saveGrades(owner, {
        requestId: randomUUID(), activityId: activity.id, revision: 0,
        rows: course.students.map((student, index) => ({ studentId: student.id, score: expectedRecord(day, index).notebook })),
      });
      assert.equal(grades.savedRows, course.students.length);
      const storedGrades = await service.grades(owner, activity.id);
      assert.equal(storedGrades.activity.courseId, course.id);
      assert.equal(storedGrades.activity.date, date);
      for (const [index, student] of course.students.entries()) {
        const actual = storedGrades.rows.find(row => row.studentId === student.id);
        assert.ok(actual);
        assert.equal(actual.score, expectedRecord(day, index).notebook);
        verifiedGrades += 1;
      }
    }
  }
  assert.equal(verifiedAttendance, 1830);
  assert.equal(verifiedBehavior, 1830);
  assert.equal(verifiedGrades, 1830);
});

test('el informe de cada uno de los 61 estudiantes coincide con un cálculo independiente', async () => {
  for (const course of courses) {
    for (const [index, student] of course.students.entries()) {
      const actual = await service.report(owner, course.id, student.id);
      const expected = expectedStudent(index);
      assert.equal(actual.course.id, course.id);
      assert.equal(actual.student.id, student.id);
      assert.deepEqual({ P: actual.attendance.present, A: actual.attendance.absent, T: actual.attendance.late, E: actual.attendance.excused }, expected.counts);
      assert.equal(actual.attendance.sessions, 30);
      const notebook = actual.categories.find(c => c.key === 'notebook')!;
      const behavior = actual.categories.find(c => c.key === 'participation')!;
      assert.equal(notebook.rawEarned, expected.notebookRaw);
      assert.equal(notebook.rawPossible, 60);
      assert.equal(notebook.pending, 0);
      assert.ok(closeTo(notebook.observedPercent!, expected.notebookRaw / 60 * 100));
      assert.equal(behavior.rawEarned, expected.behaviorRaw);
      assert.equal(behavior.rawPossible, 300);
      assert.ok(closeTo(behavior.observedPercent!, expected.behaviorRaw / 300 * 100));
      assert.equal(actual.total, null, 'No se debe publicar una nota final con el plan provisional.');
    }
  }
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/long-run-volume.json', JSON.stringify({
    source: 'synthetic', courses: 3, students: 61, datesPerCourse: 30, sessions: 90,
    attendanceRowsReadBack: verifiedAttendance, behaviorRowsReadBack: verifiedBehavior,
    notebookGradesReadBack: verifiedGrades, studentReportsCompared: 61,
    startDate: dates[0], endDate: dates.at(-1),
  }, null, 2));
});

test('los registros sobreviven al cierre y reapertura de la base local', async () => {
  const first = await service.attendance(owner, courses[0].id, dates[0], 1);
  const last = await service.attendance(owner, courses[2].id, dates[29], 1);
  const report = await service.report(owner, courses[0].id, courses[0].students[0].id);
  await db.close();
  db = await createTestDatabase(databasePath);
  service = new RegistroService(db, { demo: true, today });
  assert.deepEqual(await service.attendance(owner, courses[0].id, dates[0], 1), first);
  assert.deepEqual(await service.attendance(owner, courses[2].id, dates[29], 1), last);
  assert.deepEqual(await service.report(owner, courses[0].id, courses[0].students[0].id), report);
});

test('cero es una nota real, vacío sigue pendiente y calificar no confirma una clase', async () => {
  const { actor, course } = await caseContext('zero-null');
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Examen fuera de clase', date: '2026-10-21', maxPoints: 15 });
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [
    { studentId: course.students[0].id, score: 0 }, { studentId: course.students[1].id, score: null },
  ] });
  const stored = await service.grades(actor, activity.id);
  assert.equal(stored.rows.find(r => r.studentId === course.students[0].id)?.score, 0);
  assert.equal(stored.rows.find(r => r.studentId === course.students[1].id)?.score, null);
  assert.equal((await service.attendance(actor, course.id, '2026-10-21', 1)).session.status, 'no_impartida');
  const zeroReport = await service.report(actor, course.id, course.students[0].id);
  const emptyReport = await service.report(actor, course.id, course.students[1].id);
  assert.equal(zeroReport.categories.find(c => c.key === 'exam')?.graded, 1);
  assert.equal(emptyReport.categories.find(c => c.key === 'exam')?.graded, 0);
  assert.ok((emptyReport.categories.find(c => c.key === 'exam')?.pending ?? 0) >= 1);
});

test('todos ausentes sí es una clase impartida; fecha futura permanece programada', async () => {
  const { actor, course } = await caseContext('class-state');
  const input = attendanceInput(course, { rows: course.students.map(s => ({ studentId: s.id, status: 'A', behavior: null })) });
  await service.saveAttendance(actor, input);
  assert.equal((await service.attendance(actor, course.id, input.date, 1)).session.status, 'impartida');
  assert.equal((await service.attendance(actor, course.id, '2026-10-21', 1)).session.status, 'no_impartida');
  assert.equal((await service.attendance(actor, course.id, '2027-01-05', 1)).session.status, 'programada');
  await assert.rejects(service.saveAttendance(actor, attendanceInput(course, { date: '2027-01-05' })), isError(400));
  assert.equal((await service.attendance(actor, course.id, '2027-01-05', 1)).session.status, 'programada');
});

test('una libreta fuera de clase se conserva y entra al cálculo solo al registrar la asistencia', async () => {
  const { actor, course } = await caseContext('notebook-outside-class');
  const date = '2026-10-21';
  const studentId = course.students[0].id;
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'notebook', title: 'Libreta corregida después', date, maxPoints: 2 });
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId, score: 2 }] });
  const before = await service.report(actor, course.id, studentId);
  assert.equal(before.categories.find(c => c.key === 'notebook')?.rawEarned, 0);
  assert.equal(before.categories.find(c => c.key === 'notebook')?.rawPossible, 0);
  assert.equal(before.grades.find(g => g.activityId === activity.id)?.included, false);
  await service.saveAttendance(actor, attendanceInput(course, { date }));
  const after = await service.report(actor, course.id, studentId);
  assert.equal(after.categories.find(c => c.key === 'notebook')?.rawEarned, 2);
  assert.equal(after.categories.find(c => c.key === 'notebook')?.rawPossible, 2);
  assert.equal(after.grades.find(g => g.activityId === activity.id)?.included, true);
});

test('conducta diaria 3 de 10 produce un 30% observado y conserva la escala explícita', async () => {
  const { actor, course } = await caseContext('behavior-percentage');
  const input = attendanceInput(course, { rows: course.students.map(s => ({ studentId: s.id, status: 'P', behavior: 3 })) });
  await service.saveAttendance(actor, input);
  const report = await service.report(actor, course.id, course.students[0].id);
  const category = report.categories.find(c => c.key === 'participation')!;
  assert.equal(category.rawEarned, 3);
  assert.equal(category.rawPossible, 10);
  assert.equal(category.observedPercent, 30);
  assert.equal(category.weight, 15);
});

test('se rechazan matrículas ajenas y no se guarda parcialmente un lote inválido', async () => {
  const { actor, courses: ownCourses, course } = await caseContext('atomic');
  const original = attendanceInput(course);
  await service.saveAttendance(actor, original);
  const before = await service.attendance(actor, course.id, original.date, 1);
  const invalid = attendanceInput(course, { revision: before.session.revision, rows: [
    { studentId: course.students[0].id, status: 'A', behavior: 0 },
    { studentId: ownCourses[1].students[0].id, status: 'P', behavior: 9 },
  ] });
  await assert.rejects(service.saveAttendance(actor, invalid), isError([400, 403, 404]));
  assert.deepEqual(await service.attendance(actor, course.id, original.date, 1), before);
  const invalidRange = attendanceInput(course, { revision: before.session.revision, rows: [
    { studentId: course.students[0].id, status: 'A', behavior: 0 },
    { studentId: course.students[1].id, status: 'P', behavior: 11 },
  ] });
  await assert.rejects(service.saveAttendance(actor, invalidRange), isError(400));
  assert.deepEqual(await service.attendance(actor, course.id, original.date, 1), before);
  await assert.rejects(service.attendance('not-the-owner', course.id, original.date, 1), isError([403, 404]));
});

test('PostgreSQL impide por sí mismo mezclar un estudiante con una sesión de otro curso', async () => {
  const { actor, courses: ownCourses, course } = await caseContext('database-relations');
  const input = attendanceInput(course);
  await service.saveAttendance(actor, input);
  const stored = await service.attendance(actor, course.id, input.date, 1);
  const foreignStudent = ownCourses[1].students[0];
  await assert.rejects(db.query(
    'INSERT INTO attendance(owner_id,course_id,session_id,student_id,status,behavior) VALUES($1,$2,$3,$4,$5,$6)',
    [actor, course.id, stored.session.id, foreignStudent.id, 'P', 7],
  ), (error: unknown) => (error as { code?: string }).code === '23503');
  await assert.rejects(db.query(
    'INSERT INTO class_sessions(id,owner_id,course_id,session_date,block) VALUES($1,$2,$3,$4,$5)',
    [randomUUID(), actor, course.id, input.date, 1],
  ), (error: unknown) => (error as { code?: string }).code === '23505');
  const after = await service.attendance(actor, course.id, input.date, 1);
  assert.deepEqual(after, stored);
});

test('el doble guardado es idempotente y una versión vieja no sobrescribe cambios nuevos', async () => {
  const { actor, course } = await caseContext('retries');
  const input = attendanceInput(course);
  const first = await service.saveAttendance(actor, input);
  const auditCount = (await service.audit(actor)).length;
  const repeated = await service.saveAttendance(actor, input);
  assert.equal(repeated.operationId, first.operationId);
  assert.equal(repeated.entityId, first.entityId);
  assert.equal(repeated.replayed, true);
  assert.equal((await service.audit(actor)).length, auditCount);
  await assert.rejects(service.saveAttendance(actor, { ...input, topic: 'Otro contenido' }), isError(409));
  await assert.rejects(service.saveAttendance(actor, { ...input, requestId: randomUUID(), topic: 'Edición vieja' }), isError(409));
  const current = await service.attendance(actor, course.id, input.date, 1);
  assert.equal(current.session.topic, 'Tema sintético');
  const corrected = await service.saveAttendance(actor, { ...input, requestId: randomUUID(), revision: first.revision, topic: 'Corrección nueva' });
  assert.equal(corrected.revision, first.revision + 1);
  assert.equal((await service.attendance(actor, course.id, input.date, 1)).session.topic, 'Corrección nueva');
});

test('el primer examen de 15 puntos aporta 15 de los 35, sin inflar la categoría', async () => {
  const { actor, course } = await caseContext('exam-weight');
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Primer examen QA', date: '2026-10-22', maxPoints: 15 });
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: course.students[0].id, score: 15 }] });
  const category = (await service.report(actor, course.id, course.students[0].id)).categories.find(c => c.key === 'exam')!;
  assert.equal(category.points, 15);
  assert.equal(category.denominator, 35);
});

test('las notas también son atómicas, idempotentes y protegidas por curso y revisión', async () => {
  const { actor, courses: ownCourses, course } = await caseContext('grade-integrity');
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'homework', title: 'Práctica QA', date: '2026-10-23', maxPoints: 10 });
  const input = { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: course.students[0].id, score: 0 }, { studentId: course.students[1].id, score: 8 }] };
  const first = await service.saveGrades(actor, input);
  const before = await service.grades(actor, activity.id);
  const replay = await service.saveGrades(actor, input);
  assert.equal(replay.operationId, first.operationId);
  assert.equal(replay.replayed, true);
  await assert.rejects(service.saveGrades(actor, { ...input, requestId: randomUUID() }), isError(409));
  await assert.rejects(service.saveGrades(actor, { ...input, requestId: randomUUID(), revision: first.revision, rows: [
    { studentId: course.students[0].id, score: 9 }, { studentId: course.students[1].id, score: 11 },
  ] }), isError(400));
  assert.deepEqual(await service.grades(actor, activity.id), before);
  await assert.rejects(service.saveGrades(actor, { ...input, requestId: randomUUID(), revision: first.revision, rows: [{ studentId: ownCourses[1].students[0].id, score: 9 }] }), isError([400,403,404]));
  await assert.rejects(service.grades('not-the-owner', activity.id), isError([403,404]));
});

test('una rúbrica guarda niveles y convierte el resultado al máximo de la actividad', async () => {
  const { actor, course } = await caseContext('rubric');
  const rubric: RubricCriterion[] = Array.from({ length: 5 }, (_, i) => ({
    id: `criterion-${i + 1}`, label: `Criterio ${i + 1}`,
    levels: [{ label: 'Insuficiente', points: 1 }, { label: 'Suficiente', points: 2 }, { label: 'Bueno', points: 3 }, { label: 'Excelente', points: 4 }],
  }));
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'sequence', title: 'Rúbrica QA', date: '2026-10-26', maxPoints: 10, scoringMode: 'rubric', rubric });
  const criterionLevels = { 'criterion-1': 3, 'criterion-2': 2, 'criterion-3': 1, 'criterion-4': 0, 'criterion-5': 3 };
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: course.students[0].id, score: null, criterionLevels }] });
  const stored = await service.grades(actor, activity.id);
  const row = stored.rows.find(r => r.studentId === course.students[0].id)!;
  assert.deepEqual(row.criterionLevels, criterionLevels);
  assert.equal(row.score, 7, '(4+3+2+1+4)/20 ×10 =7');
});

test('corregir nombres y reordenar la lista conserva matrículas, notas e historial', async () => {
  const { actor, course } = await caseContext('roster');
  const original = attendanceInput(course);
  await service.saveAttendance(actor, original);
  const student = course.students[0];
  const oldAttendance = await service.attendance(actor, course.id, original.date, 1);
  const rows = [...course.students].reverse().map((s, index) => ({ externalId: s.externalId, number: index + 1, name: s.id === student.id ? 'Nombre QA corregido' : s.name }));
  await service.importRoster(actor, course.id, rows);
  const updated = (await service.bootstrap(actor)).courses.find(c => c.id === course.id)!;
  assert.equal(updated.students.length, course.students.length);
  assert.equal(updated.students.find(s => s.externalId === student.externalId)?.id, student.id);
  const actual = await service.attendance(actor, course.id, original.date, 1);
  assert.equal(actual.rows.find(r => r.studentId === student.id)?.status, 'P');
  assert.equal(actual.rows.find(r => r.studentId === student.id)?.behavior, 7);
  assert.equal(actual.rows.find(r => r.studentId === student.id)?.name, 'Nombre QA corregido');
  assert.equal(actual.session.revision, oldAttendance.session.revision);
  assert.ok((await service.audit(actor)).length >= 2);
});

test('la exportación contiene datos del docente y no filtra registros de otros cursos propietarios', async () => {
  const exported = await service.exportData(owner);
  const serialized = JSON.stringify(exported);
  assert.ok(serialized.includes(courses[0].students[0].id));
  assert.ok(serialized.includes(dates[0]));
  assert.ok(!serialized.includes('Nombre QA corregido'));
  assert.ok(!serialized.includes('qa-rubric'));
  assert.ok(!serialized.includes('NEON_AUTH_COOKIE_SECRET'));
});

test('sin notas el informe sigue pendiente; una actividad pendiente no reduce el porcentaje observado', async () => {
  const { actor, course } = await caseContext('pending-denominator');
  const studentId = course.students[0].id;
  const empty = await service.report(actor, course.id, studentId);
  assert.equal(empty.total, null);
  assert.equal(empty.provisionalTotal, null);
  assert.ok(empty.categories.every(c => c.points === null && c.observedPercent === null));
  const first = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Calificada QA', date: '2026-10-21', maxPoints: 10 });
  await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Pendiente QA', date: '2026-10-22', maxPoints: 10 });
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: first.id, revision: 0, rows: [{ studentId, score: 5 }] });
  const category = (await service.report(actor, course.id, studentId)).categories.find(c => c.key === 'exam')!;
  assert.equal(category.rawEarned, 5);
  assert.equal(category.rawPossible, 20);
  assert.equal(category.observedDenominator, 10);
  assert.equal(category.observedPercent, 50);
  assert.equal(category.pending, 1);
  assert.equal(category.points, 5);
  assert.equal(category.planIncomplete, true);
});

test('una rúbrica parcial conserva las elecciones y permanece sin calificación', async () => {
  const { actor, course } = await caseContext('partial-rubric');
  const rubric: RubricCriterion[] = ['one', 'two'].map(id => ({ id, label: id, levels: [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points })) }));
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'sequence', title: 'Rúbrica parcial QA', date: '2026-10-23', maxPoints: 10, scoringMode: 'rubric', rubric });
  const studentId = course.students[0].id;
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId, score: null, criterionLevels: { one: 3 } }] });
  const saved = (await service.grades(actor, activity.id)).rows.find(row => row.studentId === studentId)!;
  assert.equal(saved.score, null);
  assert.deepEqual(saved.criterionLevels, { one: 3 });
  const category = (await service.report(actor, course.id, studentId)).categories.find(c => c.key === 'sequence')!;
  assert.equal(category.graded, 0);
  assert.equal(category.pending, 1);
  assert.equal(category.observedPercent, null);
});

test('un período nuevo permite planificar actividades después del final del P2', async () => {
  const { actor, course } = await caseContext('period-three');
  const original = (await service.bootstrap(actor)).plan;
  const p3 = { ...original, period: 'P3', startDate: '2027-01-21', endDate: '2027-03-31', note: 'Plan P3 de prueba' };
  await service.updatePlan(actor, p3);
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Planificación P3 QA', date: '2027-02-02', maxPoints: 15 });
  assert.equal(activity.period, 'P3');
  assert.equal((await service.bootstrap(actor)).plan.period, 'P3');
  assert.equal((await service.attendance(actor, course.id, '2027-02-02', 1)).session.status, 'programada');
});
