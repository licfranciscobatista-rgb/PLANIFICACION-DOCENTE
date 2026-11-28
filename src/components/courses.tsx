'use client';

import { useState } from 'react';
import { ArrowRight, BookOpenCheck, LoaderCircle, Plus, Table2, UsersRound } from 'lucide-react';
import { PERIOD_START } from '@/lib/model';
import type { Activity, Course, EvaluationPlan } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';
import TeacherLedgerPanel from './ledger';
import { AttendancePanel, AttendanceSummaryPanel, GradesPanel } from './captures';
import StudentPanel from './students';

const startDefault=PERIOD_START;
const endDefault='2027-06-30';
type InlinePanel='attendance'|'grades'|'roster';
const blankPanels:Record<InlinePanel,boolean>={attendance:false,grades:false,roster:false};

export default function CoursesPanel({courses,onCreated,onChange,plan,activities,today,demo,onConfigurePlan,onConfigureActivities,onPrepareActivity}:{courses:Course[];onCreated:(course:Course)=>void;onChange:()=>void;plan:EvaluationPlan;activities:Activity[];today:string;demo:boolean;onConfigurePlan:(period:string)=>void;onConfigureActivities:(courseId:string,activityId?:string)=>void;onPrepareActivity:(courseId:string)=>void}){
  const [creating,setCreating]=useState(courses.length===0);
  const [courseId,setCourseId]=useState('');
  const [openPanels,setOpenPanels]=useState<Record<InlinePanel,boolean>>(blankPanels);
  const [attendanceView,setAttendanceView]=useState<'daily'|'month'|'week'>('daily');
  const [registerDate,setRegisterDate]=useState(today);
  const [registerBlock,setRegisterBlock]=useState(1);
  const [gradeMode,setGradeMode]=useState<'activities'|'quick'>('activities');
  const [gradeActivityId,setGradeActivityId]=useState('');
  const [code,setCode]=useState('');const [name,setName]=useState('');const [startDate,setStartDate]=useState(startDefault);const [endDate,setEndDate]=useState(endDefault);
  const [noClassText,setNoClassText]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [success,setSuccess]=useState('');
  const selected=courses.find(course=>course.id===courseId);
  const courseActivities=selected?activities.filter(item=>item.courseId===selected.id):[];
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try{
      const noClassDates=noClassText.split(/[\n,;]/).map(value=>value.trim()).filter(Boolean);
      const course=await apiPost<Course>('course',{code,name,startDate,endDate,noClassDates});
      setSuccess(`${course.code} quedó creado. La lista aún está pendiente; ábrelo para añadir estudiantes.`);setCode('');setName('');setCreating(false);setCourseId(course.id);setOpenPanels({...blankPanels,roster:true});onCreated(course);
    }catch(cause){setError(errorText(cause));}finally{setBusy(false);}
  }
  const hasLoadedCalendar=['5A','5B','5C'].includes(code.trim().toUpperCase());
  const totalStudents=courses.reduce((sum,course)=>sum+course.students.length,0);
  const activeStudents=courses.reduce((sum,course)=>sum+course.students.filter(student=>student.active).length,0);
  function openCourse(id:string){setCourseId(id);setOpenPanels(blankPanels);}
  function expand(panel:InlinePanel){
    setOpenPanels(current=>({...current,[panel]:true}));
    window.setTimeout(()=>document.getElementById(`course-${panel}-${courseId}`)?.scrollIntoView({behavior:'smooth',block:'start'}),60);
  }
  function details(panel:InlinePanel,label:string,title:string,description:string,children:React.ReactNode,count?:string){
    return <details id={`course-${panel}-${selected?.id}`} className="panel course-inline-panel" open={openPanels[panel]} onToggle={event=>{const isOpen=event.currentTarget.open;setOpenPanels(current=>({...current,[panel]:isOpen}));}}>
      <summary><div><p className="eyebrow">{label}</p><h3>{title}</h3><p className="muted">{description}</p></div><span className="course-inline-state">{openPanels[panel]?'Cerrar':'Abrir'}{count?` · ${count}`:''}</span></summary>
      {openPanels[panel]&&<div className="course-inline-content">{children}</div>}
    </details>;
  }

  return <>
    <div className="section-heading"><div><p className="eyebrow">{selected?`CURSO · ${selected.code}`:'ADMINISTRACIÓN DE CURSOS'}</p><h1>{selected?selected.name:'Cursos'}</h1><p className="muted">{selected?'Administra su lista y consulta sus capturas y calificaciones. La selección de actividades evaluativas se organiza en Configurar cursos.':'Crea y administra cursos y sus listas. La configuración de evaluaciones tiene una sección independiente.'}</p></div><div className="toolbar">{selected&&<button type="button" className="button secondary" onClick={()=>setCourseId('')}>Cambiar curso</button>}<button type="button" className="button secondary" aria-expanded={creating} aria-controls="create-course-form" disabled={busy} onClick={()=>setCreating(!creating)}><Plus size={16}/>{creating?'Cerrar formulario':'Crear curso'}</button></div></div>
    {!selected&&courses.length>0&&<div className="metrics compact course-summary-metrics"><div className="metric"><span><UsersRound size={16}/> Cursos configurados</span><strong>{courses.length}</strong><small>Espacios de trabajo independientes</small></div><div className="metric"><span>Estudiantes en las listas</span><strong>{totalStudents}</strong><small>{activeStudents} activos</small></div><div className="metric"><span>Listas por completar</span><strong>{courses.filter(course=>course.students.length===0).length}</strong><small>Cursos sin estudiantes cargados</small></div></div>}
    {!creating&&success&&<div className="notice success" role="status">{success}</div>}
    {creating&&<section id="create-course-form" className="panel course-setup-panel"><form onSubmit={submit}><h2><Plus size={18}/> Crear curso</h2><div className="form-grid"><label>Código del curso<input required maxLength={12} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} placeholder="Ej.: 5A"/></label><label>Nombre visible<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)} placeholder="Ej.: Quinto A · Matemática"/></label><label>Desde<input type="date" required min={PERIOD_START} value={startDate} onChange={event=>setStartDate(event.target.value)}/></label><label>Hasta<input type="date" required min={startDate} max="2028-06-30" value={endDate} onChange={event=>setEndDate(event.target.value)}/></label></div>
      <p className="muted course-calendar-note">{hasLoadedCalendar?'Si el rango incluye fechas del calendario de este curso, se cargarán sus sesiones diarias exactas. Los datos precargados llegan hasta el 20 de enero de 2027; no se inventan sesiones posteriores.':'No hay un calendario diario precargado para este código; el curso se creará sin fechas de clase programadas.'}</p>
      <label>Fechas sin clase (opcional)<textarea rows={2} value={noClassText} onChange={event=>setNoClassText(event.target.value)} placeholder="Una fecha por línea: 2026-12-25"/><small>Estas fechas se excluyen del calendario cargado.</small></label>
      {error&&<div className="notice warning" role="alert">{error}</div>}{success&&<div className="notice success">{success}</div>}
      <button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:<Plus size={16}/>} Crear curso</button>
    </form></section>}
    {!selected&&<section className="panel course-overview-panel"><div className="table-toolbar"><div><p className="eyebrow">SELECCIÓN DE CURSO</p><h2>Cursos configurados</h2><p className="muted">Cada curso mantiene su propia planificación, nómina y matriz.</p></div><span className="pill">{courses.length} cursos</span></div>{courses.length?<div className="course-manage-grid">{courses.map(course=>{const active=course.students.filter(student=>student.active).length;return <article className="course-manage-card course-overview-card" key={course.id}><div className="course-overview-identity"><span className="course-overview-icon"><UsersRound size={19}/></span><div><h3>{course.code}</h3><p>{course.name}</p></div></div><div className="course-overview-stats"><strong>{course.students.length}</strong><span>estudiantes</span><small>{active} activos{course.students.length>active?` · ${course.students.length-active} inactivos`:''}</small></div><span className={'course-list-status '+(course.students.length?'ready':'pending')}>{course.students.length?'Lista cargada':'Lista pendiente'}</span><button type="button" className="button secondary" onClick={()=>openCourse(course.id)}>Abrir centro de {course.code} <ArrowRight size={15}/></button></article>})}</div>:<div className="empty-state compact">Todavía no hay cursos. Crea uno para comenzar y luego carga su lista de estudiantes.</div>}</section>}
    {selected&&<><nav className="course-switcher" aria-label="Cambiar curso">{courses.map(course=><button type="button" aria-current={selected.id===course.id?'page':undefined} className={selected.id===course.id?'selected':''} key={course.id} onClick={()=>openCourse(course.id)}>{course.code}<span>{course.students.length}</span></button>)}</nav>
      <section id={`administrar-${selected.id}`} className="course-control-center">
        <header className="course-center-header"><div><p className="eyebrow">REGISTROS INDEPENDIENTES · {selected.code}</p><h2>{selected.name} <span>{selected.code}</span></h2><p>{selected.students.length} estudiantes · {selected.students.filter(student=>student.active).length} activos · asistencia y calificaciones guardadas en el curso correcto.</p><div className="toolbar"><button type="button" className="button primary" onClick={()=>onPrepareActivity(selected.id)}><BookOpenCheck size={16}/> Preparar actividad para {selected.code}</button><button type="button" className="button secondary" onClick={()=>onConfigureActivities(selected.id)}>Configurar qué se califica</button></div></div><div className="course-center-overview"><span><strong>{courseActivities.length}</strong> actividades preparadas</span><span><strong>{courseActivities.filter(activity=>activity.activeForGrading??true).length}</strong> incluidas en calificaciones</span><span><strong>{selected.students.length}</strong> estudiantes en su matriz</span></div></header>

        <section className="panel course-matrix-workspace"><div className="course-workspace-section-heading"><div><p className="eyebrow">LIBRO DE CALIFICACIONES · {selected.code}</p><h3><Table2 size={19}/> Matriz del curso</h3><p className="muted">Una fila por estudiante y columnas por actividad, criterio y categoría. Las calificaciones directas y por competencias llegan al mismo resumen.</p></div></div><TeacherLedgerPanel courseId={selected.id} courseCode={selected.code}/></section>

        {details('attendance','CAPTURA DIARIA','Asistencia, participación y comportamiento','El horario docente detecta el bloque cuando hay una franja definida; cambia el bloque solo si hubo una excepción.',<><div className="course-subnav" role="tablist" aria-label={`Vistas de asistencia de ${selected.code}`}>{([['daily','Captura diaria'],['week','Resumen semanal'],['month','Registro mensual']] as const).map(([key,label])=><button type="button" key={key} role="tab" aria-selected={attendanceView===key} className={attendanceView===key?'selected':''} onClick={()=>setAttendanceView(key)}>{label}</button>)}</div>{attendanceView==='daily'?<AttendancePanel course={selected} today={today} date={registerDate||today} onDateChange={setRegisterDate} block={registerBlock} onBlockChange={setRegisterBlock}/>:<AttendanceSummaryPanel course={selected} courses={courses} demo={demo} section={attendanceView}/>}</>,'captura y reportes')}

        {details('grades','CALIFICACIONES','Capturar notas','Elige una actividad ya preparada o anota una calificación directa; ambas se reflejan en la matriz del curso.',<><div className="course-subnav" role="tablist" aria-label={`Modos de calificación de ${selected.code}`}><button type="button" role="tab" aria-selected={gradeMode==='activities'} className={gradeMode==='activities'?'selected':''} onClick={()=>setGradeMode('activities')}>Actividades preparadas</button><button type="button" role="tab" aria-selected={gradeMode==='quick'} className={gradeMode==='quick'?'selected':''} onClick={()=>setGradeMode('quick')}>Captura directa</button></div><GradesPanel mode={gradeMode} course={selected} activities={courseActivities} selectedActivityId={gradeActivityId} period={plan.period} onOpenActivities={()=>onConfigureActivities(selected.id)} onConfigureActivity={activityId=>onConfigureActivities(selected.id,activityId)} onOpenPlan={()=>onConfigurePlan(plan.period)}/></>,'actividad o nota directa')}

        {details('roster','LISTA DEL CURSO','Estudiantes','Administra la nómina que alimenta las capturas y la matriz de este curso.',<StudentPanel course={selected} onChange={onChange} onOpenAttendance={()=>expand('attendance')}/>,`${selected.students.length} estudiantes`)}

      </section></>}
  </>;
}
