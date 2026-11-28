'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import type { Course, TeacherTimetable, TeacherTimetableEntry } from '@/lib/model';
import { apiPost, errorText, useRemote } from '@/lib/client';

const days=[['1','Lunes'],['2','Martes'],['3','Miércoles'],['4','Jueves'],['5','Viernes'],['6','Sábado'],['7','Domingo']] as const;
const newId=()=>globalThis.crypto?.randomUUID?.()??`slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export default function TeacherTimetablePanel({courses}:{courses:Course[]}){
  const remote=useRemote<TeacherTimetable>('teacher-timetable');
  const [entries,setEntries]=useState<TeacherTimetableEntry[]>([]);
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{if(remote.data){setEntries(remote.data.entries);setRevision(remote.data.revision);}},[remote.data]);

  function patchEntry(id:string,patch:Partial<TeacherTimetableEntry>){setEntries(rows=>rows.map(row=>row.id===id?{...row,...patch}:row));setMessage('');setError('');}
  function add(){
    const firstCourse=courses[0];
    if(!firstCourse){setError('Primero crea un curso para asignar sus bloques.');return;}
    setEntries(rows=>[...rows,{id:newId(),weekday:1,startTime:'08:00',endTime:'09:00',courseId:firstCourse.id,block:1}]);
    setMessage('');setError('');
  }
  async function save(){
    if(!remote.data)return;
    setBusy(true);setError('');setMessage('');
    try{
      const saved=await apiPost<TeacherTimetable>('teacher-timetable',{revision,entries});
      setEntries(saved.entries);setRevision(saved.revision);remote.reload();
      setMessage('Horario docente guardado. La asistencia usará el curso y bloque de cada franja.');
    }catch(cause){setError(errorText(cause));}finally{setBusy(false);}
  }

  return <section className="teacher-timetable-panel" aria-labelledby="teacher-timetable-title">
    <div className="teacher-timetable-heading"><div><p className="eyebrow">CONFIGURACIÓN GENERAL</p><h1 id="teacher-timetable-title"><CalendarClock size={20}/> Horario docente</h1><p className="muted">Configúralo una sola vez. Cada franja indica el curso, día, hora y bloque; la captura de asistencia detectará cuál corresponde.</p></div><div className="toolbar"><button type="button" className="button secondary" onClick={add} disabled={!courses.length}><Plus size={15}/> Añadir franja</button><button type="button" className="button primary" onClick={()=>void save()} disabled={busy||remote.loading||!remote.data||!courses.length}>{busy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Guardar horario</button></div></div>
    {remote.loading&&!remote.data?<div className="loading-state"><LoaderCircle className="spin"/> Cargando horario…</div>:!courses.length?<div className="empty-state compact">Primero crea un curso. Después podrás organizar aquí el horario general y asignar cada franja al curso correspondiente.</div>:entries.length?<div className="table-wrap teacher-timetable-table-wrap"><table className="data-table teacher-timetable-table"><thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th>Curso</th><th>Bloque</th><th aria-label="Acciones"/></tr></thead><tbody>{entries.map(entry=><tr key={entry.id}><td><select aria-label={`Día de ${courses.find(course=>course.id===entry.courseId)?.code??'la franja'}`} value={entry.weekday} onChange={event=>patchEntry(entry.id,{weekday:Number(event.target.value)})}>{days.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td><td><input aria-label="Hora inicial" type="time" value={entry.startTime} onChange={event=>patchEntry(entry.id,{startTime:event.target.value})}/></td><td><input aria-label="Hora final" type="time" value={entry.endTime} onChange={event=>patchEntry(entry.id,{endTime:event.target.value})}/></td><td><select aria-label="Curso de la franja" value={entry.courseId} onChange={event=>patchEntry(entry.id,{courseId:event.target.value})}>{courses.map(course=><option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></td><td><select aria-label="Bloque" value={entry.block} onChange={event=>patchEntry(entry.id,{block:Number(event.target.value)})}>{Array.from({length:12},(_,index)=><option key={index+1} value={index+1}>Bloque {index+1}</option>)}</select></td><td><button type="button" className="icon-button" aria-label={`Quitar franja del ${days[entry.weekday-1]?.[1]??'horario'}`} onClick={()=>{setEntries(rows=>rows.filter(row=>row.id!==entry.id));setMessage('');setError('');}}><Trash2 size={16}/></button></td></tr>)}</tbody></table></div>:<div className="empty-state compact">Todavía no hay franjas en el horario docente. Añade una para empezar.</div>}
    {error&&<div className="notice warning" role="alert">{error}</div>}{message&&<div className="notice success" role="status">{message}</div>}
    <p className="teacher-timetable-footnote">Las franjas no confirman que una clase se impartió. Solo ayudan a seleccionar el curso y bloque; asistencia y estado de la clase se guardan desde el registro diario.</p>
  </section>;
}
