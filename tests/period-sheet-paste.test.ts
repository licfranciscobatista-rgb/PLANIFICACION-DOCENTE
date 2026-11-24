import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePeriodScorePaste } from '../src/lib/period-sheet-paste';

const students=[{id:'a'},{id:'b'},{id:'c'}];
const columns=[{id:'exam',label:'Examen',maxPoints:10},{id:'notebook',label:'Libreta',maxPoints:20}];

test('pega un bloque tabular desde la celda seleccionada y conserva cero, decimales y vacíos',()=>{
 const result=parsePeriodScorePaste('0\t7,5\r\n\t18\r\n',0,0,students,columns);
 assert.equal(result.error,null);
 assert.deepEqual(result.updates,[
  {studentId:'a',columnId:'exam',score:0},{studentId:'a',columnId:'notebook',score:7.5},
  {studentId:'b',columnId:'exam',score:null},{studentId:'b',columnId:'notebook',score:18},
 ]);
});

test('rechaza un bloque completo si una nota supera el máximo y no devuelve cambios parciales',()=>{
 const result=parsePeriodScorePaste('8\t7\n11\t12',0,0,students,columns);
 assert.deepEqual(result.updates,[]);
 assert.match(result.error??'',/0 a 10/);
});

test('protege los límites de la lista y de las columnas',()=>{
 assert.match(parsePeriodScorePaste('5\n6',2,0,students,columns).error??'',/final de la lista/);
 assert.match(parsePeriodScorePaste('5\t6\t7',0,0,students,columns).error??'',/más columnas/);
});
