import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { AccessError, demoMode, requireOwner } from '@/lib/auth';
import { getDatabase } from '@/lib/db';
import { inspectAttendanceWorkbook, normalizeAttendanceImportText, parseAttendanceWorkbookSheet, type ParsedAttendanceRecord } from '@/lib/attendance-import';
import { AppError, PERIOD_START } from '@/lib/model';
import { RegistroService } from '@/lib/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const maxWorkbookBytes = 25 * 1024 * 1024;

type Issue = { sheet: string; row: number; student: string; code: string; message: string; severity: 'review' | 'blocked' };

function fail(error: unknown) {
  if (error instanceof AccessError || error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  console.error('Registro: fallo al revisar asistencia importada', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({ error: 'No se pudo revisar el Excel. El archivo original y la asistencia guardada permanecen intactos.' }, { status: 500, headers });
}

function serviceOptions() {
  return { demo: demoMode, ...(demoMode && process.env.DEMO_TODAY ? { today: () => process.env.DEMO_TODAY! } : {}), ...(demoMode && process.env.DEMO_NOTE ? { demoNote: process.env.DEMO_NOTE } : {}) };
}

function safeFileName(value: string) {
  const name = value.split(/[\\/]/).at(-1)?.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() ?? 'asistencia.xlsx';
  return (name || 'asistencia.xlsx').slice(0, 200);
}

function markIssue(record: ParsedAttendanceRecord, code: string, message: string, severity: Issue['severity'] = 'blocked'): Issue {
  return { sheet: record.sourceSheet, row: record.sourceRow, student: record.sourceStudentName || record.sourceStudentId, code, message, severity };
}

function issueText(code: string): string {
  return ({
    fecha_ambigua_o_invalida: 'La fecha está incompleta, es ambigua o no es válida.',
    fecha_vacia: 'Falta la fecha; no voy a inferirla.',
    bloque_invalido: 'El bloque debe ser un número del 1 al 12.',
    sin_identidad_estudiante: 'Falta un nombre o matrícula para identificar al estudiante.',
    marca_no_reconocida: 'La marca no coincide con P, A, T, E o R; debe revisarse.',
  } as Record<string,string>)[code] ?? 'La fila necesita revisión.';
}

function sourceCourseKey(value: string) { return normalizeAttendanceImportText(value).replace(/\s+/g, ''); }

async function makePreview(input: {
  service: RegistroService; owner: string; bytes: Uint8Array; fileName: string; sheetName: string;
  defaultCourseId: string; defaultBlock: number | null;
}) {
  const { service, owner, bytes, fileName, sheetName, defaultCourseId, defaultBlock } = input;
  const bootstrap = await service.bootstrap(owner);
  const today = bootstrap.today;
  const source = await parseAttendanceWorkbookSheet(bytes, sheetName);
  const courseByCode = new Map(bootstrap.courses.map(course => [sourceCourseKey(course.code), course]));
  const selectedCourse = bootstrap.courses.find(course => course.id === defaultCourseId) ?? null;
  const issues: Issue[] = [];
  const duplicates = { identical: 0, conflicting: 0, blank: 0, otherCourseRows: 0 };
  const candidateByKey = new Map<string, { record: ParsedAttendanceRecord; value: { courseId: string; date: string; block: number; studentId: string; status: 'P'|'A'|'T'|'E'|'R'; sourceSheet: string; sourceRow: number; sourceStudentName: string; sourceStudentNumber: number|null } }>();
  const duplicateConflicts = new Set<string>();

  for (const record of source.records) {
    if (record.issues.includes('sin_marca')) { duplicates.blank++; continue; }
    const parserIssues = record.issues.filter(code => code !== 'sin_marca');
    if (parserIssues.length) {
      for (const code of parserIssues) issues.push(markIssue(record, code, issueText(code)));
      continue;
    }
    let course = record.sourceCourse ? courseByCode.get(sourceCourseKey(record.sourceCourse)) ?? null : selectedCourse;
    if (!course) {
      const sourceCode = record.sourceCourse || '(sin curso)';
      issues.push(markIssue(record, 'curso_no_vinculado', `No pude relacionar «${sourceCode}» con un curso de la app. La fila no se importará.`));
      continue;
    }
    if (record.sourceCourse && selectedCourse && course.id !== selectedCourse.id) duplicates.otherCourseRows++;
    if (!record.date || !record.status) continue;
    if (record.date < PERIOD_START) { issues.push(markIssue(record, 'fuera_del_registro', `La app registra asistencia desde ${PERIOD_START}.`)); continue; }
    if (record.date > today) { issues.push(markIssue(record, 'fecha_futura', 'La fecha todavía no ha ocurrido; no se importó.')); continue; }
    const block = record.block ?? defaultBlock;
    if (!block || !Number.isInteger(block) || block < 1 || block > 12) { issues.push(markIssue(record, 'bloque_sin_confirmar', 'El bloque no aparece en esta fila. Selecciona explícitamente el bloque antes de importar.')); continue; }

    const students = course.students;
    const stableIdMatch = record.sourceStudentId ? students.find(student => student.externalId === record.sourceStudentId) : undefined;
    const normalizedName = normalizeAttendanceImportText(record.sourceStudentName);
    const nameMatches = normalizedName ? students.filter(student => normalizeAttendanceImportText(student.name) === normalizedName) : [];
    if (stableIdMatch && nameMatches.length === 1 && stableIdMatch.id !== nameMatches[0]!.id) {
      issues.push(markIssue(record, 'identidad_en_conflicto', 'La matrícula y el nombre apuntan a estudiantes distintos. No se importó esta fila.'));
      continue;
    }
    let student = stableIdMatch ?? (nameMatches.length === 1 ? nameMatches[0] : undefined);
    if (!student) {
      const message = nameMatches.length > 1 ? 'Hay nombres idénticos en el curso; el Excel no permite distinguir cuál estudiante es.' : 'El estudiante no coincide exactamente con una identidad de este curso.';
      issues.push(markIssue(record, nameMatches.length > 1 ? 'nombre_ambiguo' : 'estudiante_no_vinculado', message));
      continue;
    }
    if (record.sourceStudentNumber !== null && record.sourceStudentNumber !== student.number) {
      issues.push(markIssue(record, 'numero_de_lista_distinto', `Se vinculó por nombre exacto, no por número. Excel: ${record.sourceStudentNumber}; app: ${student.number}.`, 'review'));
    }
    const key = `${course.id}:${record.date}:${block}:${student.id}`;
    const value = { courseId: course.id, date: record.date, block, studentId: student.id, status: record.status, sourceSheet: record.sourceSheet, sourceRow: record.sourceRow, sourceStudentName: record.sourceStudentName, sourceStudentNumber: record.sourceStudentNumber };
    const prior = candidateByKey.get(key);
    if (!prior) candidateByKey.set(key, { record, value });
    else if (prior.value.status === value.status) {
      duplicates.identical++;
      issues.push(markIssue(record, 'duplicado_igual', `La marca coincide con la fila ${prior.record.sourceRow}; se contará una sola vez.`, 'review'));
    } else {
      duplicateConflicts.add(key);
      duplicates.conflicting++;
      issues.push(markIssue(prior.record, 'duplicado_conflictivo', `La fila ${record.sourceRow} tiene otra marca para el mismo estudiante, fecha y bloque; ambas quedan fuera hasta corregir el Excel.`));
      issues.push(markIssue(record, 'duplicado_conflictivo', `La fila ${prior.record.sourceRow} tiene otra marca para el mismo estudiante, fecha y bloque; ambas quedan fuera hasta corregir el Excel.`));
    }
  }
  for (const key of duplicateConflicts) candidateByKey.delete(key);
  const rows = [...candidateByKey.values()].map(item => item.value);
  const rowGroups = new Map<string, { courseId:string; courseCode:string; date:string; block:number; students:Set<string> }>();
  for (const row of rows) {
    const course=bootstrap.courses.find(item=>item.id===row.courseId)!;
    const key=`${row.courseId}:${row.date}:${row.block}`;
    const group=rowGroups.get(key)??{courseId:row.courseId,courseCode:course.code,date:row.date,block:row.block,students:new Set<string>()};
    group.students.add(row.studentId);rowGroups.set(key,group);
  }
  for (const group of rowGroups.values()) {
    const course=bootstrap.courses.find(item=>item.id===group.courseId)!;
    if (group.students.size<course.students.length) {
      const missing=course.students.length-group.students.size;
      issues.push({sheet:sheetName,row:0,student:'',code:'sesion_incompleta',severity:'review',message:`${group.courseCode} · ${group.date} · bloque ${group.block}: hay marcas para ${group.students.size} de ${course.students.length} estudiantes. Los ${missing} restantes quedarán pendientes; no se convertirán en ausencias.`});
    }
  }
  const sourceFingerprint = createHash('sha256').update(bytes).digest('hex');
  const fileSummary = { sourceSheet: sheetName, sourceRows: source.records.length, blankRows: duplicates.blank, duplicateRows: duplicates.identical, conflictingDuplicates: duplicates.conflicting, otherCourseRows: duplicates.otherCourseRows, incompleteSessions: [...rowGroups.values()].filter(group=>group.students.size<(bootstrap.courses.find(course=>course.id===group.courseId)?.students.length??0)).length, blockedRows: issues.filter(issue => issue.severity === 'blocked').length, reviewRows: issues.filter(issue => issue.severity === 'review').length };
  const review = rows.length ? await service.previewAttendanceImport(owner, { fileName, sourceFingerprint, rows }) : null;
  return { fileName, sourceFingerprint, sheet: source.sheet, fileSummary, issues, review };
}

export async function POST(request: NextRequest) {
  try {
    const owner = await requireOwner();
    const origin = request.headers.get('origin');
    const expected = new URL(process.env.APP_URL || request.url).origin;
    if (!origin || origin !== expected) throw new AccessError(403, 'Origen de la solicitud no permitido.');
    const form = await request.formData();
    const mode = form.get('mode');
    const service = new RegistroService(await getDatabase(), serviceOptions());
    if (mode === 'revert') {
      const batchId = String(form.get('batchId') ?? '');
      return NextResponse.json({ data: await service.revertAttendanceImport(owner, batchId) }, { headers });
    }
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError(400, 'Selecciona un libro de Excel para analizar.');
    if (file.size > maxWorkbookBytes) throw new AppError(413, 'El libro supera el límite de 25 MB.');
    if (!['inspect', 'preview', 'import'].includes(String(mode))) throw new AppError(400, 'Selecciona analizar, revisar o importar el libro.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileName = safeFileName(file.name);
    if (mode === 'inspect') {
      const candidates = await inspectAttendanceWorkbook(bytes);
      return NextResponse.json({ data: { fileName, sourceFingerprint: createHash('sha256').update(bytes).digest('hex'), candidates } }, { headers });
    }
    const formBlock = String(form.get('defaultBlock') ?? '');
    const defaultBlock = formBlock ? Number(formBlock) : null;
    if (defaultBlock !== null && (!Number.isInteger(defaultBlock) || defaultBlock < 1 || defaultBlock > 12)) throw new AppError(400, 'Selecciona un bloque válido.');
    const preview = await makePreview({
      service, owner, bytes, fileName,
      sheetName: String(form.get('sheetName') ?? ''),
      defaultCourseId: String(form.get('defaultCourseId') ?? ''), defaultBlock,
    });
    if (mode === 'preview') return NextResponse.json({ data: preview }, { headers });

    if (String(form.get('sourceFingerprint') ?? '') !== preview.sourceFingerprint) throw new AppError(409, 'El archivo cambió después de la revisión. Vuelve a analizarlo antes de importar.', 'IMPORT_FILE_CHANGED');
    if (!preview.review) throw new AppError(409, 'No hay marcas válidas para importar. Corrige las filas señaladas en la vista previa.', 'NO_IMPORTABLE_ROWS');
    const requestId = String(form.get('requestId') ?? randomUUID());
    const receipt = await service.importAttendance(owner, {
      requestId, previewId: preview.review.previewId, fileName, sourceFingerprint: preview.sourceFingerprint,
      replaceConflicts: form.get('replaceConflicts') === 'true', confirmWithdrawals: form.get('confirmWithdrawals') === 'true',
      rows: preview.review.entries,
    });
    return NextResponse.json({ data: { receipt, issues: preview.issues, fileSummary: preview.fileSummary } }, { headers });
  } catch (error) { return fail(error); }
}
