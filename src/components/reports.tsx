"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { downloadJson, useRemote } from "@/lib/client";
import type { Course, CourseCompetencySummary, EvaluationPlan, StudentReport } from "@/lib/model";

const numberFormat = new Intl.NumberFormat("es-DO", { maximumFractionDigits: 2 });
const formatNumber = (value: number | null) => value === null ? "Pendiente" : numberFormat.format(value);
const formatDate = (value: string) => {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
};

export default function ReportPanel({ course, plan }: { course: Course; plan: EvaluationPlan }) {
  const summary = useRemote<CourseCompetencySummary>("competency-summary", { courseId: course.id });
  if (!course.students.length) {
    return <><CompetencySummary summary={summary.data} error={summary.error} loading={summary.loading}/><section className="panel empty-state"><h2>Informe por estudiante</h2><p>Añade la lista de este curso para consultar sus informes.</p></section></>;
  }
  return <><CompetencySummary summary={summary.data} error={summary.error} loading={summary.loading}/><StudentReportPanel key={course.id} course={course} plan={plan} /></>;
}

function CompetencySummary({summary,error,loading}:{summary?:CourseCompetencySummary;error:string;loading:boolean}){
  return <section className="panel competency-summary" aria-labelledby="competency-summary-title">
    <div className="section-heading compact-heading"><div><p className="eyebrow">MATRIZ DEL CURSO · {summary?.period??"Período"}</p><h2 id="competency-summary-title">Resumen por competencia</h2><p className="muted">Una fila por estudiante; cada columna agrupa los puntos de evidencias que tienen esa competencia asignada.</p></div></div>
    <p className="notice">El total suma los puntos capturados por competencia. La nota del período se consulta aparte, según el cuadro o plan elegido; una celda vacía sigue siendo pendiente.</p>
    {error&&<div className="notice warning" role="alert">{error}</div>}{loading&&!summary&&<div className="loading-state">Calculando el resumen del curso…</div>}
    {summary&&<div className="table-wrap"><table className="data-table competency-matrix"><caption>{summary.course.code} · {summary.period}. Valores en puntos obtenidos / posibles.</caption><thead><tr><th>N.º</th><th>Estudiante</th>{summary.groups.map(group=><th key={group.key}>{group.label}</th>)}<th>Total</th></tr></thead><tbody>{summary.rows.map(row=><tr key={row.student.id}><td className="row-number">{String(row.student.number).padStart(2,"0")}</td><td className="student-name">{row.student.name}</td>{summary.groups.map(group=>{const item=row.competencies.find(value=>value.key===group.key);return <td key={group.key}>{item?`${formatNumber(item.points)} / ${formatNumber(item.possible)}`:"—"}{item?.pending? <small className="cell-description">{item.pending} pendiente(s)</small>:null}</td>})}<td><strong>{formatNumber(row.points)}</strong><small className="cell-description">/ {formatNumber(row.possible)}</small></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Curso · puntos acumulados</th>{summary.groups.map(group=>{const points=summary.rows.reduce((sum,row)=>sum+(row.competencies.find(value=>value.key===group.key)?.points??0),0);const possible=summary.rows.reduce((sum,row)=>sum+(row.competencies.find(value=>value.key===group.key)?.possible??0),0);return <th key={group.key}>{formatNumber(points)} / {formatNumber(possible)}</th>})}<th>{formatNumber(summary.rows.reduce((sum,row)=>sum+row.points,0))} / {formatNumber(summary.rows.reduce((sum,row)=>sum+row.possible,0))}</th></tr></tfoot></table></div>}
    {summary&&<p className="footnote">{summary.note}</p>}
  </section>;
}

function StudentReportPanel({ course, plan }: { course: Course; plan: EvaluationPlan }) {
  const students = useMemo(() => [...course.students].sort((a, b) => a.number - b.number || a.id.localeCompare(b.id)), [course.students]);
  const [selectedId, setSelectedId] = useState(students[0]?.id ?? "");
  const studentId = students.some(student => student.id === selectedId) ? selectedId : students[0]?.id ?? "";
  const params = useMemo(() => ({ courseId: course.id, studentId }), [course.id, studentId]);
  const { data, error, loading, reload } = useRemote<StudentReport>("report", params);
  const report = data?.student.id === studentId && data.course.id === course.id ? data : null;
  const behavior = report?.timeline.map((entry) => ({ ...entry, label: `${formatDate(entry.date)} · B${entry.block}`, behavior: entry.sessionStatus === "impartida" ? entry.behavior : null })) ?? [];
  const categories = report?.categories.map(category => ({ name: category.label, weight: category.weight, points: category.points })) ?? [];
  const labels = new Map([...plan.categories.map(category => [category.key, category.label] as const), ["extra", "Puntos extra"] as const]);
  const baseScore = report?.total !== null && report ? report.total - report.bonusPoints : report?.categories.some(category => category.points !== null) ? report.categories.reduce((sum, category) => sum + (category.points ?? 0), 0) : null;

  return <section aria-labelledby="student-report-title">
    <div className="section-heading">
      <div><p className="eyebrow">Seguimiento individual · {plan.period}</p><h2 id="student-report-title">Informe por estudiante</h2><p className="muted">Asistencia, comportamiento y evaluación de {course.code}.</p></div>
      <div className="toolbar">
        <button className="button secondary" type="button" onClick={() => reload()} disabled={loading}>Actualizar</button>
        <button className="button secondary" type="button" onClick={() => window.print()} disabled={!report || loading}>Imprimir informe</button>
        <button className="button secondary" type="button" disabled={!report || loading} onClick={() => report && downloadJson(`informe-${course.code}-${report.student.number}.json`, report)}>Descargar datos</button>
      </div>
    </div>
    <div className="panel">
      <div className="form-grid">
        <label className="field">Estudiante
          <select value={studentId} onChange={event => setSelectedId(event.target.value)}>
            {students.map(student => <option key={student.id} value={student.id}>{student.number}. {student.name}{student.active ? "" : " · Inactivo"}</option>)}
          </select>
        </label>
        <div className="field"><span>Período</span><strong>{plan.period}</strong><span className="muted">{formatDate(plan.startDate)} al {formatDate(plan.endDate)}</span></div>
      </div>
    </div>
    {error && <div className="notice error" role="alert">{String(error)}</div>}
    {loading && <p className="muted" role="status">Cargando el informe del estudiante seleccionado…</p>}
    {!loading && !error && !report && <div className="panel empty-state">No se encontró el informe del estudiante.</div>}
    {report && !loading && <>
      {!report.directEvaluation&&<div className={`notice report-plan-notice ${report.plan.status === "provisional" ? "warning" : "success"}`}><strong>{report.plan.status === "provisional" ? "Evaluación provisional." : "Plan de evaluación confirmado."}</strong> {report.plan.note}<p>Una valoración pendiente se mantiene vacía. Una valoración de 0 se conserva como cero.</p></div>}
      {report.directEvaluation&&<section className="panel"><h3>Calificación del período · {report.plan.period}</h3><p className="muted">Este cuadro determina la nota. Las actividades anteriores se conservan como evidencias sin sumarse otra vez.</p><div className="metrics"><div className="metric"><span>Acumulado / 100</span><strong>{formatNumber(report.directEvaluation.accumulated)}</strong><small>{report.directEvaluation.total===null?"En progreso":"Completo"}</small></div><div className="metric"><span>Puntos distribuidos</span><strong>{formatNumber(report.directEvaluation.plannedPoints)} / 100</strong></div><div className="metric"><span>Notas pendientes</span><strong>{report.directEvaluation.pending}</strong></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Qué se evalúa</th><th>Fecha</th><th>Nota</th><th>Máximo</th></tr></thead><tbody>{report.directEvaluation.columns.map(column=><tr key={column.id}><td>{column.label}</td><td>{column.date?formatDate(column.date):"Sin fecha"}</td><td>{formatNumber(report.directEvaluation!.scores[column.id])}</td><td>{formatNumber(column.maxPoints)}</td></tr>)}</tbody></table></div></section>}
      {!report.directEvaluation&&<>
      <div className="metrics">
        <div className="metric"><span>Base ponderada</span><strong>{baseScore === null ? "Pendiente" : `${formatNumber(baseScore)} / 100`}</strong><small>{report.total === null ? "Faltan requisitos para cerrar las cinco categorías." : "Nota base según el plan del período."}</small></div>
        <div className="metric"><span>Puntos extra</span><strong>{formatNumber(report.bonusPoints)} / {formatNumber(report.bonusPossible)}</strong><small>Se suman aparte; no cambian los pesos del plan.</small></div>
        <div className="metric"><span>Acumulado con extra</span><strong>{report.provisionalTotal === null ? "Pendiente" : formatNumber(report.provisionalTotal)}</strong><small>{report.total === null ? "Acumulado provisional; base de 100 más extra." : "Base de 100 más los puntos extra registrados."}</small></div>
        <div className="metric"><span>Asistencia</span><strong>{report.attendance.percent === null ? "Pendiente" : `${formatNumber(report.attendance.percent)} %`}</strong><small>{report.attendance.sessions} sesiones · {report.attendance.pending} registros pendientes</small></div>
      </div>
      </>}
      <div className="metrics" aria-label="Conteo de asistencia">
        {[{ label: "Presentes · P", value: report.attendance.present }, { label: "Ausencias · A", value: report.attendance.absent }, { label: "Tardanzas · T", value: report.attendance.late }, { label: "Excusas · E", value: report.attendance.excused }].map(item => <div key={item.label} className="metric"><span>{item.label}</span><strong>{item.value}</strong></div>)}
      </div>
      {report.notices.length > 0 && <div className="notice warning report-calculation-notice" role="status"><strong>Observaciones del cálculo</strong><ul>{report.notices.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}</ul></div>}
      <section className="panel" aria-labelledby="behavior-chart-title">
        <h3 id="behavior-chart-title">Comportamiento por sesión</h3><p className="muted">Escala de 0 a 10. Los espacios sin valoración se muestran como pendientes.</p>
        {behavior.some(entry => entry.behavior !== null) ? <div className="chart-box" role="img" aria-label="Evolución del comportamiento, en escala de cero a diez">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={behavior} accessibilityLayer margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="label" minTickGap={35} tick={{ fontSize: 11 }} /><YAxis domain={[0, 10]} allowDecimals={false} width={35} /><Tooltip /><Line type="linear" dataKey="behavior" name="Comportamiento / 10" stroke="#17776d" strokeWidth={3} dot={{ r: 4 }} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div> : <div className="empty-state">Todavía no hay valoraciones de comportamiento en sesiones impartidas.</div>}
        <div className="table-wrap"><table className="data-table"><caption>Detalle de comportamiento y asistencia</caption><thead><tr><th>Fecha</th><th>Bloque</th><th>Clase</th><th>Asistencia</th><th>Comportamiento / 10</th></tr></thead><tbody>
          {report.timeline.length === 0 ? <tr><td colSpan={5}>Sin sesiones registradas.</td></tr> : report.timeline.map(entry => <tr key={`${entry.date}-${entry.block}`}><td>{formatDate(entry.date)}</td><td>{entry.block}</td><td>{entry.sessionStatus === "impartida" ? "Impartida" : entry.sessionStatus === "programada" ? "Programada" : entry.sessionStatus === "no_programada" ? "No programada" : "No impartida"}</td><td>{entry.status ?? "Pendiente"}</td><td>{formatNumber(entry.behavior)}</td></tr>)}
        </tbody></table></div>
      </section>
      {!report.directEvaluation&&<section className="panel" aria-labelledby="category-chart-title">
        <h3 id="category-chart-title">Puntos por categoría</h3><p className="muted">La tabla indica qué categorías siguen pendientes de cálculo.</p>
        <div className="chart-box" role="img" aria-label="Puntos registrados comparados con el peso máximo por categoría">
          <ResponsiveContainer width="100%" height={310}>
            <BarChart data={categories} layout="vertical" accessibilityLayer margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" /><YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} /><Tooltip /><Legend /><Bar dataKey="weight" name="Máximo" fill="#d5dce5" radius={[0, 3, 3, 0]} /><Bar dataKey="points" name="Puntos registrados" fill="#17776d" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap"><table className="data-table"><caption>Cálculo de cada categoría</caption><thead><tr><th>Categoría</th><th>Obtenidos / posibles registrados</th><th>Valoraciones</th><th>Pendientes</th><th>Aporte / peso</th></tr></thead><tbody>
          {report.categories.map(category => <tr key={category.key}><td>{category.label}</td><td>{formatNumber(category.rawEarned)} / {formatNumber(category.rawPossible)}</td><td>{category.graded}</td><td>{category.pending}</td><td>{formatNumber(category.points)} / {formatNumber(category.weight)}{category.provisional && <span className="pill"> Provisional</span>}</td></tr>)}
        </tbody></table></div>
      </section>}
      <section className="panel" aria-labelledby="activity-report-title"><h3 id="activity-report-title">Actividades y calificaciones</h3>
        <div className="table-wrap"><table className="data-table"><caption>Calificaciones originales del estudiante, sin convertir vacíos en ceros</caption><thead><tr><th>Actividad</th><th>Creada</th><th>Categoría</th><th>Nota</th><th>Máximo</th><th>Cálculo</th><th>Comentario</th></tr></thead><tbody>
          {report.grades.length === 0 ? <tr><td colSpan={7}>No hay actividades creadas para este estudiante.</td></tr> : report.grades.map(grade => <tr key={grade.activityId}><td>{grade.title}</td><td>{formatDate(grade.date)}</td><td>{labels.get(grade.category) ?? grade.category}</td><td>{formatNumber(grade.score)}</td><td>{formatNumber(grade.maxPoints)}</td><td><span className="pill">{grade.included&&!report.directEvaluation ? "Incluida" : "Fuera del cálculo"}</span></td><td>{grade.comment || "—"}</td></tr>)}
        </tbody></table></div>
      </section>
    </>}
  </section>;
}
