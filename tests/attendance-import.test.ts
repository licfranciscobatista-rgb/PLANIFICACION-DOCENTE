import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';
import { createTestDatabase } from '../src/lib/db';
import { AppError } from '../src/lib/model';
import type { AttendanceImportRecord } from '../src/lib/model';
import { inspectAttendanceWorkbook, parseAttendanceWorkbookSheet } from '../src/lib/attendance-import';
import { RegistroService } from '../src/lib/service';

function escapeXml(value:string){return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');}
function excelSerial(value:string){return (Date.parse(`${value}T00:00:00Z`)-Date.UTC(1899,11,30))/86400000;}

async function workbook(){
 const zip=new JSZip();
 const rows=[
  ['ID','Curso','Fecha','Bloque','ID estudiante','Estudiante','Asistencia'],
  ['1','5A',String(excelSerial('2026-10-21')),'2','ana-id','Ana Pérez','P'],
  ['2','5A','2026-10-22','2','luis-id','Luis Mateo','Ausente'],
  ['3','5B','2026-10-23','1','bea-id','Beatriz Díaz','Llegó tarde'],
  ['4','5A','11/12/2026','2','x-id','Fecha Dudosa','Presente'],
  ['5','5A','2026-10-24','2','blank-id','Marca vacía',''],
  ['6','5A','2026-10-25','2','unknown-id','Marca rara','Quizás'],
 ];
 const strings=[...new Set(rows.flat())];
 const shared=`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value=>`<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`;
 const letters=['A','B','C','D','E','F','G'];
 const xmlRows=rows.map((row,rowIndex)=>`<row r="${rowIndex+1}">${row.map((value,columnIndex)=>{
  if(!value)return '';
  const ref=`${letters[columnIndex]}${rowIndex+1}`;
  if(rowIndex===1&&columnIndex===2)return `<c r="${ref}"><v>${value}</v></c>`;
  return `<c r="${ref}" t="s"><v>${strings.indexOf(value)}</v></c>`;
 }).join('')}</row>`).join('');
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`);
 zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Diario_datos" sheetId="1" state="hidden" r:id="rId1"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
 zip.file('xl/sharedStrings.xml',shared);
 return zip.generateAsync({type:'uint8array'});
}

async function attendanceMatrixWorkbook(){
 const zip=new JSZip();
 const rows=[
  ['','','','','','','','','',''],
  ['Curso','5A','','','','','','','',''],
  ['Mes','','','','','','','','OCTUBRE 2026','OCTUBRE 2026'],
  ['Fecha','','','','','','','','2026-10-21','2026-10-22'],
  ['Bloque','','','','','','','','2','3'],
  ['No.','Estudiante','P','A','T','E','R','Marcadas','Asistencia','Asistencia'],
  ['1','Ana Pérez','','','','','','','P',''],
  ['2','Luis Mateo','','','','','','','A','T'],
 ];
 const strings=[...new Set(rows.flat().filter(Boolean))];
 const columnName=(column:number)=>{let n=column,result='';while(n){const digit=(n-1)%26;result=String.fromCharCode(65+digit)+result;n=Math.floor((n-1)/26);}return result;};
 const xmlRows=rows.map((row,rowIndex)=>`<row r="${rowIndex+1}">${row.map((value,columnIndex)=>{
  if(!value)return '';
  const ref=`${columnName(columnIndex+1)}${rowIndex+1}`;
  return `<c r="${ref}" t="s"><v>${strings.indexOf(value)}</v></c>`;
 }).join('')}</row>`).join('');
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${xmlRows}</sheetData></worksheet>`);
 zip.file('xl/workbook.xml','<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="5A" sheetId="1" r:id="rId1"/></sheets></workbook>');
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
 zip.file('xl/sharedStrings.xml',`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map(value=>`<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`);
 return zip.generateAsync({type:'uint8array'});
}

test('reconoce hoja oculta, fecha Excel, curso/bloque y no convierte celdas dudosas o vacías en ausencias',async()=>{
 const bytes=await workbook();
 const sheets=await inspectAttendanceWorkbook(bytes);
 assert.equal(sheets.length,1);
 assert.equal(sheets[0]!.name,'Diario_datos');
 assert.equal(sheets[0]!.state,'hidden');
 assert.deepEqual(sheets[0]!.columns.map(column=>column.field),['studentNumber','course','date','block','studentId','studentName','status']);
 const parsed=await parseAttendanceWorkbookSheet(bytes,'Diario_datos');
 assert.equal(parsed.records.length,6);
 assert.deepEqual(parsed.records.slice(0,3).map(row=>[row.date,row.block,row.sourceCourse,row.status]),[
  ['2026-10-21',2,'5A','P'],['2026-10-22',2,'5A','A'],['2026-10-23',1,'5B','T'],
 ]);
 assert.ok(parsed.records[3]!.issues.includes('fecha_ambigua_o_invalida'));
 assert.ok(parsed.records[4]!.issues.includes('sin_marca'));
 assert.ok(parsed.records[5]!.issues.includes('marca_no_reconocida'));
});

test('reconoce matriz visual por estudiante, toma fecha y bloque de los encabezados y convierte sus columnas en marcas',async()=>{
 const bytes=await attendanceMatrixWorkbook();
 const sheets=await inspectAttendanceWorkbook(bytes);
 assert.equal(sheets.length,1);
 assert.equal(sheets[0]!.format,'attendance_matrix');
 assert.equal(sheets[0]!.courseCode,'5A');
 assert.equal(sheets[0]!.rowCount,2);
 assert.equal(sheets[0]!.sessionCount,2);
 const parsed=await parseAttendanceWorkbookSheet(bytes,'5A');
 assert.deepEqual(parsed.records.map(row=>[row.sourceCourse,row.sourceStudentName,row.date,row.block,row.status]),[
  ['5A','Ana Pérez','2026-10-21',2,'P'],
  ['5A','Ana Pérez','2026-10-22',3,null],
  ['5A','Luis Mateo','2026-10-21',2,'A'],
  ['5A','Luis Mateo','2026-10-22',3,'T'],
 ]);
 assert.ok(parsed.records[1]!.issues.includes('sin_marca'));
});

const owner=`attendance-import-${randomUUID()}`;
let db:Awaited<ReturnType<typeof createTestDatabase>>;
let service:RegistroService;
let courseId='';
let students:{id:string;externalId:string;number:number;name:string}[]=[];
const fingerprint='a'.repeat(64);

before(async()=>{
 db=await createTestDatabase();
 service=new RegistroService(db,{today:()=> '2026-11-15'});
 const course=await service.createCourse(owner,{code:'5A',name:'Matemática 5A',startDate:'2026-10-20',endDate:'2026-11-30',weekly:[{weekday:3,blocks:[1,2]}]});
 courseId=course.id;
 students=await service.importRoster(owner,courseId,[
  {externalId:'ana-id',number:1,name:'Ana Pérez'},
  {externalId:'luis-id',number:2,name:'Luis Mateo'},
  {externalId:'bea-id',number:3,name:'Beatriz Díaz'},
  {externalId:'carlos-id',number:4,name:'Carlos Gil'},
 ]);
});

after(async()=>{await db?.close();});

function row(studentId:string,date:string,status:'P'|'A'|'T'|'E'|'R',sourceRow:number):AttendanceImportRecord{
 const student=students.find(item=>item.id===studentId)!;
 return {courseId,date,block:2,studentId,status,sourceSheet:'Diario_datos',sourceRow,sourceStudentName:student.name,sourceStudentNumber:student.number};
}

test('vista previa clasifica iguales, nuevas y conflictivas sin modificar el libro',async()=>{
 const existing=await service.attendance(owner,courseId,'2026-10-21',2);
 await service.saveAttendance(owner,{requestId:randomUUID(),courseId,date:'2026-10-21',block:2,revision:existing.session.revision,lessonType:'teoria',rows:[
  {studentId:students[0]!.id,status:'P',behavior:7},
  {studentId:students[3]!.id,status:'P',behavior:8},
 ]});
 const rows=[row(students[0]!.id,'2026-10-21','P',2),row(students[1]!.id,'2026-10-21','A',3),row(students[2]!.id,'2026-10-21','T',4),row(students[3]!.id,'2026-10-21','A',5)];
 const preview=await service.previewAttendanceImport(owner,{fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,rows});
 assert.deepEqual(preview.summary,{sourceRows:4,mappedRows:4,newRows:2,sameRows:1,conflictingRows:1,sessions:1});
 const before=await service.attendance(owner,courseId,'2026-10-21',2);
 assert.equal(before.rows.find(item=>item.studentId===students[1]!.id)?.status,null);
 assert.equal(before.rows.find(item=>item.studentId===students[3]!.id)?.behavior,8);
});

test('importa solo marcas nuevas, conserva conflictos por defecto y permite deshacer sin borrar datos anteriores',async()=>{
 const existing=await service.attendance(owner,courseId,'2026-10-21',2);
 const rows=[row(students[0]!.id,'2026-10-21','P',2),row(students[1]!.id,'2026-10-21','A',3),row(students[2]!.id,'2026-10-21','T',4),row(students[3]!.id,'2026-10-21','A',5)];
 const preview=await service.previewAttendanceImport(owner,{fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,rows});
 const result=await service.importAttendance(owner,{requestId:randomUUID(),previewId:preview.previewId,fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,replaceConflicts:false,confirmWithdrawals:false,rows});
 assert.equal(result.imported,2);assert.equal(result.replaced,0);assert.equal(result.unchanged,1);assert.equal(result.conflictsKept,1);
 let saved=await service.attendance(owner,courseId,'2026-10-21',2);
 assert.equal(saved.session.lessonType,'teoria','la importación no inventa ni reemplaza el tipo de una sesión existente');
 assert.equal(saved.rows.find(item=>item.studentId===students[1]!.id)?.status,'A');
 assert.equal(saved.rows.find(item=>item.studentId===students[2]!.id)?.status,'T');
 assert.equal(saved.rows.find(item=>item.studentId===students[3]!.id)?.status,'P');
 assert.equal(saved.rows.find(item=>item.studentId===students[3]!.id)?.behavior,8);
 const undo=await service.revertAttendanceImport(owner,result.batchId);
 assert.equal(undo.alreadyReverted,false);assert.equal(undo.reverted,2);
 saved=await service.attendance(owner,courseId,'2026-10-21',2);
 assert.equal(saved.rows.find(item=>item.studentId===students[1]!.id)?.status,null);
 assert.equal(saved.rows.find(item=>item.studentId===students[2]!.id)?.status,null);
 assert.equal(saved.rows.find(item=>item.studentId===students[0]!.id)?.status,'P');
 assert.equal(saved.rows.find(item=>item.studentId===students[3]!.id)?.behavior,8);
 assert.equal((await service.attendanceImports(owner)).find(item=>item.id===result.batchId)?.status,'reverted');
});

test('reemplazar conflictos exige elección explícita y el deshacer restaura la marca anterior y conducta',async()=>{
 const session=await service.attendance(owner,courseId,'2026-10-21',2);
 const rows=[row(students[3]!.id,'2026-10-21','A',6)];
 const preview=await service.previewAttendanceImport(owner,{fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,rows});
 assert.equal(preview.entries[0]!.outcome,'conflict');
 const result=await service.importAttendance(owner,{requestId:randomUUID(),previewId:preview.previewId,fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,replaceConflicts:true,confirmWithdrawals:false,rows});
 const replaced=await service.attendance(owner,courseId,'2026-10-21',2);
 assert.equal(replaced.rows.find(item=>item.studentId===students[3]!.id)?.status,'A');
 assert.equal(replaced.rows.find(item=>item.studentId===students[3]!.id)?.behavior,null);
 await service.revertAttendanceImport(owner,result.batchId);
 const restored=await service.attendance(owner,courseId,'2026-10-21',2);
 assert.equal(restored.rows.find(item=>item.studentId===students[3]!.id)?.status,'P');
 assert.equal(restored.rows.find(item=>item.studentId===students[3]!.id)?.behavior,8);
 assert.ok(session.session.revision<restored.session.revision);
});

test('el deshacer se bloquea íntegramente si alguien modificó una marca después del lote',async()=>{
 const rows=[row(students[1]!.id,'2026-10-22','P',7)];
 const preview=await service.previewAttendanceImport(owner,{fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,rows});
 const result=await service.importAttendance(owner,{requestId:randomUUID(),previewId:preview.previewId,fileName:'asistencia.xlsm',sourceFingerprint:fingerprint,replaceConflicts:false,confirmWithdrawals:false,rows});
 const session=await service.attendance(owner,courseId,'2026-10-22',2);
 await service.saveAttendance(owner,{requestId:randomUUID(),courseId,date:'2026-10-22',block:2,revision:session.session.revision,lessonType:'practica',topic:'Editada luego',rows:[{studentId:students[1]!.id,status:'P'}]});
 await assert.rejects(service.revertAttendanceImport(owner,result.batchId),(error:unknown)=>error instanceof AppError&&error.code==='IMPORT_REVERT_CONFLICT');
 const after=await service.attendance(owner,courseId,'2026-10-22',2);
 assert.equal(after.rows.find(item=>item.studentId===students[1]!.id)?.status,'P');
 assert.equal(after.session.topic,'Editada luego');
});

test('no permite importar una identidad de otro curso ni una vista previa desactualizada',async()=>{
 const other=await service.createCourse(owner,{code:'5B',name:'Matemática 5B',startDate:'2026-10-20',endDate:'2026-11-30',weekly:[{weekday:3,blocks:[1,2]}]});
 const stranger=await service.importRoster(owner,other.id,[{externalId:'outsider',number:1,name:'Estudiante de 5B'}]);
 const badRow:AttendanceImportRecord={courseId:courseId,date:'2026-10-22',block:2,studentId:stranger[0]!.id,status:'P',sourceSheet:'Diario_datos',sourceRow:8,sourceStudentName:stranger[0]!.name,sourceStudentNumber:1};
 await assert.rejects(service.previewAttendanceImport(owner,{fileName:'asistencia.xlsx',sourceFingerprint:fingerprint,rows:[badRow]}),(error:unknown)=>error instanceof AppError&&error.code==='CROSS_COURSE');
 const rows=[row(students[2]!.id,'2026-10-22','P',9)];
 const preview=await service.previewAttendanceImport(owner,{fileName:'asistencia.xlsx',sourceFingerprint:fingerprint,rows});
 const current=await service.attendance(owner,courseId,'2026-10-22',2);
 await service.saveAttendance(owner,{requestId:randomUUID(),courseId,date:'2026-10-22',block:2,revision:current.session.revision,lessonType:'teoria',rows:[{studentId:students[0]!.id,status:'P'}]});
 await assert.rejects(service.importAttendance(owner,{requestId:randomUUID(),previewId:preview.previewId,fileName:'asistencia.xlsx',sourceFingerprint:fingerprint,replaceConflicts:false,confirmWithdrawals:false,rows}),(error:unknown)=>error instanceof AppError&&error.code==='IMPORT_PREVIEW_STALE');
 const after=await service.attendance(owner,courseId,'2026-10-22',2);
 assert.equal(after.rows.find(item=>item.studentId===students[2]!.id)?.status,null);
});
