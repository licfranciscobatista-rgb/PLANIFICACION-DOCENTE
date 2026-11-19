'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Save, Search, AlertCircle, LoaderCircle, Download, RotateCcw } from 'lucide-react';
import { COMPETENCY_GROUPS } from '@/lib/model';
import type { Activity, AttendanceMark, AttendanceView, ClassLessonType, Course, CourseRegisterSummary, GradesView, LessonType, SaveReceipt } from '@/lib/model';
import { apiPost, downloadJson, errorText, useRemote } from '@/lib/client';
import { AttendanceWorkbookImportPanel } from './attendance-workbook-import';

const marks:[AttendanceMark,string][]=[['P','Presente'],['A','Ausente'],['T','Tardanza'],['E','Excusa'],['R','Retiro voluntario']];
function Loader({error}:{error?:string}) {return error?<div className="notice warning" role="alert">{error}</div>:<div className="loading-state"><LoaderCircle className="spin"/> Cargando registros…</div>;}
function useDraft<T>(key:string,initial:T,initialRevision:number){
  const [state,setState]=useState(()=>{
    if(typeof window!=='undefined')try{const raw=localStorage.getItem(key);if(raw){const x=JSON.parse(raw);if(x&&typeof x.revision==='number'&&x.value)return x as {value:T;revision:number;request?:{signature:string;id:string}};}}catch{}
    return {value:initial,revision:initialRevision,request:undefined as {signature:string;id:string}|undefined};
  });
  const [base,setBase]=useState(JSON.stringify(initial));
  const [confirmedRevision,setConfirmedRevision]=useState(initialRevision);
  const snapshot=useRef({value:initial,revision:initialRevision});
  const request=useRef(state.request);
  const dirty=JSON.stringify(state.value)!==base;
  useEffect(()=>{
    try{if(dirty)localStorage.setItem(key,JSON.stringify({...state,request:request.current}));else localStorage.removeItem(key);}catch{}
  },[state,dirty,key]);
  useEffect(()=>{if(!dirty)return;const h=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',h);return()=>window.removeEventListener('beforeunload',h);},[dirty]);
  function operation(){
    const signature=JSON.stringify({value:state.value,revision:state.revision});
    if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    try{localStorage.setItem(key,JSON.stringify({...state,request:request.current}));}catch{}
    return request.current.id;
  }
  function saved(revision:number){snapshot.current={value:state.value,revision};setBase(JSON.stringify(state.value));setConfirmedRevision(revision);setState(v=>({...v,revision}));request.current=undefined;localStorage.removeItem(key);}
  function rebase(value:T,revision:number){snapshot.current={value,revision};setBase(JSON.stringify(value));setConfirmedRevision(revision);setState({value,revision,request:undefined});request.current=undefined;localStorage.removeItem(key);}
  function discard(){if(dirty&&!window.confirm('¿Descartar este borrador y cargar los valores guardados?'))return;setState(snapshot.current);setConfirmedRevision(snapshot.current.revision);setBase(JSON.stringify(snapshot.current.value));request.current=undefined;localStorage.removeItem(key);}
  return {value:state.value,set:(value:T)=>setState(x=>({...x,value})),revision:state.revision,dirty,stale:state.revision!==confirmedRevision,operation,saved,rebase,discard};
}
function DraftNotice({dirty,stale,onDiscard,onExport}:{dirty:boolean;stale:boolean;onDiscard:()=>void;onExport:()=>void}){
  if(!dirty&&!stale)return null;
  return <div className={'notice '+(stale?'warning':'draft-notice')}><AlertCircle size={17}/><span>{stale?'Hay una versión más reciente en la base. Conserva el borrador antes de recargar.':'Cambios pendientes de enviar. El borrador se conserva al cambiar de apartado.'}</span><button className="text-button" onClick={onExport}><Download size={14}/> Borrador</button><button className="text-button" onClick={onDiscard}><RotateCcw size={14}/> Descartar</button></div>;
}
export function AttendancePanel({course,today,date,onDateChange,block,onBlockChange}:{course:Course;today:string;date:string;onDateChange:(value:string)=>void;block:number;onBlockChange:(value:number)=>void}){
  const remote=useRemote<AttendanceView>('attendance',{courseId:course.id,date,block});
  return <><div className="section-heading"><div><p className="eyebrow">REGISTRO DIARIO · {course.code}</p><h1>Registro de la clase</h1><p className="muted">Toma la asistencia y, en el mismo bloque, registra participación y comportamiento.</p></div><div className="toolbar"><label>Fecha<input type="date" min="2026-10-20" value={date||today} onChange={e=>e.target.value&&onDateChange(e.target.value)}/></label><label>Bloque<select value={block} onChange={e=>onBlockChange(Number(e.target.value))}><option value={1}>Bloque 1</option><option value={2}>Bloque 2</option><option value={3}>Bloque 3</option><option value={4}>Bloque 4</option><option value={5}>Bloque 5</option><option value={6}>Bloque 6</option><option value={7}>Bloque 7</option><option value={8}>Bloque 8</option></select></label></div></div>
  {remote.data?<AttendanceCapture key={course.id+date+block+remote.data.session.revision} initial={remote.data} courseCode={course.code} today={today} onReload={remote.reload} mode="attendance"/>:<Loader error={remote.error}/>}</>;
}
export function AttendanceSummaryPanel({course,courses,demo,section}:{course:Course;courses:Course[];demo:boolean;section:'month'|'week'}){
  const [weekStart,setWeekStart]=useState('');
  const [monthKey,setMonthKey]=useState('');
  const remote=useRemote<CourseRegisterSummary>('register-summary',{courseId:course.id});
  const data=remote.data;
  const weeks=data?.weeks.filter(week=>week.taught>0||week.notTaught>0)??[];
  const months=data?.months.filter(month=>month.taught>0)??[];
  const selectedWeek=weeks.find(week=>week.startDate===weekStart)??weeks[weeks.length-1];
  const selectedMonth=months.find(month=>month.key===monthKey)??months[months.length-1];
  const shortDate=(value:string)=>{const [year,month,day]=value.split('-');return `${day}/${month}/${year}`;};
  const monthDay=(value:string)=>value.split('-')[2]??'';
  if(!data)return <><div className="section-heading"><div><p className="eyebrow">ASISTENCIA · {course.code}</p><h1>{section==='month'?'Registro mensual':'Resumen semanal'}</h1></div></div><Loader error={remote.error}/></>;
  return <>
    <div className="section-heading attendance-summary-heading"><div><p className="eyebrow">REGISTRO DOCENTE · {course.code}</p><h1>{section==='month'?'Registro mensual de asistencia':'Resumen semanal de asistencia'}</h1><p className="muted">{section==='month'?'Marcas y totales por día trabajado. Las sesiones no impartidas se excluyen.':'Conteo de cuántas veces asistió cada estudiante en cada semana.'}</p></div></div>
    {section==='month'&&<section className="panel monthly-register-sheet" aria-labelledby="monthly-register-title">
      <header className="monthly-register-top">
        {demo&&<p className="monthly-register-demo-mark">MUESTRA FICTICIA · NO APTA PARA ENTREGA</p>}
        <p className="monthly-register-ministry">REGISTRO DE ASISTENCIA Y PUNTUALIDAD</p>
        <h2 id="monthly-register-title">Matemática · {data.course.code}</h2>
        <div className="monthly-register-meta"><span>{data.course.name}</span><span>5.º de Secundaria</span><span>Año escolar 2026–2027</span><span>Mes: {selectedMonth?.label??'Sin sesiones impartidas'}</span></div>
        <div className="monthly-register-fields"><span>Docente: __________________________________________</span><span>Centro educativo: __________________________________</span></div>
      </header>
      <div className="toolbar monthly-register-controls no-print">
        <label>Mes<select aria-label="Mes del registro oficial" value={selectedMonth?.key??''} onChange={e=>setMonthKey(e.target.value)}>{months.map(month=><option key={month.key} value={month.key}>{month.label} · {month.taught} días trabajados</option>)}</select></label>
        <a className="button primary" href={`/api/registro?action=attendance-register-pdf&courseId=${encodeURIComponent(course.id)}`} download>Descargar registro PDF</a>
      </div>
      {selectedMonth?<>
        <div className="table-wrap monthly-register-table-wrap"><table className="data-table monthly-register-table">
          <caption>{data.course.code} · {selectedMonth.label} · {selectedMonth.taught} días trabajados; {selectedMonth.notTaught} no impartidos, fuera del conteo.</caption>
          <thead><tr><th rowSpan={2}>N.º</th><th rowSpan={2}>Alumnos</th><th colSpan={selectedMonth.slots.length}>DÍAS TRABAJADOS</th><th rowSpan={2}>T</th><th rowSpan={2}>%</th></tr><tr>{selectedMonth.slots.map((slot,index)=><th key={`${slot.date}:${slot.block}`}><span>{index+1}</span><small>{monthDay(slot.date)}/{slot.date.slice(5,7)}{slot.block>1?` B${slot.block}`:''}</small></th>)}</tr></thead>
          <tbody>{selectedMonth.rows.map(row=><tr key={row.student.id}><td className="row-number">{String(row.student.number).padStart(2,'0')}</td><td className="student-name">{row.student.name}</td>{selectedMonth.slots.map((slot,index)=>{const mark=row.marks[index];return <td key={`${slot.date}:${slot.block}`} className={'register-mark'+(mark?' register-mark-'+mark:'')}>{mark??'—'}</td>})}<td>{row.pending===0?<strong>{row.totalAttendance}</strong>:'Pend.'}</td><td>{row.attendancePercent===null?'—':row.attendancePercent+'%'}</td></tr>)}</tbody>
        </table></div>
        <p className="monthly-register-legend">P = presente · A = ausencia · T = tardanza · E = excusa · R = retiro voluntario desde esa fecha. Tres tardanzas equivalen a una ausencia; E cuenta como día trabajado sin sumar asistencia y R sale del denominador. T y % quedan pendientes si falta una marca.</p>
        <p className="monthly-register-signature">Firma del docente: ___________________________________________ <span>Fecha: __________________</span></p>
      </>:<div className="empty-state">No hay sesiones impartidas para imprimir en este curso.</div>}
    </section>}
    {section==='month'&&<AttendanceWorkbookImportPanel course={course} courses={courses} onChange={remote.reload}/>}
    {section==='week'&&<>
      <section className="panel weekly-summary-panel" aria-labelledby="weekly-register-title">
        <div className="weekly-register-heading"><div><p className="eyebrow">ASISTENCIA POR ESTUDIANTE</p><h2 id="weekly-register-title">Veces que asistió cada semana</h2><p>Cada celda muestra presentes o tardanzas sobre las clases impartidas esa semana.</p></div></div>
        {weeks.length?<div className="table-wrap weekly-register-table-wrap"><table className="data-table weekly-register-table weekly-matrix-table" style={{minWidth:`${Math.max(1100,270+weeks.length*112)}px`}}><caption>{data.course.code} · P + T muestra cuántas veces asistió. El porcentaje usa las clases impartidas y excluye los días con R desde el retiro.</caption><thead><tr><th>N.º</th><th>Estudiante</th>{weeks.map(week=><th key={week.startDate}><span>{shortDate(week.startDate)}–{shortDate(week.endDate)}</span><small>{week.taught} impartidas · {week.notTaught} no impartidas</small></th>)}</tr></thead><tbody>{course.students.slice().sort((a,b)=>a.number-b.number).map(student=><tr key={student.id}><td className="row-number">{String(student.number).padStart(2,'0')}</td><td className="student-name">{student.name}</td>{weeks.map(week=>{const row=week.rows.find(item=>item.student.id===student.id);const worked=row?week.taught-row.withdrawn:0;return <td key={week.startDate} className="weekly-count-cell">{week.taught&&row?<><strong>{row.attended} / {worked}</strong><small>{row.pending?`${row.pending} pendiente(s)`:row.attendancePercent===null?'—':`${row.attendancePercent}%`}</small></>:<span className="muted">—</span>}</td>})}</tr>)}</tbody></table></div>:<div className="empty-state">Todavía no hay semanas con clases registradas en {course.code}.</div>}
        <p className="weekly-register-note">La tardanza cuenta como asistencia en el conteo semanal. El registro mensual aplica la regla de tres tardanzas por una ausencia al calcular T y %.</p>
      </section>
      <section className="panel weekly-detail-panel" aria-labelledby="weekly-detail-title">
        <div className="weekly-register-heading"><div><p className="eyebrow">DETALLE DE LA SEMANA</p><h2 id="weekly-detail-title">Marcas por día</h2><p>{selectedWeek?`Semana del ${shortDate(selectedWeek.startDate)} al ${shortDate(selectedWeek.endDate)} · ${selectedWeek.taught} impartidas · ${selectedWeek.notTaught} no impartidas`:"Selecciona una semana con clases registradas."}</p></div><div className="toolbar weekly-register-controls"><label>Semana<select aria-label="Semana de asistencia" value={selectedWeek?.startDate??''} onChange={e=>setWeekStart(e.target.value)}>{weeks.map(week=><option key={week.startDate} value={week.startDate}>{shortDate(week.startDate)} – {shortDate(week.endDate)}</option>)}</select></label></div></div>
        {selectedWeek&&selectedWeek.taught>0?<div className="table-wrap weekly-register-table-wrap"><table className="data-table weekly-register-table"><thead><tr><th>N.º</th><th>Estudiante</th>{selectedWeek.slots.map(slot=><th key={`${slot.date}:${slot.block}`}><span>{shortDate(slot.date)}</span><small>Bloque {slot.block}</small></th>)}<th>P</th><th>A</th><th>T</th><th>E</th><th>R</th><th>Asistió</th><th>%</th></tr></thead><tbody>{selectedWeek.rows.map(row=><tr key={row.student.id}><td className="row-number">{String(row.student.number).padStart(2,'0')}</td><td className="student-name">{row.student.name}</td>{selectedWeek.slots.map((slot,index)=>{const mark=row.marks[index];return <td key={`${slot.date}:${slot.block}`} className={'register-mark'+(mark?' register-mark-'+mark:'')}>{mark??'—'}</td>})}<td>{row.present}</td><td>{row.absent}</td><td>{row.late}</td><td>{row.excused}</td><td>{row.withdrawn}</td><td><strong>{row.attended} / {selectedWeek.taught-row.withdrawn}</strong></td><td>{row.attendancePercent===null?'Pend.':row.attendancePercent+'%'}</td></tr>)}</tbody></table></div>:<div className="empty-state">En esta semana no se impartió ninguna clase.</div>}
      </section>
    </>}
  </>;
}
function AttendanceCapture({initial,courseCode,today,onReload,mode}:{initial:AttendanceView;courseCode:string;today:string;onReload:()=>void;mode:'attendance'|'behavior'}){
  const sessionKey=initial.session.courseId+':'+initial.session.date+':'+initial.session.block;
  const initialValue={rows:initial.rows,lessonType:initial.session.lessonType,topic:initial.session.topic,notes:initial.session.notes};
  const initialRatings={rows:initial.rows.map(({studentId,behavior,discipline,participation,participationMax,dailyAssessmentRequired,comment})=>({studentId,behavior,discipline,participation,participationMax,dailyAssessmentRequired,comment}))};
  const attendanceDraft=useDraft('attendance:'+sessionKey,initialValue,initial.session.revision);
  const assessmentDraft=useDraft('daily-assessment:'+sessionKey,initialRatings,initial.session.assessmentRevision);
  const captureModeKey='attendance-mode:'+sessionKey;
  const [sessionRevision,setSessionRevision]=useState(initial.session.revision);const [captureMode,setCaptureMode]=useState<'attendance'|'behavior'>(mode);
  const [search,setSearch]=useState('');const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const [reviewOpen,setReviewOpen]=useState(false);
  const [assessmentAutoSave,setAssessmentAutoSave]=useState<'idle'|'pending'|'saved'|'error'>('idle');const assessmentSavingRef=useRef(false);const assessmentSaveRef=useRef<()=>Promise<void>>(async()=>{});
  const [status,setStatus]=useState(initial.session.status);const future=initial.session.date>today;
  const pendingCount=attendanceDraft.value.rows.filter(r=>r.status===null).length;
  const recordedCount=attendanceDraft.value.rows.length-pendingCount;
  const classMarkCount=attendanceDraft.value.rows.filter(r=>r.status!==null&&r.status!=='R').length;
  const canConfirm=classMarkCount>0||initial.session.status==='impartida';
  const behaviorReady=status==='impartida';
  const activeDraft=captureMode==='attendance'?attendanceDraft:assessmentDraft;
  const assessableCount=attendanceDraft.value.rows.filter(r=>r.status==='P'||r.status==='T').length;
  const behaviorRecordedCount=assessmentDraft.value.rows.filter(r=>{const attendance=attendanceDraft.value.rows.find(item=>item.studentId===r.studentId);return (attendance?.status==='P'||attendance?.status==='T')&&r.behavior!==null;}).length;
  const completedAssessmentCount=assessmentDraft.value.rows.filter(r=>{const attendance=attendanceDraft.value.rows.find(item=>item.studentId===r.studentId);return (attendance?.status==='P'||attendance?.status==='T')&&r.participation!==null&&r.behavior!==null&&r.discipline!==null;}).length;
  useEffect(()=>{
    if(initial.session.status!=='impartida')return;
    try{setCaptureMode(window.localStorage.getItem(captureModeKey)==='attendance'?'attendance':'behavior');}catch{setCaptureMode('behavior');}
  },[captureModeKey,initial.session.status]);
  function attendanceRow(id:string,patch:Partial<AttendanceView['rows'][number]>){attendanceDraft.set({...attendanceDraft.value,rows:attendanceDraft.value.rows.map(r=>r.studentId===id?{...r,...patch}:r)});}
  function assessmentRow(id:string,patch:Partial<(typeof assessmentDraft.value.rows)[number]>){assessmentDraft.set({...assessmentDraft.value,rows:assessmentDraft.value.rows.map(r=>r.studentId===id?{...r,...patch}:r)});}
  function changeCaptureMode(next:'attendance'|'behavior',rememberConfirmed=false){
    setCaptureMode(next);
    try{
      if(next==='attendance')window.localStorage.setItem(captureModeKey,'attendance');
      else if(behaviorReady||rememberConfirmed)window.localStorage.setItem(captureModeKey,'behavior');
      else window.localStorage.removeItem(captureModeKey);
    }catch{}
  }
  async function saveAttendance(){
    if(assessmentDraft.dirty||assessmentDraft.stale){setError('Guarda o descarta primero la valoración diaria pendiente y recarga si otra pestaña ya la cambió.');return;}
    setSaving(true);setError('');setMessage('');
    try{const receipt=await apiPost<SaveReceipt>('attendance',{...attendanceDraft.value,rows:attendanceDraft.value.rows.map(({studentId,status})=>({studentId,status})),requestId:attendanceDraft.operation(),courseId:initial.session.courseId,date:initial.session.date,block:initial.session.block,revision:attendanceDraft.revision});attendanceDraft.saved(receipt.revision);setSessionRevision(receipt.revision);if(receipt.status)setStatus(receipt.status);const refreshedRatings={...assessmentDraft.value,rows:assessmentDraft.value.rows.map(row=>{const attendance=attendanceDraft.value.rows.find(item=>item.studentId===row.studentId);return attendance?.status==='P'||attendance?.status==='T'?row:{...row,behavior:null,participation:null,dailyAssessmentRequired:false,comment:''};})};assessmentDraft.rebase(refreshedRatings,assessmentDraft.revision);setReviewOpen(false);if(receipt.status==='impartida')changeCaptureMode('behavior',true);setMessage('Asistencia confirmada · '+receipt.savedRows+' estudiantes · '+pendingCount+' pendiente(s)'+(receipt.status==='impartida'?' · sesión impartida · completa la valoración del bloque':' · sesión no impartida')+'.');}
    catch(e){setError(errorText(e));}finally{setSaving(false);}
  }
  async function saveDailyAssessment(automatic=false){
    if(!behaviorReady||attendanceDraft.dirty||assessmentDraft.stale||future||!assessmentDraft.dirty||assessmentSavingRef.current)return;
    assessmentSavingRef.current=true;
    setSaving(true);setError('');setMessage('');
    try{const receipt=await apiPost<SaveReceipt>('daily-assessment',{requestId:assessmentDraft.operation(),courseId:initial.session.courseId,date:initial.session.date,block:initial.session.block,revision:sessionRevision,assessmentRevision:assessmentDraft.revision,rows:assessmentDraft.value.rows});assessmentDraft.saved(receipt.revision);setAssessmentAutoSave('saved');setMessage(automatic?'Valoración parcial guardada en la cuenta · puedes cambiar de curso y retomarla aquí.':'Participación, comportamiento y disciplina guardados · '+completedAssessmentCount+' valoraciones completas · comprobante '+receipt.operationId.slice(0,8));}
    catch(e){setAssessmentAutoSave('error');setError(errorText(e));}finally{assessmentSavingRef.current=false;setSaving(false);}
  }
  assessmentSaveRef.current=async()=>saveDailyAssessment(true);
  const assessmentSnapshot=JSON.stringify(assessmentDraft.value);
  useEffect(()=>{
    if(captureMode!=='behavior'||!behaviorReady||attendanceDraft.dirty||assessmentDraft.stale||future||!assessmentDraft.dirty)return;
    setAssessmentAutoSave('pending');
    const timer=window.setTimeout(()=>{void assessmentSaveRef.current();},800);
    return()=>window.clearTimeout(timer);
  },[captureMode,behaviorReady,attendanceDraft.dirty,assessmentDraft.stale,future,assessmentDraft.dirty,assessmentDraft.revision,assessmentSnapshot]);
  const rows=attendanceDraft.value.rows.filter(r=>(r.name+' '+r.number).toLowerCase().includes(search.toLowerCase()));
  const ratingById=new Map(assessmentDraft.value.rows.map(row=>[row.studentId,row]));
  const counts=Object.fromEntries(marks.map(([m])=>[m,attendanceDraft.value.rows.filter(r=>r.status===m).length]));
  const shortDate=initial.session.date.split('-').reverse().join('/');
  return <><div className="metrics compact"><div className="metric"><span>En lista</span><strong>{attendanceDraft.value.rows.length}</strong></div>{marks.map(([m,label])=><div className="metric" key={m}><span>{label}</span><strong className={'mark-color-'+m}>{counts[m!]}</strong></div>)}<div className="metric"><span>Estado de sesión</span><strong className="small-value">{attendanceDraft.dirty?'borrador pendiente':status.replace('_',' ')}</strong></div><div className="metric"><span>Comportamiento registrado</span><strong>{behaviorRecordedCount} / {assessableCount}</strong></div><div className="metric"><span>Valoraciones completas</span><strong>{completedAssessmentCount} / {assessableCount}</strong></div></div>
  {future&&<div className="notice">{initial.session.scheduled?'Esta fecha y bloque figuran en el horario; la asistencia queda programada hasta que llegue el día.':'Este bloque no aparece en el horario cargado. Las fechas posteriores a '+initial.session.calendarThrough+' necesitan que se complete el calendario.'}</div>}
  {!initial.session.scheduled&&!future&&<div className="notice warning">Este día y bloque no aparecen en el horario cargado hasta {initial.session.calendarThrough}. Si hubo una clase extraordinaria, marca la asistencia; sin marcas queda como no programada.</div>}
  <div className="toolbar attendance-capture-tabs" role="tablist" aria-label="Pasos del registro diario">
    <button type="button" role="tab" aria-selected={captureMode==='attendance'} aria-label="Paso 1: asistencia" className={'button '+(captureMode==='attendance'?'primary':'secondary')} onClick={()=>changeCaptureMode('attendance')}><Check size={16}/> 1 · Asistencia</button>
    <button type="button" role="tab" aria-selected={captureMode==='behavior'} aria-label="Paso 2: participación, comportamiento y disciplina" className={'button '+(captureMode==='behavior'?'primary':'secondary')} onClick={()=>changeCaptureMode('behavior')}><Save size={16}/> 2 · Participación y comportamiento</button>
  </div>
  <p className="attendance-flow-hint" role="status">{behaviorReady?'Asistencia confirmada. Completa aquí la participación, el comportamiento y la disciplina; los cambios se guardan automáticamente y puedes cambiar de curso.':'Confirma la asistencia para abrir la valoración del bloque en esta misma pantalla.'}</p>
  <DraftNotice dirty={activeDraft.dirty} stale={activeDraft.stale} onDiscard={activeDraft.discard} onExport={()=>downloadJson(captureMode==='attendance'?'borrador-asistencia.json':'borrador-valoracion-diaria.json',activeDraft.value)}/>
  {captureMode==='attendance'?<>
    <section className="panel"><fieldset disabled={saving} className="bare-fieldset"><div className="form-grid session-fields"><label>Tipo de clase<select value={attendanceDraft.value.lessonType} onChange={e=>attendanceDraft.set({...attendanceDraft.value,lessonType:e.target.value as ClassLessonType})}>{initial.session.lessonType==='importada'&&<option value="importada">Tipo no especificado · importado</option>}<option value="teoria">Teórica</option><option value="practica">Práctica</option><option value="ejercicios">Ejercicios</option><option value="repaso">Repaso</option><option value="correcciones">Correcciones</option><option value="actividad_escolar">Actividad escolar</option></select></label><label>Tema trabajado<input placeholder="Tema o actividad del día" maxLength={200} value={attendanceDraft.value.topic} onChange={e=>attendanceDraft.set({...attendanceDraft.value,topic:e.target.value})}/></label><label>Observación de la clase<input placeholder="Opcional" maxLength={1000} value={attendanceDraft.value.notes} onChange={e=>attendanceDraft.set({...attendanceDraft.value,notes:e.target.value})}/></label></div>
    <div className="table-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Buscar estudiante" placeholder="Buscar estudiante…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button type="button" className="button secondary" disabled={future} onClick={()=>attendanceDraft.set({...attendanceDraft.value,rows:attendanceDraft.value.rows.map(r=>({...r,status:'P'}))})}><Check size={16}/> Todos presentes</button></div>
    <div className="table-wrap"><table className="data-table attendance-table"><thead><tr><th>N.º</th><th>Estudiante</th><th>Asistencia</th></tr></thead><tbody>{rows.map(r=><tr key={r.studentId}><td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td><td><div className="attendance-marks">{marks.map(([m,label])=><button type="button" aria-label={label+' '+r.name} aria-pressed={r.status===m} title={label} disabled={future} key={m} className={'attendance-mark mark-'+m+(r.status===m?' selected':'')} onClick={()=>attendanceRow(r.studentId,r.status===m?{status:null}:{status:m})}>{m}</button>)}</div></td></tr>)}</tbody></table>{!rows.length&&<div className="empty-state">No hay estudiantes que coincidan con la búsqueda.</div>}</div>
    </fieldset></section>
    {reviewOpen&&<section className="panel attendance-confirmation-panel" aria-labelledby="attendance-confirmation-title">
    <div className="attendance-confirmation-heading">
      <div><p className="eyebrow">REVISIÓN ANTES DE GUARDAR</p><h2 id="attendance-confirmation-title">Confirma la lista de {courseCode}</h2><p>{shortDate} · Bloque {initial.session.block}. Al confirmar, la sesión y sus marcas entran en los resúmenes y el registro mensual.</p></div>
      <span className="attendance-confirmation-total">{recordedCount} / {attendanceDraft.value.rows.length}<small>con estado</small></span>
    </div>
    <div className="attendance-review-counts">
      {marks.map(([mark,label])=><div className="attendance-review-count" key={mark}><span>{label}</span><strong className={'mark-color-'+mark}>{counts[mark!]}</strong></div>)}
      <div className="attendance-review-count pending"><span>Pendientes</span><strong>{pendingCount}</strong></div>
    </div>
    {pendingCount>0&&<div className="notice warning"><AlertCircle size={17}/><span>Quedan {pendingCount} estudiantes sin estado. Si confirmas ahora, la clase contará como impartida y esas marcas seguirán pendientes; puedes corregirlas más tarde.</span></div>}
    <div className="toolbar attendance-confirmation-actions">
      <button className="button secondary" type="button" disabled={saving} onClick={()=>setReviewOpen(false)}>Volver a la lista</button>
      <button className="button primary" type="button" disabled={saving||attendanceDraft.stale||!canConfirm} onClick={saveAttendance}>{saving?<LoaderCircle className="spin" size={17}/>:<Check size={17}/>} {saving?'Confirmando…':pendingCount?'Confirmar con '+pendingCount+' pendiente(s)':'Confirmar asistencia'}</button>
    </div>
  </section>}
    <div className="save-bar"><span><strong>{recordedCount}</strong> de {attendanceDraft.value.rows.length} estudiantes con estado · <strong>{pendingCount}</strong> pendientes<small> · El borrador se conserva en este navegador; solo confirmar actualiza la asistencia.</small></span><div className="toolbar"><button className="button secondary" disabled={saving||attendanceDraft.dirty} onClick={onReload}>Actualizar</button><button className="button primary" disabled={saving||attendanceDraft.stale||future||!canConfirm||(!attendanceDraft.dirty&&status==='impartida')} onClick={()=>{setError('');setMessage('');setReviewOpen(true);}}><Check size={17}/> Revisar y confirmar</button></div></div>
    {classMarkCount===0&&status!=='impartida'&&!future&&<div className="notice">Todavía no hay marcas de asistencia. Esta fecha seguirá como {initial.session.scheduled?'no impartida':'no programada'}; marca la lista para poder confirmarla.</div>}
  </>:<>
    {!behaviorReady&&<div className="notice warning">La participación, el comportamiento y la disciplina se habilitan después de confirmar la asistencia de este curso, fecha y bloque.</div>}
    <div className="panel"><div className="table-toolbar"><div><strong>Valoración del bloque</strong><p className="muted">Marca a los estudiantes por partes. Los cambios se guardan automáticamente en la cuenta y quedan ligados a {courseCode} · {shortDate} · bloque {initial.session.block}.</p><p className="muted" role="status">{assessmentAutoSave==='pending'?'Guardando cambios…':assessmentAutoSave==='saved'&&!assessmentDraft.dirty?'Guardado en la cuenta':assessmentAutoSave==='error'?'No se pudo guardar; el borrador sigue en este navegador':'Los espacios sin marcar siguen pendientes.'}</p></div><div className="search-field"><Search size={17}/><input aria-label="Buscar estudiante" placeholder="Buscar estudiante…" value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
      <fieldset className="bare-fieldset" disabled={saving||!behaviorReady||future||attendanceDraft.dirty||assessmentDraft.stale}><div className="table-wrap"><table className="data-table attendance-table"><thead><tr><th>N.º</th><th>Estudiante</th><th>Asistencia confirmada</th><th>Participación / {initial.rows.find(r=>r.participationMax!==null)?.participationMax??10}</th><th>Comportamiento / {initial.rows.find(r=>r.participationMax!==null)?.participationMax??10}</th><th>Disciplina / {initial.rows.find(r=>r.participationMax!==null)?.participationMax??10}</th><th>Observación</th></tr></thead><tbody>{rows.map(r=>{const rating=ratingById.get(r.studentId);const eligible=r.status==='P'||r.status==='T';const max=rating?.participationMax??r.participationMax??10;const percent=(value:number|null|undefined)=>value===null||value===undefined?'Pendiente':(value/max*100)+'%';return <tr key={r.studentId}><td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td><td><span className={'pill '+(eligible?'':'provisional')}>{marks.find(([m])=>m===r.status)?.[1]??'Pendiente'}</span></td><td><input className="score-input" aria-label={'Participación '+r.name} type="number" min={0} max={max} step={0.5} value={rating?.participation??''} disabled={!eligible} onChange={e=>assessmentRow(r.studentId,{participation:e.target.value===''?null:Number(e.target.value)})}/><span className="percent-note">{!eligible?'Sin asistencia · participación = 0':percent(rating?.participation)}</span></td><td><input className="score-input" aria-label={'Comportamiento '+r.name} type="number" min={0} max={max} step={0.5} value={rating?.behavior??''} disabled={!eligible} onChange={e=>assessmentRow(r.studentId,{behavior:e.target.value===''?null:Number(e.target.value)})}/><span className="percent-note">{!eligible?'No evaluado':percent(rating?.behavior)}</span></td><td><input className="score-input" aria-label={'Disciplina '+r.name} type="number" min={0} max={max} step={0.5} value={rating?.discipline??''} disabled={!eligible} onChange={e=>assessmentRow(r.studentId,{discipline:e.target.value===''?null:Number(e.target.value)})}/><span className="percent-note">{!eligible?'No evaluada':percent(rating?.discipline)}</span></td><td><input aria-label={'Observación '+r.name} placeholder="Opcional" maxLength={500} value={rating?.comment??''} disabled={!eligible} onChange={e=>assessmentRow(r.studentId,{comment:e.target.value})}/></td></tr>})}</tbody></table>{!rows.length&&<div className="empty-state">No hay estudiantes que coincidan con la búsqueda.</div>}</div></fieldset>
    </div>
    <div className="save-bar"><span><strong>{behaviorRecordedCount}</strong> de {assessableCount} estudiantes con comportamiento registrado · <strong>{completedAssessmentCount}</strong> con las tres valoraciones completas<small> · El plan define el porcentaje de cada dimensión dentro de los 15 puntos del período.</small></span><div className="toolbar"><button className="button secondary" disabled={saving||assessmentDraft.dirty} onClick={onReload}>Actualizar</button><button className="button primary" disabled={saving||assessmentDraft.stale||future||!behaviorReady||attendanceDraft.dirty||!assessmentDraft.dirty} onClick={()=>void saveDailyAssessment(false)}>{saving?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>} {saving?'Guardando…':'Guardar ahora'}</button></div></div>
  </>}
  {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status"><Check size={17}/>{message}</div>}<p className="footnote">Sin marcas guardadas, un bloque pasado del horario queda como no impartido; fuera del calendario queda no programado. Las valoraciones se guardan por separado y solo incluyen estudiantes presentes o tardíos.</p></>;
}
export function GradesPanel({course,activities,selectedActivityId,onOpenActivities}:{course:Course;activities:Activity[];selectedActivityId?:string;onOpenActivities:()=>void}){
  const list=activities.filter(a=>a.courseId===course.id&&(a.scoringMode==='rubric'?a.indicatorPoints.length>0&&a.rubric.length>0:Boolean(a.instrument.trim()||a.indicatorPoints.length)));
  const [selected,setSelected]=useState(selectedActivityId||list[0]?.id||'');useEffect(()=>{if(selectedActivityId)setSelected(selectedActivityId);},[selectedActivityId]);const id=list.some(a=>a.id===selected)?selected:list[0]?.id||'';
  const remote=useRemote<GradesView>('grades',{activityId:id},Boolean(id));
  return <><div className="section-heading"><div><p className="eyebrow">EVALUACIÓN</p><h1>Calificaciones</h1><p className="muted">Selecciona una actividad ya preparada para registrar sus resultados. Puedes corregirla aunque sea de otro día.</p></div></div>
  {list.length>0&&<div className="panel activity-selector"><label>Actividad preparada<select value={id} onChange={e=>setSelected(e.target.value)}>{list.map(a=><option value={a.id} key={a.id}>{a.date+' · '+(a.sequenceCode?a.sequenceCode+' · ':'')+a.title+' / '+a.maxPoints}</option>)}</select></label><p className="muted">Guardar notas conserva la asistencia y el estado de la clase.</p></div>}
  {!id?<div className="empty-state"><h2>No hay actividades listas para calificar</h2><p>Una actividad aparece aquí después de asignarla a un período y guardar su valoración. La calificación directa necesita indicadores con puntos; la rúbrica, además, criterios vinculados.</p><button className="button secondary" onClick={onOpenActivities}>Ir a Actividades</button></div>:remote.data?<GradeCapture key={id+remote.data.activity.revision} initial={remote.data} course={course}/>:<Loader error={remote.error}/>}</>;
}
function GradeCapture({initial,course}:{initial:GradesView;course:Course}){
  const activity=initial.activity;const draft=useDraft('grades:'+activity.id,initial.rows,activity.revision);
  const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const [search,setSearch]=useState('');
  function row(id:string,patch:Partial<GradesView['rows'][number]>){draft.set(draft.value.map(r=>r.studentId===id?{...r,...patch}:r));}
  function level(id:string,criterionId:string,value:string){
    const current=draft.value.find(r=>r.studentId===id)!;const levels={...current.criterionLevels};if(value==='')delete levels[criterionId];else levels[criterionId]=Number(value);
    const complete=activity.rubric.every(c=>levels[c.id]!==undefined);
    const max=activity.rubric.reduce((n,c)=>n+Math.max(...c.levels.map(l=>l.points))*(c.weight??1),0);
    const raw=complete&&activity.indicatorPoints.length?activity.indicatorPoints.reduce((sum,allocation)=>{
      const grouped=activity.rubric.filter(criterion=>criterion.indicatorId===allocation.indicatorId);
      const possible=grouped.reduce((n,criterion)=>n+Math.max(...criterion.levels.map(level=>level.points))*(criterion.weight??1),0);
      const earned=grouped.reduce((n,criterion)=>n+criterion.levels[levels[criterion.id]].points*(criterion.weight??1),0);
      return sum+(possible?allocation.points*earned/possible:0);
    },0):complete?activity.rubric.reduce((n,c)=>n+c.levels[levels[c.id]].points*(c.weight??1),0):0;
    row(id,{criterionLevels:Object.keys(levels).length?levels:null,score:complete?Math.round((activity.indicatorPoints.length?raw:raw/max*activity.maxPoints)*100)/100:null});
  }
  async function save(){setSaving(true);setError('');setMessage('');try{const receipt=await apiPost<SaveReceipt>('grades',{activityId:activity.id,revision:draft.revision,requestId:draft.operation(),rows:draft.value.map(({studentId,score,criterionLevels,comment})=>({studentId,score,criterionLevels,comment}))});draft.saved(receipt.revision);setMessage('Calificaciones guardadas · '+receipt.savedRows+' estudiantes · comprobante '+receipt.operationId.slice(0,8));}catch(e){setError(errorText(e));}finally{setSaving(false);}}
  return <>
    <div className="metrics compact">
      <div className="metric"><span>Calificados</span><strong>{draft.value.filter(r=>r.score!==null).length}</strong></div>
      <div className="metric"><span>Pendientes</span><strong>{draft.value.filter(r=>r.score===null).length}</strong></div>
      <div className="metric"><span>Valor de la actividad</span><strong>{activity.maxPoints}<small> puntos</small></strong></div>
      <div className="metric"><span>Instrumento</span><strong className="small-value">{activity.scoringMode==='rubric'?'Rúbrica':'Puntos directos'}</strong></div>
    </div>
    <DraftNotice dirty={draft.dirty} stale={draft.stale} onDiscard={draft.discard} onExport={()=>downloadJson('borrador-notas.json',draft.value)}/>
    {activity.scoringMode==='rubric'&&<RubricReference activity={activity} course={course}/>}
    <section className="panel">
      <div className="table-toolbar">
        <div className="search-field"><Search size={17}/><input placeholder="Buscar estudiante…" aria-label="Buscar estudiante en calificaciones" value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <span className="pill">0 es una nota válida</span>
      </div>
      <fieldset disabled={saving} className="bare-fieldset">
        <div className="table-wrap">
          <table className="data-table grade-capture-table">
            <thead><tr><th>N.º</th><th>Estudiante</th>{activity.scoringMode==='rubric'&&activity.rubric.map(c=><th key={c.id}><span>{c.label}</span><small className="cell-description">{COMPETENCY_GROUPS.find(g=>g.key===c.competency)?.label??c.indicator??''}</small><details className="grade-criterion-help"><summary>Ver niveles</summary><div>{c.levels.map((item,index)=><p key={`${item.label}-${index}`}><strong>{item.label} · {item.points}</strong>{item.description&&<span>{item.description}</span>}</p>)}</div></details></th>)}<th>Nota final / {activity.maxPoints}</th><th>Porcentaje</th><th>Comentario</th></tr></thead>
            <tbody>{draft.value.filter(r=>(r.name+' '+r.number).toLowerCase().includes(search.toLowerCase())).map(r=><tr key={r.studentId}>
              <td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td>
              {activity.scoringMode==='rubric'&&activity.rubric.map(c=>{const selected=r.criterionLevels?.[c.id];return <td key={c.id}><select aria-label={c.label+' '+r.name} value={selected??''} onChange={e=>level(r.studentId,c.id,e.target.value)}><option value="">Pendiente</option>{c.levels.map((l,i)=><option key={i} value={i}>{l.label+' ('+l.points+')'}</option>)}</select>{selected!==undefined&&c.levels[selected]?.description&&<small className="selected-level-descriptor">{c.levels[selected].description}</small>}</td>})}
              <td>{activity.scoringMode==='points'?<input className="score-input" type="number" min={0} max={activity.maxPoints} step={0.01} value={r.score??''} aria-label={'Nota '+r.name} onChange={e=>row(r.studentId,{score:e.target.value===''?null:Number(e.target.value)})}/>:<strong>{r.score===null?'Pendiente':r.score.toFixed(2)}</strong>}</td>
              <td>{r.score===null?<span className="pending-label">Pendiente</span>:Math.round(r.score/activity.maxPoints*100)+'%'}</td>
              <td><input aria-label={'Comentario '+r.name} maxLength={500} placeholder="Opcional" value={r.comment} onChange={e=>row(r.studentId,{comment:e.target.value})}/></td>
            </tr>)}</tbody>
          </table>
        </div>
      </fieldset>
    </section>
    <div className="save-bar"><span>Los cambios se aplican únicamente a <strong>{activity.title}</strong>.</span><button className="button primary" onClick={save} disabled={saving||draft.stale}>{saving?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>} {saving?'Guardando…':'Guardar calificaciones'}</button></div>
    {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status"><Check size={17}/>{message}</div>}
  </>;
}

function RubricReference({activity,course}:{activity:Activity;course:Course}){
  const order=(activity.rubric[0]?.levels.map((_,index)=>index)??[]).reverse();
  return <section className="panel rubric-reference" aria-label="Matriz completa de criterios y descriptores">
    <details className="rubric-reference-details">
      <summary><span>Consultar matriz completa y descriptores</span><small>{activity.rubric.length} criterios · {activity.maxPoints} puntos</small></summary>
      <div className="rubric-reference-content">
        <div className="rubric-reference-heading">
          <div><p className="eyebrow">MATRIZ DE EVALUACIÓN · {activity.period}</p><h2>{activity.title}</h2><p>{activity.description||activity.evidence||activity.purpose||'Descriptores usados para valorar cada criterio.'}</p></div>
          <strong className="rubric-final-value">{activity.maxPoints}<small> puntos finales</small></strong>
        </div>
        <div className="rubric-metadata">
          <div><span>Área</span><strong>Matemática</strong></div>
          <div><span>Curso</span><strong>{course.code}</strong></div>
          <div><span>Fecha</span><strong>{activity.date}</strong></div>
          <div><span>Tema / secuencia</span><strong>{activity.sequenceCode||activity.period}</strong></div>
          <div><span>Instrumento</span><strong>{activity.instrument||'Rúbrica analítica'}</strong></div>
        </div>
        <div className="table-wrap rubric-matrix-wrap">
          <table className="data-table rubric-matrix-table">
            <thead><tr><th>Nivel de desempeño</th>{activity.rubric.map(c=><th key={c.id}><strong>{c.label}</strong><small>{COMPETENCY_GROUPS.find(g=>g.key===c.competency)?.label??c.competency??'Competencia pendiente'}</small>{c.indicator&&<small>Indicador: {c.indicator}</small>}<small>Peso {c.weight??1} · máximo {Math.max(...c.levels.map(l=>l.points))*(c.weight??1)}</small></th>)}</tr></thead>
            <tbody>{order.map(levelIndex=><tr key={levelIndex} className={'rubric-level-row rubric-level-'+levelIndex}>
              <th scope="row"><span>{activity.rubric[0]?.levels[levelIndex]?.label??'Nivel'}</span><small>{activity.rubric[0]?.levels[levelIndex]?.points??''} pts base</small></th>
              {activity.rubric.map(c=>{const level=c.levels[levelIndex];return <td key={c.id}><div className="rubric-descriptor-label">{level?.label} <span>{level?.points} pts × {c.weight??1}</span></div><p>{level?.description||'Sin descriptor definido.'}</p></td>;})}
            </tr>)}</tbody>
          </table>
        </div>
        <p className="rubric-reference-note">Selecciona un nivel por criterio para cada estudiante. La nota final se convierte proporcionalmente al máximo de {activity.maxPoints} puntos y queda pendiente hasta completar todos los criterios.</p>
      </div>
    </details>
  </section>;
}

