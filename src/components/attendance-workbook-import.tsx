"use client";

import { useId, useMemo, useState } from 'react';
import { AlertTriangle, Check, FileSpreadsheet, LoaderCircle, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import type { AttendanceImportEntry, AttendanceImportPreview, AttendanceImportReceipt, Course } from '@/lib/model';
import { useRemote } from '@/lib/client';

type Candidate = { name: string; state: 'visible'|'hidden'|'veryHidden'; headerRow: number; rowCount: number; format: 'row_table'; confidence: 'high'|'review'; columns: {index:number;letter:string;header:string;field:string|null}[] };
type Inspection = { fileName:string; sourceFingerprint:string; candidates:Candidate[] };
type Issue = {sheet:string;row:number;student:string;code:string;message:string;severity:'review'|'blocked'};
type ImportPreview = {fileName:string;sourceFingerprint:string;sheet:Candidate;fileSummary:{sourceSheet:string;sourceRows:number;blankRows:number;duplicateRows:number;conflictingDuplicates:number;otherCourseRows:number;incompleteSessions:number;blockedRows:number;reviewRows:number};issues:Issue[];review:AttendanceImportPreview|null};
type Batch = {id:string;fileName:string;summary:Record<string,unknown>;status:string;createdAt:string;revertedAt:string|null};

async function sendWorkbook<T>(file:File,fields:Record<string,string>):Promise<T>{
  const form=new FormData();form.append('file',file);for(const [key,value] of Object.entries(fields))form.append(key,value);
  const response=await fetch('/api/registro/attendance-workbook',{method:'POST',body:form,cache:'no-store'});
  const result=await response.json() as {data?:T;error?:string};
  if(!response.ok)throw new Error(result.error||'No se pudo completar la importación.');
  if(!result.data)throw new Error('La app no devolvió la vista previa.');
  return result.data;
}

function statusLabel(mark:string|null){return ({P:'Presente',A:'Ausente',T:'Tardanza',E:'Excusa',R:'Retiro'} as Record<string,string>)[mark??'']??'Sin marca';}
function dateLabel(value:string){const [year,month,day]=value.split('-');return `${day}/${month}/${year}`;}

export function AttendanceWorkbookImportPanel({course,courses,onChange}:{course:Course;courses:Course[];onChange:()=>void}){
  const fileId=useId();
  const [open,setOpen]=useState(false);
  const [file,setFile]=useState<File|null>(null);
  const [inspection,setInspection]=useState<Inspection|null>(null);
  const [sheetName,setSheetName]=useState('');
  const [defaultCourseId,setDefaultCourseId]=useState(course.id);
  const [defaultBlock,setDefaultBlock]=useState('');
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [replaceConflicts,setReplaceConflicts]=useState(false);
  const [confirmWithdrawals,setConfirmWithdrawals]=useState(false);
  const [confirmImport,setConfirmImport]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const imports=useRemote<Batch[]>('attendance-imports');
  const selectedCandidate=inspection?.candidates.find(candidate=>candidate.name===sheetName)??null;
  const needsBlock=Boolean(selectedCandidate&&!selectedCandidate.columns.some(column=>column.field==='block'));
  const conflicts=preview?.review?.entries.filter(entry=>entry.outcome==='conflict')??[];
  const withdrawalEntries=preview?.review?.entries.filter(entry=>entry.status==='R'&&(entry.outcome==='new'||(entry.outcome==='conflict'&&replaceConflicts)))??[];
  const importable=preview?.review?preview.review.entries.filter(entry=>entry.outcome==='new'||(entry.outcome==='conflict'&&replaceConflicts)).filter(entry=>entry.status!=='R'||confirmWithdrawals).length??0:0;
  const recentBatches=useMemo(()=>imports.data?.filter(batch=>Array.isArray(batch.summary.courseIds)&&batch.summary.courseIds.includes(course.id)).slice(0,5)??[],[imports.data,course.id]);

  async function inspect(){
    if(!file){setError('Selecciona el Excel con la asistencia.');return;}
    if(file.size>25*1024*1024){setError('El libro supera el límite de 25 MB.');return;}
    setBusy(true);setError('');setSuccess('');setInspection(null);setPreview(null);setConfirmImport(false);
    try{const result=await sendWorkbook<Inspection>(file,{mode:'inspect'});setInspection(result);setSheetName(result.candidates.length===1?result.candidates[0]!.name:'');}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo analizar el Excel.');}
    finally{setBusy(false);}
  }

  async function analyze(){
    if(!file||!selectedCandidate){setError('Selecciona el libro y una pestaña reconocida.');return;}
    if(needsBlock&&!defaultBlock){setError('Esta pestaña no trae el bloque. Elige el bloque al que corresponden sus filas.');return;}
    setBusy(true);setError('');setSuccess('');setPreview(null);setConfirmImport(false);
    try{const result=await sendWorkbook<ImportPreview>(file,{mode:'preview',sheetName,defaultCourseId,defaultBlock});setPreview(result);}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo revisar la asistencia.');}
    finally{setBusy(false);}
  }

  async function importConfirmed(){
    if(!file||!preview?.review||!confirmImport||!importable)return;
    setBusy(true);setError('');setSuccess('');
    try{
      const result=await sendWorkbook<{receipt:AttendanceImportReceipt;issues:Issue[];fileSummary:ImportPreview['fileSummary']}>(file,{
        mode:'import',sheetName,defaultCourseId,defaultBlock,sourceFingerprint:preview.sourceFingerprint,
        replaceConflicts:String(replaceConflicts),confirmWithdrawals:String(confirmWithdrawals),requestId:crypto.randomUUID(),
      });
      setSuccess(`Se importaron ${result.receipt.imported} marcas en ${result.receipt.sessions} sesiones. ${result.receipt.unchanged} ya coincidían; ${result.receipt.conflictsKept} conflictos se dejaron intactos.`);
      setPreview(null);setInspection(null);setFile(null);setConfirmImport(false);setReplaceConflicts(false);setConfirmWithdrawals(false);onChange();imports.reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se completó la importación. Conserva el Excel y vuelve a revisar.');}
    finally{setBusy(false);}
  }

  async function undo(batchId:string){
    if(!window.confirm('¿Deshacer este lote? Si alguien cambió después una de sus marcas, la app conservará esos cambios y bloqueará el deshacer completo.'))return;
    setBusy(true);setError('');setSuccess('');
    try{
      const form=new FormData();form.append('mode','revert');form.append('batchId',batchId);
      const response=await fetch('/api/registro/attendance-workbook',{method:'POST',body:form,cache:'no-store'});const result=await response.json() as {data?:{reverted:number;alreadyReverted:boolean};error?:string};
      if(!response.ok)throw new Error(result.error||'No se pudo deshacer este lote.');
      setSuccess(result.data?.alreadyReverted?'Este lote ya había sido deshecho.':`Se deshizo el lote y se restauraron ${result.data?.reverted??0} registros anteriores.`);onChange();imports.reload();
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo deshacer el lote.');}
    finally{setBusy(false);}
  }

  const summaries=preview?.review?.summary;
  const issues=preview?.issues??[];
  const visibleIssues=issues.slice(0,30);
  const hasCourseColumn=Boolean(selectedCandidate?.columns.some(column=>column.field==='course'));
  const hasBlockColumn=Boolean(selectedCandidate?.columns.some(column=>column.field==='block'));

  return <details className="panel roster-workbook-import" open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary className="roster-workbook-summary"><div><p className="eyebrow">ASISTENCIA · MIGRAR HISTÓRICO</p><h2><FileSpreadsheet size={18}/> Importar desde Excel</h2><p>Sube varios meses de marcas y revisa cómo se relacionan antes de guardarlas.</p></div><span className="button secondary">{open?'Cerrar':'Revisar Excel'}</span></summary>
    <div className="roster-workbook-body">
      <div className="notice"><ShieldCheck size={17}/><span>El Excel se trata como propuesta. No se ejecutan macros, no se importan notas ni comportamiento y las marcas existentes no se reemplazan sin una decisión explícita.</span></div>
      <div className="roster-workbook-controls"><label htmlFor={fileId}>Libro Excel (.xlsx o .xlsm)<input id={fileId} type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" disabled={busy} onChange={event=>{setFile(event.target.files?.[0]??null);setInspection(null);setPreview(null);setError('');setSuccess('');setConfirmImport(false);}}/></label><button type="button" className="button secondary" onClick={()=>void inspect()} disabled={busy||!file}>{busy?<LoaderCircle className="spin" size={16}/>:<Upload size={16}/>} Analizar estructura</button></div>
      {inspection&&<div className="roster-workbook-controls"><label>Pestaña con asistencia<select value={sheetName} onChange={event=>{setSheetName(event.target.value);setPreview(null);setConfirmImport(false);}}><option value="">Selecciona una tabla</option>{inspection.candidates.map(candidate=><option value={candidate.name} key={candidate.name}>{candidate.name}{candidate.state!=='visible'?' · oculta':''} · {candidate.rowCount} filas</option>)}</select></label>
        <label>Asignar filas sin curso a<select value={defaultCourseId} onChange={event=>{setDefaultCourseId(event.target.value);setPreview(null);}}>{courses.map(item=><option value={item.id} key={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>Bloque de respaldo para filas sin bloque<select value={defaultBlock} onChange={event=>{setDefaultBlock(event.target.value);setPreview(null);}}><option value="">No completar automáticamente</option>{Array.from({length:12},(_,index)=>index+1).map(block=><option value={block} key={block}>Bloque {block}</option>)}</select></label>
        <button type="button" className="button primary" onClick={()=>void analyze()} disabled={busy||!sheetName}>{busy?<LoaderCircle className="spin" size={16}/>:<FileSpreadsheet size={16}/>} Revisar marcas</button>
      </div>}
      {selectedCandidate&&<p className="muted roster-workbook-note">Encabezado detectado en fila {selectedCandidate.headerRow}: {selectedCandidate.columns.map(column=>`${column.letter} · ${column.header}`).join(' / ')}. {hasCourseColumn?'La app usará el código de curso escrito en cada fila; los códigos desconocidos se bloquearán.':'La hoja no trae curso; se asignará explícitamente al curso seleccionado.'} {hasBlockColumn?'Se usará el bloque de cada fila; cualquier fila sin bloque queda pendiente, salvo que elijas un respaldo.':'El bloque necesita confirmación explícita.'} Las celdas vacías no se convierten en ausencias.</p>}
      {error&&<div className="notice warning" role="alert"><AlertTriangle size={17}/>{error}</div>}
      {success&&<div className="notice success" role="status"><Check size={17}/>{success}</div>}

      {preview&&<div className="roster-workbook-preview">
        <div className="table-toolbar"><div><h3>Vista previa · {preview.fileName}</h3><p className="muted">Pestaña {preview.fileSummary.sourceSheet} · {preview.fileSummary.sourceRows} filas analizadas</p></div><span className={'pill '+((preview.fileSummary.blockedRows||conflicts.length)?'provisional':'')}>{preview.fileSummary.blockedRows||conflicts.length?'Requiere revisión':'Lista para confirmar'}</span></div>
        <div className="metrics compact"><div className="metric"><span>Marcas nuevas</span><strong>{summaries?.newRows??0}</strong></div><div className="metric"><span>Ya coincidían</span><strong>{summaries?.sameRows??0}</strong></div><div className="metric"><span>Conflictos con la app</span><strong>{summaries?.conflictingRows??0}</strong><small>Se conservan por defecto</small></div><div className="metric"><span>Sesiones</span><strong>{summaries?.sessions??0}</strong><small>{preview.fileSummary.blankRows} filas vacías quedan pendientes</small></div></div>
        {preview.fileSummary.otherCourseRows>0&&<div className="notice">El libro también contiene {preview.fileSummary.otherCourseRows} filas de otros cursos; se procesaron solo si su código coincide exactamente con un curso de la app.</div>}
        {preview.fileSummary.incompleteSessions>0&&<div className="notice warning"><AlertTriangle size={17}/><span>{preview.fileSummary.incompleteSessions} sesiones no traen una marca para cada estudiante. Solo se importarán las marcas presentes; los demás estudiantes quedarán pendientes, no ausentes.</span></div>}
        {preview.fileSummary.duplicateRows>0&&<div className="notice">{preview.fileSummary.duplicateRows} filas repetidas con la misma marca se contarán una sola vez.</div>}
        {preview.fileSummary.conflictingDuplicates>0&&<div className="notice warning"><AlertTriangle size={17}/>Hay marcas distintas repetidas para la misma fecha y estudiante. Esas filas se excluyeron hasta corregir el Excel.</div>}
        {conflicts.length>0&&<><div className="notice warning"><AlertTriangle size={17}/><span>{conflicts.length} marcas contradicen datos que ya están guardados. La app las dejará intactas a menos que autorices reemplazarlas.</span></div><label className="checkbox-row"><input type="checkbox" checked={replaceConflicts} onChange={event=>{setReplaceConflicts(event.target.checked);setConfirmImport(false);}}/>Reemplazar las marcas existentes que contradicen el Excel ({conflicts.length})</label><div className="table-wrap"><table className="data-table"><thead><tr><th>Curso</th><th>Fecha · bloque</th><th>Estudiante</th><th>Guardado en la app</th><th>Excel propone</th></tr></thead><tbody>{conflicts.slice(0,30).map(entry=><tr key={entry.key}><td>{entry.courseCode}</td><td>{dateLabel(entry.date)} · {entry.block}</td><td>{entry.studentName}</td><td>{statusLabel(entry.existingStatus)}</td><td>{statusLabel(entry.status)}</td></tr>)}</tbody></table>{conflicts.length>30&&<p className="muted">Se muestran los primeros 30 conflictos; el resumen incluye los {conflicts.length}.</p>}</div></>}
        {withdrawalEntries.length>0&&<label className="checkbox-row warning-text"><input type="checkbox" checked={confirmWithdrawals} onChange={event=>{setConfirmWithdrawals(event.target.checked);setConfirmImport(false);}}/><span><strong>{withdrawalEntries.length} marcas R</strong> registran retiro y afectan el historial del estudiante desde esa fecha. Confirma solo si eso es lo que significa en este libro.</span></label>}
        {issues.length>0&&<details className="roster-workbook-course"><summary><strong>Filas que requieren revisión</strong><span>{preview.fileSummary.blockedRows} bloqueadas · {preview.fileSummary.reviewRows} avisos</span></summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Fila / sesión</th><th>Estudiante</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>{visibleIssues.map((issue,index)=><tr key={`${issue.sheet}-${issue.row}-${issue.code}-${index}`}><td>{issue.sheet}{issue.row?` · fila ${issue.row}`:' · sesión'}</td><td>{issue.student||'—'}</td><td>{issue.severity==='blocked'?'Bloqueada':'Aviso'}</td><td>{issue.message}</td></tr>)}</tbody></table>{issues.length>visibleIssues.length&&<p className="muted">Se muestran {visibleIssues.length} de {issues.length} incidencias; ninguna de ellas se importará como una marca válida.</p>}</div></details>}
        {importable>0&&<label className="checkbox-row"><input type="checkbox" checked={confirmImport} onChange={event=>setConfirmImport(event.target.checked)}/>Revisé los conteos y confirmo agregar {importable} marcas{replaceConflicts?' (incluye los conflictos autorizados)':''}.</label>}
        <div className="toolbar roster-workbook-actions"><button type="button" className="button primary" disabled={busy||!confirmImport||importable===0} onClick={()=>void importConfirmed()}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} Confirmar importación</button><button type="button" className="button secondary" disabled={busy} onClick={()=>{setPreview(null);setConfirmImport(false);}}>Descartar vista previa</button></div>
      </div>}

      {recentBatches.length>0&&<section className="roster-workbook-preview"><h3>Importaciones recientes de {course.code}</h3>{recentBatches.map(batch=><div className="table-toolbar" key={batch.id}><div><strong>{batch.fileName}</strong><p className="muted">{new Date(batch.createdAt).toLocaleString('es-DO')} · {String(batch.summary.imported??0)} marcas · {batch.status==='reverted'?'deshecho':'aplicado'}</p></div>{batch.status==='applied'&&<button type="button" className="button secondary" disabled={busy} onClick={()=>void undo(batch.id)}><RotateCcw size={15}/> Deshacer lote</button>}</div>)}</section>}
      <p className="muted roster-workbook-note">El lote queda en el historial. Se puede deshacer si sus marcas no fueron editadas después. Las marcas R requieren confirmación adicional; comportamiento, participación, notas y tipo de clase no se deducen de la asistencia.</p>
    </div>
  </details>;
}
