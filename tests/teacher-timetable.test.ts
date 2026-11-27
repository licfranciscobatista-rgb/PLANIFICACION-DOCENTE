import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceCourseTimetableEntries, suggestTeacherBlock, timetableEntriesForCourse } from '../src/lib/timetable';
import type { TeacherTimetableEntry } from '../src/lib/model';

const courseId='course-a';
const entry=(weekday:number,startTime:string,endTime:string,block:number,course=courseId):TeacherTimetableEntry=>({id:`${weekday}-${startTime}-${block}`,weekday,startTime,endTime,block,courseId:course});

test('horario docente detecta el bloque de hoy por hora local escolar y respeta límites de franja',()=>{
 const slots=[entry(2,'08:00','09:00',1),entry(2,'09:00','10:00',2)];
 assert.equal(suggestTeacherBlock(slots,courseId,'2026-11-24','2026-11-24','08:59'),1);
 assert.equal(suggestTeacherBlock(slots,courseId,'2026-11-24','2026-11-24','09:00'),2);
 assert.equal(suggestTeacherBlock(slots,courseId,'2026-11-24','2026-11-24','10:00'),null);
});

test('para otra fecha solo sugiere cuando día y curso dejan un bloque inequívoco',()=>{
 assert.equal(suggestTeacherBlock([entry(1,'08:00','09:00',4)],courseId,'2026-11-23','2026-11-24','12:00'),4);
 assert.equal(suggestTeacherBlock([entry(1,'08:00','09:00',4),entry(1,'10:00','11:00',5)],courseId,'2026-11-23','2026-11-24','12:00'),null);
 assert.equal(suggestTeacherBlock([entry(2,'08:00','09:00',4,'course-b')],courseId,'2026-11-24','2026-11-24','08:30'),null);
});

test('un único bloque del curso en ese día queda detectado automáticamente sin exigir volver a escogerlo',()=>{
 const only=[entry(4,'08:00','09:00',6)];
 assert.equal(suggestTeacherBlock(only,courseId,'2026-11-26','2026-11-26','13:30'),6,'si solo hay un bloque ese día, no hace falta que el docente seleccione el bloque otra vez');
 assert.equal(suggestTeacherBlock(only,courseId,'2026-12-03','2026-11-26','13:30'),6,'al corregir una fecha pasada con un solo bloque también se identifica sin ambigüedad');
});

test('la configuración de un curso solo muestra sus bloques y conserva intactos los demás cursos',()=>{
 const original=[entry(1,'08:00','09:00',1,'course-a'),entry(2,'10:00','11:00',3,'course-b')];
 const courseA=timetableEntriesForCourse(original,'course-a');
 assert.equal(courseA.length,1);
 assert.equal(courseA[0]?.block,1);
 const changed=[entry(1,'09:00','10:00',2,'course-a')];
 const saved=replaceCourseTimetableEntries(original,'course-a',changed);
 assert.deepEqual(saved.map(item=>[item.courseId,item.weekday,item.startTime,item.block]),[
  ['course-b',2,'10:00',3],
  ['course-a',1,'09:00',2],
 ]);
 assert.equal(timetableEntriesForCourse(saved,'course-b')[0]?.block,3);
});
