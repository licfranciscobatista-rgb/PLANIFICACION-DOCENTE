import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { RubricLevel } from './model';

export interface ImportedRubricCriterion {
  label: string;
  levels: RubricLevel[];
}

export interface ImportedRubricWorkbook {
  sheetName: string;
  sheetVisibility: 'visible' | 'hidden' | 'veryHidden';
  criteria: ImportedRubricCriterion[];
}

const maxWorkbookBytes = 25 * 1024 * 1024;
const levelOrder = [
  { key: 'insuficiente', label: 'Insuficiente', points: 0 },
  { key: 'suficiente', label: 'Suficiente', points: 1 },
  { key: 'bueno', label: 'Bueno', points: 2 },
  { key: 'excelente', label: 'Excelente', points: 3 },
] as const;

function xml(source: string, part: string): Document {
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: () => undefined, fatalError: () => undefined } }).parseFromString(source, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !doc.documentElement) {
    throw new Error(`El archivo Excel tiene un XML inválido (${part}).`);
  }
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

function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
}

function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return index;
}

function cellText(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute('t');
  const valueNode = descendants(cell, 'v')[0];
  if (type === 's' && valueNode) {
    const index = Number(valueNode.textContent);
    return Number.isInteger(index) ? sharedStrings[index] ?? '' : '';
  }
  if (type === 'inlineStr') return descendants(cell, 't').map(node => node.textContent ?? '').join('');
  return valueNode?.textContent?.trim() ?? '';
}

export async function parseRubricWorkbook(input: ArrayBuffer | Uint8Array): Promise<ImportedRubricWorkbook> {
  const byteLength = input.byteLength;
  if (!byteLength) throw new Error('Selecciona un libro de Excel que no esté vacío.');
  if (byteLength > maxWorkbookBytes) throw new Error('El libro supera el límite de 25 MB para importar criterios.');

  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(input);
  } catch {
    throw new Error('No pude abrir el libro. Usa un archivo .xlsx o .xlsm sin contraseña.');
  }
  const workbookFile = archive.file('xl/workbook.xml');
  const relationshipsFile = archive.file('xl/_rels/workbook.xml.rels');
  if (!workbookFile || !relationshipsFile) throw new Error('El archivo no contiene una estructura de libro Excel compatible.');

  const [workbookText, relationshipsText, sharedStringsText] = await Promise.all([
    workbookFile.async('text'),
    relationshipsFile.async('text'),
    archive.file('xl/sharedStrings.xml')?.async('text') ?? Promise.resolve(''),
  ]);
  const workbook = xml(workbookText, 'workbook.xml');
  const relationships = xml(relationshipsText, 'workbook.xml.rels');
  const sharedStringsDoc = sharedStringsText ? xml(sharedStringsText, 'sharedStrings.xml') : null;
  const sharedStrings = sharedStringsDoc
    ? descendants(sharedStringsDoc, 'si').map(item => descendants(item, 't').map(text => text.textContent ?? '').join(''))
    : [];

  const targets = new Map(descendants(relationships, 'Relationship').map(item => [item.getAttribute('Id'), item.getAttribute('Target')]));
  const criteriaSheet = descendants(workbook, 'sheet').find(item => normalizeHeader(item.getAttribute('name') ?? '') === 'criterios');
  if (!criteriaSheet) throw new Error('No encontré una hoja llamada «Criterios» en el libro.');
  const relationshipId = criteriaSheet.getAttribute('r:id') || criteriaSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const target = relationshipId ? targets.get(relationshipId) : null;
  if (!target) throw new Error('No pude localizar la hoja «Criterios» dentro del libro.');
  const sheetPath = normalizeTarget(target);
  const sheetFile = archive.file(sheetPath);
  if (!sheetFile) throw new Error('El archivo anuncia una hoja «Criterios» que no está incluida.');
  const sheet = xml(await sheetFile.async('text'), sheetPath);

  const rows = new Map<number, Map<number, string>>();
  for (const row of descendants(sheet, 'row')) {
    const rowNumber = Number(row.getAttribute('r'));
    if (!Number.isInteger(rowNumber) || rowNumber < 1) continue;
    const cells = new Map<number, string>();
    for (const cell of descendants(row, 'c')) {
      const index = columnIndex(cell.getAttribute('r') ?? '');
      if (index) cells.set(index, cellText(cell, sharedStrings).trim());
    }
    rows.set(rowNumber, cells);
  }

  let headerRow = 0;
  let criterionColumn = 0;
  let levelColumns = new Map<string, number>();
  for (const [number, row] of rows) {
    const normalized = new Map([...row].map(([column, value]) => [column, normalizeHeader(value)]));
    const criterion = [...normalized].find(([, value]) => ['criterio', 'criterios', 'queseevalua'].includes(value));
    const levels = new Map(levelOrder.map(level => [level.key, [...normalized].find(([, value]) => value === level.key)?.[0] ?? 0]));
    if (criterion && [...levels.values()].every(Boolean)) {
      headerRow = number;
      criterionColumn = criterion[0];
      levelColumns = levels;
      break;
    }
  }
  if (!headerRow) throw new Error('La hoja «Criterios» necesita columnas para Criterio, Excelente, Bueno, Suficiente e Insuficiente.');

  const criteria: ImportedRubricCriterion[] = [];
  const labels = new Set<string>();
  for (const [number, row] of rows) {
    if (number <= headerRow) continue;
    const label = row.get(criterionColumn)?.trim() ?? '';
    if (!label) continue;
    if (label.length > 200) throw new Error(`El criterio de la fila ${number} supera los 200 caracteres.`);
    const key = normalizeHeader(label);
    if (labels.has(key)) throw new Error(`El criterio «${label}» aparece más de una vez en la hoja «Criterios».`);
    const levels = levelOrder.map(level => {
      const description = row.get(levelColumns.get(level.key) ?? 0)?.trim() ?? '';
      if (!description) throw new Error(`Falta el descriptor «${level.label}» para «${label}» (fila ${number}).`);
      if (description.length > 1000) throw new Error(`El descriptor «${level.label}» de «${label}» supera los 1000 caracteres.`);
      return { label: level.label, points: level.points, description };
    });
    labels.add(key);
    criteria.push({ label, levels });
    if (criteria.length > 50) throw new Error('La hoja contiene más de 50 criterios; divide la importación para revisarla con claridad.');
  }
  if (!criteria.length) throw new Error('La hoja «Criterios» no contiene criterios con sus cuatro descriptores.');

  const visibility = criteriaSheet.getAttribute('state');
  return {
    sheetName: criteriaSheet.getAttribute('name') ?? 'Criterios',
    sheetVisibility: visibility === 'hidden' || visibility === 'veryHidden' ? visibility : 'visible',
    criteria,
  };
}
