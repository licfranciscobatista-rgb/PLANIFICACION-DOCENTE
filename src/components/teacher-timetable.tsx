'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import type { Course, TeacherTimetable, TeacherTimetableEntry } from '@/lib/model';
import { apiPost, errorText, useRemote } from '@/lib/client';
import { replaceCourseTimetableEntries, timetableEntriesForCourse } from '@/lib/timetable';

const days=[['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado'],['7','Domingo']] as const;
const newId=()=>globalThis.crypto?.randomUUID?.()??`slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function TeacherTimetablePanel({courses,selectedCourseId}:{courses:Course[];selectedCourseId:string}){
  const remote=useRemote<TeacherTimetable>('teacher-timetable');
  const [entries,setEntries]=useState<TeacherTimetableEntry[]>([]);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const selectedCourse=courses.find(course=>course.id===selectedCourseId);
  useEffect(()=>{if(remote.data){setEntries(timetableEntriesForCourse(remote.data.entries,selectedCourseId));setRevision(remote.data.revision);}},[remote.data,selectedCourseId]);
  function patchEntry(id:string,patch:Partial<TeacherTimetableEntry>){setEntries(rows=>rows.map(row=>row.id===id?{...row,...patch}:row));setMessage('');setError('');}
  function add(){if(!selectedCourse){setError('No se encontró el curso abierto.');return;}setEntries(rows=>[...rows,{id:newId(),weekday:1,startTime:'08:00',endTime:'09:00',courseId:selectedCourse.id,block:1}]);setMessage('');setError('');}
  async function save(){if(!selectedCourse||!remote.data)return;setBusy(true);setError('');setMessage('');try{const saved=await apiPost<TeacherTimetable>('teacher-timetable',{revision,entries:replaceCourseTimetableEntries(remote.data.entries,selectedCourse.id,entries)});setEntries(timetableEntriesForCourse(saved.entries,selectedCourse.id));setRevision(saved.revision);remote.reload();setMessage(`Horario de ${selectedCourse.code} guardado. Los horarios de los otros cursos se conservaron.`);}catch(cause){setError(errorText(cause));}finally{setBusy(false);}}
  return <section className="teacher-timetable-panel" aria-labelledby="teacher-timetable-title">
    <div className="teacher-timetable-heading"><div><p className="eyebrow">CONFIGURACIÓN DE {selectedCourse?.code??'CURSO'}</p><h3 id="teacher-timetable-title"><CalendarClock size={18}/> Horario de {selectedCourse?.code??'este curso'}</h3><p className="muted">Define los días, horas y bloques de este curso. En asistencia se sugerirá el bloque cuando coincidan día y hora.</p></div><div className="toolbar"><button type="button" className="button secondary" onClick={add} disabled={!selectedCourse}><Plus size={15}/> Añadir bloque</button><button type="button" className="button primary" onClick={()=>void save()} disabled={busy||remote.loading||!remote.data||!selectedCourse}>{busy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Guardar horario</button></div></div>
    {remote.loading&&!remote.data?<div className="loading-state"><LoaderCircle className="spin"/> Cargando horario…</div>:entries.length?<div className="table-wrap teacher-timetable-table-wrap"><table className="data-table teacher-timetable-table"><thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th>Bloque</th><th aria-label="Acciones"/></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td><select aria-label="Día de la semana" value={entry.weekday} onChange={event=>patchEntry(entry.id,{weekday:Number(event.target.value)})}>{days.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td><td><input aria-label="Hora inicial" type="time" value={entry.startTime} onChange={event=>patchEntry(entry.id,{startTime:event.target.value})}/></td><td><input aria-label="Hora final" type="time" value={entry.endTime} onChange={event=>patchEntry(entry.id,{endTime:event.target.value})}/></td><td><select aria-label="Bloque" value={entry.block} onChange={event=>patchEntry(entry.id,{block:Number(event.target.value)})}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>Bloque {index+1}</option>)}</select></td><td><button type="button" className="icon-button" aria-label={`Quitar bloque del ${days[entry.weekday-1]?.[1]??'horario'}`} onClick={()=>setEntries(rows=>rows.filter(row=>row.id!==entry.id))}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>:<div className="empty-state compact">Este curso aún no tiene bloques configurados. Añade el día y el horario que le corresponde.</div>}
    {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status">{message}</div>}
    <p className="teacher-timetable-footnote">El horario solo propone el bloque. Los cambios de hora se pueden corregir en la captura y no crean ni confirman una clase.</p>
  </section>;
}
