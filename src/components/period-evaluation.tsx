'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { apiPost, errorText, useRemote } from '@/lib/client';
import type { Course, PeriodSheetPlan, PeriodSheetView } from '@/lib/model';

const fmt=(value:number|null)=>value===null?'Pendiente':new Intl.NumberFormat('es-DO',{maximumFractionDigits:2}).format(value);
export default function PeriodEvaluationPanel({courses,period,onPeriod}:{courses:Course[];period:string;onPeriod:(period:string)=>void}){
  const [courseId,setCourseId]=useState(courses[0]?.id??'');
  const [dirty,setDirty]=useState(false);
  const selected=courses.find(course=>course.id===courseId)??courses[0];
  const remote=useRemote<PeriodSheetView>('period-sheet',{period,courseId:selected?.id??''});
  return <section className="panel period-evaluation" aria-labelledby="period-evaluation-title">
    <div className="table-toolbar"><div><p className="eyebrow">CALIFICACIÓN SENCILLA</p><h2 id="period-evaluation-title">Cuadro de evaluación · {period}</h2><p className="muted">Escribe una nota sobre 100 o divide los puntos en las columnas que necesites. Las fechas son opcionales.</p></div><div className="toolbar"><label>Período<select aria-label="Período del cuadro" value={period} disabled={dirty} onChange={event=>onPeriod(event.target.value)}>{['P1','P2','P3','P4'].map(value=><option key={value}>{value}</option>)}</select></label><label>Curso<select aria-label="Curso del cuadro" value={selected?.id??''} disabled={dirty} onChange={event=>setCourseId(event.target.value)}>{courses.map(course=><option key={course.id} value={course.id}>{course.code}</option>)}</select></label></div></div>
    {remote.error&&<div className="notice warning" role="alert">{remote.error}<button type="button" className="text-button" onClick={remote.reload}>Reintentar</button></div>}
    {remote.loading&&<p role="status"><LoaderCircle className="spin" size={16}/> Cargando el cuadro…</p>}
    {remote.data&&!remote.loading&&<SheetEditor key={period+selected?.id+remote.data.plan.revision} data={remote.data} onDirty={setDirty} onReload={remote.reload}/>}
  </section>;
}

function SheetEditor({data,onDirty,onReload}:{data:PeriodSheetView;onDirty:(dirty:boolean)=>void;onReload:()=>void}){
  const draftKey=`period-sheet-notes:${data.courseId}:${data.plan.period}`;
  const [restored]=useState(()=>{
    try{const value=JSON.parse(localStorage.getItem(draftKey)??'null');if(value&&Number.isInteger(value.revision)&&value.revision>=0&&value.scores&&typeof value.scores==='object')return value as {revision:number;scores:Record<string,Record<string,number|null>>};}catch{}
    return null;
  });
  const [confirmedRevision,setConfirmedRevision]=useState(data.plan.revision);
  const [plan,setPlan]=useState({...data.plan,revision:restored?.revision??data.plan.revision});
  const [draft,setDraft]=useState({...data.plan,revision:restored?.revision??data.plan.revision});
  const [configuring,setConfiguring]=useState(false);
  const initialScores=Object.fromEntries(data.rows.map(row=>[row.student.id,row.result.scores]));
  const [scores,setScores]=useState<Record<string,Record<string,number|null>>>(()=>Object.fromEntries(data.rows.map(row=>[row.student.id,Object.fromEntries(data.plan.columns.map(column=>{
    const value=restored?.scores[row.student.id]?.[column.id];
    return [column.id,value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:row.result.scores[column.id]];
  }))])));
  const [savedScores,setSavedScores]=useState(initialScores);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const [sortBy,setSortBy]=useState<'manual'|'date'>('manual');
  const points=Math.round(draft.columns.reduce((sum,column)=>sum+column.maxPoints,0)*100)/100;
  const scoreDirty=JSON.stringify(scores)!==JSON.stringify(savedScores);
  const configDirty=JSON.stringify(draft)!==JSON.stringify(plan);
  useEffect(()=>{try{if(scoreDirty)localStorage.setItem(draftKey,JSON.stringify({revision:plan.revision,scores}));else localStorage.removeItem(draftKey);}catch{}},[draftKey,scoreDirty,scores,plan.revision]);
  useEffect(()=>{if(!scoreDirty&&!configDirty)return;const warn=(event:BeforeUnloadEvent)=>event.preventDefault();window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[scoreDirty,configDirty]);
  const columns=sortBy==='date'?[...plan.columns].sort((a,b)=>(a.date??'9999').localeCompare(b.date??'9999')):plan.columns;
  useEffect(()=>{if(!scoreDirty&&!configDirty&&!busy&&plan.revision!==confirmedRevision){setPlan(current=>({...current,revision:confirmedRevision}));setDraft(current=>({...current,revision:confirmedRevision}));}},[scoreDirty,configDirty,busy,plan.revision,confirmedRevision]);
  useEffect(()=>{onDirty(scoreDirty||configDirty||busy);},[scoreDirty,configDirty,busy,onDirty]);
  function markDirty(){setSuccess('');}
  function editColumn(id:string,patch:Partial<PeriodSheetPlan['columns'][number]>){setDraft(current=>({...current,columns:current.columns.map(column=>column.id===id?{...column,...patch}:column)}));markDirty();}
  function move(index:number,offset:number){const next=[...draft.columns];const [column]=next.splice(index,1);next.splice(index+offset,0,column);setDraft(current=>({...current,columns:next}));markDirty();}
  async function savePlan(value:PeriodSheetPlan){
    setBusy(true);onDirty(true);setError('');setSuccess('');
    try{const saved=await apiPost<PeriodSheetPlan>('period-sheet-plan',value);setPlan(saved);setDraft(saved);setConfirmedRevision(saved.revision);setConfiguring(false);setSuccess('Cuadro guardado. Ya puedes escribir las notas.');onDirty(false);setScores(current=>Object.fromEntries(data.rows.map(row=>[row.student.id,Object.fromEntries(saved.columns.map(column=>[column.id,current[row.student.id]?.[column.id]??null]))])));setSavedScores(Object.fromEntries(data.rows.map(row=>[row.student.id,Object.fromEntries(saved.columns.map(column=>[column.id,savedScores[row.student.id]?.[column.id]??null]))])));}
    catch(cause){setError(errorText(cause));onDirty(true);}finally{setBusy(false);}
  }
  async function saveGrades(){
    setBusy(true);onDirty(true);setError('');setSuccess('');
    try{const result=await apiPost<{revision:number}>('period-sheet-grades',{period:plan.period,courseId:data.courseId,revision:plan.revision,rows:data.rows.map(row=>({studentId:row.student.id,scores:scores[row.student.id]}))});const next={...plan,revision:result.revision};setPlan(next);setDraft(next);setConfirmedRevision(next.revision);setSavedScores(structuredClone(scores));onDirty(false);setSuccess('Notas guardadas. El acumulado del período está actualizado.');}
    catch(cause){setError(errorText(cause));}finally{setBusy(false);}
  }
  const planned=Math.round(plan.columns.reduce((sum,column)=>sum+column.maxPoints,0)*100)/100;
  return <>
    {error&&<div className="notice warning" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={()=>{if(window.confirm('¿Descartar el borrador y volver a cargar el cuadro?')){localStorage.removeItem(draftKey);onDirty(false);onReload();}}}>Recargar cuadro</button></div>}
    {success&&<div className="notice success" role="status">{success}</div>}
    {!plan.columns.length&&!configuring&&<div className="period-sheet-start"><p>La opción más simple: una columna «Nota del período» sobre 100. Después podrás dividirla si lo necesitas.</p><button type="button" className="button primary" disabled={busy} onClick={()=>void savePlan({...plan,enabled:true,columns:[{id:crypto.randomUUID(),label:'Nota del período',maxPoints:100,date:null}]})}><Plus size={16}/> Calificar sobre 100</button><p className="muted">Al usar este cuadro, sus notas serán la calificación del período en todos tus cursos. Las notas de actividades anteriores se conservan y no se suman otra vez.</p></div>}
    {plan.columns.length>0&&<><div className="toolbar period-sheet-actions"><strong>{fmt(planned)} / 100 puntos distribuidos</strong><span className="muted">{fmt(100-planned)} por distribuir</span><button type="button" className="button secondary" disabled={busy||scoreDirty} onClick={()=>{setDraft(plan);setConfiguring(!configuring);}}><Settings2 size={16}/>{configuring?'Cerrar columnas':'Dividir los puntos'}</button><label>Orden<select aria-label="Orden de columnas" value={sortBy} disabled={configuring} onChange={event=>setSortBy(event.target.value as 'manual'|'date')}><option value="manual">Orden del maestro</option><option value="date">Por fecha</option></select></label></div>
    {!plan.enabled&&<div className="notice">Estas notas están conservadas, pero el período usa las actividades. <button type="button" className="text-button" disabled={busy||scoreDirty||configDirty} onClick={()=>void savePlan({...plan,enabled:true})}>Usar este cuadro para la nota del período</button></div>}</>}
    {configuring&&<form className="period-sheet-config" onSubmit={event=>{event.preventDefault();void savePlan({...draft,enabled:true});}}><p className="muted">El reparto se comparte con todos los cursos de este período. Reduce el valor de una columna para dejar puntos disponibles y añadir otras.</p><fieldset disabled={busy} className="bare-fieldset"><div className="table-wrap"><table className="data-table"><thead><tr><th>Qué evaluarás</th><th>Puntos</th><th>Fecha opcional</th><th>Orden</th><th></th></tr></thead><tbody>{draft.columns.map((column,index)=><tr key={column.id}><td><input aria-label={`Nombre de columna ${index+1}`} required maxLength={160} value={column.label} onChange={event=>editColumn(column.id,{label:event.target.value})}/></td><td><input aria-label={`Puntos de ${column.label}`} className="score-input" type="number" min={0.01} max={100} step={0.01} required value={column.maxPoints} onChange={event=>editColumn(column.id,{maxPoints:Number(event.target.value)})}/></td><td><input aria-label={`Fecha de ${column.label}`} type="date" value={column.date??''} onChange={event=>editColumn(column.id,{date:event.target.value||null})}/></td><td><div className="toolbar"><button type="button" className="button secondary" aria-label={`Mover ${column.label} arriba`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp size={14}/></button><button type="button" className="button secondary" aria-label={`Mover ${column.label} abajo`} disabled={index===draft.columns.length-1} onClick={()=>move(index,1)}><ArrowDown size={14}/></button></div></td><td><button type="button" className="button secondary" aria-label={`Quitar ${column.label}`} onClick={()=>{setDraft(current=>({...current,columns:current.columns.filter(item=>item.id!==column.id)}));markDirty();}}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div><div className="toolbar"><button type="button" className="button secondary" disabled={points>=100||draft.columns.length>=100} onClick={()=>{setDraft(current=>({...current,columns:[...current.columns,{id:crypto.randomUUID(),label:'',maxPoints:Math.max(0.01,Math.round((100-points)*100)/100),date:null}]}));markDirty();}}><Plus size={15}/> Añadir columna</button><strong>{fmt(points)} / 100</strong><button className="button primary" disabled={points>100||!draft.columns.length}><Save size={15}/> Guardar columnas</button><button type="button" className="button secondary" onClick={()=>{setDraft(plan);setConfiguring(false);onDirty(false);}}>Cancelar</button></div></fieldset></form>}
    {plan.columns.length>0&&!configuring&&<form onSubmit={event=>{event.preventDefault();void saveGrades();}}><fieldset className="bare-fieldset" disabled={busy}><div className="table-wrap period-sheet-table-wrap"><table className="data-table period-sheet-table"><thead><tr><th>N.º</th><th>Estudiante</th>{columns.map(column=><th key={column.id}>{column.label}<small>{fmt(column.maxPoints)} puntos{column.date?` · ${column.date}`:''}</small></th>)}<th>Acumulado / 100</th><th>Estado</th></tr></thead><tbody>{data.rows.map(row=>{const values=plan.columns.map(column=>scores[row.student.id]?.[column.id]??null);const pending=values.filter(value=>value===null).length;const total=values.some(value=>value!==null)?Math.round(values.reduce<number>((sum,value)=>sum+(value??0),0)*100)/100:null;return <tr key={row.student.id}><td>{row.student.number}</td><td>{row.student.name}</td>{columns.map(column=><td key={column.id}><input className="score-input" aria-label={`${row.student.name} · ${column.label}`} type="number" min={0} max={column.maxPoints} step={0.01} placeholder="—" value={scores[row.student.id]?.[column.id]??''} onChange={event=>{const score=event.target.value===''?null:Number(event.target.value);setScores(current=>({...current,[row.student.id]:{...current[row.student.id],[column.id]:score}}));markDirty();}}/></td>)}<td><strong>{fmt(total)}</strong></td><td>{planned===100&&pending===0?'Completo':pending?`${pending} pendientes`:'Faltan puntos por distribuir'}</td></tr>;})}</tbody></table></div>{!data.rows.length&&<p className="empty-state compact">Añade estudiantes al curso para escribir sus notas.</p>}<div className="toolbar period-sheet-actions"><button className="button primary" disabled={!scoreDirty||busy}><Save size={16}/> Guardar notas</button><button type="button" className="button secondary" disabled={!scoreDirty||busy} onClick={()=>{setScores(structuredClone(savedScores));setPlan(current=>({...current,revision:confirmedRevision}));setDraft(current=>({...current,revision:confirmedRevision}));onDirty(false);setError('');}}>Descartar cambios</button>{scoreDirty&&<span className="muted">Borrador sin guardar; se conserva al cambiar de apartado.</span>}</div></fieldset></form>}
    {plan.columns.length>0&&plan.enabled&&!configuring&&<details className="period-sheet-source"><summary>Opciones del período</summary><p className="muted">Este cuadro determina la nota del período. También puedes volver al cálculo por actividades; ambas capturas se conservan.</p><button type="button" className="button secondary" disabled={busy||scoreDirty} onClick={()=>void savePlan({...plan,enabled:false})}>Volver al cálculo por actividades</button></details>}
  </>;
}
