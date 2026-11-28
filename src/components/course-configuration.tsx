'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GraduationCap, Settings2 } from 'lucide-react';
import type { Activity, Bootstrap, EvaluationPeriodKey, EvaluationPlan, EvaluationCriterion, SequencePlan } from '@/lib/model';
import { apiPost, errorText } from '@/lib/client';
import { ActivityEvaluationEditor } from './activity-workspace';
import { isActivityEvaluationReady } from '@/lib/evaluation-readiness';

const periods: EvaluationPeriodKey[] = ['P1', 'P2', 'P3', 'P4'];
const emptySequence: SequencePlan = { source: 'manual', sourceName: '', sourceText: '', reviewed: false, activities: [], indicators: [] };

export default function CourseConfigurationPanel({ courses, activities, plan, sequence, criteriaCatalog, initialCourseId, activityToConfigure, onConsumeActivityRequest, onChange, onConfigurePlan, onGrade, onOpenActivities }: {
  courses: Bootstrap['courses']; activities: Activity[]; plan: EvaluationPlan; sequence: SequencePlan | null;
  criteriaCatalog: EvaluationCriterion[]; initialCourseId?: string; activityToConfigure?: string | null;
  onConsumeActivityRequest?: () => void; onChange: () => void; onConfigurePlan: (period: string) => void;
  onGrade: (activityId: string, courseId: string) => void; onOpenActivities: (courseId?: string) => void;
}) {
  const [courseId, setCourseId] = useState(initialCourseId || courses[0]?.id || '');
  const [contentPart, setContentPart] = useState('all');
  const [period, setPeriod] = useState<EvaluationPeriodKey>(periods.includes(plan.period as EvaluationPeriodKey) ? plan.period as EvaluationPeriodKey : 'P1');
  const [configureActivityId, setConfigureActivityId] = useState<string | null>(null);
  const [gradingBusyId, setGradingBusyId] = useState<string | null>(null);
  const [gradingError, setGradingError] = useState('');
  const course = courses.find(item => item.id === courseId) ?? courses[0];

  useEffect(() => {
    if (!courses.some(item => item.id === courseId) && courses[0]) setCourseId(courses[0].id);
  }, [courseId, courses]);

  useEffect(() => {
    if (!activityToConfigure) return;
    const target = activities.find(item => item.id === activityToConfigure);
    if (target) {
      if (target.courseId) setCourseId(target.courseId);
      if (periods.includes(target.period as EvaluationPeriodKey)) setPeriod(target.period as EvaluationPeriodKey);
      setContentPart(target.sequencePlannedPeriod && periods.includes(target.sequencePlannedPeriod as EvaluationPeriodKey) ? target.sequencePlannedPeriod : 'all');
      setConfigureActivityId(target.id);
    }
    onConsumeActivityRequest?.();
  // This is a one-shot request from the grade capture screen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityToConfigure]);

  const courseActivities = useMemo(() => course ? activities.filter(item => item.courseId === course.id) : [], [activities, course]);
  const visibleActivities = courseActivities
    .filter(item => item.period === period)
    .filter(item => contentPart === 'all' || (contentPart === 'none' ? !item.sequencePlannedPeriod : item.sequencePlannedPeriod === contentPart))
    .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const configuring = activities.find(item => item.id === configureActivityId && item.courseId === course?.id) ?? null;
  const linkedCourseOptions = configuring?.sharedId ? activities
    .filter(item => item.sharedId === configuring.sharedId && item.id !== configuring.id)
    .map(item => ({ activityId: item.id, courseId: item.courseId, courseCode: courses.find(candidate => candidate.id === item.courseId)?.code ?? 'Otro curso' })) : [];

  function chooseCourse(id: string) {
    setCourseId(id);
    setConfigureActivityId(null);
  }

  async function setIncludedForGrading(activity: Activity, active: boolean) {
    setGradingBusyId(activity.id); setGradingError('');
    try {
      await apiPost<Activity>('activity-grading-state', { activityId: activity.id, revision: activity.revision, active, requestId: crypto.randomUUID() });
      onChange();
    } catch (error) { setGradingError(errorText(error)); }
    finally { setGradingBusyId(null); }
  }

  if (!courses.length) return <section className="panel course-configuration-empty"><GraduationCap size={28}/><h1>Configurar cursos</h1><p>Primero crea un curso en <strong>Cursos</strong>. Después podrás elegir qué evaluaciones se usarán y cómo se calificarán.</p></section>;

  return <>
    <div className="section-heading course-config-heading"><div><p className="eyebrow">CONFIGURACIÓN DEL REGISTRO</p><h1>Configurar cursos</h1><p className="muted">Elige un curso y define cómo se califican las actividades preparadas para él. Cada curso conserva sus propias decisiones.</p></div><span className="pill"><CheckCircle2 size={14}/> Por curso</span></div>

    <section className="panel course-config-selector" aria-label="Cursos creados">
      <div className="table-toolbar"><div><p className="eyebrow">CURSOS CREADOS</p><h2>Selecciona un curso</h2></div><span className="pill">{courses.length} cursos</span></div>
      <div className="course-config-course-tabs" role="tablist" aria-label="Cursos">
        {courses.map(item => <button key={item.id} type="button" role="tab" aria-selected={course?.id === item.id} className={course?.id === item.id ? 'selected' : ''} onClick={() => chooseCourse(item.id)}><span>{item.code}</span><small>{item.students.filter(student => student.active).length} estudiantes activos</small></button>)}
      </div>
      {course && <div className="course-config-selected-summary"><div><span className="course-config-icon"><GraduationCap size={19}/></span><div><strong>{course.name}</strong><small>{courseActivities.length} actividades preparadas para este curso · la distribución de puntos del período es común</small></div></div><button type="button" className="button secondary" onClick={() => onConfigurePlan(period)}><Settings2 size={16}/> Distribución común de {period}</button></div>}
    </section>

    {course && <>
        <section className="panel course-config-period-section" aria-label="Elegir parte del año y período de evaluación">
          <div className="course-config-selectors">
            <label>Parte del año escolar / contenido de la secuencia
              <select value={contentPart} onChange={event => { setContentPart(event.target.value); setConfigureActivityId(null); }}>
                <option value="all">Todas las partes</option>
                {periods.map(key => <option key={key} value={key}>{key} · contenido planificado</option>)}
                <option value="none">Sin parte de secuencia</option>
              </select>
              <small>Filtra por el período al que pertenece el contenido planificado. Esto no determina dónde se reporta la nota.</small>
            </label>
            <label>Período que recibirá la calificación
              <select value={period} onChange={event => { setPeriod(event.target.value as EvaluationPeriodKey); setConfigureActivityId(null); }}>
                {periods.map(key => <option key={key} value={key}>{key}</option>)}
              </select>
              <small>La actividad puede haberse trabajado en otra parte del año y registrarse en este período.</small>
            </label>
          </div>
        </section>

        <section className="panel course-config-activities-summary" aria-label={`Evaluaciones de ${course.code} ${period}`}>
          <div className="course-config-section-heading"><div><p className="eyebrow">{course.code} · CONTENIDO {contentPart === 'all' ? 'DE TODAS LAS PARTES' : contentPart === 'none' ? 'SIN PARTE ASIGNADA' : contentPart} · NOTAS EN {period}</p><h2>Actividades preparadas</h2><p className="muted">Aquí eliges cuáles de las actividades preparadas cuentan en las notas de {course.code}. Solo las incluidas aparecen en Calificaciones.</p></div><span className="pill">{visibleActivities.filter(activity => activity.activeForGrading ?? true).length} incluidas · {visibleActivities.length} preparadas</span></div>
          {gradingError&&<div className="notice warning" role="alert">{gradingError}</div>}
          {visibleActivities.length ? <div className="course-config-activity-list">{visibleActivities.map(activity => <article key={activity.id} className={configureActivityId === activity.id ? 'editing' : ''}>
            <div><strong>{activity.title}</strong><small>{activity.date || 'Sin fecha'} · {activity.category} · máximo {activity.maxPoints} puntos</small></div>
            <span className={`course-config-method ${(activity.activeForGrading ?? true) ? 'ready' : 'pending'}`}>{!isActivityEvaluationReady(activity) ? 'Falta configurar' : (activity.activeForGrading ?? true) ? activity.scoringMode === 'rubric' ? 'Incluida · competencias' : 'Incluida · puntos directos' : 'Preparada · no incluida'}</span>
            <div className="toolbar"><button type="button" className="button secondary" onClick={() => setConfigureActivityId(configureActivityId === activity.id ? null : activity.id)}>{configureActivityId === activity.id ? 'Cerrar' : isActivityEvaluationReady(activity) ? 'Cambiar método' : 'Configurar'}</button><button type="button" className="button secondary" aria-pressed={activity.activeForGrading ?? true} disabled={gradingBusyId===activity.id||(!isActivityEvaluationReady(activity)&&!(activity.activeForGrading??true))} title={!isActivityEvaluationReady(activity)&&!(activity.activeForGrading??true)?'Configura primero los criterios o puntos de la actividad':undefined} onClick={()=>void setIncludedForGrading(activity,!(activity.activeForGrading??true))}>{gradingBusyId===activity.id?'Guardando…':(activity.activeForGrading??true)?'Quitar de notas':'Incluir en notas'}</button><button type="button" className="text-button" disabled={!(activity.activeForGrading??true)||!isActivityEvaluationReady(activity)} title={!(activity.activeForGrading??true)?'Incluye esta actividad antes de calificarla':!isActivityEvaluationReady(activity)?'Configura el método antes de capturar notas':undefined} onClick={() => onGrade(activity.id, course.id)}>Calificar lista</button></div>
          </article>)}</div> : <div className="empty-state compact"><h3>No hay actividades en este filtro</h3><p>Prepara la actividad para <strong>{course.code}</strong>. Al guardarla aquí podrás definir cómo se calificará y si contará en {period}.</p><button type="button" className="button primary" onClick={()=>onOpenActivities(course.id)}>Preparar para {course.code}</button></div>}
        </section>

        {configuring && <ActivityEvaluationEditor key={`${configuring.id}-${configuring.revision}`} activity={configuring} sequence={sequence ?? emptySequence} criteria={criteriaCatalog} courseCode={course.code} linkedCourses={linkedCourseOptions} onClose={() => setConfigureActivityId(null)} onSaved={() => { setConfigureActivityId(null); onChange(); }}/ >}
    </>}
  </>;
}
