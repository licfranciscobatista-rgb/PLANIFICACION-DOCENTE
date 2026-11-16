import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createTestDatabase } from '../src/lib/db';
import { buildAttendanceRegisterPdf } from '../src/lib/attendance-pdf';
import { RegistroService } from '../src/lib/service';
import { AppError, type AttendanceInput, type Course, type RubricCriterion, type SequencePlan } from '../src/lib/model';
import { closeTo, expectedRecord, expectedStudent, teachingDates } from './oracle';

const root = path.resolve('.local');
const directory = path.join(root, `qa-${randomUUID()}`);
const databasePath = path.join(directory, 'postgres');
const owner = 'workflow-qa-teacher';
let simulatedToday = '2026-12-01';
const today = () => simulatedToday;
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

afterEach(() => { simulatedToday = '2026-12-01'; });

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
  const expectedBehaviorRows = dates.reduce((sum, _date, day) => sum + courses.reduce((courseSum, course) => courseSum + course.students.filter((_student, index) => expectedRecord(day, index).behavior !== null).length, 0), 0);
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
        if (expected.behavior !== null) verifiedBehavior += 1;
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
  assert.equal(verifiedBehavior, expectedBehaviorRows);
  assert.equal(verifiedGrades, 1830);
});

test('flujo de año escolar completo: 182 días lectivos, 3 cursos, asistencia, conducta y libreta', async () => {
  const { actor, courses: roster } = await caseContext('full-school-year');
  const yearDates = teachingDates(182);
  const checks = { count: 0 };
  const equal = (actual: unknown, expected: unknown, message?: string) => { assert.equal(actual, expected, message ?? ''); checks.count += 1; };
  const truth = (value: unknown, message?: string) => { assert.ok(value, message ?? ''); checks.count += 1; };
  const perCourse = { attendanceRows: 0, behaviorRows: 0, notebookRows: 0, sessions: 0 };

  equal(yearDates[0], '2026-10-20');
  equal(yearDates.at(-1), '2027-06-30');
  equal(yearDates.length, 182);
  equal(roster.reduce((sum, course) => sum + course.students.length, 0), 61);

  // Test-only extension: one class per weekday and course, block 1. The real
  // workbook supplies the date/block calendar only through 2027-01-20.
  const scheduleRows = yearDates.flatMap(date => roster.map(course => ({ courseId: course.id, date, block: 1 })));
  const scheduleParams: unknown[] = [];
  const scheduleValues = scheduleRows.map((row, index) => {
    const start = index * 4 + 1;
    scheduleParams.push(actor, row.courseId, row.date, row.block);
    return `($${start},$${start+1},$${start+2}::date,$${start+3}::integer)`;
  });
  await db.query(`INSERT INTO scheduled_sessions(owner_id,course_id,session_date,block) VALUES ${scheduleValues.join(',')} ON CONFLICT DO NOTHING`, scheduleParams);

  const original = (await service.bootstrap(actor)).plan;
  await service.updatePlan(actor, { ...original, period: 'P3', startDate: '2027-01-21', endDate: '2027-03-31', note: 'Plan provisional P3 para prueba anual.' });
  await service.updatePlan(actor, { ...original, period: 'P4', startDate: '2027-04-01', endDate: '2027-06-30', note: 'Plan provisional P4 para prueba anual.' });
  await service.activatePlan(actor, 'P2');

  simulatedToday = '2026-10-20';
  const firstFuture = await service.attendance(actor, roster[0].id, '2026-10-21', 1);
  equal(firstFuture.session.scheduled, true);
  equal(firstFuture.session.status, 'programada');

  let activePeriod = 'P2';
  for (const [day, date] of yearDates.entries()) {
    const period = date <= '2027-01-20' ? 'P2' : date <= '2027-03-31' ? 'P3' : 'P4';
    if (period !== activePeriod) {
      await service.activatePlan(actor, period);
      activePeriod = period;
      equal((await service.bootstrap(actor)).plan.period, period);
    }
    simulatedToday = date;
    for (const course of roster) {
      const before = await service.attendance(actor, course.id, date, 1);
      equal(before.session.scheduled, true, `Falta el bloque previsto ${course.code} ${date}`);
      equal(before.session.status, 'no_impartida', `El bloque sin marcas debía quedar no impartido: ${course.code} ${date}`);

      const input = attendanceInput(course, {
        date, block: 1, lessonType: ['teoria','practica','ejercicios','repaso','correcciones'][day % 5] as AttendanceInput['lessonType'],
        topic: `Clase anual QA ${course.code} ${day + 1}`,
        rows: course.students.map((student, index) => {
          const expected = expectedRecord(day, index);
          return { studentId: student.id, status: expected.status, behavior: expected.behavior, comment: expected.comment };
        }),
      });
      const receipt = await service.saveAttendance(actor, input);
      equal(receipt.savedRows, course.students.length);
      equal(receipt.status, 'impartida');
      const stored = await service.attendance(actor, course.id, date, 1);
      equal(stored.session.status, 'impartida');
      equal(stored.session.scheduled, true);
      equal(stored.rows.length, course.students.length);
      perCourse.sessions += 1;

      for (const [index, student] of course.students.entries()) {
        const actual = stored.rows.find(row => row.studentId === student.id);
        const expected = expectedRecord(day, index);
        truth(actual, `Falta el registro de ${course.code}, estudiante ${index+1}, ${date}`);
        equal(actual!.status, expected.status);
        equal(actual!.behavior, expected.behavior);
        equal(actual!.comment, expected.comment);
        perCourse.attendanceRows += 1;
        if (expected.behavior !== null) perCourse.behaviorRows += 1;
      }

      const activity = await service.createActivity(actor, {
        requestId: randomUUID(), courseId: course.id, category: 'notebook',
        title: `Libreta QA anual ${course.code} ${date}`, date, block: 1, maxPoints: 2,
      });
      equal(activity.period, period);
      const gradeReceipt = await service.saveGrades(actor, {
        requestId: randomUUID(), activityId: activity.id, revision: 0,
        rows: course.students.map((student, index) => ({ studentId: student.id, score: expectedRecord(day, index).notebook })),
      });
      equal(gradeReceipt.savedRows, course.students.length);
      const storedGrades = await service.grades(actor, activity.id);
      equal(storedGrades.activity.courseId, course.id);
      equal(storedGrades.activity.date, date);
      equal(storedGrades.rows.length, course.students.length);
      for (const [index, student] of course.students.entries()) {
        const actual = storedGrades.rows.find(row => row.studentId === student.id);
        truth(actual, `Falta la nota de libreta de ${course.code}, estudiante ${index+1}, ${date}`);
        equal(actual!.score, expectedRecord(day, index).notebook);
        perCourse.notebookRows += 1;
      }
    }
  }

  simulatedToday = yearDates.at(-1)!;
  for (const course of roster) {
    const summary = await service.registerSummary(actor, course.id);
    equal(summary.calendarThrough, '2027-01-20');
    equal(summary.totals.taught, 182);
    equal(summary.weeks.reduce((sum, week) => sum + week.taught, 0), summary.totals.taught);
    for (const student of course.students) {
      const yearRow = summary.rows.find(row => row.student.id === student.id)!;
      const weeks = summary.weeks.flatMap(week => week.rows.filter(row => row.student.id === student.id));
      equal(weeks.reduce((sum, row) => sum + row.present, 0), yearRow.present);
      equal(weeks.reduce((sum, row) => sum + row.absent, 0), yearRow.absent);
      equal(weeks.reduce((sum, row) => sum + row.late, 0), yearRow.late);
      equal(weeks.reduce((sum, row) => sum + row.excused, 0), yearRow.excused);
      equal(weeks.reduce((sum, row) => sum + row.pending, 0), yearRow.pending);
      truth(weeks.every(row => row.attended === row.present + row.late), `La asistencia semanal no coincide para ${course.code} ${student.number}`);
    }
    for (const [index, student] of course.students.entries()) {
      const actual = summary.rows.find(row => row.student.id === student.id);
      truth(actual, `Falta el resumen de ${course.code}, estudiante ${index+1}`);
      const records = yearDates.map((_, day) => expectedRecord(day, index));
      const counts = { P: records.filter(x=>x.status==='P').length, A: records.filter(x=>x.status==='A').length, T: records.filter(x=>x.status==='T').length, E: records.filter(x=>x.status==='E').length };
      const behaviorRecords = records.filter(row => row.behavior !== null);
      const behaviorSum = behaviorRecords.reduce((sum, row) => sum + row.behavior!, 0);
      const attendanceDenominator = summary.totals.taught;
      const totalAttendance = counts.P + counts.T - Math.floor(counts.T/3);
      equal(actual!.sessions, 182);
      equal(actual!.present, counts.P);
      equal(actual!.absent, counts.A);
      equal(actual!.late, counts.T);
      equal(actual!.excused, counts.E);
      equal(actual!.attendancePercent, Math.round(totalAttendance/attendanceDenominator*10000)/100);
      equal(actual!.behaviorCount, behaviorRecords.length);
      equal(actual!.behaviorAverage, Math.round(behaviorSum/behaviorRecords.length*100)/100);
      equal(actual!.behaviorPercent, Math.round(behaviorSum/(behaviorRecords.length*10)*10000)/100);
    }
  }

  equal(perCourse.sessions, 182*3);
  equal(perCourse.attendanceRows, 182*61);
  const expectedYearBehaviorRows = yearDates.reduce((sum, _date, day) => sum + roster.reduce((courseSum, course) => courseSum + course.students.filter((_student, index) => expectedRecord(day, index).behavior !== null).length, 0), 0);
  equal(perCourse.behaviorRows, expectedYearBehaviorRows);
  equal(perCourse.notebookRows, 182*61);
  truth(checks.count >= 2900, `Solo se ejecutaron ${checks.count} comprobaciones.`);
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/full-year-flow.json', JSON.stringify({
    source: 'synthetic weekday schedule; official source calendar through 2027-01-20',
    courses: 3, students: 61, weekdaysPerCourse: 182, sessions: perCourse.sessions,
    attendanceRows: perCourse.attendanceRows, behaviorRows: perCourse.behaviorRows,
    notebookGradeRows: perCourse.notebookRows, independentStudentSummaries: 61,
    assertionsCounted: checks.count, periodRanges: { P2: ['2026-10-20','2027-01-20'], P3: ['2027-01-21','2027-03-31'], P4: ['2027-04-01','2027-06-30'] },
    startDate: yearDates[0]!, endDate: yearDates.at(-1)!,
  }, null, 2));
  simulatedToday = '2026-12-01';
});

test('flujo anual: guardar borrador, confirmar revisión y distribuir la secuencia después', async () => {
  const actor = `qa-sequence-flow-${randomUUID()}`;
  const bootstrap = await service.bootstrap(actor);
  const indicatorId = 'indicator-vector-components';
  const draft: SequencePlan = {
    source: 'manual', sourceName: '', sourceText: '', reviewed: false,
    indicators: [{ id: indicatorId, code: '', label: '', competency: 'logico_matematica' }],
    activities: [{ id: 'sequence-vector-2-1', code: '', theme: '', title: '', lessonType: 'teoria', description: '', evidence: '', indicatorIds: [], period: '' }],
  };
  const savedDraft = await service.saveCurriculumSequence(actor, draft);
  assert.equal(savedDraft.reviewed, false, 'el borrador vacío puede persistirse mientras se completa');
  assert.equal((await service.bootstrap(actor)).curriculumSequence?.activities[0]?.title, '');

  const reviewed: SequencePlan = {
    ...draft, reviewed: true,
    indicators: [{ id: indicatorId, code: 'I1', label: 'Representa y suma vectores correctamente', competency: 'logico_matematica' }],
    activities: [{ ...draft.activities[0]!, code: '2.1', theme: 'Vectores', title: 'Suma de vectores', lessonType: 'ejercicios', description: 'Representa los componentes y encuentra la resultante.', evidence: 'Procedimiento escrito.', indicatorIds: [indicatorId], period: '' }],
  };
  const savedReview = await service.saveCurriculumSequence(actor, reviewed);
  assert.equal(savedReview.reviewed, true, 'la revisión no exige una asignación de período prematura');
  assert.equal(savedReview.activities[0]?.period, '');

  const distributed = await service.saveCurriculumSequence(actor, { ...savedReview, activities: [{ ...savedReview.activities[0]!, period: 'P2' }] });
  assert.equal(distributed.reviewed, true, 'asignar período conserva el estado de revisión');
  assert.equal(distributed.activities[0]?.period, 'P2');
  assert.equal((await service.bootstrap(actor)).curriculumSequence?.activities[0]?.period, 'P2', 'la distribución se conserva en el bootstrap');
  assert.ok(bootstrap.courses.length > 0, 'el flujo comienza con los cursos creados');
});

test('la fecha de creación de una actividad fuera del período no crea una clase ni asistencia', async () => {
  const actor = `qa-activity-date-${randomUUID()}`;
  const bootstrap = await service.bootstrap(actor);
  const date = '2027-02-06';
  const created = await service.createSharedActivity(actor, {
    courseIds: bootstrap.courses.map(course => course.id),
    activity: { requestId: randomUUID(), category: 'sequence', title: 'Registro de prueba fuera de período', date, maxPoints: 10 },
  });
  assert.equal(created.length, bootstrap.courses.length);
  assert.ok(created.every(activity => activity.date === date));
  for (const course of bootstrap.courses) {
    const sessions = await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM class_sessions WHERE owner_id=$1 AND course_id=$2 AND session_date=$3', [actor, course.id, date]);
    assert.equal(sessions.rows[0]?.count, 0, `${course.code}: crear una actividad no registra una sesión de clase`);
    const attendance = await service.attendance(actor, course.id, date, 1);
    assert.notEqual(attendance.session.status, 'impartida', `${course.code}: la actividad no debe marcar clase impartida`);
  }
});

test('bootstrap reúne secuencias guardadas por período para no esconder planificación previa', async () => {
  const actor = `qa-legacy-sequence-${randomUUID()}`;
  const bootstrap = await service.bootstrap(actor);
  const indicatorId = 'legacy-indicator-1';
  const legacy: SequencePlan = {
    source: 'manual', sourceName: '', sourceText: 'Secuencia heredada', reviewed: true,
    indicators: [{ id: indicatorId, code: 'I1', label: 'Resuelve problemas con vectores', competency: 'resolucion' }],
    activities: [{ id: 'legacy-activity-1', code: '2.1', theme: 'Vectores', title: 'Suma de vectores', lessonType: 'ejercicios', description: '', evidence: '', indicatorIds: [indicatorId] }],
  };
  await service.savePlanSequence(actor, bootstrap.plan.period, legacy);
  const migratedView = (await service.bootstrap(actor)).curriculumSequence;
  assert.equal(migratedView?.reviewed, true);
  assert.equal(migratedView?.activities.length, 1);
  assert.equal(migratedView?.activities[0]?.period, bootstrap.plan.period);
  assert.equal(migratedView?.activities[0]?.title, 'Suma de vectores');
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
      assert.equal(behavior.rawPossible, expected.behaviorPossible);
      assert.ok(closeTo(behavior.observedPercent!, expected.behaviorRaw / expected.behaviorPossible * 100));
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
  assert.equal((await service.attendance(actor, course.id, '2026-10-21', 1)).session.status, 'no_programada');
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
  const calendar = await service.registerSummary(actor, course.id);
  const week = calendar.weeks.find(item => item.slots.some(slot => slot.date === input.date))!;
  assert.equal(week.taught, 1);
  assert.equal(week.rows.find(row => row.student.id === course.students[0].id)?.absent, 1);
  assert.equal(week.rows.find(row => row.student.id === course.students[0].id)?.attended, 0);
  const future = calendar.sessions.find(session => session.date > today() && session.scheduled)!;
  assert.equal((await service.attendance(actor, course.id, '2026-11-14', 1)).session.status, 'no_programada');
  assert.equal((await service.attendance(actor, course.id, future.date, future.block)).session.status, 'programada');
  await assert.rejects(service.saveAttendance(actor, attendanceInput(course, { date: future.date, block: future.block })), isError(400));
  assert.equal((await service.attendance(actor, course.id, future.date, future.block)).session.status, 'programada');
});

test('el calendario distingue clases previstas, no impartidas, días fuera de horario y fin de cobertura', async () => {
  const { actor, courses: roster } = await caseContext('calendar-coverage');
  const expectedCounts = new Map([['5A',93],['5B',92],['5C',92]]);
  for (const course of roster) {
    const summary = await service.registerSummary(actor, course.id);
    assert.equal(summary.sessions.length, expectedCounts.get(course.code));
    assert.equal(summary.calendarThrough, '2027-01-20');
    assert.equal(summary.sessions.every(session=>session.scheduled), true);
    assert.equal(summary.totals.notScheduled, 0);
    assert.equal(summary.sessions.some(session=>session.status==='no_impartida'), true);
    assert.equal(summary.sessions.some(session=>session.status==='programada'), true);
  }
  const course = roster[0];
  assert.equal((await service.attendance(actor, course.id, '2026-11-14', 1)).session.status, 'no_programada');
  assert.equal((await service.attendance(actor, course.id, '2027-01-21', 1)).session.status, 'no_programada');
});

test('el registro mensual conserva los bloques, aplica tres tardanzas por ausencia y excluye clases no impartidas', async () => {
  const { actor, course } = await caseContext('monthly-register');
  const dates = ['2026-10-20','2026-10-21','2026-10-22','2026-10-23'];
  for (const [day,date] of dates.entries()) {
    const input = attendanceInput(course, {
      date,
      rows: course.students.map((student,index) => ({
        studentId: student.id,
        status: index === 0 ? (['A','T','T','T'] as const)[day]! : index === 1 ? 'E' : 'P',
        behavior: null,
      })),
    });
    await service.saveAttendance(actor,input);
  }
  const register = await service.registerSummary(actor,course.id);
  const october = register.months.find(month=>month.key==='2026-10')!;
  assert.equal(october.taught,4);
  assert.equal(october.slots.length,4);
  assert.ok(october.notTaught>0,'un bloque del horario vencido sin marcas se identifica como no impartido');
  const student = october.rows.find(row=>row.student.id===course.students[0].id)!;
  assert.deepEqual(student.marks,['A','T','T','T']);
  assert.equal(student.absent,1);
  assert.equal(student.late,3);
  assert.equal(student.absenceEquivalent,2);
  assert.equal(student.attendancePercent,50);
  const excused = october.rows.find(row=>row.student.id===course.students[1].id)!;
  assert.equal(excused.excused,4);
  assert.equal(excused.attendancePercent,0,'las excusas se conservan como no asistencia y el día trabajado permanece en el denominador');
});

test('la hoja ministerial PDF conserva filas numeradas, dos meses por página y el conteo semanal', async () => {
  const { actor, course } = await caseContext('official-attendance-pdf');
  const dates = ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-11-02','2026-11-03'];
  const marks = ['P','T','T','T','A','E','R'] as const;
  for (const [index,date] of dates.entries()) {
    const input = attendanceInput(course, {
      date,
      rows: course.students.map((student,studentIndex) => ({
        studentId: student.id,
        status: studentIndex === 0 ? marks[index]! : 'P',
        behavior: studentIndex === 0 && ['A','E','R'].includes(marks[index]!) ? null : 7,
      })),
    });
    await service.saveAttendance(actor,input);
  }
  const summary = await service.registerSummary(actor,course.id);
  const weekly = summary.weeks.find(week=>week.startDate==='2026-10-26')!;
  const student = weekly.rows.find(row=>row.student.id===course.students[0].id)!;
  assert.deepEqual(student.marks,['P','T','T','T','A']);
  assert.equal(student.attended,4,'P y T se cuentan como asistencias semanales');
  assert.equal(student.totalAttendance,3,'tres tardanzas descuentan una asistencia en el total formal');
  assert.equal(student.attendancePercent,60);

  const october = summary.months.find(month=>month.key==='2026-10')!;
  const octoberStudent = october.rows.find(row=>row.student.id===course.students[0].id)!;
  assert.equal(octoberStudent.totalAttendance,3);
  assert.equal(octoberStudent.attendancePercent,60);
  const november = summary.months.find(month=>month.key==='2026-11')!;
  const novemberStudent = november.rows.find(row=>row.student.id===course.students[0].id)!;
  assert.deepEqual(novemberStudent.marks,['E','R']);
  assert.equal(novemberStudent.attendancePercent,0,'E queda como no asistencia y el día con R no se incluye en el denominador');

  const bytes = await buildAttendanceRegisterPdf(summary,true);
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getTitle(),`Registro de asistencia ${course.code} · Matemática · 2026-2027`);
  assert.equal(pdf.getPageCount(),2,'nómina complementaria y una hoja con dos meses');
  for (const page of pdf.getPages()) assert.deepEqual(page.getSize(),{width:612,height:792});
});

test('el retiro voluntario R se aplica desde su fecha y no convierte por sí solo el día en clase impartida', async () => {
  const { actor, course } = await caseContext('withdrawal-effective-date');
  const dates = ['2026-10-26','2026-10-27','2026-10-28'];
  for (const [day,date] of dates.entries()) {
    const view = day === 0 ? null : await service.attendance(actor,course.id,date,1);
    if (view) assert.equal(view.rows.find(row=>row.studentId===course.students[0]!.id)?.status,'R');
    const input = attendanceInput(course, {
      date,
      rows: course.students.map((student,index) => ({
        studentId: student.id,
        status: index === 0 ? 'R' : 'P',
        behavior: index === 0 ? null : 7,
      })),
    });
    await service.saveAttendance(actor,input);
  }
  const register = await service.registerSummary(actor,course.id);
  const october = register.months.find(month=>month.key==='2026-10')!;
  const withdrawn = october.rows.find(row=>row.student.id===course.students[0]!.id)!;
  assert.deepEqual(withdrawn.marks,['R','R','R']);
  assert.equal(withdrawn.withdrawn,3);
  assert.equal(withdrawn.pending,0);
  assert.equal(withdrawn.attendancePercent,null);
  assert.equal(october.taught,3,'las marcas P de los demás estudiantes confirman las clases');

  const notebook = await service.createActivity(actor,{courseId:course.id,category:'notebook',title:'Libreta después del retiro',date:dates[1]!,block:1,maxPoints:2});
  await service.saveGrades(actor,{requestId:randomUUID(),activityId:notebook.id,revision:0,rows:[{studentId:course.students[0]!.id,score:2}]});
  const report = await service.report(actor,course.id,course.students[0]!.id);
  assert.equal(report.attendance.sessions,0);
  assert.equal(report.timeline.find(row=>row.date===dates[1])?.status,'R');
  assert.equal(report.grades.find(row=>row.activityId===notebook.id)?.included,false);
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

test('ausencias y excusas no producen nota de conducta ni aumentan su máximo posible', async () => {
  const { actor, course } = await caseContext('behavior-excludes-absence');
  const first = course.students[0], second = course.students[1];
  const absentDay = attendanceInput(course, { date: '2026-10-21', rows: course.students.map(student => ({
    studentId: student.id,
    status: student.id === first.id ? 'A' : student.id === second.id ? 'E' : 'P',
    behavior: student.id === first.id ? 9 : student.id === second.id ? 8 : 7,
  })) });
  await service.saveAttendance(actor, absentDay);
  const stored = await service.attendance(actor, course.id, absentDay.date, 1);
  assert.equal(stored.rows.find(row => row.studentId === first.id)?.behavior, null);
  assert.equal(stored.rows.find(row => row.studentId === second.id)?.behavior, null);
  await service.saveAttendance(actor, attendanceInput(course, {
    date: '2026-10-22',
    rows: course.students.map(student => ({ studentId: student.id, status: 'P', behavior: student.id === first.id ? 6 : student.id === second.id ? 5 : 7 })),
  }));
  const firstReport = await service.report(actor, course.id, first.id);
  const firstConduct = firstReport.categories.find(category => category.key === 'participation')!;
  assert.equal(firstReport.timeline.find(item => item.date === absentDay.date)?.behavior, null);
  assert.equal(firstConduct.rawEarned, 6);
  assert.equal(firstConduct.rawPossible, 10);
  assert.equal(firstConduct.pending, 0);
  const secondReport = await service.report(actor, course.id, second.id);
  assert.equal(secondReport.categories.find(category => category.key === 'participation')?.rawPossible, 10);
  const register = await service.registerSummary(actor, course.id);
  assert.equal(register.rows.find(row => row.student.id === first.id)?.behaviorCount, 1);
  assert.equal(register.rows.find(row => row.student.id === first.id)?.behaviorAverage, 6);
  const ledger = await service.teacherLedger(actor);
  const behavior = ledger.rows.find(row => row.student.id === first.id)?.scores.find(score => score.key === 'behavior:period')!;
  assert.equal(behavior.points, 6);
  assert.equal(behavior.possible, 10);
  assert.equal(behavior.state, 'graded');
});

test('el desarrollo de calificaciones reproduce las cinco ponderaciones y permite consultar cada período guardado', async () => {
  const { actor, course } = await caseContext('grade-development-by-period');
  const initial = await service.bootstrap(actor);
  assert.deepEqual(initial.plan.categories.map(category=>[category.key,category.weight]),[
    ['exam',35],['sequence',20],['notebook',20],['participation',15],['homework',10],
  ]);
  assert.deepEqual(initial.plan.categories.filter(category=>category.group).map(category=>[category.key,category.group,category.weight]),[
    ['sequence','Libretas y tareas',20],['notebook','Libretas y tareas',20],
  ]);
  const p2 = await service.createActivity(actor,{courseId:course.id,category:'exam',title:'Examen P2 · parte inicial QA',date:'2026-10-21',maxPoints:15});
  await service.saveGrades(actor,{requestId:randomUUID(),activityId:p2.id,revision:0,rows:[{studentId:course.students[0].id,score:12}]});
  const p1Plan = {...initial.plan,period:'P1',startDate:'2026-10-20',endDate:'2026-10-28',note:'Plan de prueba P1',categories:initial.plan.categories.map(category=>category.key==='sequence'?{...category,weight:15,expectedRaw:15,group:undefined}:category.key==='participation'?{...category,weight:20}:category)};
  await service.updatePlan(actor,p1Plan);
  const p1 = await service.createActivity(actor,{courseId:course.id,category:'sequence',title:'Trabajo para entregar P1 QA',date:'2026-10-22',maxPoints:15});
  await service.saveGrades(actor,{requestId:randomUUID(),activityId:p1.id,revision:0,rows:[{studentId:course.students[0].id,score:10}]});
  const p1View = await service.teacherLedger(actor,'P1');
  const p2View = await service.teacherLedger(actor,'P2');
  assert.deepEqual(p1View.availablePeriods,['P1','P2']);
  assert.equal(p1View.period,'P1');
  assert.equal(p2View.period,'P2');
  const student = course.students[0];
  const p1Row = p1View.rows.find(row=>row.student.id===student.id)!;
  const p2Row = p2View.rows.find(row=>row.student.id===student.id)!;
  assert.equal(p1Row.categories.find(category=>category.key==='sequence')?.points,10);
  assert.equal(p1Row.categories.find(category=>category.key==='exam')?.points,null);
  assert.equal(p1Row.finalized,false);
  assert.equal(p2Row.categories.find(category=>category.key==='exam')?.points,12);
  assert.equal(p2Row.categories.find(category=>category.key==='sequence')?.points,null);
  assert.equal(p1View.groups.flatMap(group=>group.columns).some(column=>column.label==='Trabajo para entregar P1 QA'),true);
  assert.equal(p2View.groups.flatMap(group=>group.columns).some(column=>column.label==='Examen P2 · parte inicial QA'),true);
  const reportP1 = await service.report(actor,course.id,student.id,'P1');
  const reportP2 = await service.report(actor,course.id,student.id,'P2');
  assert.equal(reportP1.grades.length,1);
  assert.equal(reportP2.grades.length,1);
  assert.equal(reportP1.grades[0]?.activityId,p1.id);
  assert.equal(reportP2.grades[0]?.activityId,p2.id);
});

test('los puntos extra se guardan por separado y no alteran los cinco máximos del plan', async () => {
  const { actor, course } = await caseContext('extra-points-separated');
  const student = course.students[0];
  const activity = await service.createActivity(actor, {
    courseId: course.id, category: 'extra', title: 'Punto de regalo QA', date: '2026-10-22', maxPoints: 5,
  });
  await service.saveGrades(actor, {
    requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: student.id, score: 3 }],
  });
  const report = await service.report(actor, course.id, student.id);
  assert.deepEqual(report.categories.map(category => [category.key, category.weight]), [
    ['exam',35],['sequence',20],['notebook',20],['participation',15],['homework',10],
  ]);
  assert.equal(report.bonusPoints, 3);
  assert.equal(report.bonusPossible, 5);
  assert.equal(report.categories.reduce((sum, category) => sum + category.weight, 0), 100);
  assert.equal(report.grades.find(grade => grade.activityId === activity.id)?.category, 'extra');
  const ledger = await service.teacherLedger(actor);
  const row = ledger.rows.find(item => item.student.id === student.id)!;
  assert.equal(row.bonusPoints, 3);
  assert.equal(row.bonusPossible, 5);
  assert.equal(row.weightedTotal, 3);
  assert.equal(row.finalized, false);
  assert.ok(ledger.groups.flatMap(group => group.columns).some(column => column.category === 'extra'));
});

test('el P1 y el P2 se conservan separados y el examen del P2 admite dos partes de 15 y 20', async () => {
  const { actor, course } = await caseContext('period-switch-exam-parts');
  const partOne = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Examen P2 · parte 1', date: '2026-10-21', maxPoints: 15 });
  const partTwo = await service.createActivity(actor, { courseId: course.id, category: 'exam', title: 'Examen P2 · parte 2', date: '2026-10-22', maxPoints: 20 });
  const student = course.students[0];
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: partOne.id, revision: 0, rows: [{ studentId: student.id, score: 12 }] });
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: partTwo.id, revision: 0, rows: [{ studentId: student.id, score: 17 }] });
  const p2Before = await service.report(actor, course.id, student.id);
  assert.equal(p2Before.categories.find(category => category.key === 'exam')?.rawPossible, 35);
  assert.equal(p2Before.categories.find(category => category.key === 'exam')?.rawEarned, 29);

  const p1 = structuredClone(p2Before.plan);
  p1.period = 'P1';
  p1.endDate = '2026-10-28';
  await service.updatePlan(actor, p1);
  const p1Bootstrap = await service.bootstrap(actor);
  assert.equal(p1Bootstrap.plan.period, 'P1');
  assert.match(p1Bootstrap.plan.note, /Copia de P2/);
  assert.deepEqual(p1Bootstrap.plans.map(plan => plan.period), ['P1', 'P2']);
  assert.deepEqual(p1Bootstrap.activities.map(activity => activity.id).sort(), [partOne.id, partTwo.id].sort());
  assert.equal(p1Bootstrap.activities.filter(activity => activity.period === 'P1').length, 0);
  assert.equal((await service.teacherLedger(actor)).period, 'P1');

  await service.activatePlan(actor, 'P2');
  const p2Bootstrap = await service.bootstrap(actor);
  assert.equal(p2Bootstrap.plan.period, 'P2');
  assert.deepEqual(p2Bootstrap.activities.map(activity => activity.id).sort(), [partOne.id, partTwo.id].sort());
  assert.equal((await service.report(actor, course.id, student.id)).categories.find(category => category.key === 'exam')?.rawEarned, 29);
});

test('P2 calcula la rúbrica de 85 y suma las dos partes de libretas sobre 40', async () => {
  const { actor, course } = await caseContext('p2-grade-formula');
  const student = course.students[0]!;
  const initial = await service.bootstrap(actor);
  const confirmed = { ...initial.plan, status: 'confirmed' as const };
  await service.updatePlan(actor, confirmed);

  const scheduled = (await service.registerSummary(actor, course.id)).sessions.filter(session => session.scheduled).slice(0, 2);
  assert.equal(scheduled.length, 2);
  for (const [index, session] of scheduled.entries()) {
    await service.saveAttendance(actor, attendanceInput(course, {
      date: session.date, block: session.block,
      rows: course.students.map(person => ({ studentId: person.id, status: 'P', behavior: person.id === student.id ? (index === 0 ? 8 : 10) : 7, comment: '' })),
    }));
    const notebook = await service.createActivity(actor, {
      requestId: randomUUID(), courseId: course.id, category: 'notebook', title: `Libreta P2 QA ${index + 1}`,
      date: session.date, block: session.block, maxPoints: 2,
    });
    await service.saveGrades(actor, {
      requestId: randomUUID(), activityId: notebook.id, revision: 0,
      rows: course.students.map(person => ({ studentId: person.id, score: person.id === student.id ? (index === 0 ? 1.5 : 2) : 1.5 })),
    });
  }

  const saveDirect = async (category: 'exam' | 'homework', title: string, date: string, maxPoints: number, score: number) => {
    const activity = await service.createActivity(actor, { requestId: randomUUID(), courseId: course.id, category, title, date, maxPoints });
    await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: student.id, score }] });
  };
  await saveDirect('exam', 'Examen P2 · 15 puntos QA', scheduled[0]!.date, 15, 15);
  await saveDirect('exam', 'Examen P2 · 20 puntos QA', scheduled[1]!.date, 20, 20);
  await saveDirect('homework', 'Práctica para casa P2 · 1 QA', scheduled[0]!.date, 5, 5);
  await saveDirect('homework', 'Práctica para casa P2 · 2 QA', scheduled[1]!.date, 5, 5);

  const rubric: RubricCriterion[] = Array.from({ length: 5 }, (_, index) => ({
    id: `p2-criterion-${index + 1}`, label: `Criterio matemático ${index + 1}`, competency: 'logico_matematica',
    indicator: 'Aplica y explica el procedimiento.', weight: 1,
    levels: [0, 5, 10, 17].map((points, level) => ({ label: `Nivel ${level + 1}`, points, description: `Descriptor de QA ${level + 1}.` })),
  }));
  const sequence = await service.createActivity(actor, {
    requestId: randomUUID(), courseId: course.id, category: 'sequence', title: 'Actividad de secuencia 2.1 QA',
    date: scheduled[0]!.date, maxPoints: 85, scoringMode: 'rubric', rubric, sequenceCode: '2.1',
  });
  await service.saveGrades(actor, {
    requestId: randomUUID(), activityId: sequence.id, revision: 0,
    rows: [{ studentId: student.id, score: null, criterionLevels: Object.fromEntries(rubric.map(criterion => [criterion.id, 3])) }],
  });

  const report = await service.report(actor, course.id, student.id, 'P2');
  const byKey = new Map(report.categories.map(category => [category.key, category]));
  assert.deepEqual(report.categories.map(category => [category.key, category.weight]), [
    ['exam', 35], ['sequence', 20], ['notebook', 20], ['participation', 15], ['homework', 10],
  ]);
  assert.equal(byKey.get('exam')?.points, 35);
  assert.equal(byKey.get('sequence')?.rawPossible, 85);
  assert.equal(byKey.get('sequence')?.rawEarned, 85);
  assert.equal(byKey.get('sequence')?.points, 20);
  assert.equal(byKey.get('notebook')?.rawPossible, 4);
  assert.equal(byKey.get('notebook')?.rawEarned, 3.5);
  assert.equal(byKey.get('notebook')?.points, 17.5);
  assert.equal(byKey.get('participation')?.rawEarned, 18);
  assert.equal(byKey.get('participation')?.points, 13.5);
  assert.equal(byKey.get('homework')?.points, 10);
  assert.equal(report.total, 96);

  const ledger = await service.teacherLedger(actor, 'P2');
  const row = ledger.rows.find(item => item.student.id === student.id)!;
  assert.equal(row.finalized, true);
  assert.equal(row.weightedTotal, 96);
  assert.equal(row.categories.find(category => category.key === 'sequence')?.group, 'Libretas y tareas');
  assert.equal(row.categories.find(category => category.key === 'notebook')?.group, 'Libretas y tareas');
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

test('una actividad común se prepara una vez, se crea para los tres cursos y separa participación de disciplina en el libro general', async () => {
  const { actor, courses: ownCourses } = await caseContext('shared-activity-ledger');
  const created = await service.createSharedActivity(actor, {
    courseIds: ownCourses.map(course => course.id),
    activity: { requestId: randomUUID(), category: 'participation', title: 'Participación común QA', date: '2026-10-22', maxPoints: 10, competency: 'comunicativa' },
  });
  assert.equal(created.length, 3);
  assert.equal(new Set(created.map(activity => activity.sharedId)).size, 1);
  assert.deepEqual(new Set(created.map(activity => activity.courseId)), new Set(ownCourses.map(course => course.id)));
  for (const [index, course] of ownCourses.entries()) {
    const activity = created.find(item => item.courseId === course.id)!;
    await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: course.students[0].id, score: index + 3 }] });
  }
  const firstCourse = ownCourses.find(course => course.code === '5A')!;
  await service.saveAttendance(actor, attendanceInput(firstCourse, {
    date: '2026-10-22',
    rows: firstCourse.students.map((student,index) => ({ studentId: student.id, status: 'P', behavior: index === 0 ? 4 : null, comment: '' })),
  }));
  const ledger = await service.teacherLedger(actor);
  assert.equal(ledger.rows.length, ownCourses.reduce((sum,course)=>sum+course.students.length,0));
  const firstRow = ledger.rows.find(row=>row.course.code==='5A'&&row.student.id===firstCourse.students[0].id)!;
  const participationColumn=ledger.groups.flatMap(group=>group.columns).find(column=>column.label==='Participación común QA')!;
  assert.equal(firstRow.scores.find(item=>item.key===participationColumn.key)?.points,3);
  assert.equal(firstRow.scores.find(item=>item.key==='behavior:period')?.points,4);
  assert.equal(firstRow.rawTotal,7);
  const personal = ledger.groups.find(group=>group.key==='desarrollo_personal')!;
  assert.ok(personal.columns.some(column=>column.label==='Disciplina / comportamiento'));
  const communication = ledger.groups.find(group=>group.key==='comunicativa')!;
  assert.ok(communication.columns.some(column=>column.label==='Participación común QA'));
  assert.deepEqual(new Set(participationColumn.courseIds),new Set(ownCourses.map(course=>course.id)));
  const secondCourse = ownCourses.find(course=>course.code==='5B')!;
  const secondRow = ledger.rows.find(row=>row.course.code==='5B'&&row.student.id===secondCourse.students[0].id)!;
  assert.equal(secondRow.scores.find(item=>item.key===participationColumn.key)?.points,4);
  assert.equal(secondRow.scores.find(item=>item.key==='behavior:period')?.state,'not_applicable');
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
    levels: [{ label: 'Insuficiente', points: 1, description: 'Necesita apoyo.' }, { label: 'Suficiente', points: 2, description: 'Avance parcial.' }, { label: 'Bueno', points: 3, description: 'Logra el criterio.' }, { label: 'Excelente', points: 4, description: 'Lo logra con precisión.' }],
  }));
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'sequence', title: 'Rúbrica QA', date: '2026-10-26', maxPoints: 10, scoringMode: 'rubric', rubric });
  const criterionLevels = { 'criterion-1': 3, 'criterion-2': 2, 'criterion-3': 1, 'criterion-4': 0, 'criterion-5': 3 };
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId: course.students[0].id, score: null, criterionLevels }] });
  const stored = await service.grades(actor, activity.id);
  const row = stored.rows.find(r => r.studentId === course.students[0].id)!;
  assert.deepEqual(row.criterionLevels, criterionLevels);
  assert.equal(row.score, 7, '(4+3+2+1+4)/20 ×10 =7');
  const competency = (await service.report(actor, course.id, course.students[0].id)).competencies.find(item => item.key === 'logico_matematica')!;
  assert.equal(competency.points, 7);
  assert.equal(competency.possible, 10);
  const matrix = await service.competencySummary(actor, course.id);
  const summaryRow = matrix.rows.find(item => item.student.id === course.students[0].id)!;
  assert.equal(summaryRow.points, 7);
  assert.equal(summaryRow.possible, 10);
});

test('la rúbrica reparte los puntos entre competencias y el total suma cada criterio una sola vez', async () => {
  const { actor, course } = await caseContext('competency-rollup');
  const rubric: RubricCriterion[] = [
    { id: 'explain', label: 'Explica el procedimiento', competency: 'comunicativa', levels: [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points, description: `Descriptor ${points}` })) },
    { id: 'solve', label: 'Resuelve el problema', competency: 'logico_matematica', levels: [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points, description: `Descriptor ${points}` })) },
  ];
  const activity = await service.createActivity(actor, { courseId: course.id, category: 'sequence', title: 'Matriz de competencias QA', date: '2026-10-26', maxPoints: 10, scoringMode: 'rubric', sequenceCode: '2.1', evidence: 'Procedimiento y explicación', instrument: 'Rúbrica analítica', rubric });
  assert.equal(activity.sequenceCode, '2.1');
  assert.equal(activity.evidence, 'Procedimiento y explicación');
  const studentId = course.students[0].id;
  await service.saveGrades(actor, { requestId: randomUUID(), activityId: activity.id, revision: 0, rows: [{ studentId, score: null, criterionLevels: { explain: 3, solve: 1 } }] });
  const report = await service.report(actor, course.id, studentId);
  assert.equal(report.grades.find(item => item.activityId === activity.id)?.score, 7.5);
  assert.equal(report.competencies.find(item => item.key === 'comunicativa')?.points, 5);
  assert.equal(report.competencies.find(item => item.key === 'logico_matematica')?.points, 2.5);
  assert.equal(report.competencies.reduce((sum, item) => sum + item.points, 0), 7.5);
  const ledger=await service.teacherLedger(actor);
  const ledgerRow=ledger.rows.find(row=>row.student.id===studentId)!;
  const criterionColumns=ledger.groups.flatMap(group=>group.columns).filter(column=>column.key.startsWith(`activity:${activity.id}:criterion:`));
  assert.deepEqual(new Set(criterionColumns.map(column=>column.competency)),new Set(['comunicativa','logico_matematica']));
  const rubricScores=criterionColumns.map(column=>ledgerRow.scores.find(score=>score.key===column.key)!);
  assert.deepEqual(rubricScores.map(score=>score.points),[5,2.5]);
  assert.equal(ledgerRow.rawTotal,7.5);
});

test('el servidor impide guardar una rúbrica sin descriptores completos', async () => {
  const { actor, course } = await caseContext('rubric-descriptor-validation');
  const rubric: RubricCriterion[] = [{ id: 'reason', label: 'Razonamiento', levels: [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points })) }];
  await assert.rejects(service.createActivity(actor, { courseId: course.id, category: 'sequence', title: 'Rúbrica incompleta QA', date: '2026-10-26', maxPoints: 10, scoringMode: 'rubric', rubric }), isError(400));
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
  const rubric: RubricCriterion[] = ['one', 'two'].map(id => ({ id, label: id, levels: [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points, description: `Descriptor ${points}` })) }));
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
  assert.equal((await service.attendance(actor, course.id, '2027-02-02', 1)).session.status, 'no_programada');
});
