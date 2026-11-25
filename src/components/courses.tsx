'use client';

import { useState } from 'react';
import { ArrowRight, LoaderCircle, Plus, UsersRound } from 'lucide-react';
import { PERIOD_START } from '@/lib/model';
import type { Course, CourseSequencePlanView, EvaluationPlan, SequencePlan } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';
import CourseAdministration from './course-administration';
import CourseSequencePlanner from './course-sequence-planner';

const startDefault=PERIOD_START;
const endDefault='2027-06-30';

export default function CoursesPanel({courses,onCreated,onChange,onOpenStudents,onOpenAttendance,onOpenGrades,onSelect,sequence,plans,today,onPrepareEvaluation}:{courses:Course[];onCreated:(course:Course)=>void;onChange:()=>void;onOpenStudents:(id:string)=>void;onOpenAttendance:(id:string)=>void;onOpenGrades:(id:string)=>void;onSelect:(id:string)=>void;sequence:SequencePlan|null;plans:EvaluationPlan[];today:string;onPrepareEvaluation:(item:CourseSequencePlanView)=>void}){
  const [creating,setCreating]=useState(courses.length===0);
  const [adminCourseId,setAdminCourseId]=useState('');
  const [courseSection,setCourseSection]=useState<'overview'|'plan'|'roster'>('overview');
  const [editingRoster,setEditingRoster]=useState(false);
  const selected=courses.find(course=>course.id===adminCourseId);
  const [code,setCode]=useState('');const [name,setName]=useState('');const [startDate,setStartDate]=useState(startDefault);const [endDate,setEndDate]=useState(endDefault);
  const [noClassText,setNoClassText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try{
      const noClassDates=noClassText.split(/[\n,;]/).map(value=>value.trim()).filter(Boolean);
      const course=await apiPost<Course>('course',{code,name,startDate,endDate,noClassDates});
      setSuccess(`${course.code} quedó creado. La lista aún está pendiente; ábrelo para añadir estudiantes.`);setCode('');setName('');setCreating(false);onCreated(course);
    }catch(error){setError(errorText(error));}finally{setBusy(false);}
  }
  const hasLoadedCalendar=['5A','5B','5C'].includes(code.trim().toUpperCase());
  const totalStudents=courses.reduce((sum,course)=>sum+course.students.length,0);
  const activeStudents=courses.reduce((sum,course)=>sum+course.students.filter(student=>student.active).length,0);
  return <><div className="section-heading"><div><p className="eyebrow">TRABAJO Y CONFIGURACIÓN POR CURSO</p><h1>Cursos</h1><p className="muted">Cada curso conserva su lista y calendario de contenido. El período que recibirá una nota se elige aparte y no determina cuándo se imparte la clase.</p></div><div className="toolbar"><button type="button" className="button secondary" aria-expanded={creating} aria-controls="create-course-form" disabled={busy} onClick={()=>setCreating(!creating)}><Plus size={16}/>{creating?'Cerrar formulario':'Crear curso'}</button></div></div>
    {courses.length>0&&<div className="metrics compact course-summary-metrics"><div className="metric"><span><UsersRound size={16}/> Cursos configurados</span><strong>{courses.length}</strong><small>Listas separadas por curso</small></div><div className="metric"><span>Estudiantes en las listas</span><strong>{totalStudents}</strong><small>{activeStudents} activos</small></div><div className="metric"><span>Listas por completar</span><strong>{courses.filter(course=>course.students.length===0).length}</strong><small>Cursos sin estudiantes cargados</small></div></div>}
    {!creating&&success&&<div className="notice success" role="status">{success}</div>}
    {creating&&<section id="create-course-form" className="panel course-setup-panel"><form onSubmit={submit}><h2><Plus size={18}/> Crear curso</h2><div className="form-grid"><label>Código del curso<input required maxLength={12} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="Ej.: 5A"/></label><label>Nombre visible<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej.: Quinto A · Matemática"/></label><label>Desde<input type="date" required min={PERIOD_START} value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><label>Hasta<input type="date" required min={startDate} max="2028-06-30" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label></div>
      <p className="muted course-calendar-note">{hasLoadedCalendar?'Si el rango incluye fechas del calendario de este curso, se cargarán sus sesiones diarias exactas. Los datos precargados llegan hasta el 20 de enero de 2027; no se inventan sesiones posteriores.':'No hay un calendario diario precargado para este código; el curso se creará sin fechas de clase programadas.'}</p>
      <label>Fechas sin clase (opcional)<textarea rows={2} value={noClassText} onChange={event=>setNoClassText(event.target.value)} placeholder="Una fecha por línea: 2026-12-25"/><small>Estas fechas se excluyen del calendario cargado.</small></label>
      {error&&<div className="notice warning" role="alert">{error}</div>}{success&&<div className="notice success">{success}</div>}
      <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear curso</button>
    </form></section>}
    <section className="panel course-overview-panel"><div className="table-toolbar"><div><p className="eyebrow">RESUMEN</p><h2>Cursos configurados</h2><p className="muted">Abre un curso para planificar sus clases, revisar su lista o pasar a sus registros.</p></div><span className="pill">{courses.length} cursos</span></div>{courses.length?<div className="course-manage-grid">{courses.map(course=>{const open=adminCourseId===course.id;const active=course.students.filter(student=>student.active).length;return <article className={'course-manage-card course-overview-card'+(open?' is-open':'')} key={course.id}><div className="course-overview-identity"><span className="course-overview-icon"><UsersRound size={19}/></span><div><h3>{course.code}</h3><p>{course.name}</p></div></div><div className="course-overview-stats"><strong>{course.students.length}</strong><span>estudiantes</span><small>{active} activos{course.students.length>active?` · ${course.students.length-active} inactivos`:''}</small></div><span className={'course-list-status '+(course.students.length?'ready':'pending')}>{course.students.length?'Lista cargada':'Lista pendiente'}</span><button type="button" className="button secondary" aria-expanded={open} aria-controls={`administrar-${course.id}`} disabled={editingRoster} onClick={()=>{onSelect(course.id);setCourseSection('overview');setAdminCourseId(current=>current===course.id?'':course.id);}}>{open?'Cerrar curso':<>Abrir curso <ArrowRight size={15}/></>}</button></article>})}</div>:<div className="empty-state compact">Todavía no hay cursos. Crea un curso para comenzar y luego carga su lista de estudiantes.</div>}</section>
    {selected&&<section id={`administrar-${selected.id}`} className="panel course-administration-panel"><div className="table-toolbar"><div><p className="eyebrow">CURSO · {selected.code}</p><h2>{selected.name}</h2><p className="muted">El contenido y su calendario se organizan por curso. El período de calificación se decide por separado.</p></div><button type="button" className="button secondary" disabled={editingRoster} onClick={()=>setAdminCourseId('')}>Cerrar</button></div>
      <div className="course-workspace-tabs" role="tablist" aria-label={`Secciones de ${selected.code}`}>
        {([['overview','Resumen'],['plan','Plan de clases'],['roster','Lista y estudiantes']] as const).map(([key,label])=><button key={key} type="button" role="tab" aria-selected={courseSection===key} className={courseSection===key?'selected':''} onClick={()=>setCourseSection(key)}>{label}</button>)}
      </div>
      {courseSection==='overview'&&<div className="course-workspace-summary"><article><strong>{selected.students.length}</strong><span>estudiantes en la lista</span></article><article><strong>{plans.length}</strong><span>períodos configurados</span></article><article><strong>{sequence?.activities.length??0}</strong><span>contenidos disponibles de la secuencia común</span></article><div className="toolbar"><button type="button" className="button secondary" onClick={()=>onOpenAttendance(selected.id)}>Registro diario</button><button type="button" className="button secondary" onClick={()=>onOpenGrades(selected.id)}>Calificar</button><button type="button" className="button secondary" onClick={()=>onOpenStudents(selected.id)}>Ver lista</button></div></div>}
      {courseSection==='plan'&&<CourseSequencePlanner key={selected.id} course={selected} sequence={sequence} plans={plans} today={today} onPrepareEvaluation={onPrepareEvaluation}/>}
      {courseSection==='roster'&&<CourseAdministration key={selected.id} course={selected} onChange={onChange} onDirty={setEditingRoster} onOpenStudents={()=>onOpenStudents(selected.id)}/>}
    </section>}
  </>;
}
