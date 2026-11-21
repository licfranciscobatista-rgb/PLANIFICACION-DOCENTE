import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { AttendanceMark } from './model';

const maxWorkbookBytes = 25 * 1024 * 1024;
const maxRows = 50_000;

export interface AttendanceImportColumn {
  index: number;
  letter: string;
  header: string;
  field: 'course' | 'date' | 'block' | 'studentId' | 'studentNumber' | 'studentName' | 'status' | null;
}

export interface AttendanceImportSheet {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  headerRow: number;
  rowCount: number;
  columns: AttendanceImportColumn[];
  format: 'row_table' | 'attendance_matrix';
  confidence: 'high' | 'review';
  courseCode?: string;
  sessionCount?: number;
}

export interface ParsedAttendanceRecord {
  sourceSheet: string;
  sourceRow: number;
  sourceCourse: string;
  sourceStudentId: string;
  sourceStudentNumber: number | null;
  sourceStudentName: string;
  date: string | null;
  block: number | null;
  status: AttendanceMark;
  issues: string[];
}

interface SheetXml {
  name: string;
  state: 'visible' | 'hidden' | 'veryHidden';
  rows: Map<number, Map<number, string>>;
}

interface MatrixSession { column: number; date: string; block: number }
interface AttendanceMatrixLayout {
  sheet: AttendanceImportSheet;
  dateRow: number;
  blockRow: number;
  studentColumn: number;
  studentNumberColumn: number | null;
  courseCode: string;
  sessions: MatrixSession[];
  studentRows: number[];
}

function xml(source: string, name: string): Document {
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined, fatalError: () => undefined } }).parseFromString(source, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagName('parsererror').length) throw new Error(`El archivo tiene una hoja inválida (${name}).`);
  return doc;
}

function descendants(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagName('*')).filter(element => element.localName === localName);
}

function normalizeTarget(target: string): string {
  const absolute = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];
  for (const part of absolute.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index;
}

function columnLetter(index: number): string {
  let number = index, result = '';
  while (number > 0) {
    const digit = (number - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const aliases: Record<Exclude<AttendanceImportColumn['field'], null>, string[]> = {
  course: ['curso', 'codigo curso', 'codigo del curso', 'seccion', 'seccion curso', 'course'],
  date: ['fecha', 'fecha de clase', 'fecha de asistencia', 'date', 'class date'],
  block: ['bloque', 'bloque horario', 'hora clase', 'numero de bloque', 'block'],
  studentId: ['matricula', 'id estudiante', 'id del estudiante', 'codigo estudiante', 'identificador estudiante', 'student id'],
  studentNumber: ['id', 'no', 'n', 'numero', 'numero de lista', 'no lista', 'listado', 'orden'],
  studentName: ['estudiante', 'nombre', 'nombre estudiante', 'nombre del estudiante', 'alumno', 'alumna', 'alumnos', 'student', 'student name'],
  status: ['asistencia', 'marca', 'estado asistencia', 'presencia', 'attendance', 'mark'],
};

function fieldForHeader(value: string): AttendanceImportColumn['field'] {
  const header = normalize(value);
  for (const [field, values] of Object.entries(aliases) as [Exclude<AttendanceImportColumn['field'], null>, string[]][]) {
    if (values.includes(header)) return field;
  }
  return null;
}

async function readWorkbook(input: ArrayBuffer | Uint8Array): Promise<{ sheets: SheetXml[]; date1904: boolean }> {
  if (!input.byteLength) throw new Error('Selecciona un libro de Excel que no esté vacío.');
  if (input.byteLength > maxWorkbookBytes) throw new Error('El libro supera el límite de 25 MB.');
  let archive: JSZip;
  try { archive = await JSZip.loadAsync(input); }
  catch { throw new Error('No pude abrir el libro. Usa un archivo .xlsx o .xlsm sin contraseña.'); }
  const workbookFile = archive.file('xl/workbook.xml');
  const relationshipsFile = archive.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !relationshipsFile) throw new Error('El archivo no contiene una estructura de libro Excel compatible.');
  const [workbookText, relationshipsText, sharedStringsText] = await Promise.all([
    workbookFile.async('text'), relationshipsFile.async('text'), archive.file('xl/sharedStrings.xml')?.async('text') ?? Promise.resolve(''),
  ]);
  const workbook = xml(workbookText, 'workbook.xml');
  const relationships = xml(relationshipsText, 'workbook.xml.rels');
  const sharedDoc = sharedStringsText ? xml(sharedStringsText, 'sharedStrings.xml') : null;
  const sharedStrings = sharedDoc ? descendants(sharedDoc, 'si').map(item => descendants(item, 't').map(text => text.textContent ?? '').join('')) : [];
  const targets = new Map(descendants(relationships, 'Relationship').map(item => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const date1904 = descendants(workbook, 'workbookPr')[0]?.getAttribute('date1904') === '1';
  const sheets: SheetXml[] = [];
  for (const item of descendants(workbook, 'sheet')) {
    const name = item.getAttribute('name') ?? '';
    const stateValue = item.getAttribute('state');
    const state: SheetXml['state'] = stateValue === 'veryHidden' ? 'veryHidden' : stateValue === 'hidden' ? 'hidden' : 'visible';
    const relationshipId = item.getAttribute('r:id') || item.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relationshipId ? targets.get(relationshipId) : null;
    if (!name || !target) continue;
    const path = normalizeTarget(target);
    const sheetFile = archive.file(path);
    if (!sheetFile) continue;
    const doc = xml(await sheetFile.async('text'), path);
    const rows = new Map<number, Map<number, string>>();
    for (const row of descendants(doc, 'row')) {
      const rowNumber = Number(row.getAttribute('r'));
      if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
      const cells = new Map<number, string>();
      for (const cell of descendants(row, 'c')) {
        const column = columnIndex(cell.getAttribute('r') ?? '');
        if (!column) continue;
        const value = descendants(cell, 'v')[0]?.textContent?.trim() ?? '';
        const type = cell.getAttribute('t');
        const text = type === 's' && value ? sharedStrings[Number(value)] ?? '' : type === 'inlineStr' ? descendants(cell, 't').map(textNode => textNode.textContent ?? '').join('') : value;
        cells.set(column, text.trim());
      }
      if (cells.size) rows.set(rowNumber, cells);
      if (rows.size > maxRows) throw new Error(`La hoja «${name}» supera el límite de ${maxRows} filas con contenido.`);
    }
    sheets.push({ name, state, rows });
  }
  return { sheets, date1904 };
}

function detectHeader(sheet: SheetXml): AttendanceImportSheet | null {
  const candidates: { row: number; columns: AttendanceImportColumn[]; score: number }[] = [];
  for (const [rowNumber, cells] of sheet.rows) {
    const columns = [...cells].map(([index, header]) => ({ index, letter: columnLetter(index), header, field: fieldForHeader(header) }));
    const fields = new Set(columns.map(column => column.field).filter(Boolean));
    const hasStudent = fields.has('studentName') || fields.has('studentId');
    if (!fields.has('date') || !fields.has('status') || !hasStudent) continue;
    const score = Number(fields.has('date')) * 3 + Number(fields.has('status')) * 3 + Number(fields.has('studentName')) * 2 + Number(fields.has('studentId')) * 2 + Number(fields.has('course')) + Number(fields.has('block'));
    candidates.push({ row: rowNumber, columns, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.row - b.row);
  const selected = candidates[0];
  if (!selected) return null;
  const headerColumns = selected.columns.filter(column => column.field !== null);
  const duplicateFields = new Set<string>();
  const seen = new Set<string>();
  for (const column of headerColumns) {
    if (seen.has(column.field!)) duplicateFields.add(column.field!);
    seen.add(column.field!);
  }
  if (duplicateFields.size) return null;
  const rowCount = [...sheet.rows.keys()].filter(row => row > selected.row && sheet.rows.get(row)?.size).length;
  const confidence = selected.score >= 9 && Boolean(seen.has('studentName')) ? 'high' : 'review';
  return { name: sheet.name, state: sheet.state, headerRow: selected.row, rowCount, columns: headerColumns, format: 'row_table', confidence };
}

function findAttendanceMatrix(sheet: SheetXml, date1904: boolean): AttendanceMatrixLayout | null {
  const rows = [...sheet.rows.entries()].sort(([a], [b]) => a - b);
  for (const [headerRow, headerCells] of rows) {
    const nameEntry = [...headerCells].find(([, value]) => fieldForHeader(value) === 'studentName');
    if (!nameEntry) continue;
    const [studentColumn] = nameEntry;
    const studentNumberColumn = [...headerCells].find(([, value]) => fieldForHeader(value) === 'studentNumber')?.[0] ?? null;
    const dateEntry = rows.find(([rowNumber, cells]) => rowNumber < headerRow && normalize(cells.get(1) ?? '') === 'fecha');
    const blockEntry = rows.find(([rowNumber, cells]) => rowNumber < headerRow && normalize(cells.get(1) ?? '') === 'bloque');
    if (!dateEntry || !blockEntry) continue;
    const [dateRow, dateCells] = dateEntry;
    const [blockRow, blockCells] = blockEntry;
    const sessions: MatrixSession[] = [];
    for (const [column, rawDate] of dateCells) {
      if (column <= studentColumn) continue;
      const date = parseDate(rawDate, date1904);
      const rawBlock = blockCells.get(column) ?? '';
      const block = Number(rawBlock);
      if (date && Number.isInteger(block) && block >= 1 && block <= 12) sessions.push({ column, date, block });
    }
    if (!sessions.length) continue;
    const studentRows = rows
      .filter(([rowNumber, cells]) => rowNumber > headerRow && Boolean(cells.get(studentColumn)?.trim()))
      .map(([rowNumber]) => rowNumber);
    if (!studentRows.length) continue;

    let courseCode = '';
    for (const [rowNumber, cells] of rows) {
      if (rowNumber >= headerRow) break;
      const courseColumn = [...cells].find(([, value]) => normalize(value) === 'curso')?.[0];
      if (courseColumn === undefined) continue;
      courseCode = [...cells].find(([column, value]) => column > courseColumn && Boolean(value.trim()))?.[1] ?? '';
      if (courseCode) break;
    }
    if (!courseCode && /^\s*\d+\s*[A-Z]\s*$/i.test(sheet.name)) courseCode = sheet.name.replace(/\s+/g, '').toLocaleUpperCase();
    const visibleColumns: AttendanceImportColumn[] = [{ index: studentColumn, letter: columnLetter(studentColumn), header: nameEntry[1], field: 'studentName' }];
    if (studentNumberColumn !== null) visibleColumns.unshift({ index: studentNumberColumn, letter: columnLetter(studentNumberColumn), header: headerCells.get(studentNumberColumn) ?? 'No.', field: 'studentNumber' });
    return {
      sheet: {
        name: sheet.name, state: sheet.state, headerRow, rowCount: studentRows.length,
        columns: visibleColumns, format: 'attendance_matrix', confidence: courseCode ? 'high' : 'review',
        ...(courseCode ? { courseCode } : {}), sessionCount: sessions.length,
      },
      dateRow, blockRow, studentColumn, studentNumberColumn, courseCode, sessions, studentRows,
    };
  }
  return null;
}

export async function inspectAttendanceWorkbook(input: ArrayBuffer | Uint8Array): Promise<AttendanceImportSheet[]> {
  const { sheets, date1904 } = await readWorkbook(input);
  const candidates = sheets.map(sheet => detectHeader(sheet) ?? findAttendanceMatrix(sheet, date1904)?.sheet ?? null).filter((item): item is AttendanceImportSheet => Boolean(item));
  if (!candidates.length) throw new Error('No encontré una tabla donde cada fila tenga estudiante, fecha y marca de asistencia. Si tu libro usa días como columnas, primero hay que mapear ese formato.');
  return candidates;
}

function parseDate(value: string, date1904: boolean): string | null {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return validDate(trimmed) ? trimmed : null;
  const isoDateTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoDateTime) return validDate(isoDateTime[1]!) ? isoDateTime[1]! : null;
  const slash = trimmed.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (slash) {
    const first = Number(slash[1]), second = Number(slash[2]);
    if (first > 12 && second > 12) return null;
    if (first <= 12 && second <= 12 && first !== second) return null;
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : first;
    if (month === null) return null;
    let year = Number(slash[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return validDate(iso) ? iso : null;
  }
  const serial = Number(trimmed);
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86400000);
  const iso = date.toISOString().slice(0, 10);
  return validDate(iso) ? iso : null;
}

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseMark(value: string): AttendanceMark | 'invalid' | null {
  const raw = value.trim().toLocaleLowerCase();
  if (['✓', '✔', '☑'].includes(raw)) return 'P';
  const normalized = normalize(value);
  if (!normalized) return null;
  if (['p', 'presente', 'presencia', 'asistio', 'si', 'x', 'pres'].includes(normalized)) return 'P';
  if (['a', 'ausente', 'ausencia', 'falto', 'no', 'aus'].includes(normalized)) return 'A';
  if (['t', 'tardanza', 'tarde', 'tardio', 'llego tarde', 'llegada tarde'].includes(normalized)) return 'T';
  if (['e', 'excusa', 'excusado', 'justificada', 'justificado', 'exc'].includes(normalized)) return 'E';
  if (['r', 'retiro', 'retirado', 'retiro voluntario'].includes(normalized)) return 'R';
  return 'invalid';
}

export async function parseAttendanceWorkbookSheet(input: ArrayBuffer | Uint8Array, sheetName: string): Promise<{ sheet: AttendanceImportSheet; records: ParsedAttendanceRecord[] }> {
  const { sheets, date1904 } = await readWorkbook(input);
  const source = sheets.find(item => item.name === sheetName);
  if (!source) throw new Error('La pestaña seleccionada no aparece en el libro que se está importando.');
  const matrix = findAttendanceMatrix(source, date1904);
  if (matrix) {
    const records: ParsedAttendanceRecord[] = [];
    for (const sourceRow of matrix.studentRows) {
      const cells = source.rows.get(sourceRow)!;
      const sourceStudentName = cells.get(matrix.studentColumn)?.trim() ?? '';
      const rawNumber = matrix.studentNumberColumn === null ? '' : cells.get(matrix.studentNumberColumn)?.trim() ?? '';
      const parsedNumber = Number(rawNumber);
      for (const session of matrix.sessions) {
        const mark = parseMark(cells.get(session.column) ?? '');
        const issues: string[] = [];
        if (mark === 'invalid') issues.push('marca_no_reconocida');
        if (mark === null) issues.push('sin_marca');
        records.push({
          sourceSheet: source.name, sourceRow, sourceCourse: matrix.courseCode,
          sourceStudentId: '', sourceStudentNumber: Number.isInteger(parsedNumber) && parsedNumber > 0 ? parsedNumber : null,
          sourceStudentName, date: session.date, block: session.block,
          status: mark === 'invalid' || mark === null ? null : mark, issues,
        });
      }
    }
    return { sheet: matrix.sheet, records };
  }
  const sheet = detectHeader(source);
  if (!sheet) throw new Error(`No pude reconocer una tabla de asistencia en «${sheetName}».`);
  const fieldColumns = new Map(sheet.columns.map(column => [column.field!, column.index]));
  const records: ParsedAttendanceRecord[] = [];
  for (const [sourceRow, cells] of source.rows) {
    if (sourceRow <= sheet.headerRow) continue;
    const value = (field: AttendanceImportColumn['field']) => {
      const column = field ? fieldColumns.get(field) : undefined;
      return column ? cells.get(column)?.trim() ?? '' : '';
    };
    const sourceStudentName = value('studentName');
    const sourceStudentId = value('studentId');
    const sourceStudentNumber = Number(value('studentNumber'));
    const sourceCourse = value('course');
    const dateRaw = value('date');
    const blockRaw = value('block');
    const mark = parseMark(value('status'));
    if (!sourceStudentName && !sourceStudentId && !sourceCourse && !dateRaw && !blockRaw && !value('status')) continue;
    const issues: string[] = [];
    const date = parseDate(dateRaw, date1904);
    if (!date) issues.push(dateRaw ? 'fecha_ambigua_o_invalida' : 'fecha_vacia');
    const parsedBlock = blockRaw ? Number(blockRaw) : null;
    const block = parsedBlock !== null && Number.isInteger(parsedBlock) && parsedBlock >= 1 && parsedBlock <= 12 ? parsedBlock : null;
    if (blockRaw && block === null) issues.push('bloque_invalido');
    if (!sourceStudentName && !sourceStudentId) issues.push('sin_identidad_estudiante');
    if (mark === 'invalid') issues.push('marca_no_reconocida');
    if (mark === null) issues.push('sin_marca');
    records.push({
      sourceSheet: source.name, sourceRow, sourceCourse,
      sourceStudentId, sourceStudentNumber: Number.isInteger(sourceStudentNumber) && sourceStudentNumber > 0 ? sourceStudentNumber : null,
      sourceStudentName, date, block, status: mark === 'invalid' || mark === null ? null : mark, issues,
    });
  }
  return { sheet, records };
}

export function normalizeAttendanceImportText(value: string): string { return normalize(value); }
