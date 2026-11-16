'use client';

import { useState } from 'react';
import { LoaderCircle, Plus, UsersRound } from 'lucide-react';
import type { Course } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';

const startDefault='2026-10-20';
const endDefault='2027-06-30';

export default function CoursesPanel({courses,onCreated}:{courses:Course[];onCreated:(course:Course)=>void}){
  const [code,setCode]=useState('');const [name,setName]=useState('');const [startDate,setStartDate]=useState(startDefault);const [endDate,setEndDate]=useState(endDefault);
  const [noClassText,setNoClassText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try{
      const noClassDates=noClassText.split(/[\n,;]/).map(value=>value.trim()).filter(Boolean);
      const course=await apiPost<Course>('course',{code,name,startDate,endDate,noClassDates});
      setSuccess(`${course.code} quedó creado. Ahora agrega o importa su lista de estudiantes.`);setCode('');setName('');onCreated(course);
    }catch(error){setError(errorText(error));}finally{setBusy(false);}
  }
  const hasLoadedCalendar=['5A','5B','5C'].includes(code.trim().toUpperCase());
  return <><div className="section-heading"><div><p className="eyebrow">CONFIGURACIÓN INICIAL</p><h1>Cursos</h1><p className="muted">Primero crea el curso con su rango de fechas; después añade o importa la lista de estudiantes. Asistencia, conducta y calificaciones se vincularán a esa única lista.</p></div></div>
    <section className="panel course-setup-panel"><form onSubmit={submit}><h2><Plus size={18}/> Crear curso</h2><div className="form-grid"><label>Código del curso<input required maxLength={12} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="Ej.: 5A"/></label><label>Nombre visible<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej.: Quinto A · Matemática"/></label><label>Desde<input type="date" required min="2026-10-20" value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><label>Hasta<input type="date" required min={startDate} max="2028-06-30" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label></div>
      <p className="muted course-calendar-note">{hasLoadedCalendar?'Si el rango incluye fechas del calendario de este curso, se cargarán sus sesiones diarias exactas. Los datos precargados llegan hasta el 20 de enero de 2027; no se inventan sesiones posteriores.':'No hay un calendario diario precargado para este código; el curso se creará sin fechas de clase programadas.'}</p>
      <label>Fechas sin clase (opcional)<textarea rows={2} value={noClassText} onChange={event=>setNoClassText(event.target.value)} placeholder="Una fecha por línea: 2026-12-25"/><small>Estas fechas se excluyen del calendario cargado.</small></label>
      {error&&<div className="notice warning" role="alert">{error}</div>}{success&&<div className="notice success">{success}</div>}
      <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear curso</button>
    </form></section>
    <section className="panel"><div className="table-toolbar"><div><h2>Cursos creados</h2><p className="muted">Cada curso mantiene una lista y calificaciones propias.</p></div><span className="pill">{courses.length}</span></div>{courses.length?<div className="course-manage-grid">{courses.map(course=><article className="course-manage-card" key={course.id}><UsersRound size={19}/><div><h3>{course.code}</h3><p>{course.name}</p></div><strong>{course.students.length} estudiantes</strong></article>)}</div>:<div className="empty-state compact">Todavía no hay cursos.</div>}</section>
  </>;
}
