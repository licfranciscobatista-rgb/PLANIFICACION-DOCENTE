'use client';

import { useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CalendarCheck2, CalendarDays, Check, ChevronRight, ClipboardList, Eye, FileText, GraduationCap, ListChecks, Plus, Upload, UsersRound } from 'lucide-react';
import { COMPETENCY_GROUPS, type ActivityCategoryKey, type CompetencyKey } from '@/lib/model';

type Attendance = '' | 'P' | 'A' | 'T' | 'E' | 'R';
type Period = 'P1' | 'P2' | 'P3' | 'P4';
type Screen = 'home' | 'course' | 'rosterReview' | 'activitySetup' | 'periods' | 'generalStudents' | 'register' | 'attendance' | 'behavior';
type Student = { id: string; number: number; name: string; attendance: Attendance; behavior: number | null; comment: string };
type Course = { id: number; code: string; name: string; students: Student[] };
type ActivityLevel = { label: string; points: number; description: string };
type ActivityCriterion = { id: string; label: string; competency: CompetencyKey; indicator: string; weight: number; levels: ActivityLevel[] };
type Activity = { id: string; period: Period; title: string; sequenceCode: string; creationDate: string; category: ActivityCategoryKey; maxPoints: number; instructions: string; evidence: string; purpose: string; competency: CompetencyKey; indicator: string; rubric: ActivityCriterion[]; sourceFileName: string };
type ActivityStep = 'source' | 'details' | 'review';
type ActivityGrade = { criterionLevels: Record<string, number>; directScore: number | null; comment: string };

const ACTIVITY_CATEGORIES: { key: ActivityCategoryKey; label: string }[] = [
  { key: 'exam', label: 'Exámenes' }, { key: 'participation', label: 'Participación y conducta' },
  { key: 'notebook', label: 'Libretas y tareas' }, { key: 'sequence', label: 'Trabajos para entregar' },
  { key: 'homework', label: 'Prácticas para casa' }, { key: 'extra', label: 'Puntos extra' },
];
const RUBRIC_LEVELS = [
  { label: 'Insuficiente', points: 1 }, { label: 'Suficiente', points: 2 },
  { label: 'Bueno', points: 3 }, { label: 'Excelente', points: 4 },
];

function emptyActivityCriterion(): ActivityCriterion {
  return { id: `criterion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', competency: 'logico_matematica', indicator: '', weight: 1, levels: RUBRIC_LEVELS.map(level => ({ ...level, description: '' })) };
}

function readLabeledValue(text: string, labels: string[]) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const labelsPattern = labels.join('|');
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(new RegExp(`^(?:${labelsPattern})\\s*[:：–-]\\s*(.*)$`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
    if (new RegExp(`^(?:${labelsPattern})\\s*[:：]?$`, 'i').test(lines[index]) && lines[index + 1]) return lines[index + 1];
  }
  return '';
}

async function extractSequenceText(file: File) {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value.trim();
  }
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      let line = '';
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          if (line.trim()) lines.push(line.trim());
          line = item.str;
        } else line += (line ? ' ' : '') + item.str;
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      pages.push(lines.join('\n'));
    }
    return pages.join('\n').trim();
  }
  throw new Error('Formato no compatible. Sube un archivo PDF o DOCX.');
}

const PERIODS: Period[] = ['P1', 'P2', 'P3', 'P4'];

function localDateInputValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 10);
}

const MARKS: { value: Exclude<Attendance, ''>; label: string }[] = [
  { value: 'P', label: 'Presente' }, { value: 'A', label: 'Ausente' }, { value: 'T', label: 'Tardanza' }, { value: 'E', label: 'Excusa' }, { value: 'R', label: 'Retiro' },
];

function ActivityEvaluationPreview({ rubricEnabled, criteria, competency, indicator }: {
  rubricEnabled: boolean;
  criteria: ActivityCriterion[];
  competency: CompetencyKey;
  indicator: string;
}) {
  const competencyLabel = COMPETENCY_GROUPS.find(group => group.key === competency)?.label ?? competency;
  const hasRubricContent = criteria.some(criterion => criterion.label.trim() || criterion.indicator.trim() || criterion.levels.some(level => level.description.trim()));

  return <section className="course-prototype-evaluation-review" aria-label="Evaluación de la actividad, solo lectura">
    <div className="rubric-heading"><div><h3><ListChecks size={16}/> Criterios de evaluación</h3><p className="muted">En esta revisión se muestran para consulta. Para cambiarlos, vuelve a la preparación.</p></div><span className="course-prototype-readonly-badge">Solo lectura</span></div>
    {rubricEnabled ? hasRubricContent ? <div className="course-prototype-readonly-criteria">{criteria.filter(criterion => criterion.label.trim() || criterion.indicator.trim() || criterion.levels.some(level => level.description.trim())).map((criterion, index) => <article className="course-prototype-criterion" key={criterion.id}>
      <h4>Criterio {index + 1}</h4>
      <div className="course-prototype-readonly-meta"><div><span>Qué se evalúa</span><strong>{criterion.label || 'Sin definir'}</strong></div><div><span>Competencia</span><strong>{COMPETENCY_GROUPS.find(group => group.key === criterion.competency)?.label ?? criterion.competency}</strong></div><div><span>Indicador de logro</span><strong>{criterion.indicator || 'Sin definir'}</strong></div><div><span>Peso relativo</span><strong>{criterion.weight}</strong></div></div>
      <div className="course-prototype-level-grid">{criterion.levels.map(level => <div className="course-prototype-level" key={level.label}><span>{level.label} · {level.points} pt{level.points === 1 ? '' : 's'}</span><p>{level.description || 'Sin descriptor definido'}</p></div>)}</div>
    </article>)}</div> : <p className="course-prototype-review-empty">Esta actividad aún no tiene criterios cargados. Para agregarlos o completar los datos, vuelve a la preparación.</p>
      : <div className="course-prototype-readonly-meta course-prototype-direct-review"><div><span>Modalidad</span><strong>Puntaje directo</strong></div><div><span>Competencia</span><strong>{competencyLabel}</strong></div><div><span>Indicador evaluado</span><strong>{indicator || 'Sin definir'}</strong></div></div>}
  </section>;
}

function testStudents(count: number): Student[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `test-student-${index + 1}`,
    number: index + 1,
    name: `Estudiante de prueba ${String(index + 1).padStart(2, '0')}`,
    attendance: '',
    behavior: null,
    comment: '',
  }));
}

export default function CourseSetupPrototype() {
  const [courseName, setCourseName] = useState('5.º A · Matemática (prueba)');
  const [studentCount, setStudentCount] = useState('22');
  const [course, setCourse] = useState<Course | null>(null);
  const [draftCourse, setDraftCourse] = useState<Course | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityGrades, setActivityGrades] = useState<Record<string, Record<string, ActivityGrade>>>({});
  const [gradingActivityId, setGradingActivityId] = useState<string | null>(null);
  const [activitiesMenuOpen, setActivitiesMenuOpen] = useState(false);
  const [activityFormOpen, setActivityFormOpen] = useState(false);
  const [activityStep, setActivityStep] = useState<ActivityStep>('source');
  const [activityOrigin, setActivityOrigin] = useState<'manual' | 'sequence' | null>(null);
  const [sequenceFileName, setSequenceFileName] = useState('');
  const [sequenceText, setSequenceText] = useState('');
  const [sequenceReading, setSequenceReading] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [studentMenuOpen, setStudentMenuOpen] = useState(true);
  const [activityPeriod, setActivityPeriod] = useState<Period>('P1');
  const [activityCategoryFilter, setActivityCategoryFilter] = useState<ActivityCategoryKey | 'all'>('all');
  const [activityTitle, setActivityTitle] = useState('');
  const [activityCode, setActivityCode] = useState('');
  const [activityDate, setActivityDate] = useState(localDateInputValue());
  const [activityMaxPoints, setActivityMaxPoints] = useState('');
  const [activityInstructions, setActivityInstructions] = useState('');
  const [activityEvidence, setActivityEvidence] = useState('');
  const [activityPurpose, setActivityPurpose] = useState('');
  const [activityCategory, setActivityCategory] = useState<ActivityCategoryKey>('sequence');
  const [activityCompetency, setActivityCompetency] = useState<CompetencyKey>('logico_matematica');
  const [activityIndicator, setActivityIndicator] = useState('');
  const [rubricEnabled, setRubricEnabled] = useState(true);
  const [activityCriteria, setActivityCriteria] = useState<ActivityCriterion[]>([emptyActivityCriterion()]);
  const [newStudentName, setNewStudentName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function createCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = courseName.trim();
    const count = Number(studentCount);
    if (!name || !Number.isInteger(count) || count < 1 || count > 250) {
      setError('Escribe el nombre del curso y una cantidad de estudiantes entre 1 y 250.');
      return;
    }
    setDraftCourse({ id: Date.now(), code: '5A', name, students: testStudents(count) });
    setScreen('rosterReview');
    setError('');
    setNotice('Revisa los nombres de la lista. El curso se creará cuando confirmes; después se abrirá Registros.');
  }

  function updateDraftStudent(id: string, name: string) {
    setDraftCourse(current => current ? { ...current, students: current.students.map(student => student.id === id ? { ...student, name } : student) } : current);
  }

  function confirmCourse() {
    if (!draftCourse) return;
    if (draftCourse.students.some(student => !student.name.trim())) {
      setError('Completa el nombre de cada estudiante antes de confirmar el curso.');
      return;
    }
    setCourse(draftCourse);
    setActivities([]);
    setActivitiesMenuOpen(false);
    setScreen('register');
    setError('');
    setNotice('Curso confirmado. Desde Registros puedes abrir Asistencia, Comportamiento y preparar las actividades.');
  }

  function startActivityFlow() {
    setScreen('activitySetup');
    setActivityStep('source');
    setActivityOrigin(null);
    setSequenceFileName('');
    setSequenceText('');
    setActivityTitle('');
    setActivityCode('');
    setActivityDate(localDateInputValue());
    setActivityMaxPoints('');
    setActivityInstructions('');
    setActivityEvidence('');
    setActivityPurpose('');
    setActivityCategory('sequence');
    setActivityCompetency('logico_matematica');
    setActivityIndicator('');
    setRubricEnabled(true);
    setActivityCriteria([emptyActivityCriterion()]);
    setError('');
    setNotice('');
    setActivityFormOpen(true);
  }

  async function importSequence(file: File | undefined) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError('El archivo supera el límite de 20 MB.'); return; }
    setSequenceReading(true);
    setError('');
    setSequenceFileName(file.name);
    try {
      const text = await extractSequenceText(file);
      if (!text) {
        setSequenceText('');
        setError('El archivo no contiene texto seleccionable. Si es un PDF escaneado, escribe sus datos en la revisión manual.');
      } else {
        const normalized = text.slice(0, 80_000);
        setSequenceText(normalized);
        const foundTitle = readLabeledValue(normalized, ['actividad(?:\\s+[\\d.]+)?', 'nombre de la actividad', 'título']);
        const firstUsefulLine = normalized.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 4 && line.length < 180) ?? '';
        const foundCode = normalized.match(/(?:secuencia|actividad|código|codigo)\s*(?:didáctica)?\s*[:#-]?\s*(\d+(?:\.\d+)+)/i)?.[1] ?? normalized.match(/\b\d+(?:\.\d+){1,3}\b/)?.[0] ?? '';
        setActivityTitle(foundTitle || firstUsefulLine || file.name.replace(/\.(pdf|docx)$/i, ''));
        setActivityCode(foundCode || 'SECUENCIA');
        setActivityPurpose(readLabeledValue(normalized, ['propósito', 'proposito', 'objetivo']));
        setActivityInstructions(readLabeledValue(normalized, ['instrucciones', 'consigna', 'desarrollo de la actividad', 'actividad propuesta']));
        setActivityEvidence(readLabeledValue(normalized, ['evidencia', 'producto esperado', 'producto final']));
        const maximumText = readLabeledValue(normalized, ['puntaje máximo bruto', 'puntaje máximo', 'puntuación máxima', 'valor máximo']);
        const maximumValue = maximumText.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.');
        if (maximumValue && Number(maximumValue) > 0) setActivityMaxPoints(maximumValue);
        const categoryText = readLabeledValue(normalized, ['categoría de evaluación', 'categoría']).toLocaleLowerCase();
        const importedCategory = categoryText.includes('extra') ? 'extra'
          : categoryText.includes('examen') || categoryText.includes('sumativa') || categoryText.includes('diagnóstica') ? 'exam'
          : categoryText.includes('conducta') || categoryText.includes('participación') ? 'participation'
          : categoryText.includes('libreta') || categoryText.includes('tarea') ? 'notebook'
          : categoryText.includes('casa') || categoryText.includes('práctica') ? 'homework'
          : categoryText.includes('secuencia') || categoryText.includes('entregable') ? 'sequence' : null;
        if (importedCategory) setActivityCategory(importedCategory);
        const criterionLabel = readLabeledValue(normalized, ['criterio de evaluación', 'criterio']);
        const criterionIndicator = readLabeledValue(normalized, ['indicador de logro', 'indicador']);
        const competencyText = readLabeledValue(normalized, ['competencia evaluada', 'competencia']).toLocaleLowerCase();
        const importedCompetency = COMPETENCY_GROUPS.find(group => competencyText.includes(group.label.toLocaleLowerCase()));
        const importedDescriptors = RUBRIC_LEVELS.map(level => readLabeledValue(normalized, [level.label]));
        if (criterionLabel || criterionIndicator || importedDescriptors.some(Boolean)) {
          const criterion = emptyActivityCriterion();
          setActivityCriteria([{ ...criterion, label: criterionLabel, indicator: criterionIndicator, competency: importedCompetency?.key ?? criterion.competency, levels: RUBRIC_LEVELS.map((level, index) => ({ ...level, description: importedDescriptors[index] })) }]);
        }
        if (importedCompetency) setActivityCompetency(importedCompetency.key);
        setActivityOrigin('sequence');
        setActivityStep('review');
        setNotice('Texto extraído. Revisa y corrige cada dato antes de crear la actividad; la extracción no sustituye tu validación.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo leer el archivo. Puedes continuar por creación manual.');
    } finally {
      setSequenceReading(false);
    }
  }

  function prepareActivityReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activityTitle.trim() || !activityInstructions.trim() || !Number.isFinite(Number(activityMaxPoints)) || Number(activityMaxPoints) <= 0) {
      setError('Completa el nombre, las instrucciones y el puntaje máximo antes de revisar.');
      return;
    }
    if (rubricEnabled && (!activityCriteria.length || activityCriteria.some(criterion => !criterion.label.trim() || !criterion.indicator.trim() || criterion.levels.some(level => !level.description.trim())))) {
      setError('Completa cada criterio, su indicador y los cuatro descriptores de desempeño antes de revisar.');
      return;
    }
    if (!rubricEnabled && !activityIndicator.trim()) {
      setError('Indica qué competencia o indicador se evaluará en esta actividad.');
      return;
    }
    setActivityStep('review');
    setError('');
  }

  function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course) return;
    const title = activityTitle.trim();
    const maxPoints = Number(activityMaxPoints);
    if (!title || !Number.isFinite(maxPoints) || maxPoints <= 0 || !activityInstructions.trim() || activityStep !== 'review') {
      setError('Revisa los datos de la actividad antes de guardarla.');
      return;
    }
    const activity: Activity = {
      id: `test-activity-${Date.now()}`,
      period: activityPeriod,
      title,
      sequenceCode: activityCode.trim() || 'MANUAL',
      creationDate: activityDate,
      category: activityCategory,
      maxPoints,
      instructions: activityInstructions.trim(),
      evidence: activityEvidence.trim(),
      purpose: activityPurpose.trim(),
      competency: activityCompetency,
      indicator: activityIndicator.trim(),
      rubric: rubricEnabled ? activityCriteria : [],
      sourceFileName: sequenceFileName,
    };
    setActivities(current => [...current, activity]);
    setActivityGrades(current => ({ ...current, [activity.id]: Object.fromEntries(course.students.map(student => [student.id, { criterionLevels: {}, directScore: null, comment: '' }])) }));
    setActivityFormOpen(false);
    setScreen('periods');
    setError('');
    setNotice(`Actividad “${title}” creada en ${activityPeriod} con ${rubricEnabled ? `${activityCriteria.length} criterio(s)` : 'puntuación por competencia'}. La fecha de uso y la calificación se registrarán aparte.`);
  }

  function updateCriterion(index: number, update: (criterion: ActivityCriterion) => ActivityCriterion) {
    setActivityCriteria(current => current.map((criterion, currentIndex) => currentIndex === index ? update(criterion) : criterion));
  }

  function updateActivityGrade(activityId: string, studentId: string, patch: Partial<ActivityGrade>) {
    setActivityGrades(current => {
      const activityRows = current[activityId] ?? {};
      const existing = activityRows[studentId] ?? { criterionLevels: {}, directScore: null, comment: '' };
      return { ...current, [activityId]: { ...activityRows, [studentId]: { ...existing, ...patch } } };
    });
  }

  function addStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!course) return;
    const name = newStudentName.trim();
    if (!name) { setError('Escribe el nombre del estudiante.'); return; }
    if (course.students.some(student => student.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError('Ese nombre ya está en la lista del curso.');
      return;
    }
    const student: Student = { id: `test-student-${Date.now()}`, number: course.students.length + 1, name, attendance: '', behavior: null, comment: '' };
    setCourse(current => current ? { ...current, students: [...current.students, student] } : current);
    setNewStudentName('');
    setError('');
    setNotice(`${name} ya aparece en el registro, Asistencia y Comportamiento.`);
  }

  function updateStudent(id: string, patch: Partial<Student>) {
    setCourse(current => current ? { ...current, students: current.students.map(student => student.id === id ? { ...student, ...patch } : student) } : current);
    setNotice('Cambio temporal aplicado a este estudiante en las rutas del curso.');
  }

  const routeLabel = screen === 'home' ? 'Inicio' : screen === 'course' ? 'Curso' : screen === 'rosterReview' ? 'Confirmar estudiantes' : screen === 'activitySetup' ? 'Preparar actividad' : screen === 'periods' ? 'Períodos' : screen === 'generalStudents' ? 'Lista general' : screen === 'register' ? 'Registros' : screen === 'attendance' ? 'Asistencia' : 'Comportamiento';
  const presentCount = course?.students.filter(student => student.attendance === 'P' || student.attendance === 'T').length ?? 0;
  const behaviorCount = course?.students.filter(student => student.behavior !== null).length ?? 0;
  const periodActivities = activities.filter(activity => activity.period === activityPeriod);
  const displayedActivities = periodActivities.filter(activity => activityCategoryFilter === 'all' || activity.category === activityCategoryFilter);
  const gradingActivity = activities.find(activity => activity.id === gradingActivityId) ?? null;

  return <div className="course-prototype-shell">
    <aside className="course-prototype-sidebar" aria-label="Menú principal">
      <button className="course-prototype-brand" type="button" onClick={() => { setScreen('home'); setError(''); }} aria-label="Ir a Inicio">
        <span className="course-prototype-brand-icon"><GraduationCap size={22} /></span>
        <span>Registro<span>docente</span></span>
      </button>
      <div className="course-prototype-label">MENÚ PRINCIPAL</div>
      <nav className="course-prototype-main-nav" aria-label="Navegación principal">
        <button type="button" className={screen === 'home' ? 'selected' : ''} onClick={() => { setScreen('home'); setError(''); }}><BookOpen size={16}/> Inicio</button>
        <div className="course-prototype-nav-group">
          <button type="button" className={['course', 'rosterReview', 'generalStudents', 'register'].includes(screen) ? 'selected' : ''} aria-expanded={studentMenuOpen} onClick={() => setStudentMenuOpen(open => !open)}><UsersRound size={16}/> Estudiantes <span className="course-prototype-nav-chevron">{studentMenuOpen ? '−' : '+'}</span></button>
          {studentMenuOpen && <div className="course-prototype-nav-submenu">
            <button type="button" className={['course', 'rosterReview', 'register'].includes(screen) ? 'selected' : ''} onClick={() => { setScreen(course ? 'register' : 'course'); setError(''); }}>Cursos</button>
            <button type="button" className={screen === 'generalStudents' ? 'selected' : ''} onClick={() => { setScreen('generalStudents'); setError(''); }}>Lista general</button>
          </div>}
        </div>
        <button type="button" className={screen === 'register' ? 'selected' : ''} disabled={!course} onClick={() => { setScreen(course ? 'register' : 'course'); setError(''); }}><ClipboardList size={16}/> Registros</button>
        <div className="course-prototype-nav-group">
          <button type="button" className={['activitySetup', 'periods'].includes(screen) ? 'selected' : ''} disabled={!course} aria-expanded={activitiesMenuOpen} onClick={() => { setActivitiesMenuOpen(open => !open); setError(''); }}><ClipboardList size={16}/> Actividades{course && <small>{activities.length}</small>}<span className="course-prototype-nav-chevron">{activitiesMenuOpen ? '−' : '+'}</span></button>
          {activitiesMenuOpen && course && <div className="course-prototype-nav-submenu"><button type="button" className={screen === 'activitySetup' ? 'selected' : ''} onClick={() => { if (screen !== 'activitySetup') startActivityFlow(); }}>Preparar actividad</button><button type="button" className={screen === 'periods' ? 'selected' : ''} disabled={!activities.length} onClick={() => { setScreen('periods'); setGradingActivityId(null); setError(''); }}>Períodos</button></div>}
        </div>
      </nav>
      <div className="course-prototype-sidebar-note"><BookOpen size={17} /><span>Prueba local. Los cambios no se guardan en la base actual.</span></div>
    </aside>

    <main className="course-prototype-main">
      <header className="course-prototype-topbar">
        <div className="course-prototype-breadcrumb">Registro docente <ChevronRight size={14} /><strong>{routeLabel}</strong></div>
        <span className="course-prototype-pill">Prueba temporal</span>
      </header>
      <div className="course-prototype-content">
        <div className="course-prototype-notice"><span className="course-prototype-notice-dot" />Prueba local: se usan estudiantes ficticios; nada se guarda en la base actual.</div>

        {screen === 'home' ? <>
          <section className="course-prototype-intro"><p className="eyebrow">INICIO</p><h1>Registro docente</h1><p>Organiza tus cursos, estudiantes, actividades, asistencia y comportamiento desde el menú principal.</p></section>
          <div className="course-prototype-home-grid">
            <section className="course-prototype-card course-prototype-home-card"><p className="eyebrow">ESTUDIANTES · CURSO</p><h2>{course?.name ?? 'Todavía no hay un curso'}</h2><p>{course ? `${course.students.length} estudiantes en la lista del curso.` : 'Crea el curso y confirma la lista antes de comenzar.'}</p><button type="button" className="button primary" onClick={() => { setScreen(course ? 'register' : 'course'); setError(''); }}>{course ? 'Abrir curso' : 'Crear curso'}</button></section>
            <section className="course-prototype-card course-prototype-home-card"><p className="eyebrow">ACTIVIDADES</p><h2>{activities.length ? `${activities.length} actividades preparadas` : 'Prepara antes de abrir períodos'}</h2><p>{course ? activities.length ? 'Las actividades ya están organizadas en Períodos P1–P4.' : 'Entra en Registros para iniciar la preparación de actividades.' : 'Confirma primero un curso para habilitar esta sección.'}</p><button type="button" className="button secondary" disabled={!course} onClick={() => { if (activities.length) { setActivitiesMenuOpen(true); setScreen('periods'); } else setScreen('register'); }}>{activities.length ? 'Abrir Períodos' : 'Abrir Registros'}</button></section>
          </div>
          <section className="course-prototype-card course-prototype-home-summary"><div><p className="eyebrow">REGISTRO DIARIO</p><h2>Asistencia y Comportamiento</h2><p>Ambas secciones se alimentan de la lista del curso confirmado.</p></div><div className="toolbar"><button type="button" className="button secondary" disabled={!course} onClick={() => setScreen('attendance')}>Asistencia</button><button type="button" className="button secondary" disabled={!course} onClick={() => setScreen('behavior')}>Comportamiento</button></div></section>
        </> : screen === 'course' ? <>
          <section className="course-prototype-intro">
            <p className="eyebrow">ESTUDIANTES · CURSO</p>
            <h1>Crea el curso y confirma su lista.</h1>
            <p>Primero prepara el curso y la lista; luego revisas cada nombre y confirmas. Al confirmar, se abre Registros. El Registro, la Asistencia y el Comportamiento usan la misma nómina.</p>
          </section>
          <section className="course-prototype-card" aria-labelledby="course-create-title">
            <div className="course-prototype-card-heading"><div className="course-prototype-number">1</div><div><h2 id="course-create-title">Datos del curso de prueba</h2><p>Se prepara una lista ficticia para esta prueba; revísala antes de crear el curso.</p></div></div>
            <form className="course-prototype-form" onSubmit={createCourse}>
              <label>Nombre del curso<input autoComplete="off" maxLength={100} value={courseName} onChange={event => setCourseName(event.target.value)} /></label>
              <label>Estudiantes de prueba<input inputMode="numeric" type="number" min={1} max={250} step={1} value={studentCount} onChange={event => setStudentCount(event.target.value)} /></label>
              <button className="button primary" type="submit"><ArrowRight size={17} /> Revisar lista de estudiantes</button>
            </form>
            {error && <p className="course-prototype-error" role="alert">{error}</p>}
          </section>
          <div className="course-prototype-fixture-note"><UsersRound size={18} /><div><strong>22 estudiantes ficticios preparados</strong><span>Se llaman “Estudiante de prueba 01–22” y sirven para revisar que ambas secciones reciban la misma lista.</span></div></div>
          <footer className="course-prototype-footer"><span>El curso se crea al confirmar la lista.</span><span>Revisa los nombres antes de continuar.</span></footer>
        </> : screen === 'rosterReview' && draftCourse ? <>
          {notice && <div className="course-prototype-success" role="status"><Check size={16} />{notice}</div>}
          <section className="course-prototype-intro"><p className="eyebrow">CONFIRMACIÓN DEL CURSO</p><h1>{draftCourse.name}</h1><p>Comprueba el curso y la lista completa. Puedes corregir los nombres aquí. Al confirmar, se crea el curso y se abre Registros.</p></section>
          <section className="course-prototype-card course-prototype-list" aria-labelledby="roster-confirm-title"><div className="course-prototype-list-heading"><div><p className="eyebrow">LISTA PARA CONFIRMAR</p><h2 id="roster-confirm-title">Estudiantes</h2></div><span className="course-prototype-count">{draftCourse.students.length} estudiantes</span></div><div className="course-prototype-roster-review">{draftCourse.students.map(student => <label key={student.id}><span>{String(student.number).padStart(2, '0')}</span><input aria-label={`Nombre del estudiante ${student.number}`} maxLength={180} value={student.name} onChange={event => updateDraftStudent(student.id, event.target.value)} /></label>)}</div>{error && <p className="course-prototype-error" role="alert">{error}</p>}<div className="course-prototype-confirm-actions"><button className="course-prototype-back-link" type="button" onClick={() => { setScreen('course'); setNotice(''); setError(''); }}><ArrowLeft size={14}/> Volver a los datos del curso</button><button className="button primary" type="button" onClick={confirmCourse}><Check size={16}/> Confirmar curso y abrir Registros</button></div></section>
        </> : screen === 'generalStudents' ? <>
          <section className="course-prototype-intro"><p className="eyebrow">ESTUDIANTES</p><h1>Lista general</h1><p>Consulta en un solo lugar los estudiantes de los cursos registrados.</p></section>
          {course ? <section className="course-prototype-card course-prototype-list" aria-labelledby="general-student-list-title"><div className="course-prototype-list-heading"><div><p className="eyebrow">TODOS LOS ESTUDIANTES · PRUEBA ACTUAL</p><h2 id="general-student-list-title">Lista general</h2></div><span className="course-prototype-count">{course.students.length} estudiantes</span></div><div className="course-prototype-course-list">{course.students.map(student => <article className="course-prototype-course" key={student.id}><span className="course-prototype-course-icon">{String(student.number).padStart(2, '0')}</span><div><strong>{student.name}</strong><small>{course.name}</small></div></article>)}</div></section> : <section className="course-prototype-card course-prototype-empty"><span><UsersRound size={20}/></span><strong>No hay estudiantes para mostrar</strong><p>Primero crea un curso y confirma su lista.</p><button type="button" className="button primary" onClick={() => setScreen('course')}>Crear curso</button></section>}
        </> : !course ? null : <>
          {notice && <div className="course-prototype-success" role="status"><Check size={16} />{notice}</div>}
          {screen === 'periods' && gradingActivity && course ? <ActivityGradeWorkspace activity={gradingActivity} course={course} grades={activityGrades[gradingActivity.id] ?? {}} onGrade={(studentId, patch) => updateActivityGrade(gradingActivity.id, studentId, patch)} onBack={() => setGradingActivityId(null)} /> : (screen === 'periods' || screen === 'activitySetup') && <>
            {screen === 'activitySetup' && <section className="course-prototype-intro"><p className="eyebrow">ACTIVIDADES · {course.name}</p><h1>Preparación de actividades</h1><p>Antes de entrar a Períodos, elige cómo preparar la actividad. Puedes cargar la secuencia o crearla manualmente; después revisarás y editarás la ficha.</p></section>}
            {screen === 'periods' && <section className="course-prototype-intro"><p className="eyebrow">ACTIVIDADES · {course.name}</p><h1>Períodos</h1><p>Consulta las actividades preparadas en P1–P4 y abre la calificación de cada curso.</p></section>}
            {screen === 'periods' && <nav className="course-prototype-period-tabs" aria-label="Seleccionar período">{PERIODS.map(period => <button type="button" key={period} className={activityPeriod === period ? 'selected' : ''} onClick={() => { setActivityPeriod(period); setActivityCategoryFilter('all'); setActivityFormOpen(false); setError(''); }}><strong>{period}</strong><small>{activities.filter(activity => activity.period === period).length} actividades</small></button>)}</nav>}
            {screen === 'activitySetup' && activityFormOpen && <section className="course-prototype-card course-prototype-activity-wizard" aria-labelledby="activity-wizard-title">
              <div className="course-prototype-list-heading"><div><p className="eyebrow">ACTIVIDADES · PASO {activityStep === 'review' ? '2' : '1'}</p><h2 id="activity-wizard-title">{activityStep === 'source' ? '¿Cómo vas a crearla?' : activityStep === 'details' ? 'Completa la ficha de actividad' : '2. Revisión de la actividad'}</h2></div><button type="button" className="course-prototype-back-link" onClick={() => { setActivityFormOpen(false); setScreen('register'); setError(''); }}>Cerrar</button></div>
              <div className="course-prototype-stepper"><span className={activityStep === 'review' ? 'done' : 'current'}><i>1</i> Preparación</span><span className={activityStep === 'review' ? 'current' : ''}><i>2</i> Revisión</span></div>
              {activityStep === 'source' ? <div className="course-prototype-origin-grid">
                <article className="course-prototype-origin-card"><span className="course-prototype-origin-icon"><Upload size={20}/></span><h3>Usar una secuencia didáctica</h3><p>Sube un PDF o DOCX. Extraeré el texto disponible y prepararé una ficha editable para que confirmes cada dato.</p><label className="button secondary course-prototype-file-button"><Upload size={15}/> {sequenceReading ? 'Leyendo archivo…' : 'Elegir secuencia'}<input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={sequenceReading} onChange={event => void importSequence(event.currentTarget.files?.[0])}/></label><small>Máximo 20 MB. Los PDF escaneados sin texto requieren revisión manual.</small>{sequenceFileName && !sequenceText && <button type="button" className="button secondary" onClick={() => { setActivityOrigin('sequence'); setActivityCode('SECUENCIA'); setActivityStep('review'); }}>Continuar a revisión manual</button>}</article>
                <article className="course-prototype-origin-card"><span className="course-prototype-origin-icon"><FileText size={20}/></span><h3>Crear manualmente</h3><p>Define el código, las instrucciones, la evidencia, la categoría y los criterios de evaluación.</p><button type="button" className="button primary" onClick={() => { setActivityOrigin('manual'); setSequenceFileName(''); setSequenceText(''); setActivityCode('MANUAL'); setActivityStep('details'); setError(''); }}>Crear actividad manual</button></article>
              </div> : <form className="course-prototype-activity-form" onSubmit={activityStep === 'details' ? prepareActivityReview : createActivity}>
                {activityStep === 'review' && <div className="course-prototype-review-banner"><Eye size={17}/><span>{activityOrigin === 'sequence' ? 'Revisa los datos extraídos de la secuencia.' : 'Confirma la ficha preparada antes de crear la actividad.'} Los criterios se muestran solo para consulta en este paso.</span></div>}
                {sequenceFileName && <div className="course-prototype-imported-file"><FileText size={16}/><span><strong>Secuencia cargada</strong><small>{sequenceFileName}</small></span><button type="button" className="course-prototype-back-link" onClick={() => setActivityStep('source')}>Cambiar origen</button></div>}
                <div className="course-prototype-activity-meta">
                  <label>Código de secuencia<input maxLength={80} placeholder="Ej.: 2.1 o MANUAL" value={activityCode} onChange={event => setActivityCode(event.target.value)} /><small>{activityOrigin === 'sequence' ? 'Código propuesto desde el archivo; revísalo antes de guardar.' : 'Sin secuencia cargada, se usa MANUAL.'}</small></label>
                  <label className="course-prototype-activity-name">Nombre de la actividad<input required maxLength={200} placeholder="Ej.: Suma de vectores por el método del paralelogramo" value={activityTitle} onChange={event => setActivityTitle(event.target.value)} /></label>
                  <label>Categoría de evaluación<select value={activityCategory} onChange={event => setActivityCategory(event.target.value as ActivityCategoryKey)}>{ACTIVITY_CATEGORIES.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
                  <label><span><CalendarDays size={14}/> Fecha de creación</span><input type="date" value={activityDate} onChange={event => setActivityDate(event.target.value)} /><small>La fecha de uso de la clase se registra por separado.</small></label>
                  <label>Puntaje máximo bruto<input type="number" min={0.01} max={1000} step={0.01} required placeholder="Ej.: 10" value={activityMaxPoints} onChange={event => setActivityMaxPoints(event.target.value)} /></label>
                </div>
                <label>Producto o evidencia esperada<textarea rows={2} maxLength={2000} placeholder="Ej.: ejercicios resueltos, explicación oral, modelo o informe." value={activityEvidence} onChange={event => setActivityEvidence(event.target.value)} /></label>
                <label>Propósito de la actividad<textarea rows={2} maxLength={1000} placeholder="¿Qué aprendizaje se busca?" value={activityPurpose} onChange={event => setActivityPurpose(event.target.value)} /></label>
                <label>Instrucciones y desarrollo<textarea required rows={4} maxLength={8000} placeholder="Consigna, pasos de trabajo, ejercicios o indicaciones para el grupo." value={activityInstructions} onChange={event => setActivityInstructions(event.target.value)} /></label>
                {sequenceText && <details className="course-prototype-extracted-text"><summary>Ver texto extraído de la secuencia</summary><pre>{sequenceText}</pre></details>}
                {activityStep === 'review' ? <ActivityEvaluationPreview rubricEnabled={rubricEnabled} criteria={activityCriteria} competency={activityCompetency} indicator={activityIndicator}/> : <>
                <fieldset className="course-prototype-rubric-toggle"><legend>¿Cómo se evaluará esta actividad?</legend><label><input type="radio" name="scoring-mode" checked={rubricEnabled} onChange={() => setRubricEnabled(true)}/> Por criterios y niveles de desempeño</label><label><input type="radio" name="scoring-mode" checked={!rubricEnabled} onChange={() => setRubricEnabled(false)}/> Por puntaje directo con competencia e indicador</label></fieldset>
                {rubricEnabled ? <div className="rubric-editor course-prototype-rubric-editor"><div className="rubric-heading"><div><h3><ListChecks size={16}/> Criterios de evaluación</h3><p className="muted">Cada criterio se vincula con una competencia e indicador y describe cuatro niveles.</p></div><button type="button" className="button secondary" onClick={() => setActivityCriteria(current => [...current, emptyActivityCriterion()])}><Plus size={15}/> Añadir criterio</button></div>
                  {activityCriteria.map((criterion, index) => <article className="criterion-editor course-prototype-criterion" key={criterion.id}><div className="criterion-title-row"><h4>Criterio {index + 1}</h4>{activityCriteria.length > 1 && <button type="button" className="course-prototype-back-link" onClick={() => setActivityCriteria(current => current.filter(item => item.id !== criterion.id))}>Quitar</button>}</div>
                    <label>Qué se evalúa<input required maxLength={200} value={criterion.label} placeholder="Ej.: Representa magnitudes y dirección correctamente" onChange={event => updateCriterion(index, current => ({ ...current, label: event.target.value }))}/></label>
                    <div className="course-prototype-criterion-meta"><label>Competencia<select value={criterion.competency} onChange={event => updateCriterion(index, current => ({ ...current, competency: event.target.value as CompetencyKey }))}>{COMPETENCY_GROUPS.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label><label>Indicador de logro<input required maxLength={500} value={criterion.indicator} placeholder="Indicador que se observará" onChange={event => updateCriterion(index, current => ({ ...current, indicator: event.target.value }))}/></label><label>Peso relativo<input type="number" min={0.25} step={0.25} value={criterion.weight} onChange={event => updateCriterion(index, current => ({ ...current, weight: Number(event.target.value) }))}/></label></div>
                    <div className="course-prototype-level-grid">{criterion.levels.map((level, levelIndex) => <label className={'course-prototype-level level-' + levelIndex} key={level.label}><span>{level.label} · {level.points} pt{level.points === 1 ? '' : 's'}</span><textarea required rows={3} maxLength={1000} value={level.description} placeholder="Describe qué evidencia demuestra este nivel" onChange={event => updateCriterion(index, current => ({ ...current, levels: current.levels.map((item, currentIndex) => currentIndex === levelIndex ? { ...item, description: event.target.value } : item) }))}/></label>)}</div>
                  </article>)}
                  <p className="course-prototype-rubric-note">La calificación por estudiante se hará después, seleccionando el nivel alcanzado en cada criterio; el resultado se escalará al máximo bruto definido.</p>
                </div> : <div className="course-prototype-criterion-meta"><label>Competencia<select value={activityCompetency} onChange={event => setActivityCompetency(event.target.value as CompetencyKey)}>{COMPETENCY_GROUPS.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label><label>Indicador que se evaluará<input required maxLength={500} value={activityIndicator} placeholder="Competencia específica o indicador de logro" onChange={event => setActivityIndicator(event.target.value)}/></label></div>}
                </>}
                {activityStep === 'review' && <label className="course-prototype-assigned-period">Período al que se añadirá la actividad<select value={activityPeriod} onChange={event => setActivityPeriod(event.target.value as Period)}>{PERIODS.map(period => <option key={period} value={period}>{period}</option>)}</select><small>Primero revisas la actividad; después se abrirá ese período.</small></label>}
                {error && <p className="course-prototype-error" role="alert">{error}</p>}
                <div className="course-prototype-activity-footer"><button type="button" className="course-prototype-back-link" onClick={() => { setActivityStep(activityStep === 'review' ? 'details' : 'source'); setError(''); }}><ArrowLeft size={14}/> {activityStep === 'review' ? 'Volver a editar' : 'Cambiar origen'}</button><button className="button primary" type="submit">{activityStep === 'details' ? <><Eye size={16}/> Revisar actividad</> : <><Check size={16}/> Guardar actividad y abrir Períodos</>}</button></div>
              </form>}
              {activityStep === 'source' && error && <p className="course-prototype-error" role="alert">{error}</p>}
            </section>}
            {screen === 'periods' && <section className="course-prototype-card course-prototype-activity-list-card" aria-labelledby="period-activities-title">
              <div className="course-prototype-list-heading"><div><p className="eyebrow">EVIDENCIAS DEL PERÍODO {activityPeriod}</p><h2 id="period-activities-title">Actividades creadas</h2></div><span className="course-prototype-count">{periodActivities.length}</span></div>
              <div className="course-prototype-category-filters"><button type="button" className={activityCategoryFilter === 'all' ? 'selected' : ''} onClick={() => setActivityCategoryFilter('all')}>Todas</button>{ACTIVITY_CATEGORIES.map(category => <button type="button" key={category.key} className={activityCategoryFilter === category.key ? 'selected' : ''} onClick={() => setActivityCategoryFilter(category.key)}>{category.label}</button>)}</div>
              {displayedActivities.length ? <div className="course-prototype-period-activities">{displayedActivities.map(activity => <article className="course-prototype-activity course-prototype-activity-expanded" key={activity.id}><div className="course-prototype-activity-title"><span className="course-prototype-activity-category">{ACTIVITY_CATEGORIES.find(category => category.key === activity.category)?.label}</span><strong>{activity.title}</strong><p>{activity.purpose || activity.instructions}</p>{activity.evidence && <small>Evidencia: {activity.evidence}</small>}{activity.rubric.length > 0 && <details className="course-prototype-saved-rubric"><summary>{activity.rubric.length} criterio(s) · ver rúbrica</summary>{activity.rubric.map((criterion, index) => <div className="course-prototype-saved-criterion" key={criterion.id}><strong>{index + 1}. {criterion.label}</strong><small>{COMPETENCY_GROUPS.find(group => group.key === criterion.competency)?.label} · {criterion.indicator} · peso {criterion.weight}</small><div>{criterion.levels.map(level => <span key={level.label}><b>{level.label} ({level.points})</b>{level.description}</span>)}</div></div>)}</details>}</div><dl><div><dt>Código</dt><dd>{activity.sequenceCode}</dd></div><div><dt>Creada</dt><dd>{activity.creationDate}</dd></div><div><dt>Máximo</dt><dd>{activity.maxPoints} pts</dd></div><div><dt>Evaluación</dt><dd>{activity.rubric.length ? `${activity.rubric.length} criterios` : 'Directa'}</dd></div></dl><button type="button" className="button secondary course-prototype-grade-button" onClick={() => setGradingActivityId(activity.id)}>Calificar {course.code}</button></article>)}</div> : <div className="course-prototype-empty-activities"><span><ClipboardList size={20}/></span><strong>{activityCategoryFilter === 'all' ? `Aún no hay actividades en ${activityPeriod}` : 'No hay actividades en esta categoría'}</strong><p>Prepara y revisa una actividad antes de que aparezca en este período.</p></div>}
            </section>}
          </>}          {screen === 'register' && <>
            <section className="course-prototype-intro">
              <p className="eyebrow">REGISTRO DEL CURSO</p>
              <h1>{course.name}</h1>
              <p>El curso y su nómina alimentan las rutas de Asistencia y Comportamiento. Agrega un estudiante aquí y aparecerá automáticamente en ambas.</p>
            </section>
            <div className="course-prototype-route-cards">
              <button type="button" className="course-prototype-route-card" onClick={() => { setActivitiesMenuOpen(true); if (activities.length) setScreen('periods'); else startActivityFlow(); }}><span className="course-prototype-route-icon"><ClipboardList size={20} /></span><span><strong>Actividades</strong><small>{activities.length ? `${activities.length} preparadas · P1–P4 disponibles` : 'Sube una secuencia o comienza manualmente'}</small></span><ArrowRight size={18} /></button>
              <button type="button" className="course-prototype-route-card" onClick={() => setScreen('attendance')}><span className="course-prototype-route-icon"><CalendarCheck2 size={20} /></span><span><strong>Asistencia</strong><small>{presentCount} presentes o tardanzas · {course.students.length} estudiantes en la lista</small></span><ArrowRight size={18} /></button>
              <button type="button" className="course-prototype-route-card" onClick={() => setScreen('behavior')}><span className="course-prototype-route-icon"><UsersRound size={20} /></span><span><strong>Comportamiento</strong><small>{behaviorCount} valoraciones · misma nómina del curso</small></span><ArrowRight size={18} /></button>
            </div>
            <section className="course-prototype-card course-prototype-list" aria-labelledby="student-list-title">
              <div className="course-prototype-list-heading"><div><p className="eyebrow">ESTUDIANTES · {course.name}</p><h2 id="student-list-title">Lista del curso</h2></div><span className="course-prototype-count">{course.students.length} estudiantes</span></div>
              <form className="course-prototype-add-student" onSubmit={addStudent}><label>Agregar estudiante<input autoComplete="off" maxLength={180} placeholder="Nombre del estudiante" value={newStudentName} onChange={event => setNewStudentName(event.target.value)} /></label><button type="submit" className="button primary"><Plus size={16} /> Agregar</button></form>
              {error && <p className="course-prototype-error" role="alert">{error}</p>}
              <div className="course-prototype-course-list">{course.students.map(student => <article className="course-prototype-course" key={student.id}><span className="course-prototype-course-icon">{String(student.number).padStart(2, '0')}</span><div><strong>{student.name}</strong><small>Asistencia y Comportamiento vinculados a este curso</small></div><span className="course-prototype-pending">Pendiente</span></article>)}</div>
            </section>
          </>}

          {screen === 'attendance' && <>
            <section className="course-prototype-intro"><p className="eyebrow">REGISTRO DEL CURSO · {course.name}</p><h1>Asistencia</h1><p>La nómina se carga desde el curso. Las marcas de esta vista son temporales y no confirman una clase en la base.</p></section>
            <section className="course-prototype-card course-prototype-list"><div className="course-prototype-list-heading"><div><p className="eyebrow">CAPTURA DE PRUEBA</p><h2>Marca la asistencia</h2></div><span className="course-prototype-count">{course.students.length} estudiantes</span></div>
              <div className="course-prototype-test-table"><div className="course-prototype-test-row course-prototype-test-head"><span>N.º</span><span>Estudiante</span><span>Asistencia</span></div>{course.students.map(student => <div className="course-prototype-test-row" key={student.id}><span>{String(student.number).padStart(2, '0')}</span><strong>{student.name}</strong><select aria-label={'Asistencia '+student.name} value={student.attendance} onChange={event => updateStudent(student.id, { attendance: event.target.value as Attendance, ...(event.target.value === 'A' || event.target.value === 'E' || event.target.value === 'R' ? { behavior: null } : {}) })}><option value="">Pendiente</option>{MARKS.map(mark => <option value={mark.value} key={mark.value}>{mark.label}</option>)}</select></div>)}</div>
            </section>
          </>}

          {screen === 'behavior' && <>
            <section className="course-prototype-intro"><p className="eyebrow">REGISTRO DEL CURSO · {course.name}</p><h1>Comportamiento</h1><p>Usa la misma nómina de asistencia. La valoración diaria de prueba es de 0 a 10 y queda asociada al estudiante.</p></section>
            <section className="course-prototype-card course-prototype-list"><div className="course-prototype-list-heading"><div><p className="eyebrow">CAPTURA DE PRUEBA</p><h2>Valoración y observación</h2></div><span className="course-prototype-count">{course.students.length} estudiantes</span></div>
              <div className="course-prototype-test-table"><div className="course-prototype-test-row course-prototype-behavior-head"><span>N.º</span><span>Estudiante</span><span>Asistencia</span><span>Comportamiento / 10</span><span>Observación</span></div>{course.students.map(student => <div className="course-prototype-test-row course-prototype-behavior-row" key={student.id}><span>{String(student.number).padStart(2, '0')}</span><strong>{student.name}</strong><span>{MARKS.find(mark => mark.value === student.attendance)?.label ?? 'Pendiente'}</span><input aria-label={'Comportamiento '+student.name} type="number" min={0} max={10} step={0.5} value={student.behavior ?? ''} disabled={['A','E','R'].includes(student.attendance)} placeholder="Pendiente" onChange={event => updateStudent(student.id, { behavior: event.target.value === '' ? null : Number(event.target.value) })} /><input aria-label={'Observación '+student.name} maxLength={500} placeholder="Opcional" value={student.comment} onChange={event => updateStudent(student.id, { comment: event.target.value })} /></div>)}</div>
            </section>
          </>}

          <footer className="course-prototype-footer"><button className="course-prototype-back-link" type="button" onClick={() => setScreen('register')}><ArrowLeft size={14} /> Volver al registro de {course.name}</button><span>{course.students.length} estudiantes vinculados a ambas rutas.</span></footer>
        </>}
      </div>
    </main>
  </div>;
}

function ActivityGradeWorkspace({ activity, course, grades, onGrade, onBack }: { activity: Activity; course: Course; grades: Record<string, ActivityGrade>; onGrade: (studentId: string, patch: Partial<ActivityGrade>) => void; onBack: () => void }) {
  const scoreFor = (grade: ActivityGrade) => {
    if (!activity.rubric.length) return grade.directScore;
    if (activity.rubric.some(criterion => grade.criterionLevels[criterion.id] === undefined)) return null;
    const rawMaximum = activity.rubric.reduce((sum, criterion) => sum + Math.max(...criterion.levels.map(level => level.points)) * criterion.weight, 0);
    const rawScore = activity.rubric.reduce((sum, criterion) => sum + criterion.levels[grade.criterionLevels[criterion.id]].points * criterion.weight, 0);
    return rawMaximum > 0 ? Math.round(rawScore / rawMaximum * activity.maxPoints * 100) / 100 : null;
  };
  const completed = course.students.filter(student => scoreFor(grades[student.id] ?? { criterionLevels: {}, directScore: null, comment: '' }) !== null).length;
  return <>
    <section className="course-prototype-intro course-prototype-grade-intro"><div><p className="eyebrow">CALIFICACIONES · {activity.period} · {activity.sequenceCode}</p><h1>{activity.title}</h1><p>{course.name} · {ACTIVITY_CATEGORIES.find(category => category.key === activity.category)?.label} · máximo {activity.maxPoints} puntos</p></div><button type="button" className="course-prototype-back-link" onClick={onBack}><ArrowLeft size={14}/> Volver a Actividades</button></section>
    <div className="course-prototype-grade-metrics"><div><span>Estudiantes</span><strong>{course.students.length}</strong></div><div><span>Calificaciones completas</span><strong>{completed} / {course.students.length}</strong></div><div><span>Evaluación</span><strong>{activity.rubric.length ? activity.rubric.length + ' criterios' : 'Puntaje directo'}</strong></div></div>
    {activity.rubric.length > 0 && <details className="course-prototype-card course-prototype-grade-rubric"><summary><ListChecks size={16}/> Ver criterios, competencias y descriptores</summary>{activity.rubric.map((criterion, index) => <article className="course-prototype-saved-criterion" key={criterion.id}><strong>{index + 1}. {criterion.label}</strong><small>{COMPETENCY_GROUPS.find(group => group.key === criterion.competency)?.label} · {criterion.indicator} · peso {criterion.weight}</small><div>{criterion.levels.map(level => <span key={level.label}><b>{level.label} ({level.points})</b>{level.description}</span>)}</div></article>)}</details>}
    <section className="course-prototype-card course-prototype-grade-card"><div className="course-prototype-list-heading"><div><p className="eyebrow">CAPTURA POR ESTUDIANTE</p><h2>{activity.rubric.length ? 'Evalúa cada criterio y nivel' : 'Registra el puntaje directo'}</h2></div><span className="course-prototype-count">{completed} completas</span></div><p className="course-prototype-grade-help">La nota se calcula desde los niveles seleccionados y se escala sobre {activity.maxPoints} puntos. Las competencias se toman del criterio evaluado.</p>
      <div className="course-prototype-grade-table-wrap"><table className="course-prototype-grade-table"><thead><tr><th>N.º</th><th>Estudiante</th>{activity.rubric.map(criterion => <th key={criterion.id}>{criterion.label}<small>{COMPETENCY_GROUPS.find(group => group.key === criterion.competency)?.label}</small></th>)}{!activity.rubric.length && <th>Puntaje / {activity.maxPoints}</th>}<th>Nota final / {activity.maxPoints}</th><th>Porcentaje</th><th>Comentario</th></tr></thead><tbody>{course.students.map(student => {
        const grade = grades[student.id] ?? { criterionLevels: {}, directScore: null, comment: '' };
        const score = scoreFor(grade);
        return <tr key={student.id}><td>{String(student.number).padStart(2, '0')}</td><th>{student.name}</th>{activity.rubric.map(criterion => <td key={criterion.id}><select aria-label={criterion.label + ' · ' + student.name} value={grade.criterionLevels[criterion.id] ?? ''} onChange={event => { const levels = { ...grade.criterionLevels }; if (event.target.value === '') delete levels[criterion.id]; else levels[criterion.id] = Number(event.target.value); onGrade(student.id, { criterionLevels: levels }); }}><option value="">Pendiente</option>{criterion.levels.map((level, index) => <option key={level.label} value={index}>{level.label} ({level.points})</option>)}</select></td>)}{!activity.rubric.length && <td><input aria-label={'Puntaje de ' + student.name} type="number" min={0} max={activity.maxPoints} step={0.01} value={grade.directScore ?? ''} onChange={event => onGrade(student.id, { directScore: event.target.value === '' ? null : Math.min(activity.maxPoints, Math.max(0, Number(event.target.value))) })}/></td>}<td><strong>{score === null ? 'Pendiente' : score.toFixed(2)}</strong></td><td>{score === null ? '—' : Math.round(score / activity.maxPoints * 100) + '%'}</td><td><input aria-label={'Comentario de ' + student.name} maxLength={500} placeholder="Opcional" value={grade.comment} onChange={event => onGrade(student.id, { comment: event.target.value })}/></td></tr>;
      })}</tbody></table></div>
      <div className="course-prototype-grade-footer"><span>Prueba local: estos puntajes viven solo en esta sesión y todavía no se guardan en la base de datos.</span><span>{completed} de {course.students.length} estudiantes evaluados</span></div>
    </section>
  </>;
}
