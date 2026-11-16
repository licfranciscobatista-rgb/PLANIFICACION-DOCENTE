'use client';

import { useState } from 'react';
import { CalendarDays, LoaderCircle, Plus, UsersRound } from 'lucide-react';
import type { Course } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';

const weekdays = [{number:1,label:'Lunes'},{number:2,label:'Martes'},{number:3,label:'Miércoles'},{number:4,label:'Jueves'},{number:5,label:'Viernes'},{number:6,label:'Sábado'},{number:7,label:'Domingo'}];
const startDefault='2026-10-20';
const endDefault='2027-06-30';

export default function CoursesPanel({courses,onCreated}:{courses:Course[];onCreated:(course:Course)=>void}){
  const [code,setCode]=useState('');const [name,setName]=useState('');const [startDate,setStartDate]=useState(startDefault);const [endDate,setEndDate]=useState(endDefault);
  const [weekly,setWeekly]=useState<Record<number,{enabled:boolean;blocks:string}>>({1:{enabled:false,blocks:'1'},2:{enabled:false,blocks:'1'},3:{enabled:false,blocks:'1'},4:{enabled:false,blocks:'1'},5:{enabled:false,blocks:'1'},6:{enabled:false,blocks:'1'},7:{enabled:false,blocks:'1'}});
  const [noClassText,setNoClassText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try{
      const schedule=weekdays.filter(day=>weekly[day.number]?.enabled).map(day=>({weekday:day.number,blocks:weekly[day.number].blocks.split(',').map(value=>Number(value.trim())).filter(Number.isFinite)}));
      if(!schedule.length)throw new Error('Selecciona al menos un día y sus bloques de clase.');
      if(schedule.some(day=>!day.blocks.length||day.blocks.some(block=>!Number.isInteger(block)||block<1||block>12)))throw new Error('Escribe bloques enteros del 1 al 12 separados por coma.');
      const noClassDates=noClassText.split(/[\n,;]/).map(value=>value.trim()).filter(Boolean);
      const course=await apiPost<Course>('course',{code,name,startDate,endDate,weekly:schedule,noClassDates});
      setSuccess(`${course.code} quedó creado con ${schedule.reduce((sum,day)=>sum+day.blocks.length,0)} bloques semanales. Ahora agrega o importa su lista de estudiantes.`);setCode('');setName('');onCreated(course);
    }catch(error){setError(errorText(error));}finally{setBusy(false);}
  }
  return <><div className="section-heading"><div><p className="eyebrow">CONFIGURACIÓN INICIAL</p><h1>Cursos</h1><p className="muted">Primero crea el curso y su horario; después entra a su lista para añadir estudiantes. Asistencia, conducta y calificaciones se vincularán a esa única lista.</p></div></div>
    <section className="panel course-setup-panel"><form onSubmit={submit}><h2><Plus size={18}/> Crear curso</h2><div className="form-grid"><label>Código del curso<input required maxLength={12} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="Ej.: 5A"/></label><label>Nombre visible<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej.: Quinto A · Matemática"/></label><label>Desde<input type="date" required min="2026-10-20" value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><label>Hasta<input type="date" required min={startDate} max="2028-06-30" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label></div>
      <div className="course-weekly-schedule"><div><h3><CalendarDays size={16}/> Horario semanal</h3><p className="muted">Marca los días y escribe el número de bloque (1–12). Si tiene dos clases el mismo día, escribe por ejemplo: 2, 5.</p></div>{weekdays.map(day=><div className="course-weekday-row" key={day.number}><label className="check-label"><input type="checkbox" checked={weekly[day.number].enabled} onChange={event=>setWeekly(current=>({...current,[day.number]:{...current[day.number],enabled:event.target.checked}}))}/>{day.label}</label>{weekly[day.number].enabled&&<label>Bloques<input aria-label={`Bloques ${day.label}`} value={weekly[day.number].blocks} onChange={event=>setWeekly(current=>({...current,[day.number]:{...current[day.number],blocks:event.target.value}}))} placeholder="1, 2"/></label>}</div>)}</div>
      <label>Fechas sin clase (opcional)<textarea rows={2} value={noClassText} onChange={event=>setNoClassText(event.target.value)} placeholder="Una fecha por línea: 2026-12-25"/><small>El horario omite estas fechas. Puedes registrar una actividad escolar o suspensión como clase no impartida en el registro diario.</small></label>
      {error&&<div className="notice warning" role="alert">{error}</div>}{success&&<div className="notice success">{success}</div>}
      <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear curso y preparar calendario</button>
    </form></section>
    <section className="panel"><div className="table-toolbar"><div><h2>Cursos creados</h2><p className="muted">Cada curso mantiene una lista y calificaciones propias.</p></div><span className="pill">{courses.length}</span></div>{courses.length?<div className="course-manage-grid">{courses.map(course=><article className="course-manage-card" key={course.id}><UsersRound size={19}/><div><h3>{course.code}</h3><p>{course.name}</p></div><strong>{course.students.length} estudiantes</strong></article>)}</div>:<div className="empty-state compact">Todavía no hay cursos.</div>}</section>
  </>;
}
