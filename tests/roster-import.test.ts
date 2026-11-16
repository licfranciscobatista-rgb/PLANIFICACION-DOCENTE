import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createTestDatabase } from '../src/lib/db';
import { AppError } from '../src/lib/model';
import { parseRosterWorkbook } from '../src/lib/roster-import';
import { RegistroService } from '../src/lib/service';

function escapeXml(value: string) { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'); }

async function rosterWorkbook({ duplicateName = false } = {}) {
  const zip = new JSZip();
  const rows = {
    '5A': [['ID', 'Estudiante'], ['1', 'Ana Pérez'], ['2', duplicateName ? 'Ana Perez' : 'Luis Mateo']],
    '5B': [['ID', 'Estudiante'], ['1', 'Beatriz Díaz']],
    '5C': [['No.', 'Nombre'], ['1', 'Carlos Gil']],
  };
  const strings = [...new Set(Object.values(rows).flat(2))];
  const stringXml = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`;
  const sheetXml = Object.entries(rows).map(([name, values], sheetIndex) => {
    const sheetRows = values.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const column = String.fromCharCode(65 + columnIndex);
      return `<c r="${column}${rowIndex + 1}" t="s"><v>${strings.indexOf(value)}</v></c>`;
    }).join('')}</row>`).join('');
    zip.file(`xl/worksheets/sheet${sheetIndex + 1}.xml`, `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`);
    return `<sheet name="${name}" sheetId="${sheetIndex + 1}" state="hidden" r:id="rId${sheetIndex + 1}"/>`;
  }).join('');
  const relationships = Object.keys(rows).map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
  zip.file('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
  zip.file('xl/sharedStrings.xml', stringXml);
  return zip.generateAsync({ type: 'uint8array' });
}

test('lee las pestañas de cada curso y mantiene la identidad si cambia el orden de lista', async () => {
  const parsed = await parseRosterWorkbook(await rosterWorkbook(), ['5A', '5B', '5C']);
  assert.deepEqual(parsed.courses.map(course => [course.courseCode, course.rows.length]), [['5A', 2], ['5B', 1], ['5C', 1]]);
  const ana = parsed.courses[0].rows.find(row => row.name === 'Ana Pérez')!;
  const reordered = await parseRosterWorkbook(await rosterWorkbook(), ['5A', '5B', '5C']);
  const anaAgain = reordered.courses[0].rows.find(row => row.name === 'Ana Pérez')!;
  assert.equal(ana.externalId, anaAgain.externalId);
  assert.notEqual(ana.externalId, '5A-01', 'la posición no se usa como identidad');
});

test('rechaza hojas faltantes y nombres duplicados que no se pueden emparejar de forma segura', async () => {
  await assert.rejects(parseRosterWorkbook(await rosterWorkbook(), ['5A', '5B', '5D']), /No encontré una pestaña/);
  await assert.rejects(parseRosterWorkbook(await rosterWorkbook({ duplicateName: true }), ['5A', '5B', '5C']), /repite el nombre/);
});

const root = path.resolve('.local');
const directory = path.join(root, `roster-import-${randomUUID()}`);
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let service: RegistroService;
const owner = `roster-workbook-${randomUUID()}`;
const courses: { id: string; code: string }[] = [];

before(async () => {
  await mkdir(directory, { recursive: true });
  db = await createTestDatabase(path.join(directory, 'database'));
  service = new RegistroService(db, { today: () => '2026-11-15' });
  for (const code of ['5A', '5B', '5C']) {
    const created = await service.createCourse(owner, { code, name: `Matemática ${code}`, startDate: '2026-10-20', endDate: '2026-11-30', weekly: [{ weekday: 1, blocks: [1] }], noClassDates: [] });
    courses.push({ id: created.id, code });
  }
});

after(async () => {
  await db?.close();
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(root + path.sep));
  assert.ok(path.basename(resolved).startsWith('roster-import-'));
  await rm(resolved, { recursive: true, force: true });
});

test('importa las tres listas en una transacción, conserva las identidades al reordenar y retiene notas', async () => {
  const parsed = await parseRosterWorkbook(await rosterWorkbook(), ['5A', '5B', '5C']);
  const batches = parsed.courses.map(course => ({ courseId: courses.find(item => item.code === course.courseCode)!.id, rows: course.rows }));
  const preview = await service.previewRosterImport(owner, batches);
  assert.deepEqual(preview.conflicts, []);
  assert.deepEqual(preview.courses.map(course => [course.courseCode, course.added, course.updated]), [['5A', 2, 0], ['5B', 1, 0], ['5C', 1, 0]]);
  const saved = await service.importRosters(owner, batches);
  assert.equal(saved.students, 4);

  const fiveA = courses.find(course => course.code === '5A')!;
  const gradesBefore = await service.bootstrap(owner);
  const studentsBefore = gradesBefore.courses.find(course => course.id === fiveA.id)!.students;
  const ana = studentsBefore.find(student => student.name === 'Ana Pérez')!;
  const activity = await service.createActivity(owner, { courseId: fiveA.id, category: 'exam', title: 'Prueba de identidad', date: '2026-11-16', maxPoints: 10, requestId: 'roster-identity-activity' });
  const initialGrades = await service.grades(owner, activity.id);
  await service.saveGrades(owner, { activityId: activity.id, requestId: 'roster-identity-grade', revision: initialGrades.activity.revision, rows: initialGrades.rows.map(row => ({ studentId: row.studentId, score: row.studentId === ana.id ? 8 : null })) });

  const updatedRows = parsed.courses[0].rows.map(row => ({ ...row, number: row.name === 'Ana Pérez' ? 2 : 1 }));
  await service.importRosters(owner, [{ courseId: fiveA.id, rows: updatedRows }, ...batches.slice(1)]);
  const after = await service.bootstrap(owner);
  const studentsAfter = after.courses.find(course => course.id === fiveA.id)!.students;
  assert.equal(studentsAfter.find(student => student.name === 'Ana Pérez')!.id, ana.id);
  assert.equal(studentsAfter.find(student => student.name === 'Ana Pérez')!.number, 2);
  assert.equal(studentsAfter.find(student => student.name === 'Luis Mateo')!.number, 1);
  const persistedGrades = await service.grades(owner, activity.id);
  assert.equal(persistedGrades.rows.find(row => row.studentId === ana.id)?.score, 8);
});

test('un conflicto de identidad revierte las importaciones de todos los cursos', async () => {
  const before = await service.bootstrap(owner);
  const fiveB = courses.find(course => course.code === '5B')!;
  const fiveC = courses.find(course => course.code === '5C')!;
  const fiveBStudents = before.courses.find(course => course.id === fiveB.id)!.students;
  const conflict = await service.previewRosterImport(owner, [
    { courseId: fiveB.id, rows: [{ externalId: 'different-student', number: 1, name: 'Otra identidad' }] },
    { courseId: fiveC.id, rows: [{ externalId: 'new-student', number: 2, name: 'Estudiante nuevo' }] },
  ]);
  assert.ok(conflict.conflicts.some(item => item.courseCode === '5B'));
  await assert.rejects(service.importRosters(owner, [
    { courseId: fiveB.id, rows: [{ externalId: 'different-student', number: 1, name: 'Otra identidad' }] },
    { courseId: fiveC.id, rows: [{ externalId: 'new-student', number: 2, name: 'Estudiante nuevo' }] },
  ]), (error: unknown) => error instanceof AppError && error.status === 409);
  const after = await service.bootstrap(owner);
  assert.deepEqual(after.courses.find(course => course.id === fiveB.id)!.students.map(student => student.id), fiveBStudents.map(student => student.id));
  assert.equal(after.courses.find(course => course.id === fiveC.id)!.students.some(student => student.name === 'Estudiante nuevo'), false);
});
