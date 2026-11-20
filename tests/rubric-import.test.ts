import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { createTestDatabase } from '../src/lib/db';
import { parseRubricWorkbook } from '../src/lib/rubric-import';
import { RegistroService } from '../src/lib/service';
import type { ImportedRubricCriterion } from '../src/lib/rubric-import';
import { AppError } from '../src/lib/model';

const expected = [
  { label: 'Insuficiente', points: 0, description: 'No identifica los vectores.' },
  { label: 'Suficiente', points: 1, description: 'Los identifica con apoyo.' },
  { label: 'Bueno', points: 2, description: 'Los clasifica con errores menores.' },
  { label: 'Excelente', points: 3, description: 'Los clasifica y justifica correctamente.' },
];

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

async function workbookBuffer({ hidden = true, missingLevel = false, sheetName = 'Criterios' } = {}) {
  const zip = new JSZip();
  const strings = [
    '#', 'CRITERIO', 'EXCELENTE', 'BUENO', 'SUFICIENTE', 'INSUFICIENTE',
    'Representa vectores & justifica.', ...expected.slice(0, missingLevel ? 3 : 4).map(level => level.description),
  ];
  const cells = (row: number, firstColumn: number, values: string[]) => values.map((_, index) => {
    const column = String.fromCharCode(65 + firstColumn + index);
    const stringIndex = strings.indexOf(values[index]);
    return `<c r="${column}${row}" t="s"><v>${stringIndex}</v></c>`;
  }).join('');
  const heading = cells(4, 0, strings.slice(0, 6));
  const data = cells(5, 0, ['1', 'Representa vectores & justifica.', expected[3].description, expected[2].description, expected[1].description, ...(missingLevel ? [] : [expected[0].description])]);
  const xmlShared = `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`;
  zip.file('xl/workbook.xml', `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1"${hidden ? ' state="veryHidden"' : ''} r:id="rId1"/></sheets></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', xmlShared);
  zip.file('xl/worksheets/sheet1.xml', `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="4">${heading}</row><row r="5">${data}</row></sheetData></worksheet>`);
  return zip.generateAsync({ type: 'uint8array' });
}

test('lee la rúbrica desde la hoja oculta Criterios y normaliza los cuatro niveles', async () => {
  const parsed = await parseRubricWorkbook(await workbookBuffer());
  assert.equal(parsed.sheetName, 'Criterios');
  assert.equal(parsed.sheetVisibility, 'veryHidden');
  assert.deepEqual(parsed.criteria[0], { label: 'Representa vectores & justifica.', levels: expected });
});

test('rechaza el libro si un criterio no tiene sus cuatro descriptores', async () => {
  await assert.rejects(parseRubricWorkbook(await workbookBuffer({ missingLevel: true })), /Falta el descriptor/);
});

test('no importa otra hoja por accidente cuando no existe Criterios', async () => {
  await assert.rejects(parseRubricWorkbook(await workbookBuffer({ sheetName: 'Actividades' })), /No encontré una hoja llamada/);
});

const root = path.resolve('.local');
const directory = path.join(root, `rubric-import-${randomUUID()}`);
let db: Awaited<ReturnType<typeof createTestDatabase>>;
let service: RegistroService;
const owner = `rubric-import-${randomUUID()}`;

before(async () => {
  await mkdir(directory, { recursive: true });
  db = await createTestDatabase(path.join(directory, 'database'));
  service = new RegistroService(db, { demo: true });
  await service.bootstrap(owner);
});

after(async () => {
  await db?.close();
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(root + path.sep));
  assert.ok(path.basename(resolved).startsWith('rubric-import-'));
  await rm(resolved, { recursive: true, force: true });
});

test('importa criterios en lote, reimporta sin duplicar y revierte el lote ante conflictos', async () => {
  const item: ImportedRubricCriterion = { label: 'Vector testado', levels: expected };
  const imported = await service.importEvaluationCriteria(owner, { criteria: [item] });
  assert.equal(imported.imported, 1);
  assert.equal(imported.unchanged, 0);
  assert.equal(imported.criteria[0].levels[0].description, expected[0].description);

  const repeated = await service.importEvaluationCriteria(owner, { criteria: [item] });
  assert.equal(repeated.imported, 0);
  assert.equal(repeated.unchanged, 1);

  const newItem: ImportedRubricCriterion = { label: 'Otro criterio de prueba', levels: expected };
  const conflictingItem: ImportedRubricCriterion = { ...item, levels: expected.map((level, index) => ({ ...level, description: index === 0 ? 'Distinto contenido.' : level.description })) };
  await assert.rejects(service.importEvaluationCriteria(owner, { criteria: [newItem, conflictingItem] }), (error: unknown) => error instanceof AppError && error.status === 409);
  const catalog = (await service.bootstrap(owner)).criteriaCatalog;
  assert.equal(catalog.some(row => row.label === newItem.label), false, 'el conflicto debe revertir también los elementos nuevos del lote');
  assert.equal(catalog.filter(row => row.label === item.label).length, 1);
});

test('actualiza los valores iniciales importados anteriormente de 1–4 a Insuficiente = 0 sin duplicar el criterio', async () => {
  const legacy = await service.saveEvaluationCriterion(owner, { label: 'Criterio importado anterior', levels: expected.map((level, index) => ({ ...level, points: index + 1 })) });
  const updated = await service.importEvaluationCriteria(owner, { criteria: [{ label: legacy.label, levels: expected }] });
  assert.equal(updated.imported, 1);
  assert.equal(updated.unchanged, 0);
  assert.equal(updated.criteria[0]?.id, legacy.id, 'la identidad del criterio permanece estable');
  assert.deepEqual(updated.criteria[0]?.levels.map(level => level.points), [0, 1, 2, 3]);
});
