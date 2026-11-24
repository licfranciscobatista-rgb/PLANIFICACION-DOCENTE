import type { PeriodSheetColumn } from './model';

export interface PeriodScorePasteUpdate { studentId:string; columnId:string; score:number|null }
export type PeriodScorePasteResult={updates:PeriodScorePasteUpdate[];error:null}|{updates:[];error:string};

export function parsePeriodScorePaste(text:string,startRow:number,startColumn:number,students:{id:string}[],columns:Pick<PeriodSheetColumn,'id'|'label'|'maxPoints'>[]):PeriodScorePasteResult{
  const lines=text.replace(/\r/g,'').split('\n');
  if(lines.at(-1)==='')lines.pop();
  if(!lines.length)return {updates:[],error:'El bloque pegado está vacío.'};
  const updates:PeriodScorePasteUpdate[]=[];
  for(let rowOffset=0;rowOffset<lines.length;rowOffset++){
    const student=students[startRow+rowOffset];
    if(!student)return {updates:[],error:'El bloque pegado sale del final de la lista. No se aplicó ningún dato.'};
    const cells=lines[rowOffset]!.split('\t');
    for(let columnOffset=0;columnOffset<cells.length;columnOffset++){
      const column=columns[startColumn+columnOffset];
      if(!column)return {updates:[],error:'El bloque pegado tiene más columnas que la matriz. No se aplicó ningún dato.'};
      const cell=cells[columnOffset]!.trim();
      if(!cell){updates.push({studentId:student.id,columnId:column.id,score:null});continue;}
      const score=Number(cell.replace(',','.'));
      if(!Number.isFinite(score)||score<0||score>column.maxPoints)return {updates:[],error:`“${cell}” no es una nota válida para ${column.label} (0 a ${column.maxPoints}). No se aplicó ningún dato.`};
      updates.push({studentId:student.id,columnId:column.id,score});
    }
  }
  return {updates,error:null};
}
