"use client";

import { useMemo, useState } from "react";
import { Download, LoaderCircle, Search, Table2 } from "lucide-react";
import { downloadJson, useRemote } from "@/lib/client";
import type { TeacherLedgerColumn, TeacherLedgerSummary } from "@/lib/model";

const fmt = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 2 });
const categoryNames: Record<TeacherLedgerColumn["category"], string> = {
  exam: "Examen",
  participation: "Conducta / participación",
  notebook: "Libreta y tareas",
  sequence: "Trabajo para entregar",
  homework: "Práctica para casa",
  extra: "Puntos extra",
  behavior: "Conducta",
};

export default function TeacherLedgerPanel() {
  const [period, setPeriod] = useState<string>();
  const remote = useRemote<TeacherLedgerSummary>("teacher-ledger", period ? { period } : {});
  const [course, setCourse] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const courses = useMemo(() => [...new Map((remote.data?.rows ?? []).map(row => [row.course.id, row.course])).values()], [remote.data]);
  const selectedCourse = course ?? courses[0]?.id ?? "all";
  const selectedPeriod = period ?? remote.data?.period ?? "P2";
  const rows = useMemo(() => (remote.data?.rows ?? []).filter(row =>
    (selectedCourse === "all" || row.course.id === selectedCourse) &&
    `${row.course.code} ${row.student.name} ${row.student.number}`.toLowerCase().includes(search.toLowerCase())
  ), [remote.data, selectedCourse, search]);
  const groups = useMemo(() => (remote.data?.groups ?? []).map(group => ({
    ...group,
    columns: group.columns.filter(column => selectedCourse === "all" || column.courseIds.includes(selectedCourse)),
  })).filter(group => group.columns.length), [remote.data, selectedCourse]);
  const columns = useMemo(() => groups.flatMap(group => group.columns), [groups]);
  const categoryGroups = useMemo(() => {
    const grouped = new Map<string, TeacherLedgerSummary["categories"]>();
    for (const category of remote.data?.categories ?? []) {
      const label = category.group || category.label;
      grouped.set(label, [...(grouped.get(label) ?? []), category]);
    }
    return [...grouped.entries()].map(([label, categories]) => ({
      key: categories.map(category => category.key).join("+"), label, categories,
      weight: categories.reduce((sum, category) => sum + category.weight, 0),
    }));
  }, [remote.data?.categories]);
  const showCourse = selectedCourse === "all";

  return <>
    <div className="section-heading">
      <div><p className="eyebrow">REGISTRO DOCENTE · {selectedPeriod}</p><h1>Libro de calificaciones</h1><p className="muted">Resultados por categoría y detalle de cada actividad, criterio y competencia.</p></div>
      <button className="button secondary" disabled={!remote.data} onClick={() => remote.data && downloadJson(`libro-${selectedCourse}-${remote.data.period}.json`, { ...remote.data, groups, rows })}><Download size={17}/> Descargar vista</button>
    </div>
    <div className="notice">El resumen convierte las categorías a los puntos del período. Las categorías agrupadas se suman en una columna y conservan el desglose. Los puntos extra se agregan aparte; abajo están las actividades, criterios y competencias.</div>
    <section className="panel ledger-panel">
      <div className="table-toolbar ledger-toolbar">
        <div className="search-field"><Search size={17}/><input aria-label="Buscar en libro general" placeholder="Buscar estudiante…" value={search} onChange={event=>setSearch(event.target.value)}/></div>
        <label>Curso<select aria-label="Filtrar curso" value={selectedCourse} onChange={event=>setCourse(event.target.value)}><option value="all">Todos los cursos</option>{courses.map(item=><option value={item.id} key={item.id}>{item.code}</option>)}</select></label>
        <label>Período<select aria-label="Período de calificaciones" value={selectedPeriod} onChange={event=>setPeriod(event.target.value)}>{(remote.data?.availablePeriods??[selectedPeriod]).map(item=><option key={item} value={item}>{item}</option>)}</select></label>
        <span className="pill">{rows.length} estudiantes</span>
      </div>
      {remote.loading&&!remote.data&&<div className="loading-state"><LoaderCircle className="spin"/> Preparando el libro general…</div>}
      {remote.error&&<div className="notice warning" role="alert">{remote.error}</div>}
      {remote.data&&<>
      <section className="ledger-development panel" aria-labelledby="grade-development-title">
        <div className="ledger-development-heading"><div><p className="eyebrow">RESUMEN DEL PERÍODO · {remote.data.period}</p><h2 id="grade-development-title">Calificación por estudiante</h2><p className="muted">Cada categoría lleva sus evidencias a la distribución acordada; las celdas muestran el aporte actual y cuánto falta.</p></div></div>
        <div className="table-wrap ledger-category-wrap"><table className="data-table ledger-category-table"><thead><tr>{showCourse&&<th>Curso</th>}<th>N.º</th><th>Estudiante</th>{categoryGroups.map(category=><th key={category.key}>{category.label}<small>{fmt.format(category.weight)} puntos</small></th>)}<th>Puntos extra<small>Adicionales</small></th><th>Acumulado</th><th>Estado</th></tr></thead><tbody>{rows.map(row=><tr key={row.student.id}>{showCourse&&<td><span className="pill">{row.course.code}</span></td>}<td className="row-number">{String(row.student.number).padStart(2,"0")}</td><td className="student-name">{row.student.name}</td>{categoryGroups.map(category=>{const scores=category.categories.map(item=>row.categories.find(score=>score.key===item.key));const complete=scores.length===category.categories.length&&scores.every(score=>score!==undefined&&score.points!==null&&score.pending===0&&!score.provisional&&!score.planIncomplete);const points=scores.reduce((sum,score)=>sum+(score?.points??0),0);const pending=scores.reduce((sum,score)=>sum+(score?.pending??0),0);return <td key={category.key} className="ledger-category-score">{complete?<strong>{fmt.format(points)} / {fmt.format(category.weight)}</strong>:<strong className="pending-label">Pendiente · {fmt.format(points)} / {fmt.format(category.weight)}</strong>}{category.categories.length>1?scores.map((score,index)=><small key={category.categories[index]!.key}>{category.categories[index]!.label}: {score?.points===null||score?.points===undefined?'Pend.':`${fmt.format(score.points)} / ${fmt.format(category.categories[index]!.weight)}`}{score?.pending?` · ${score.pending} pend.`:''}</small>):<small>{scores[0]?`${fmt.format(scores[0].rawEarned)} / ${fmt.format(scores[0].rawPossible)} bruto${pending?` · ${pending} pendiente(s)`:''}`:'Sin evidencia'}</small>}{scores.some(score=>score?.planIncomplete||score?.provisional)&&<small className="cell-description">Máximo o evidencias por completar</small>}</td>})}<td className="ledger-score"><strong>{fmt.format(row.bonusPoints)}</strong><small>/ {fmt.format(row.bonusPossible)} extra</small></td><td className="ledger-score">{row.weightedTotal===null?<span className="pending-label">—</span>:<strong>{fmt.format(row.weightedTotal)}</strong>}<small>/ 100 + extra</small></td><td><span className={'pill '+(row.finalized?'':'provisional')}>{row.finalized?'Completo':'En proceso'}</span></td></tr>)}</tbody></table></div>
        <p className="footnote">Las categorías diarias de conducta y libreta usan solo clases impartidas. Una categoría por actividad requiere sus evidencias y el máximo bruto esperado; los pendientes no se convierten en cero. El total solo se marca completo cuando todas las reglas y notas están cerradas.</p>
      </section>
      <div className="ledger-development-heading"><div><p className="eyebrow">EVIDENCIAS Y COMPETENCIAS</p><h2>Detalle de actividades por competencia</h2><p className="muted">Cada actividad conserva su propia columna; las rúbricas se desglosan por criterio.</p></div></div>
      <div className="table-wrap ledger-wrap"><table className={`data-table ledger-table ${showCourse?"ledger-all":"ledger-one"}`} style={{minWidth:`${Math.max(900, 540 + columns.length * 138)}px`}}>
        <thead>
          <tr>{showCourse&&<th rowSpan={2}>Curso</th>}<th rowSpan={2}>N.º</th><th rowSpan={2}>Estudiante</th>{groups.map(group=><th key={group.key} colSpan={group.columns.length}>{group.label}</th>)}<th rowSpan={2}>Total bruto</th><th rowSpan={2}>Aporte al período / 100</th><th rowSpan={2}>Observaciones</th></tr>
          <tr>{columns.map(column=><th key={column.key} title={`${column.categoryLabel} · ${column.label}`}><span className="ledger-column-title">{column.label}</span><small className="ledger-column-meta">{categoryNames[column.category]}{column.date?` · creada ${column.date}`:""} · máx. {fmt.format(column.maxPoints)}</small></th>)}</tr>
        </thead>
        <tbody>{rows.map(row=>{
          const scoreByKey=new Map(row.scores.map(score=>[score.key,score]));
          return <tr key={row.student.id}>
            {showCourse&&<td><span className="pill">{row.course.code}</span></td>}<td className="row-number">{String(row.student.number).padStart(2,"0")}</td><td className="student-name">{row.student.name}</td>
            {columns.map(column=>{
              const value=scoreByKey.get(column.key);
              if(!value||value.state==="not_applicable")return <td key={column.key} className="ledger-empty">—{column.kind==="behavior"&&value?.state==="not_applicable"&&<small>Sin valoración por ausencia/excusa</small>}</td>;
              if(value.state==="excluded")return <td key={column.key} className="ledger-excluded">{value.points===null?"—":<><strong>{fmt.format(value.points)}</strong><small>/ {fmt.format(value.possible)}</small></>}<small className="cell-description">No cuenta: clase no impartida</small></td>;
              if(value.state==="pending")return <td key={column.key} className="ledger-score">{value.points===null?<strong className="pending-label">Pend.</strong>:<strong>{fmt.format(value.points)}</strong>}<small>/ {fmt.format(value.possible)}</small>{value.pending>0&&<small className="cell-description">{value.pending} pendiente(s)</small>}</td>;
              return <td key={column.key} className="ledger-score"><strong>{fmt.format(value.points??0)}</strong><small>/ {fmt.format(value.possible)}</small></td>;
            })}
            <td className="ledger-score"><strong>{fmt.format(row.rawTotal)}</strong><small>/ {fmt.format(row.rawPossible)}</small></td><td>{row.weightedTotal===null?<span className="pending-label">Pendiente</span>:<strong>{fmt.format(row.weightedTotal)}</strong>}</td><td className="ledger-observations" title={row.observations.join(" · ")}>{row.observations.length?row.observations.join(" · "):"—"}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr><th colSpan={(showCourse?3:2)}>Puntos acumulados</th>{columns.map(column=>{
          const values=rows.map(row=>row.scores.find(score=>score.key===column.key)).filter((item):item is NonNullable<typeof item>=>Boolean(item&&item.state!=="excluded"&&item.state!=="not_applicable"));
          const points=values.reduce((sum,item)=>sum+(item.points??0),0),possible=values.reduce((sum,item)=>sum+item.possible,0);
          return <th key={column.key}>{fmt.format(points)} / {fmt.format(possible)}</th>;
        })}<th>{fmt.format(rows.reduce((sum,row)=>sum+row.rawTotal,0))} / {fmt.format(rows.reduce((sum,row)=>sum+row.rawPossible,0))}</th><th colSpan={2}>Pendientes y clases no impartidas se distinguen</th></tr></tfoot>
      </table>{!rows.length&&<div className="empty-state"><Table2 size={32}/><h2>No hay coincidencias</h2><p>Cambia el curso o el texto de búsqueda.</p></div>}</div></>}
      {remote.data&&<p className="footnote">{remote.data.note} El total ponderado permanece provisional si falta confirmar el plan.</p>}
    </section>
  </>;
}
