'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, LoaderCircle } from 'lucide-react';
import type { Course } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';

export default function CourseAdministration({course,onChange,onOpenStudents,onDirty}:{course:Course;onChange:()=>void;onOpenStudents:()=>void;onDirty:(dirty:boolean)=>void}) {
  const [before,setBefore]=useState(()=>course.students.map(({id,name,number})=>({id,name,number})));
  const [rows,setRows]=useState(()=>[...before].sort((a,b)=>a.number-b.number));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const dirty=JSON.stringify([...rows].sort((a,b)=>a.id.localeCompare(b.id)))!==JSON.stringify([...before].sort((a,b)=>a.id.localeCompare(b.id)));
  useEffect(()=>{onDirty(dirty||busy);},[dirty,busy,onDirty]);
  function move(index:number,target:number) {
    const next=[...rows];
    const [student]=next.splice(index,1);next.splice(target,0,student);
    setRows(next.map((row,i)=>({...row,number:i+1})));setSuccess('');
  }
  async function save(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');setSuccess('');
    try {
      const saved=await apiPost<Course['students']>('manage-roster',{courseId:course.id,before,rows});
      const snapshot=saved.map(({id,name,number})=>({id,name,number}));
      setBefore(snapshot);setRows([...snapshot].sort((a,b)=>a.number-b.number));
      setSuccess('Lista guardada. Cada estudiante conserva su asistencia, conducta y calificaciones.');onChange();
    } catch(cause) {setError(errorText(cause));} finally {setBusy(false);}
  }
  return <form onSubmit={save}>
    <div className="table-toolbar"><div><h3>{course.code} · {course.name}</h3><p className="muted">Edita los nombres y mueve cada estudiante a su lugar. Los cambios se reflejan en las listas sin alterar su historial.</p></div><button type="button" className="button secondary" disabled={busy||dirty} onClick={onOpenStudents}>Añadir o importar estudiantes</button></div>
    {error&&<div className="notice warning" role="alert">{error}</div>}{success&&<div className="notice success" role="status">{success}</div>}
    <fieldset disabled={busy} className="course-roster-fields"><div className="table-wrap"><table className="data-table"><thead><tr><th>Lugar</th><th>Nombre del estudiante</th><th>Cambiar lugar</th></tr></thead><tbody>{rows.map((student,index)=><tr key={student.id}><td>{student.number}</td><td><input aria-label={`Nombre del estudiante ${student.number}`} required maxLength={250} value={student.name} onChange={event=>{setRows(current=>current.map(row=>row.id===student.id?{...row,name:event.target.value}:row));setSuccess('');}}/></td><td><div className="toolbar"><button type="button" className="button secondary" aria-label={`Subir a ${student.name}`} disabled={index===0} onClick={()=>move(index,index-1)}><ArrowUp size={16}/></button><button type="button" className="button secondary" aria-label={`Bajar a ${student.name}`} disabled={index===rows.length-1} onClick={()=>move(index,index+1)}><ArrowDown size={16}/></button><label>Ir al lugar<input type="number" min={1} max={rows.length} value={index+1} aria-label={`Lugar de ${student.name}`} onChange={event=>{const target=Number(event.target.value)-1;if(Number.isInteger(target)&&target>=0&&target<rows.length)move(index,target);}}/></label></div></td></tr>)}</tbody></table></div>
    {!rows.length&&<p className="empty-state compact">Este curso todavía no tiene estudiantes. Añade o importa su lista.</p>}
    <div className="toolbar"><button className="button primary" disabled={!dirty||busy}>{busy&&<LoaderCircle className="spin" size={16}/>} Guardar cambios</button><button type="button" className="button secondary" disabled={!dirty||busy} onClick={()=>{setRows([...before].sort((a,b)=>a.number-b.number));setError('');setSuccess('');}}>Descartar cambios</button>{dirty&&<span className="muted">Hay cambios sin guardar. Guárdalos o descártalos antes de cambiar de curso.</span>}</div></fieldset>
  </form>;
}
