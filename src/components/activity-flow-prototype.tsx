'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { COMPETENCY_GROUPS, type CompetencyKey } from '@/lib/model';

type Step = 0 | 1 | 2 | 3;
type IndicatorRow = { id: string; label: string; competency: CompetencyKey; points: number };
type Criterion = { id: string; label: string; indicatorId: string; weight: number; levels: { label: string; description: string }[] };

const STEPS = [
  { title: 'Crear actividad', note: 'Ficha básica' },
  { title: 'Indicadores', note: 'Asignación de puntos' },
  { title: 'Criterios', note: 'Cómo valorar' },
  { title: 'Calificar', note: 'Por estudiante' },
];
const COURSES = ['5A', '5B', '5C'];
const STUDENTS = ['Estudiante de prueba 01', 'Estudiante de prueba 02', 'Estudiante de prueba 03', 'Estudiante de prueba 04'];
const RUBRIC_LEVELS = ['Insuficiente', 'Suficiente', 'Bueno', 'Excelente'];
const CRITERIA_CATALOG: Criterion[] = [
  { id: 'procedure', label: 'Precisión del procedimiento', indicatorId: 'indicator-a', weight: 1, levels: [
    { label: 'Insuficiente', description: 'El procedimiento tiene errores que impiden llegar al resultado.' },
    { label: 'Suficiente', description: 'Aplica parte del procedimiento, con errores o pasos incompletos.' },
    { label: 'Bueno', description: 'Aplica el procedimiento correctamente, con algún detalle por mejorar.' },
    { label: 'Excelente', description: 'Aplica y justifica el procedimiento con precisión.' },
  ] },
  { id: 'explanation', label: 'Explicación del resultado', indicatorId: 'indicator-b', weight: 1, levels: [
    { label: 'Insuficiente', description: 'No explica el resultado o la explicación no corresponde.' },
    { label: 'Suficiente', description: 'Explica el resultado de forma parcial.' },
    { label: 'Bueno', description: 'Explica el resultado y menciona los pasos principales.' },
    { label: 'Excelente', description: 'Explica y verifica el resultado con claridad.' },
  ] },
];

function localDateInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function newId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export default function ActivityFlowPrototype() {
  const [step, setStep] = useState<Step>(0);
  const [savedActivity, setSavedActivity] = useState(false);
  const [title, setTitle] = useState('Suma de vectores · ejemplo de prueba');
  const [period, setPeriod] = useState('P2');
  const [category, setCategory] = useState('Trabajos para entregar');
  const [date] = useState(localDateInputValue);
  const [maxPoints, setMaxPoints] = useState(10);
  const [instructions, setInstructions] = useState('Resuelve los ejercicios asignados y muestra el procedimiento.');
  const [indicators, setIndicators] = useState<IndicatorRow[]>([
    { id: 'indicator-a', label: 'Representa los componentes del vector', competency: 'logico_matematica', points: 6 },
    { id: 'indicator-b', label: 'Justifica la resultante', competency: 'resolucion', points: 4 },
  ]);
  const [criteriaCatalog, setCriteriaCatalog] = useState(CRITERIA_CATALOG);
  const [selectedCriterionIds, setSelectedCriterionIds] = useState<string[]>(['procedure', 'explanation']);
  const [showCriterionForm, setShowCriterionForm] = useState(false);
  const [newCriterionLabel, setNewCriterionLabel] = useState('');
  const [newCriterionIndicatorId, setNewCriterionIndicatorId] = useState('indicator-a');
  const [newCriterionWeight, setNewCriterionWeight] = useState(1);
  const [newCriterionLevels, setNewCriterionLevels] = useState(() => RUBRIC_LEVELS.map(label => ({ label, description: '' })));
  const [activeCourse, setActiveCourse] = useState('5A');
  const [ratings, setRatings] = useState<Record<string, Record<string, Record<string, number>>>>({});
  const [savedGrades, setSavedGrades] = useState(false);
  const [error, setError] = useState('');

  const indicatorTotal = indicators.reduce((sum, item) => sum + (Number.isFinite(item.points) ? item.points : 0), 0);
  const selectedCriteria = useMemo(() => criteriaCatalog.filter(item => selectedCriterionIds.includes(item.id)), [criteriaCatalog, selectedCriterionIds]);
  const courseRatings = ratings[activeCourse] ?? {};
  const coveredIndicatorIds = new Set(selectedCriteria.map(criterion => criterion.indicatorId));
  const missingCriteriaIndicators = indicators.filter(indicator => indicator.points > 0 && !coveredIndicatorIds.has(indicator.id));

  function criterionPoints(student: string, indicator: IndicatorRow) {
    const linked = selectedCriteria.filter(criterion => criterion.indicatorId === indicator.id);
    if (!linked.length || linked.some(criterion => courseRatings[student]?.[criterion.id] === undefined)) return null;
    const weightedLevel = linked.reduce((sum, criterion) => sum + (courseRatings[student][criterion.id] + 1) * criterion.weight, 0);
    const weightedMaximum = linked.reduce((sum, criterion) => sum + 4 * criterion.weight, 0);
    return Math.round((weightedLevel / weightedMaximum) * indicator.points * 100) / 100;
  }

  function competencyPoints(student: string, competency: CompetencyKey) {
    const rows = indicators.filter(indicator => indicator.competency === competency && indicator.points > 0);
    if (!rows.length) return null;
    const points = rows.map(indicator => criterionPoints(student, indicator));
    if (points.some(value => value === null)) return null;
    return Math.round((points as number[]).reduce((sum, value) => sum + value, 0) * 100) / 100;
  }

  const activeCompetencies = COMPETENCY_GROUPS.filter(group => indicators.some(indicator => indicator.competency === group.key && indicator.points > 0));
  const gradedCount = STUDENTS.filter(student => selectedCriteria.length > 0 && missingCriteriaIndicators.length === 0 && indicators.filter(indicator => indicator.points > 0).every(indicator => criterionPoints(student, indicator) !== null)).length;

  function updateIndicator(id: string, patch: Partial<IndicatorRow>) {
    setIndicators(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    setSavedGrades(false);
  }

  function addIndicator() {
    setIndicators(current => [...current, { id: newId(), label: '', competency: 'logico_matematica', points: 0 }]);
    setSavedGrades(false);
  }

  function toggleCriterion(id: string) {
    setSelectedCriterionIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
    setSavedGrades(false);
  }

  function updateCriterion(id: string, patch: Partial<Criterion>) {
    setCriteriaCatalog(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
    setSavedGrades(false);
  }

  function addActivityCriterion() {
    if (!newCriterionLabel.trim()) { setError('Escribe el nombre del criterio.'); return; }
    if (!newCriterionIndicatorId || !indicators.some(item => item.id === newCriterionIndicatorId)) { setError('Asocia el criterio con un indicador.'); return; }
    if (!Number.isFinite(newCriterionWeight) || newCriterionWeight <= 0) { setError('El peso relativo del criterio debe ser mayor que cero.'); return; }
    if (newCriterionLevels.some(level => !level.description.trim())) { setError('Describe qué evidencia corresponde a cada uno de los cuatro niveles.'); return; }
    const criterion: Criterion = { id: newId(), label: newCriterionLabel.trim(), indicatorId: newCriterionIndicatorId, weight: newCriterionWeight, levels: newCriterionLevels.map(level => ({ ...level, description: level.description.trim() })) };
    setCriteriaCatalog(current => [...current, criterion]);
    setSelectedCriterionIds(current => [...current, criterion.id]);
    setNewCriterionLabel('');
    setNewCriterionIndicatorId(indicators[0]?.id ?? '');
    setNewCriterionWeight(1);
    setNewCriterionLevels(RUBRIC_LEVELS.map(label => ({ label, description: '' })));
    setShowCriterionForm(false);
    setSavedGrades(false);
    setError('');
  }

  function setRating(student: string, criterionId: string, value: string) {
    setRatings(current => {
      const nextCourse = { ...(current[activeCourse] ?? {}) };
      const nextStudent = { ...(nextCourse[student] ?? {}) };
      if (value === '') delete nextStudent[criterionId];
      else nextStudent[criterionId] = Number(value);
      nextCourse[student] = nextStudent;
      return { ...current, [activeCourse]: nextCourse };
    });
    setSavedGrades(false);
  }

  function studentScore(student: string) {
    const scoredIndicators = indicators.filter(indicator => indicator.points > 0);
    if (!scoredIndicators.length || missingCriteriaIndicators.length) return null;
    const earned = scoredIndicators.map(indicator => criterionPoints(student, indicator));
    if (earned.some(value => value === null)) return null;
    return Math.round((earned as number[]).reduce((sum, value) => sum + value, 0) * 100) / 100;
  }

  function continueFromActivity() {
    if (!title.trim()) { setError('Escribe el nombre de la actividad.'); return; }
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) { setError('El máximo debe ser mayor que cero.'); return; }
    setError('');
    setSavedActivity(true);
    setStep(1);
  }

  function next() {
    setError('');
    if (step === 1 && indicators.some(item => !item.label.trim() || item.points <= 0)) {
      setError('Completa el nombre, la competencia y los puntos de cada indicador; cada uno debe recibir puntos mayores que cero.');
      return;
    }
    if (step === 1 && Math.abs(indicatorTotal - maxPoints) > 0.001) {
      setError(`La prueba propone repartir los ${maxPoints} puntos completos; ahora hay ${indicatorTotal} asignados.`);
      return;
    }
    if (step === 2 && selectedCriteria.length === 0) {
      setError('Elige por lo menos un criterio o vuelve para cambiar la forma de valoración.');
      return;
    }
    if (step === 2 && selectedCriteria.some(criterion => !criterion.label.trim() || !Number.isFinite(criterion.weight) || criterion.weight <= 0 || criterion.levels.some(level => !level.description.trim()))) {
      setError('Completa el nombre, el peso y los cuatro descriptores de cada criterio seleccionado.');
      return;
    }
    if (step === 2 && missingCriteriaIndicators.length > 0) {
      setError(`Asigna al menos un criterio a cada indicador con puntos: ${missingCriteriaIndicators.map(item => item.label || 'Indicador sin nombre').join(', ')}.`);
      return;
    }
    setStep((current) => Math.min(3, current + 1) as Step);
  }

  function back() {
    setError('');
    setStep((current) => Math.max(0, current - 1) as Step);
  }

  function reset() {
    setStep(0);
    setSavedActivity(false);
    setTitle('Suma de vectores · ejemplo de prueba');
    setPeriod('P2');
    setCategory('Trabajos para entregar');
    setMaxPoints(10);
    setInstructions('Resuelve los ejercicios asignados y muestra el procedimiento.');
    setIndicators([{ id: 'indicator-a', label: 'Representa los componentes del vector', competency: 'logico_matematica', points: 6 }, { id: 'indicator-b', label: 'Justifica la resultante', competency: 'resolucion', points: 4 }]);
    setCriteriaCatalog(CRITERIA_CATALOG);
    setSelectedCriterionIds(['procedure', 'explanation']);
    setShowCriterionForm(false);
    setNewCriterionLabel('');
    setNewCriterionIndicatorId('indicator-a');
    setNewCriterionWeight(1);
    setNewCriterionLevels(RUBRIC_LEVELS.map(label => ({ label, description: '' })));
    setActiveCourse('5A');
    setRatings({});
    setSavedGrades(false);
    setError('');
  }

  return <main className="activity-flow-page">
    <div className="activity-flow-wrap">
      <header className="activity-flow-header">
        <div><p className="activity-flow-eyebrow">PRUEBA DE FLUJO · MATEMÁTICA</p><h1>Preparar y valorar una actividad</h1><p>Recorre una actividad de ejemplo desde su ficha simple hasta una nota por estudiante.</p></div>
        <span className="activity-flow-local"><i/> Prueba temporal · no guarda datos</span>
      </header>

      <section className="activity-flow-steps" aria-label="Pasos del flujo">
        {STEPS.map((item, index) => <button key={item.title} type="button" className={`${index === step ? 'current' : ''} ${index < step ? 'done' : ''}`} disabled={index > step || !savedActivity} onClick={() => setStep(index as Step)}>
          <span className="activity-flow-step-number">{index < step ? <Check size={15}/> : index + 1}</span><span><strong>{item.title}</strong><small>{item.note}</small></span>
        </button>)}
      </section>

      <div className="activity-flow-layout">
        <section className="activity-flow-card">
          {step === 0 && <>
            <div className="activity-flow-section-heading"><div><span className="activity-flow-kicker">PASO 1 · FICHA</span><h2>Crear actividad</h2><p>Solo los datos para identificar qué se hará. Aquí no se escriben criterios ni descriptores.</p></div></div>
            {savedActivity && <div className="activity-flow-created"><Check size={16}/> Actividad creada en esta prueba. Los siguientes pasos se configuran aparte.</div>}
            <div className="activity-flow-form-grid">
              <label className="activity-flow-wide">Nombre<input aria-label="Nombre de la actividad" maxLength={160} value={title} onChange={event => setTitle(event.target.value)}/></label>
              <label>Período<select value={period} onChange={event => setPeriod(event.target.value)}>{['P1','P2','P3','P4'].map(item => <option key={item}>{item}</option>)}</select></label>
              <label>Categoría<select value={category} onChange={event => setCategory(event.target.value)}>{['Exámenes','Participación y conducta','Libretas y tareas','Trabajos para entregar','Prácticas para casa','Puntos extra'].map(item => <option key={item}>{item}</option>)}</select></label>
              <label>Fecha de creación<input type="date" value={date} readOnly aria-readonly="true"/><small>Solo informativa; registrar o calificar esta actividad no confirma que la clase se impartió.</small></label>
              <label>Máximo de la actividad<input aria-label="Máximo de puntos" type="number" min="0.5" max="1000" step="0.5" value={maxPoints} onChange={event => setMaxPoints(Number(event.target.value))}/></label>
              <label className="activity-flow-wide">Consigna o indicación <span className="activity-flow-optional">opcional</span><textarea rows={3} maxLength={1200} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Qué debe hacer el grupo"/></label>
            </div>
            {error && <p className="activity-flow-error" role="alert">{error}</p>}
            <div className="activity-flow-actions activity-flow-actions-end"><button className="activity-flow-primary" type="button" onClick={continueFromActivity}>{savedActivity ? 'Continuar' : 'Guardar actividad y continuar'}<ArrowRight size={16}/></button></div>
          </>}

          {step === 1 && <>
            <div className="activity-flow-section-heading"><div><span className="activity-flow-kicker">PASO 2 · VALOR POR INDICADOR</span><h2>¿Qué puntos aporta cada indicador?</h2><p>La actividad ya existe. Asigna aquí sus puntos; esta parte no define cómo se juzga el trabajo.</p></div></div>
            <div className="activity-flow-assumption"><CircleHelp size={17}/><span>Distribuye el máximo de la actividad entre los indicadores. Cada indicador queda asociado a una competencia para que el resultado pueda resumirse por competencia.</span></div>
            <div className="activity-flow-indicator-head"><span>Indicador</span><span>Competencia</span><span>Puntos</span><span/></div>
            <div className="activity-flow-indicator-list">{indicators.map((item, index) => <div className="activity-flow-indicator-row" key={item.id}>
              <label><span className="activity-flow-mobile-label">Indicador {index + 1}</span><input aria-label={`Indicador ${index + 1}`} value={item.label} onChange={event => updateIndicator(item.id, { label: event.target.value })} placeholder="Nombre del indicador"/></label>
              <label><span className="activity-flow-mobile-label">Competencia</span><select aria-label={`Competencia del indicador ${index + 1}`} value={item.competency} onChange={event => updateIndicator(item.id, { competency: event.target.value as CompetencyKey })}>{COMPETENCY_GROUPS.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>
              <label><span className="activity-flow-mobile-label">Puntos</span><input aria-label={`Puntos del indicador ${index + 1}`} type="number" min="0" max={maxPoints} step="0.5" value={item.points} onChange={event => updateIndicator(item.id, { points: Number(event.target.value) })}/></label>
              <button type="button" aria-label={`Quitar indicador ${index + 1}`} className="activity-flow-icon-button" onClick={() => { const remaining = indicators.filter(row => row.id !== item.id); if (!remaining.length) { setError('La actividad debe conservar al menos un indicador.'); return; } setIndicators(remaining); setCriteriaCatalog(current => current.map(criterion => criterion.indicatorId === item.id ? { ...criterion, indicatorId: remaining[0].id } : criterion)); setSavedGrades(false); }}><Trash2 size={16}/></button>
            </div>)}</div>
            <button type="button" className="activity-flow-add" onClick={addIndicator}><Plus size={15}/> Añadir indicador</button>
            <div className={`activity-flow-total ${Math.abs(indicatorTotal - maxPoints) <= 0.001 ? 'balanced' : 'unbalanced'}`}><span>Puntos asignados</span><strong>{indicatorTotal} / {maxPoints}</strong></div>
            {error && <p className="activity-flow-error" role="alert">{error}</p>}
            <div className="activity-flow-actions"><button className="activity-flow-secondary" type="button" onClick={back}><ArrowLeft size={16}/> Volver a la actividad</button><button className="activity-flow-primary" type="button" onClick={next}>Guardar puntos y seguir<ArrowRight size={16}/></button></div>
          </>}

          {step === 2 && <>
            <div className="activity-flow-section-heading"><div><span className="activity-flow-kicker">PASO 3 · INSTRUMENTO DE VALORACIÓN</span><h2>Define los criterios para valorar el trabajo</h2><p>Selecciona ejemplos o agrega criterios propios para esta actividad. Los indicadores ya definidos reciben los puntos; los criterios describen qué observarás.</p></div><button className="activity-flow-add" type="button" onClick={() => { setShowCriterionForm(value => !value); setError(''); }}><Plus size={14}/> Añadir criterio</button></div>
            {showCriterionForm && <form className="activity-flow-custom-criterion" onSubmit={event => { event.preventDefault(); addActivityCriterion(); }}><div className="activity-flow-custom-criterion-top"><label>Nombre del criterio<input required maxLength={120} value={newCriterionLabel} onChange={event => setNewCriterionLabel(event.target.value)} placeholder="Ej.: Justificación del resultado"/></label><label>Indicador asociado<select value={newCriterionIndicatorId} onChange={event => setNewCriterionIndicatorId(event.target.value)}>{indicators.map(indicator => <option key={indicator.id} value={indicator.id}>{indicator.label || 'Indicador sin nombre'}</option>)}</select></label><label>Peso relativo<input type="number" min="0.01" max="100" step="0.01" value={newCriterionWeight} onChange={event => setNewCriterionWeight(Number(event.target.value))}/></label></div><div className="activity-flow-custom-levels">{newCriterionLevels.map((level, index) => <label key={level.label}><span>{level.label} · {index + 1} pt{index ? 's' : ''}</span><textarea required rows={3} maxLength={600} value={level.description} onChange={event => setNewCriterionLevels(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} placeholder="Describe la evidencia de este nivel"/></label>)}</div><button className="activity-flow-primary" type="submit">Añadir criterio a esta actividad<Plus size={14}/></button></form>}
            <div className="activity-flow-criteria-list">{criteriaCatalog.map(criterion => <article className={`activity-flow-criterion ${selectedCriterionIds.includes(criterion.id) ? 'selected' : ''}`} key={criterion.id}>
              <label className="activity-flow-criterion-select"><input type="checkbox" checked={selectedCriterionIds.includes(criterion.id)} onChange={() => toggleCriterion(criterion.id)}/><input aria-label={`Nombre del criterio ${criterion.id}`} maxLength={120} value={criterion.label} onChange={event => updateCriterion(criterion.id, { label: event.target.value })}/><small>Se valora dentro del indicador y su competencia</small></label>
              <div className="activity-flow-criterion-link"><label>Indicador que observa<select aria-label={`Indicador del criterio ${criterion.id}`} value={criterion.indicatorId} onChange={event => updateCriterion(criterion.id, { indicatorId: event.target.value })}>{indicators.map(indicator => <option key={indicator.id} value={indicator.id}>{indicator.label || 'Indicador sin nombre'}</option>)}</select></label><label>Peso relativo<input aria-label={`Peso del criterio ${criterion.id}`} type="number" min="0.01" max="100" step="0.01" value={criterion.weight} onChange={event => updateCriterion(criterion.id, { weight: Number(event.target.value) })}/></label><span>{COMPETENCY_GROUPS.find(group => group.key === indicators.find(indicator => indicator.id === criterion.indicatorId)?.competency)?.label ?? 'Competencia pendiente'}</span></div>
              <div className="activity-flow-descriptor-grid">{criterion.levels.map((level, index) => <label key={level.label}><strong>{level.label} · {index + 1} pt{index ? 's' : ''}</strong><textarea rows={3} maxLength={600} aria-label={`${level.label} para ${criterion.label || 'criterio'}`} value={level.description} onChange={event => updateCriterion(criterion.id, { levels: criterion.levels.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item) })}/></label>)}</div>
            </article>)}</div>
            <p className="activity-flow-criteria-note">Cálculo de esta prueba: el promedio de niveles (1–4) de los criterios asociados se divide entre 4 y se multiplica por los puntos del indicador. Los criterios tienen igual peso dentro de su indicador. La nota final suma los aportes de los indicadores; el resumen por competencia agrupa esos mismos puntos.</p>
            {error && <p className="activity-flow-error" role="alert">{error}</p>}
            <div className="activity-flow-actions"><button className="activity-flow-secondary" type="button" onClick={back}><ArrowLeft size={16}/> Volver a indicadores</button><button className="activity-flow-primary" type="button" onClick={next}>Seguir a calificar<ArrowRight size={16}/></button></div>
          </>}

          {step === 3 && <>
            <div className="activity-flow-section-heading"><div><span className="activity-flow-kicker">PASO 4 · CAPTURA DE NOTAS</span><h2>Califica el resultado de la actividad</h2><p>El nivel elegido se escala al máximo de {maxPoints} puntos de esta actividad.</p></div></div>
            <div className="activity-flow-course-tabs" aria-label="Curso de prueba">{COURSES.map(item => <button type="button" key={item} className={activeCourse === item ? 'selected' : ''} onClick={() => { setActiveCourse(item); setSavedGrades(false); }}>{item}</button>)}</div>
            <div className="activity-flow-grade-wrap"><table className="activity-flow-grade-table"><thead><tr><th>Estudiante de prueba</th>{selectedCriteria.map(criterion => <th key={criterion.id}>{criterion.label}<small>{indicators.find(indicator => indicator.id === criterion.indicatorId)?.label ?? 'Indicador pendiente'} · {COMPETENCY_GROUPS.find(group => group.key === indicators.find(indicator => indicator.id === criterion.indicatorId)?.competency)?.label ?? ''}</small></th>)}{activeCompetencies.map(group => <th key={group.key}>{group.label}<small>Puntos ganados</small></th>)}<th>Nota / {maxPoints}</th></tr></thead><tbody>{STUDENTS.map(student => {
              const score = studentScore(student);
              return <tr key={student}><th>{student}</th>{selectedCriteria.map(criterion => <td key={criterion.id}><select aria-label={`${criterion.label} · ${student}`} value={courseRatings[student]?.[criterion.id] ?? ''} onChange={event => setRating(student, criterion.id, event.target.value)}><option value="">Pendiente</option>{criterion.levels.map((level, index) => <option value={index} key={level.label}>{level.label}</option>)}</select></td>)}{activeCompetencies.map(group => {const earned = competencyPoints(student, group.key);const possible = indicators.filter(indicator => indicator.competency === group.key).reduce((sum, indicator) => sum + indicator.points, 0);return <td key={group.key}><strong>{earned === null ? 'Pendiente' : earned.toFixed(2)}</strong><small> / {possible} pts</small></td>;})}<td><strong>{score === null ? 'Pendiente' : score.toFixed(2)}</strong></td></tr>;
            })}</tbody></table></div>
            <div className="activity-flow-grade-summary"><span>{gradedCount} de {STUDENTS.length} notas completas en {activeCourse}</span><span>{activeCompetencies.map(group => `${group.label}: ${indicators.filter(indicator => indicator.competency === group.key).reduce((sum, indicator) => sum + indicator.points, 0)} pts`).join(' · ')} · total: {indicatorTotal} pts</span></div>
            {savedGrades && <div className="activity-flow-created"><Check size={16}/> Calificaciones de {activeCourse} guardadas en esta prueba temporal.</div>}
            {error && <p className="activity-flow-error" role="alert">{error}</p>}
            <div className="activity-flow-actions"><button className="activity-flow-secondary" type="button" onClick={back}><ArrowLeft size={16}/> Volver a criterios</button><button className="activity-flow-primary" type="button" disabled={gradedCount === 0} onClick={() => setSavedGrades(true)}>Guardar calificaciones de {activeCourse}<Check size={16}/></button></div>
          </>}
        </section>

        <aside className="activity-flow-summary-card">
          <span className="activity-flow-kicker">VISTA DE LA PRUEBA</span><h2>{title || 'Actividad sin nombre'}</h2>
          <dl><div><dt>Período</dt><dd>{period}</dd></div><div><dt>Categoría</dt><dd>{category}</dd></div><div><dt>Creada</dt><dd>{date}</dd></div><div><dt>Valor máximo</dt><dd>{maxPoints} pts</dd></div><div><dt>Indicadores</dt><dd>{savedActivity && step >= 1 ? `${indicators.length} · ${indicatorTotal} pts` : 'Después de crear'}</dd></div><div><dt>Criterios</dt><dd>{savedActivity && step >= 2 ? `${selectedCriteria.length} seleccionados` : 'Al valorar'}</dd></div></dl>
          <p>La fecha es solo de creación. Los indicadores distribuyen puntos por competencia; los criterios describen el desempeño.</p>
          <button type="button" className="activity-flow-reset" onClick={reset}><RotateCcw size={14}/> Reiniciar prueba</button>
        </aside>
      </div>
      <footer className="activity-flow-footer"><span>Todos los cambios viven solo en esta página.</span><span>Ejemplos ficticios · no modifica la base ni el Excel.</span></footer>
    </div>
  </main>;
}
