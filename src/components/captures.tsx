'use client';
import { useEffect, useRef, useState } from 'react';
import { Check, Save, Search, AlertCircle, LoaderCircle, Download, RotateCcw } from 'lucide-react';
import type { Activity, AttendanceMark, AttendanceView, Course, GradesView, LessonType, SaveReceipt } from '@/lib/model';
import { apiPost, downloadJson, errorText, useRemote } from '@/lib/client';

const marks:[AttendanceMark,string][]=[['P','Presente'],['A','Ausente'],['T','Tardanza'],['E','Excusa']];
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
export function AttendancePanel({course,today}:{course:Course;today:string}){
  const [date,setDate]=useState(today);const [block,setBlock]=useState(1);
  const remote=useRemote<AttendanceView>('attendance',{courseId:course.id,date,block});
  return <><div className="section-heading"><div><p className="eyebrow">REGISTRO DIARIO</p><h1>Asistencia y comportamiento</h1><p className="muted">Una captura por curso, fecha y bloque de clase.</p></div><div className="toolbar"><label>Fecha<input type="date" min="2026-10-20" value={date} onChange={e=>e.target.value&&setDate(e.target.value)}/></label><label>Bloque<select value={block} onChange={e=>setBlock(Number(e.target.value))}><option value={1}>Bloque 1</option><option value={2}>Bloque 2</option><option value={3}>Bloque 3</option></select></label></div></div>
  {remote.data?<AttendanceCapture key={course.id+date+block+remote.data.session.revision} initial={remote.data} today={today} onReload={remote.reload}/>:<Loader error={remote.error}/>}</>;
}
function AttendanceCapture({initial,today,onReload}:{initial:AttendanceView;today:string;onReload:()=>void}){
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
  {future&&<div className="notice">Esta fecha todavía no ha llegado. Puedes preparar el tema; la asistencia queda programada.</div>}
  <DraftNotice dirty={draft.dirty} stale={draft.stale} onDiscard={draft.discard} onExport={()=>downloadJson('borrador-asistencia.json',draft.value)}/>
  <section className="panel"><fieldset disabled={saving} className="bare-fieldset"><div className="form-grid session-fields"><label>Tipo de clase<select value={draft.value.lessonType} onChange={e=>draft.set({...draft.value,lessonType:e.target.value as LessonType})}><option value="teoria">Teórica</option><option value="practica">Práctica</option><option value="ejercicios">Ejercicios</option><option value="repaso">Repaso</option><option value="correcciones">Correcciones</option><option value="actividad_escolar">Actividad escolar</option></select></label><label>Tema trabajado<input placeholder="Tema o actividad del día" maxLength={200} value={draft.value.topic} onChange={e=>draft.set({...draft.value,topic:e.target.value})}/></label><label>Observación de la clase<input placeholder="Opcional" maxLength={1000} value={draft.value.notes} onChange={e=>draft.set({...draft.value,notes:e.target.value})}/></label></div>
  <div className="table-toolbar"><div className="search-field"><Search size={17}/><input aria-label="Buscar estudiante" placeholder="Buscar estudiante…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button type="button" className="button secondary" disabled={future} onClick={()=>draft.set({...draft.value,rows:draft.value.rows.map(r=>({...r,status:'P'}))})}><Check size={16}/> Todos presentes</button></div>
  <div className="table-wrap"><table className="data-table attendance-table"><thead><tr><th>N.º</th><th>Estudiante</th><th>Asistencia</th><th>Comportamiento / 10</th><th>Observación individual</th></tr></thead><tbody>{rows.map(r=><tr key={r.studentId}><td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td><td><div className="attendance-marks">{marks.map(([m,label])=><button type="button" aria-label={label+' '+r.name} aria-pressed={r.status===m} title={label} disabled={future} key={m} className={'attendance-mark mark-'+m+(r.status===m?' selected':'')} onClick={()=>row(r.studentId,{status:r.status===m?null:m})}>{m}</button>)}</div></td><td><input className="score-input" aria-label={'Comportamiento '+r.name} type="number" min={0} max={10} step={0.5} value={r.behavior??''} disabled={future} onChange={e=>row(r.studentId,{behavior:e.target.value===''?null:Number(e.target.value)})}/><span className="percent-note">{r.behavior===null?'Pendiente':(r.behavior*10)+'%'}</span></td><td><input aria-label={'Observación '+r.name} placeholder="Opcional" maxLength={500} value={r.comment} onChange={e=>row(r.studentId,{comment:e.target.value})}/></td></tr>)}</tbody></table>{!rows.length&&<div className="empty-state">No hay estudiantes que coincidan con la búsqueda.</div>}</div>
  </fieldset></section><div className="save-bar"><span><strong>{draft.value.rows.filter(r=>r.status!==null).length}</strong> de {draft.value.rows.length} asistencias marcadas <small>· Vacío significa pendiente</small></span><div className="toolbar"><button className="button secondary" disabled={saving||draft.dirty} onClick={onReload}>Actualizar</button><button className="button primary" disabled={saving||draft.stale} onClick={save}>{saving?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>} {saving?'Guardando…':'Guardar registro del día'}</button></div></div>
  {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status"><Check size={17}/>{message}</div>}<p className="footnote">La asistencia determina si se impartió la clase. El comportamiento es independiente de la marca de asistencia y se registra cuando lo observas.</p></>;
}
export function GradesPanel({course,activities,onNew}:{course:Course;activities:Activity[];onNew:()=>void}){
  const list=activities.filter(a=>a.courseId===course.id);
  const [selected,setSelected]=useState(list[0]?.id||''); const id=list.some(a=>a.id===selected)?selected:list[0]?.id||'';
  const remote=useRemote<GradesView>('grades',{activityId:id},Boolean(id));
  return <><div className="section-heading"><div><p className="eyebrow">EVALUACIÓN</p><h1>Calificaciones</h1><p className="muted">Puedes corregir hoy una actividad de otro día.</p></div><button className="button primary" onClick={onNew}>Crear actividad</button></div>
  <div className="panel activity-selector"><label>Actividad o revisión<select value={id} onChange={e=>setSelected(e.target.value)}>{list.map(a=><option value={a.id} key={a.id}>{a.date+' · '+a.title+' / '+a.maxPoints}</option>)}</select></label><p className="muted">Guardar notas conserva la asistencia y el estado de la clase.</p></div>
  {!id?<div className="empty-state"><h2>Prepara tu primera actividad</h2><p>Crea una actividad, su categoría y su puntuación máxima.</p><button className="button primary" onClick={onNew}>Crear actividad</button></div>:remote.data?<GradeCapture key={id+remote.data.activity.revision} initial={remote.data}/>:<Loader error={remote.error}/>}</>;
}
function GradeCapture({initial}:{initial:GradesView}){
  const activity=initial.activity;const draft=useDraft('grades:'+activity.id,initial.rows,activity.revision);
  const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');const [search,setSearch]=useState('');
  function row(id:string,patch:Partial<GradesView['rows'][number]>){draft.set(draft.value.map(r=>r.studentId===id?{...r,...patch}:r));}
  function level(id:string,criterionId:string,value:string){
    const current=draft.value.find(r=>r.studentId===id)!;const levels={...current.criterionLevels};if(value==='')delete levels[criterionId];else levels[criterionId]=Number(value);
    const complete=activity.rubric.every(c=>levels[c.id]!==undefined);
    const max=activity.rubric.reduce((n,c)=>n+Math.max(...c.levels.map(l=>l.points)),0);
    const raw=complete?activity.rubric.reduce((n,c)=>n+c.levels[levels[c.id]].points,0):0;
    row(id,{criterionLevels:Object.keys(levels).length?levels:null,score:complete?Math.round(raw/max*activity.maxPoints*100)/100:null});
  }
  async function save(){setSaving(true);setError('');setMessage('');try{const receipt=await apiPost<SaveReceipt>('grades',{activityId:activity.id,revision:draft.revision,requestId:draft.operation(),rows:draft.value.map(({studentId,score,criterionLevels,comment})=>({studentId,score,criterionLevels,comment}))});draft.saved(receipt.revision);setMessage('Calificaciones guardadas · '+receipt.savedRows+' estudiantes · comprobante '+receipt.operationId.slice(0,8));}catch(e){setError(errorText(e));}finally{setSaving(false);}}
  return <><div className="metrics compact"><div className="metric"><span>Calificados</span><strong>{draft.value.filter(r=>r.score!==null).length}</strong></div><div className="metric"><span>Pendientes</span><strong>{draft.value.filter(r=>r.score===null).length}</strong></div><div className="metric"><span>Valor de la actividad</span><strong>{activity.maxPoints}<small> puntos</small></strong></div><div className="metric"><span>Instrumento</span><strong className="small-value">{activity.scoringMode==='rubric'?'Rúbrica':'Puntos directos'}</strong></div></div>
  <DraftNotice dirty={draft.dirty} stale={draft.stale} onDiscard={draft.discard} onExport={()=>downloadJson('borrador-notas.json',draft.value)}/>
  <section className="panel"><div className="table-toolbar"><div className="search-field"><Search size={17}/><input placeholder="Buscar estudiante…" aria-label="Buscar estudiante en calificaciones" value={search} onChange={e=>setSearch(e.target.value)}/></div><span className="pill">0 es una nota válida</span></div><fieldset disabled={saving} className="bare-fieldset"><div className="table-wrap"><table className="data-table"><thead><tr><th>N.º</th><th>Estudiante</th>{activity.scoringMode==='rubric'&&activity.rubric.map(c=><th key={c.id}>{c.label}</th>)}<th>Nota / {activity.maxPoints}</th><th>Porcentaje</th><th>Comentario</th></tr></thead><tbody>{draft.value.filter(r=>(r.name+' '+r.number).toLowerCase().includes(search.toLowerCase())).map(r=><tr key={r.studentId}><td className="row-number">{String(r.number).padStart(2,'0')}</td><td className="student-name">{r.name}</td>{activity.scoringMode==='rubric'&&activity.rubric.map(c=><td key={c.id}><select aria-label={c.label+' '+r.name} value={r.criterionLevels?.[c.id]??''} onChange={e=>level(r.studentId,c.id,e.target.value)}><option value="">Pendiente</option>{c.levels.map((l,i)=><option key={i} value={i}>{l.label+' ('+l.points+')'}</option>)}</select></td>)}<td>{activity.scoringMode==='points'?<input className="score-input" type="number" min={0} max={activity.maxPoints} step={0.01} value={r.score??''} aria-label={'Nota '+r.name} onChange={e=>row(r.studentId,{score:e.target.value===''?null:Number(e.target.value)})}/>:<strong>{r.score??'—'}</strong>}</td><td>{r.score===null?<span className="pending-label">Pendiente</span>:Math.round(r.score/activity.maxPoints*100)+'%'}</td><td><input aria-label={'Comentario '+r.name} maxLength={500} placeholder="Opcional" value={r.comment} onChange={e=>row(r.studentId,{comment:e.target.value})}/></td></tr>)}</tbody></table></div></fieldset></section><div className="save-bar"><span>Los cambios se aplican únicamente a <strong>{activity.title}</strong>.</span><button className="button primary" onClick={save} disabled={saving||draft.stale}>{saving?<LoaderCircle className="spin" size={17}/>:<Save size={17}/>} {saving?'Guardando…':'Guardar calificaciones'}</button></div>{error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status"><Check size={17}/>{message}</div>}</>;
}

