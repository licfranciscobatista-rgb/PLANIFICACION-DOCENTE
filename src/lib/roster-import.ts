import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { RosterRow } from './model';

export interface ImportedCourseRoster {
  courseCode: string;
  sheetName: string;
  rows: RosterRow[];
}

export interface ImportedRosterWorkbook {
  courses: ImportedCourseRoster[];
}

const maxWorkbookBytes = 25 * 1024 * 1024;

function xml(source: string, part: string): Document {
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined, fatalError: () => undefined } }).parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) throw new Error(`El archivo Excel tiene un XML inválido (${part}).`);
  return doc;
}

function descendants(node: Document | Element, localName: string): Element[] {
  return Array.from(node.getElementsByTagName('*')).filter(element => element.localName === localName);
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function courseSheetAliases(courseCode: string): Set<string> {
  const compact = normalize(courseCode).replace(/\s+/g, '');
  const aliases = new Set([compact]);
  const fifthGrade = compact.match(/^5([a-z])$/);
  if (fifthGrade) {
    aliases.add(`quinto${fifthGrade[1]}`);
    aliases.add(`5to${fifthGrade[1]}`);
  }
  return aliases;
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

function cellText(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t');
  const value = descendants(cell, 'v')[0];
  if (type === 's' && value) {
    const index = Number(value.textContent);
    return Number.isInteger(index) ? sharedStrings[index] ?? '' : '';
  }
  if (type === 'inlineStr') return descendants(cell, 't').map(node => node.textContent ?? '').join('');
  return value?.textContent?.trim() ?? '';
}

function stableStudentId(courseCode: string, name: string): string {
  const canonical = normalize(name);
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 24);
  return `workbook-${courseCode.toLocaleUpperCase()}-${digest}`;
}

export async function parseRosterWorkbook(input: ArrayBuffer | Uint8Array, courseCodes: string[]): Promise<ImportedRosterWorkbook> {
  if (!input.byteLength) throw new Error('Selecciona un libro de Excel que no esté vacío.');
  if (input.byteLength > maxWorkbookBytes) throw new Error('El libro supera el límite de 25 MB para importar nóminas.');
  if (!courseCodes.length || courseCodes.length > 20 || courseCodes.some(code => !/^[\p{L}\p{N}_-]{1,12}$/u.test(code)) || new Set(courseCodes.map(code => code.toLocaleUpperCase())).size !== courseCodes.length) {
    throw new Error('No pude determinar los códigos de los cursos que deben recibir la nómina.');
  }

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
  const sharedStringsDoc = sharedStringsText ? xml(sharedStringsText, 'sharedStrings.xml') : null;
  const sharedStrings = sharedStringsDoc ? descendants(sharedStringsDoc, 'si').map(item => descendants(item, 't').map(text => text.textContent ?? '').join('')) : [];
  const targets = new Map(descendants(relationships, 'Relationship').map(item => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const sheets = descendants(workbook, 'sheet');

  const imported: ImportedCourseRoster[] = [];
  for (const requestedCode of courseCodes) {
    const code = requestedCode.toLocaleUpperCase();
    const aliases = courseSheetAliases(code);
    const matches = sheets.filter(item => aliases.has(normalize(item.getAttribute('name') ?? '').replace(/\s+/g, '')));
    if (!matches.length) throw new Error(`No encontré una pestaña llamada «${code}» en el libro.`);
    if (matches.length > 1) throw new Error(`Encontré varias pestañas que podrían corresponder a «${code}». Deja solo una con datos de ese curso.`);
    const sheet = matches[0]!;
    const relationshipId = sheet.getAttribute('r:id') || sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const target = relationshipId ? targets.get(relationshipId) : null;
    if (!target) throw new Error(`No pude localizar la pestaña «${code}» dentro del libro.`);
    const path = normalizeTarget(target);
    const file = archive.file(path);
    if (!file) throw new Error(`El archivo anuncia una pestaña «${code}» que no está incluida.`);
    const sheetDoc = xml(await file.async('text'), path);
    const rows = new Map<number, Map<number, string>>();
    for (const row of descendants(sheetDoc, 'row')) {
      const rowNumber = Number(row.getAttribute('r'));
      if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
      const cells = new Map<number, string>();
      for (const cell of descendants(row, 'c')) {
        const column = columnIndex(cell.getAttribute('r') ?? '');
        if (column) cells.set(column, cellText(cell, sharedStrings).trim());
      }
      rows.set(rowNumber, cells);
    }

    let headerRow = 0, numberColumn = 0, nameColumn = 0;
    for (const [rowNumber, row] of rows) {
      const headers = new Map([...row].map(([column, value]) => [normalize(value).replace(/ /g, ''), column]));
      const number = ['id', 'no', 'numero', 'numerodelista'].map(key => headers.get(key)).find(Boolean) ?? 0;
      const name = ['estudiante', 'estudiantes', 'alumno', 'alumnos', 'nombre', 'nombrecompleto'].map(key => headers.get(key)).find(Boolean) ?? 0;
      if (number && name) { headerRow = rowNumber; numberColumn = number; nameColumn = name; break; }
    }
    if (!headerRow) throw new Error(`La pestaña «${code}» necesita encabezados de número/ID y estudiante/nombre.`);

    const roster: RosterRow[] = [];
    const ids = new Set<string>(), numbers = new Set<number>();
    let previousRowNumber = headerRow;
    for (const [rowNumber, row] of [...rows].sort((a, b) => a[0] - b[0])) {
      if (rowNumber <= headerRow) continue;
      // Roster workbooks often contain another table (grades, attendance, or
      // notes) below the class list. The first blank row separates those tables.
      if (roster.length && rowNumber > previousRowNumber + 1) break;
      previousRowNumber = rowNumber;
      const numberText = row.get(numberColumn)?.trim() ?? '';
      const name = row.get(nameColumn)?.trim() ?? '';
      if (!numberText && !name) {
        if (roster.length) break;
        continue;
      }
      if (!numberText && name && roster.length) break;
      // Excel teachers often put notes beneath the roster using the same columns.
      // Only rows whose ID cell is numeric can represent a numbered student.
      if (!/^\d+(?:\.0+)?$/.test(numberText)) {
        if (roster.length && numberText) break;
        continue;
      }
      const number = Number(numberText);
      if (!Number.isInteger(number) || number < 1 || number > 9999) throw new Error(`La pestaña «${code}», fila ${rowNumber}: el número de lista debe ser un entero de 1 a 9999.`);
      if (!name || name.length > 180) throw new Error(`La pestaña «${code}», fila ${rowNumber}: escribe un nombre de 1 a 180 caracteres.`);
      const externalId = stableStudentId(code, name);
      if (ids.has(externalId)) throw new Error(`La pestaña «${code}» repite el nombre «${name}». Asigna identificadores oficiales distintos antes de importar personas con nombres iguales.`);
      if (numbers.has(number)) throw new Error(`La pestaña «${code}» repite el número de lista ${number}.`);
      ids.add(externalId); numbers.add(number);
      roster.push({ externalId, number, name });
      if (roster.length > 250) throw new Error(`La pestaña «${code}» supera el límite de 250 estudiantes.`);
    }
    if (!roster.length) throw new Error(`La pestaña «${code}» no contiene estudiantes.`);
    imported.push({ courseCode: code, sheetName: sheet.getAttribute('name') ?? code, rows: roster });
  }
  return { courses: imported };
}
