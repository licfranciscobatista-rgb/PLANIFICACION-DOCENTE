'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Save, Search, AlertCircle, LoaderCircle, Download, RotateCcw } from 'lucide-react';
import { COMPETENCY_GROUPS } from '@/lib/model';
import type { Activity, AttendanceMark, AttendanceView, Course, CourseRegisterSummary, GradesView, LessonType, SaveReceipt } from '@/lib/model';
import { apiPost, downloadJson, errorText, useRemote } from '@/lib/client';

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
  function discard(){if(dirty&&!window.confirm('¿Descartar este borrador y cargar los valores guardados?'))return;setState(snapshot.current);setConfirmedRevision(snapshot.current.revision);setBase(JSON.stringify(snapshot.current.value));request.current=undefined;localStorage.removeItem(key);}
  return {value:state.value,set:(value:T)=>setState(x=>({...x,value})),revision:state.revision,dirty,stale:state.revision!==confirmedRevision,operation,saved,discard};
}
function DraftNotice({dirty,stale,onDiscard,onExport}:{dirty:boolean;stale:boolean;onDiscard:()=>void;onExport:()=>void}){
  if(!dirty&&!stale)return null;
  return <div className={'notice '+(stale?'warning':'draft-notice')}><AlertCircle size={17}/><span>{stale?'Hay una versión más reciente en la base. Conserva el borrador antes de recargar.':'Cambios pendientes de enviar. El borrador se conserva al cambiar de apartado.'}</span><button className="text-button" onClick={onExport}><Download size={14}/> Borrador</button><button className="text-button" onClick={onDiscard}><RotateCcw size={14}/> Descartar</button></div>;
}
export function AttendancePanel({course,today,mode='attendance',date,onDateChange,block,onBlockChange}:{course:Course;today:string;mode?:'attendance'|'behavior';date:string;onDateChange:(value:string)=>void;block:number;onBlockChange:(value:number)=>void}){
  const remote=useRemote<AttendanceView>('attendance',{courseId:course.id,date,block});
  return <><div className="section-heading"><div><p className="eyebrow">REGISTRO DIARIO · {course.code}</p><h1>{mode==='attendance'?'Asistencia del día':'Comportamiento del día'}</h1><p className="muted">El estado compara la asistencia con el horario de este curso. Asistencia y conducta quedan ligadas a la fecha y al bloque.</p></div><div className="toolbar"><label>Fecha<input type="date" min="2026-10-20" value={date||today} onChange={e=>e.target.value&&onDateChange(e.target.value)}/></label><label>Bloque<select value={block} onChange={e=>onBlockChange(Number(e.target.value))}><option value={1}>Bloque 1</option><option value={2}>Bloque 2</option><option value={3}>Bloque 3</option><option value={4}>Bloque 4</option><option value={5}>Bloque 5</option><option value={6}>Bloque 6</option><option value={7}>Bloque 7</option><option value={8}>Bloque 8</option></select></label></div></div>
  {remote.data?<AttendanceCapture key={course.id+date+block+remote.data.session.revision} initial={remote.data} today={today} onReload={remote.reload} mode={mode}/>:<Loader error={remote.error}/>}</>;
}
export function AttendanceSummaryPanel({course,demo,section}:{course:Course;demo:boolean;section:'month'|'week'}){
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
function AttendanceCapture({initial,today,onReload,mode}:{initial:AttendanceView;today:string;onReload:()=>void;mode:'attendance'|'behavior'}){
  const initialValue={rows:initial.rows,lessonType:initial.session.lessonType,topic:initial.session.topic,notes:initial.session.notes};
  const draft=useDraft('attendance:'+initial.session.courseId+':'+initial.session.date+':'+initial.session.block,initialValue,initial.session.revision);
  const [search,setSearch]=useState('');const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
  const [status,setStatus]=useState(initial.session.status);const future=initial.session.date>today;
  function row(id:string,patch:Partial<AttendanceView['rows'][number]>){draft.set({...draft.value,rows:draft.value.rows.map(r=>r.studentId===id?{...r,...patch}:r)});}
  async function save(){
    setSaving(true);setError('');setMessage('');
    try{const receipt=await apiPost<SaveReceipt>('attendance',{...draft.value,rows:draft.value.rows.map(({studentId,status,behavior,comment})=>({studentId,status,behavior,comment})),requestId:draft.operation(),courseId:initial.session.courseId,date:initial.session.date,block:initial.session.block,revision:draft.revision});draft.saved(receipt.revision);if(receipt.status)setStatus(receipt.status);setMessage('Guardado confirmado · '+receipt.savedRows+' estudiantes · comprobante '+receipt.operationId.slice(0,8));}
    catch(e){setError(errorText(e));}finally{setSaving(false);}
  }
  const rows=draft.value.rows.filter(r=>(r.name+' '+r.number).toLowerCase().includes(search.toLowerCase()));
  const counts=Object.fromEntries(marks.map(([m])=>[m,draft.value.rows.filter(r=>r.status===m).length]));
  return <><div className="metrics compact"><div className="metric"><span>En lista</span><strong>{draft.value.rows.length}</strong></div>{marks.map(([m,label])=><div className="metric" key={m}><span>{label}</span><strong className={'mark-color-'+m}>{counts[m!]}</strong></div>)}<div className="metric"><span>Clase guardada</span><strong className="small-value">{status.replace('_',' ')}</strong></div></div>
  {future&&<div className="notice">{initial.session.scheduled?'Esta fecha y bloque figuran en el horario; la asistencia queda programada hasta que llegue el día.':'Este bloque no aparece en el horario cargado. Las fechas posteriores a '+initial.session.calendarThrough+' necesitan que se complete el calendario.'}</div>}
  {!initial.session.scheduled&&!future&&<div className="notice warning">Este día y bloque no aparecen en el horario cargado hasta {initial.session.calendarThrough}. Si hubo una clase extraordinaria, marca la asistencia; sin marcas queda como no programada.</div>}
  <DraftNotice dirty={draft.dirty} stale={draft.stale} onDiscard={draft.discard} onExport={()=>downloadJson('borrador-asistencia.json',draft.value)}/>
  <section className="panel"><fieldset disabled={saving} className="bare-fieldset"><div className="form-grid session-fields"><label>Tipo de clase<select value={draft.value.lessonType} onChange={e=>draft.set({...draft.value,lessonType:e.target.value as LessonType})}><option value="teoria">Teórica</option><option value="practica">Práctica</option><option value="ejercicios">Ejercicios</option><option value="repaso">Repaso</option><option value="correcciones">Correcciones</option><option value="actividad_escolar">Actividad escolar</option></select></label><label>Tema trabajado<input placeholder="Tema o actividad del día" maxLength={200} value={draft.value.topic} onChange={e=>draft.set({...draft.value,topic:e.target.value})}/></label><label>Observación de la clase<input placeholder="Opcional" maxLength={1000} value={draft.value.notes} onChange={e=>draft.set({...draft.value,notes:e.target.value})}/></label></div>
  <div className="table-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Buscar estudiante" placeholder="Buscar estudiante…" value={search} onChange={e=>setSearch(e.target.value)}/></div>{mode==='attendance'&&<button type="button" className="button secondary" disabled={future} onClick={()=>draft.set({...draft.value,rows:draft.value.rows.map(r=>({...r,status:'P'}))})}><Check size={16}/> Todos presentes</button>}</div>
  <div className="table-wrap"><table className="data-table attendance-table"><thead><tr><th>N.º</th><th>Estudiante</th><th>Asistencia</th>{mode==='behavior'&&<th>Comportamiento / 10</th>}{mode==='behavior'&&<th>Observación individual</th>}</tr></thead><tbody>{rows.map(r=><tr key={r.studentId}><td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td><td>{mode==='attendance'?<div className="attendance-marks">{marks.map(([m,label])=><button type="button" aria-label={label+' '+r.name} aria-pressed={r.status===m} title={label} disabled={future} key={m} className={'attendance-mark mark-'+m+(r.status===m?' selected':'')} onClick={()=>row(r.studentId,r.status===m?{status:null}:{status:m,...(m==='A'||m==='E'||m==='R'?{behavior:null}:{})})}>{m}</button>)}</div>:<span className={'pill '+(r.status?'':'provisional')}>{marks.find(([m])=>m===r.status)?.[1]??'Pendiente'}</span>}</td>{mode==='behavior'&&<><td><input className="score-input" aria-label={'Comportamiento '+r.name} type="number" min={0} max={10} step={0.5} value={r.behavior??''} disabled={future||r.status==='A'||r.status==='E'||r.status==='R'} onChange={e=>row(r.studentId,{behavior:e.target.value===''?null:Number(e.target.value)})}/><span className="percent-note">{r.status==='A'||r.status==='E'||r.status==='R'?'Sin valoración por ausencia, excusa o retiro':r.behavior===null?'Pendiente':(r.behavior*10)+'%'}</span></td><td><input aria-label={'Observación '+r.name} placeholder="Opcional" maxLength={500} value={r.comment} onChange={e=>row(r.studentId,{comment:e.target.value})}/></td></>}</tr>)}</tbody></table>{!rows.length&&<div className="empty-state">No hay estudiantes que coincidan con la búsqueda.</div>}</div>
  </fieldset></section><div className="save-bar"><span>{mode==='attendance'?<><strong>{draft.value.rows.filter(r=>r.status!==null).length}</strong> de {draft.value.rows.length} asistencias marcadas</>:<><strong>{draft.value.rows.filter(r=>r.behavior!==null).length}</strong> de {draft.value.rows.length} valoraciones registradas</>} <small>· Vacío significa pendiente</small></span><div className="toolbar"><button className="button secondary" disabled={saving||draft.dirty} onClick={onReload}>Actualizar</button><button className="button primary" disabled={saving||draft.stale} onClick={save}>{saving?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>} {saving?'Guardando…':'Guardar registro del día'}</button></div></div>
  {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status"><Check size={17}/>{message}</div>}<p className="footnote">Un bloque del horario sin marcas queda como no impartido. Una fecha/bloque fuera del horario queda no programada. Cualquier marca P, A, T o E confirma que la clase se impartió.</p></>;
}
export function GradesPanel({course,activities,selectedActivityId,onNew}:{course:Course;activities:Activity[];selectedActivityId?:string;onNew:()=>void}){
  const list=activities.filter(a=>a.courseId===course.id);
  const [selected,setSelected]=useState(selectedActivityId||list[0]?.id||'');useEffect(()=>{if(selectedActivityId)setSelected(selectedActivityId);},[selectedActivityId]);const id=list.some(a=>a.id===selected)?selected:list[0]?.id||'';
  const remote=useRemote<GradesView>('grades',{activityId:id},Boolean(id));
  return <><div className="section-heading"><div><p className="eyebrow">EVALUACIÓN</p><h1>Calificaciones</h1><p className="muted">Puedes corregir hoy una actividad de otro día.</p></div><button className="button primary" onClick={onNew}>Crear actividad</button></div>
  <div className="panel activity-selector"><label>Actividad o revisión<select value={id} onChange={e=>setSelected(e.target.value)}>{list.map(a=><option value={a.id} key={a.id}>{a.date+' · '+(a.sequenceCode?a.sequenceCode+' · ':'')+a.title+' / '+a.maxPoints}</option>)}</select></label><p className="muted">Guardar notas conserva la asistencia y el estado de la clase.</p></div>
  {!id?<div className="empty-state"><h2>Prepara tu primera actividad</h2><p>Crea una actividad, su categoría y su puntuación máxima.</p><button className="button primary" onClick={onNew}>Crear actividad</button></div>:remote.data?<GradeCapture key={id+remote.data.activity.revision} initial={remote.data} course={course}/>:<Loader error={remote.error}/>}</>;
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
            <thead><tr><th>N.º</th><th>Estudiante</th>{activity.scoringMode==='rubric'&&activity.rubric.map(c=><th key={c.id}><span>{c.label}</span><small className="cell-description">{COMPETENCY_GROUPS.find(g=>g.key===c.competency)?.label??c.indicator??''}</small></th>)}<th>Nota final / {activity.maxPoints}</th><th>Porcentaje</th><th>Comentario</th></tr></thead>
            <tbody>{draft.value.filter(r=>(r.name+' '+r.number).toLowerCase().includes(search.toLowerCase())).map(r=><tr key={r.studentId}>
              <td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td>
              {activity.scoringMode==='rubric'&&activity.rubric.map(c=>{const selected=r.criterionLevels?.[c.id];return <td key={c.id}><select aria-label={c.label+' '+r.name} value={selected??''} onChange={e=>level(r.studentId,c.id,e.target.value)}><option value="">Pendiente</option>{c.levels.map((l,i)=><option key={i} value={i}>{l.label+' ('+l.points+')'}</option>)}</select></td>})}
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
    <div className="rubric-reference-heading">
      <div><p className="eyebrow">MATRIZ DE EVALUACIÓN · {activity.period}</p><h2>{activity.title}</h2><p>{activity.evidence||activity.description||activity.purpose||'Descriptores usados para valorar cada criterio.'}</p></div>
      <strong className="rubric-final-value">{activity.maxPoints}<small> puntos finales</small></strong>
    </div>
    <div className="rubric-metadata">
      <div><span>Área</span><strong>Matemática</strong></div>
      <div><span>Curso</span><strong>{course.code}</strong></div>
      <div><span>Creada</span><strong>{activity.date}</strong></div>
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
  </section>;
}

