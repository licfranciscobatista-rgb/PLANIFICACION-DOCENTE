'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BookOpenCheck, Check, ClipboardList, FileText, LoaderCircle, Plus, Save, Settings2, Trash2, Upload, X } from 'lucide-react';
import { COMPETENCY_GROUPS, type Activity, type ActivityCategoryKey, type Bootstrap, type CompetencyKey, type EvaluationCriterion, type EvaluationPlan, type EvaluationPurpose, type IndicatorUsageRecord, type RubricCriterion, type RubricLevel, type SequenceActivity, type SequenceIndicator, type SequencePlan, type SourceAssessmentInstrument } from '@/lib/model';
import { apiPost, errorText, formatDate, useRemote } from '@/lib/client';
import { proposeActivities, proposeSequenceFromPdfPages } from '@/lib/sequence-import';
import { parseRubricWorkbook, type ImportedRubricCriterion } from '@/lib/rubric-import';
import { allocateRubricPoints } from '@/lib/rubric-allocation';

import PeriodEvaluationPanel from './period-evaluation';

type Section = 'all' | 'criteria' | 'indicators' | 'sequence';
type LevelDraft = { label: string; points: number; description: string };
type SelectedCriterionDraft = { id:string; label:string; levels:RubricLevel[]; indicatorId:string; weight:number; originLabel?:string; templateId?:string; pointsInput?:string };
const LEVELS: LevelDraft[] = [
  { label: 'Insuficiente', points: 1, description: '' },
  { label: 'Suficiente', points: 2, description: '' },
  { label: 'Bueno', points: 3, description: '' },
  { label: 'Excelente', points: 4, description: '' },
];
const CATEGORY_LABELS: Record<ActivityCategoryKey, string> = { exam: 'Exámenes', participation: 'Participación y conducta', notebook: 'Libretas y tareas', sequence: 'Actividades de secuencia', homework: 'Prácticas para casa', extra: 'Puntos extra' };
const PURPOSE_LABELS: Record<EvaluationPurpose, string> = { diagnostica: 'Diagnóstica', formativa: 'Formativa', sumativa: 'Sumativa', formativa_sumativa: 'Formativa y sumativa' };
const newId = () => crypto.randomUUID();
function criterionKey(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^a-z0-9]/g,'');}
function standardEvaluationLevels(source:RubricLevel[]):RubricLevel[]{
  const aliases=[['insuficiente','deficiente','inicial','beginning'],['suficiente','basico','basica','aceptable','developing'],['bueno','logrado','satisfactorio','proficient'],['excelente','destacado','avanzado','exemplary']];
  return LEVELS.map((level,index)=>{const match=source.find(item=>aliases[index]!.includes(criterionKey(item.label)))??source.find(item=>item.points===level.points);return {...level,description:match?.description?.trim()??''};});
}
function criterionMaximumPoints(item:Pick<SelectedCriterionDraft,'levels'|'weight'>){return Math.max(0,...item.levels.map(level=>level.points))*(item.weight||0);}
function pointText(value:number){return (Math.round((value+Number.EPSILON)*100)/100).toFixed(2).replace(/\.00$/,'').replace(/(\.\d)0$/,'$1');}
function distributeCriterionValues(items:SelectedCriterionDraft[],total:number):SelectedCriterionDraft[]{
  if(!items.length)return [];
  const totalCents=Math.max(0,Math.round((total+Number.EPSILON)*100));
  const raw=items.map(criterionMaximumPoints);const rawTotal=raw.reduce((sum,value)=>sum+value,0);
  const exact=raw.map(value=>totalCents*(rawTotal>0?value/rawTotal:1/items.length));
  const cents=exact.map(Math.floor);let remaining=totalCents-cents.reduce((sum,value)=>sum+value,0);
  const order=exact.map((value,index)=>({index,remainder:value-cents[index]!})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(const item of order){if(remaining<=0)break;cents[item.index]=cents[item.index]!+1;remaining-=1;}
  return items.map((item,index)=>{const points=cents[index]!/100;const maxLevel=Math.max(...item.levels.map(level=>level.points));return {...item,weight:maxLevel>0?points/maxLevel:0,pointsInput:pointText(points)};});
}
function equalCriterionValues(items:SelectedCriterionDraft[],total:number):SelectedCriterionDraft[]{
  if(!items.length)return [];
  const totalCents=Math.max(0,Math.round((total+Number.EPSILON)*100));const base=Math.floor(totalCents/items.length);let extra=totalCents-base*items.length;
  return items.map(item=>{const points=(base+(extra-->0?1:0))/100;const maxLevel=Math.max(...item.levels.map(level=>level.points));return {...item,weight:maxLevel>0?points/maxLevel:0,pointsInput:pointText(points)};});
}
function setCriterionValue(items:SelectedCriterionDraft[],criterionId:string,value:number,total:number):SelectedCriterionDraft[]{
  const targetIndex=items.findIndex(item=>item.id===criterionId);if(targetIndex<0)return items;
  if(items.length===1)return distributeCriterionValues(items,total);
  const centsTotal=Math.round((total+Number.EPSILON)*100);const minCents=1;const targetCents=Math.max(minCents,Math.min(centsTotal-minCents*(items.length-1),Math.round((value+Number.EPSILON)*100)));
  const otherIndexes=items.map((_,index)=>index).filter(index=>index!==targetIndex);const raw=otherIndexes.map(index=>criterionMaximumPoints(items[index]!));const rawTotal=raw.reduce((sum,points)=>sum+points,0);const remainingCents=centsTotal-targetCents;
  const exact=raw.map(points=>remainingCents*(rawTotal>0?points/rawTotal:1/otherIndexes.length));const cents=exact.map(Math.floor);let left=remainingCents-cents.reduce((sum,points)=>sum+points,0);
  const order=exact.map((points,index)=>({index,remainder:points-cents[index]!})).sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(const other of order){if(left<=0)break;cents[other.index]=cents[other.index]!+1;left-=1;}
  const next=items.map(item=>({...item}));const values=new Map<number,number>([[targetIndex,targetCents/100]]);otherIndexes.forEach((index,offset)=>values.set(index,cents[offset]!/100));
  return next.map((item,index)=>{const points=values.get(index)!;const maxLevel=Math.max(...item.levels.map(level=>level.points));return {...item,weight:maxLevel>0?points/maxLevel:0,pointsInput:pointText(points)};});
}
function isUnscoredDiagnostic(item: Pick<SequenceActivity, 'evaluationPurpose'|'plannedPoints'|'plannedPercent'>) {
  return item.evaluationPurpose === 'diagnostica' && !(Number(item.plannedPoints) > 0 || Number(item.plannedPercent) > 0);
}
function sequenceHasEvaluationCriteria(item: SequenceActivity) {
  return Boolean(item.assessmentInstrument?.criteria.length || item.evaluationCriteria?.length);
}
function assignedPeriods(sequence: SequencePlan, item: SequenceActivity): string[] {
  return sequence.periodAssignments === undefined
    ? item.period ? [item.period] : []
    : [...new Set(sequence.periodAssignments.filter(row => row.activityId === item.id).map(row => row.period))];
}
function linkedEvaluations(item: SequenceActivity, activities: Activity[]): Activity[] {
  return activities.filter(activity => activity.sequenceActivityId === item.id || (!activity.sequenceActivityId && Boolean(item.code) && activity.sequenceCode === item.code));
}
function sequenceEvaluationPeriods(item: SequenceActivity, activities: Activity[]): string[] {
  return [...new Set(linkedEvaluations(item, activities).map(activity => activity.period))];
}
function sequenceDraftForPeriod(sequence: SequencePlan, period: string, activities: Activity[]): SequenceActivity[] {
  if (!sequence.reviewed) return [];
  return sequence.activities.filter(item => assignedPeriods(sequence, item).includes(period) && !linkedEvaluations(item, activities).some(activity => activity.period === period));
}

async function extractText(file: File): Promise<{ text: string; pdfSequenceProposal?: ReturnType<typeof proposeSequenceFromPdfPages> }> {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'txt') return { text: (await file.text()).slice(0, 80000) };
  if (extension === 'docx') {
    const mammoth = await import('mammoth');
    return { text: (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.slice(0, 80000).trim() };
  }
  if (extension === 'pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    const proposalPages: Array<Array<{ str: string; x: number; y: number }>> = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' '));
      proposalPages.push(content.items.flatMap(item => 'str' in item ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }] : []));
    }
    return { text: pages.join('\n').slice(0, 80000).trim(), pdfSequenceProposal: proposeSequenceFromPdfPages(proposalPages) };
  }
  throw new Error('Formato no compatible. Usa PDF, DOCX o TXT.');
}

export function ActivityWorkspace({ courses, activities, plan, plans, curriculumSequence, period, section, today, onPeriod, onSection, onConfigure, onChange, onGrade }: {
  courses: Bootstrap['courses']; activities: Activity[]; plan: EvaluationPlan; plans: EvaluationPlan[]; curriculumSequence: SequencePlan | null; period: string; section: Section; today: string;
  onPeriod: (period: string) => void; onSection: (section: Section) => void; onConfigure: (period: string) => void; onChange: () => void; onGrade: (activityId: string, courseId: string) => void;
}) {
  const periodPlan = plans.find(item => item.period === period);
  const selectedActivities = useMemo(() => {
    const seen = new Set<string>();
    return activities.filter(item => item.period === period).filter(item => { const key = item.sharedId ?? item.id; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a,b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  }, [activities, period]);
  const [showActivity, setShowActivity] = useState(false);
  const [assignmentPickerOpen, setAssignmentPickerOpen] = useState(false);
  const [showEvaluation, setShowEvaluation] = useState<Activity | null>(null);
  const [showCriterionForm, setShowCriterionForm] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [title, setTitle] = useState('');
  const [activityCode, setActivityCode] = useState('MANUAL');
  const [activityDate, setActivityDate] = useState(today);
  const [activityEvidence, setActivityEvidence] = useState('');
  const [category, setCategory] = useState<ActivityCategoryKey>('sequence');
  const [maxPoints, setMaxPoints] = useState(10);
  const [activityScoringMode, setActivityScoringMode] = useState<'points'|'rubric'>('points');
  const [sequenceDraft, setSequenceDraft] = useState<SequencePlan>(() => curriculumSequence ?? { source: 'manual', sourceName: '', sourceText: '', reviewed: false, periodAssignments: [], activities: [], indicators: [] });
  const pendingSequenceActivities = useMemo(() => sequenceDraftForPeriod(sequenceDraft, period, activities), [sequenceDraft, period, activities]);
  const [sequenceMode, setSequenceMode] = useState<'start'|'review'|'summary'>(curriculumSequence?.reviewed ? 'summary' : curriculumSequence && curriculumSequence.planningMode !== 'manual' ? 'review' : 'start');
  const [sequenceBusy, setSequenceBusy] = useState(false);
  const [sequenceError, setSequenceError] = useState('');
  const [sequenceNotice, setSequenceNotice] = useState('');
  const [periodAssignmentsDirty, setPeriodAssignmentsDirty] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [criteria, setCriteria] = useState<EvaluationCriterion[]>([]);
  const [criteriaLoaded, setCriteriaLoaded] = useState(false);
  const [criterionId, setCriterionId] = useState('');
  const [criterionLabel, setCriterionLabel] = useState('');
  const [criterionLevels, setCriterionLevels] = useState<LevelDraft[]>(LEVELS);
  const [criterionBusy, setCriterionBusy] = useState(false);
  const [criterionError, setCriterionError] = useState('');
  const indicatorUsage = useRemote<IndicatorUsageRecord[]>('indicator-usage', {}, section === 'indicators');

  useEffect(() => {
    setSequenceDraft(curriculumSequence ?? { source: 'manual', sourceName: '', sourceText: '', reviewed: false, periodAssignments: [], activities: [], indicators: [] });
    setSequenceMode(curriculumSequence?.reviewed ? 'summary' : curriculumSequence && curriculumSequence.planningMode !== 'manual' ? 'review' : 'start');
  }, [curriculumSequence]);
  useEffect(() => {
    if (section !== 'criteria') return;
    void fetch('/api/registro?action=bootstrap', { cache: 'no-store' }).then(response => response.json()).then(body => {
      if (!body.error) { setCriteria((body.data?.criteriaCatalog ?? []).filter((item: EvaluationCriterion) => item.active)); setCriteriaLoaded(true); }
      else setCriterionError(body.error);
    }).catch(error => setCriterionError(errorText(error)));
  }, [section, criteriaLoaded]);

  function resetActivity() {
    setTitle(''); setActivityCode('MANUAL'); setActivityDate(today); setActivityEvidence(''); setCategory('sequence'); setMaxPoints(10); setActivityScoringMode('points'); setActivityError('');
  }
  function selectSequenceCode(id: string) {
    setActivityCode(id);
    if(id==='MANUAL'){setTitle('');setActivityError('');setMaxPoints(10);setActivityScoringMode('points');return;}
    const item = sequenceDraft.activities.find(activity => activity.id === id);
    if (item) {
      setTitle(item.title);
      setActivityScoringMode(sequenceHasEvaluationCriteria(item) ? 'rubric' : 'points');
      setActivityError(isUnscoredDiagnostic(item) ? 'La secuencia marca esta actividad como diagnóstica sin ponderación. Consérvala en la secuencia; no la conviertas en una nota.' : '');
      if (item.plannedPoints !== undefined && item.plannedPoints !== null) setMaxPoints(item.plannedPoints > 0 ? item.plannedPoints : 10);
    }
  }
  function prepareSequenceEvaluation(item: SequenceActivity) {
    if (isUnscoredDiagnostic(item)) return;
    setActivityError('');
    setActivityDate(today);
    setCategory('sequence');
    setActivityEvidence(item.evidence ?? '');
    setActivityCode(item.id);
    setActivityScoringMode(sequenceHasEvaluationCriteria(item) ? 'rubric' : 'points');
    setTitle(item.title);
    setMaxPoints(item.plannedPoints ?? item.assessmentInstrument?.maxPoints ?? 0);
    setShowActivity(true);
  }
  function changePeriodAssignment(item: SequenceActivity, include: boolean) {
    const target = sequenceDraft.activePlanningPeriod;
    if (!target) return;
    const currentPeriods = assignedPeriods(sequenceDraft, item);
    const evaluatedPeriods = sequenceEvaluationPeriods(item, activities);
    if (include && currentPeriods.includes(target)) return;
    if (!include && evaluatedPeriods.includes(target)) return;
    if (include && evaluatedPeriods.some(value => value !== target)) {
      const previous = evaluatedPeriods.join(', ');
      if (!window.confirm(`“${item.title}” ya se evaluó en ${previous}. ¿Quieres volver a evaluarla en ${target}? Se guardará como otra evaluación; la anterior no se moverá ni se borrará.`)) return;
    }
    const base = sequenceDraft.periodAssignments ?? sequenceDraft.activities.flatMap(activity => activity.period ? [{ activityId: activity.id, period: activity.period as 'P1'|'P2'|'P3'|'P4' }] : []);
    const next = include
      ? [...base, { activityId: item.id, period: target }]
      : base.filter(row => !(row.activityId === item.id && row.period === target));
    const nextPeriods = next.filter(row => row.activityId === item.id).map(row => row.period);
    setSequenceDraft(current => ({
      ...current,
      periodAssignments: next,
      activities: current.activities.map(activity => activity.id === item.id
        ? { ...activity, period: activity.period === target ? nextPeriods[0] ?? '' : activity.period || target }
        : activity),
    }));
    setPeriodAssignmentsDirty(true);
  }
  async function createActivity(event: React.FormEvent) {
    event.preventDefault(); if (!periodPlan) return;
    setActivityBusy(true); setActivityError('');
    try {
      const sourceActivity = sequenceDraft.reviewed ? sequenceDraft.activities.find(item => item.id === activityCode) : undefined;
      if (sourceActivity && isUnscoredDiagnostic(sourceActivity)) throw new Error('La secuencia marca esta actividad como diagnóstica sin ponderación. Consérvala en la secuencia; no la conviertas en una nota.');
      const created = await apiPost<Activity[]>('shared-activity', {
        courseIds: courses.map(course => course.id),
        activity: { category, title: title.trim(), date: activityDate, maxPoints, evidence: activityEvidence.trim(), description: sourceActivity?.description ?? '', sequenceCode: sourceActivity?.code ?? '', ...(sourceActivity ? { sequenceActivityId: sourceActivity.id, purpose: sourceActivity.evaluationPurpose ? PURPOSE_LABELS[sourceActivity.evaluationPurpose] : '' } : {}), instrument: activityScoringMode==='points'?'Puntaje directo':'', scoringMode: activityScoringMode, rubric: [], requestId: newId() },
      });
      const first = created[0];
      setShowActivity(false);
      if(first&&activityScoringMode==='rubric')setShowEvaluation(first);else onChange();
      resetActivity();
    } catch (error) { setActivityError(errorText(error)); } finally { setActivityBusy(false); }
  }

  async function importSequence(file?: File) {
    if (!file) return;
    setFileBusy(true); setSequenceError(''); setSequenceNotice('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB.');
      const extracted = await extractText(file);
      const text = extracted.text;
      if (!text.trim()) throw new Error('No se encontró texto seleccionable. Si el PDF es una imagen escaneada, usa la captura manual y consulta el documento mientras completas la revisión.');
      const structured = extracted.pdfSequenceProposal?.activities.length ? extracted.pdfSequenceProposal : null;
      const proposed: SequenceActivity[] = structured
        ? structured.activities.map(item => ({ id: newId(), code: item.code, theme: item.theme, title: item.title, lessonType: null, description: item.theme, evidence: '', indicatorIds: [], period: '', evaluationPurpose: item.evaluationPurpose, plannedPoints: item.plannedPoints, plannedPercent: item.plannedPercent, instrument: item.instrument, evaluationCriteria: item.evaluationCriteria, feedback: item.feedback, ...(item.assessmentInstrument ? { assessmentInstrument: item.assessmentInstrument } : {}) }))
        : proposeActivities(text).map(item => ({ id: newId(), code: item.code, theme: '', title: item.title, lessonType: null, description: '', evidence: '', indicatorIds: [], period: '' }));
      const importedIndicators = structured?.indicators.map(item => ({ id: newId(), code: item.code, label: item.label, competency: item.competency })) ?? [];
      setSequenceDraft({ source: 'uploaded', sourceName: file.name, sourceText: text, reviewed: false, activePlanningPeriod: null, periodAssignments: [], activities: proposed, indicators: importedIndicators, ...(structured?.finalAssessment ? { finalAssessment: structured.finalAssessment } : {}) });
      setSequenceMode('review');
      setSequenceNotice(proposed.length ? `Extraje ${proposed.length} actividades y ${importedIndicators.length} indicadores. Revisa solo el nombre y el contenido de cada actividad; los indicadores se administran aparte y no se asignan a una evaluación todavía.` : 'Extraje el texto. No detecté encabezados numerados con suficiente confianza; añade las actividades manualmente y conserva el texto como referencia.');
    } catch (error) { setSequenceError(errorText(error)); } finally { setFileBusy(false); }
  }
  function startManualSequence() {
    setSequenceDraft({ source: 'manual', sourceName: '', sourceText: '', reviewed: false, planningMode: 'sequence', activePlanningPeriod: null, periodAssignments: [], activities: [], indicators: [] });
    setSequenceError('');
    setSequenceNotice('');
    setSequenceMode('review');
  }
  async function continueWithoutSequence() {
    setSequenceBusy(true); setSequenceError(''); setSequenceNotice('');
    try {
      if (curriculumSequence && (curriculumSequence.planningMode !== 'manual' || curriculumSequence.activities.length || curriculumSequence.indicators.length)) {
        throw new Error('Ya existe una secuencia guardada. Revísala antes de cambiar a captura manual para proteger sus datos.');
      }
      const saved = await apiPost<SequencePlan>('curriculum-sequence', { source: 'manual', sourceName: '', sourceText: '', reviewed: false, planningMode: 'manual', activePlanningPeriod: null, periodAssignments: [], activities: [], indicators: [] });
      setSequenceDraft(saved); setSequenceMode('start'); setSequenceNotice('Captura manual activada. La secuencia no se usará; podrás crear actividades por período y definir sus indicadores al evaluarlas.');
      onSection('all'); onChange();
    } catch (error) { setSequenceError(errorText(error)); } finally { setSequenceBusy(false); }
  }
  async function saveSequence(reviewed: boolean, reason?: 'indicators'): Promise<boolean> {
    const wasReviewed=sequenceDraft.reviewed;
    setSequenceBusy(true); setSequenceError(''); setSequenceNotice('');
    try {
      if (reviewed) {
        if (!sequenceDraft.activities.length) throw new Error('Añade al menos una actividad antes de confirmar la revisión.');
        const missing = sequenceDraft.activities.find(item => !item.title.trim() || !(item.description.trim() || item.theme.trim()));
        if (missing) throw new Error(`Completa el nombre y qué se trabajará en “${missing.title || 'la actividad'}”.`);
      }
      const saved = await apiPost<SequencePlan>('curriculum-sequence', { ...sequenceDraft, reviewed });
      setSequenceDraft(saved); setPeriodAssignmentsDirty(false); setSequenceMode(reviewed?'summary':'review'); setSequenceNotice(reason === 'indicators' ? 'Catálogo de indicadores guardado sin asignarlos a evaluaciones.' : reviewed ? wasReviewed ? 'Distribución y período de planificación guardados.' : 'Revisión guardada. Activa un período para distribuir la secuencia.' : 'Borrador de secuencia guardado.'); if(reviewed&&!wasReviewed&&reason!=='indicators')onSection('all'); onChange(); return true;
    } catch (error) { setSequenceError(errorText(error)); return false; } finally { setSequenceBusy(false); }
  }
  function addSequenceActivity() {
    setSequenceDraft(current => ({ ...current, reviewed: false, activities: [...current.activities, { id: newId(), code: '', theme: '', title: '', lessonType: null, description: '', evidence: '', indicatorIds: [], period: '' }] }));
  }
  function updateSequenceActivity(id: string, patch: Partial<SequenceActivity>) {
    setSequenceDraft(current => ({ ...current, reviewed: false, activities: current.activities.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }
  function activatePlanningPeriod(period: string) {
    setSequenceDraft(current => ({ ...current, activePlanningPeriod: period as 'P1'|'P2'|'P3'|'P4' }));
    setPeriodAssignmentsDirty(true);
  }
  function addIndicator() {
    setSequenceDraft(current => ({ ...current, indicators: [...current.indicators, { id: newId(), code: '', label: '', competency: 'logico_matematica' }] }));
  }
  function updateIndicator(id: string, patch: Partial<SequenceIndicator>) {
    setSequenceDraft(current => ({ ...current, indicators: current.indicators.map(item => item.id === id ? { ...item, ...patch } : item) }));
  }
  async function saveCriterion(event: React.FormEvent) {
    event.preventDefault(); setCriterionBusy(true); setCriterionError('');
    try {
      const saved = await apiPost<EvaluationCriterion>('criterion', { ...(criterionId ? { id: criterionId } : {}), label: criterionLabel, levels: criterionLevels });
      setCriteria(current => [...current.filter(item => item.id !== saved.id), saved].sort((a,b) => a.label.localeCompare(b.label)));
      setCriterionId(''); setCriterionLabel(''); setCriterionLevels(LEVELS.map(item => ({ ...item }))); setShowCriterionForm(false); setCriteriaLoaded(true); onChange();
    } catch (error) { setCriterionError(errorText(error)); } finally { setCriterionBusy(false); }
  }
  async function importCriteria(items: ImportedRubricCriterion[]) {
    const result = await apiPost<{criteria:EvaluationCriterion[];imported:number;unchanged:number}>('criteria-import', { criteria: items });
    setCriteria(result.criteria.filter(item=>item.active).sort((a,b)=>a.label.localeCompare(b.label)));
    setCriteriaLoaded(true);
    return { imported: result.imported, unchanged: result.unchanged };
  }
  async function archiveCriterion(id: string) {
    if (!window.confirm('¿Retirar este criterio del catálogo? Las actividades ya guardadas conservan su copia.')) return;
    setCriterionBusy(true); setCriterionError('');
    try { await apiPost('archive-criterion', { id }); setCriteria(current => current.filter(item => item.id !== id)); onChange(); }
    catch (error) { setCriterionError(errorText(error)); } finally { setCriterionBusy(false); }
  }

  // The teacher must choose a sequence workflow or explicitly switch to manual capture before periods open.
  const canOpenPeriods = sequenceDraft.reviewed || sequenceDraft.planningMode === 'manual';
  const canCreateInActivePeriod = Boolean(periodPlan && plan.period === period);
  const visibleSection: Section = section;
  // Evaluation periods can differ from the sequence's planned periods when a topic runs late.
  const periodSequenceActivities = sequenceDraft.activities;
  return <>
    <div className="section-heading"><div><p className="eyebrow">{visibleSection === 'sequence' ? 'ACTIVIDADES · ORIGEN Y REVISIÓN' : visibleSection === 'criteria' ? 'ACTIVIDADES · PLANTILLAS OPCIONALES' : visibleSection === 'indicators' ? 'ACTIVIDADES · CATÁLOGO DE INDICADORES' : 'EVALUACIÓN · PERÍODOS P1–P4'}</p><h1>{visibleSection === 'sequence' ? 'Secuencia y revisión' : visibleSection === 'criteria' ? 'Plantillas de criterios' : visibleSection === 'indicators' ? 'Indicadores de logro' : 'Períodos'}</h1><p className="muted">{visibleSection === 'sequence' ? 'En esta revisión solo corriges el nombre y qué se trabajará en cada actividad. Los indicadores y la distribución por período van aparte.' : visibleSection === 'criteria' ? 'Las plantillas son opcionales. Puedes crear y editar criterios directamente al preparar una actividad por competencias.' : visibleSection === 'indicators' ? 'Guarda aquí los indicadores extraídos de la secuencia. Se vinculan a una evaluación cuando tú prepares esa actividad.' : 'Califica de forma sencilla sobre 100 puntos. Si lo necesitas, divide la nota en partes o conserva la evaluación por actividades.'}</p></div>{visibleSection === 'all' ? <div className="activity-preparation-actions"><button type="button" className="button secondary" onClick={() => onSection('sequence')}><FileText size={16}/>Revisar secuencia</button><button className="button primary" disabled={!canCreateInActivePeriod} title={!periodPlan ? `Configura ${period} antes de crear actividades` : plan.period !== period ? 'Activa el período de captura elegido antes de guardar' : undefined} onClick={() => { resetActivity(); setShowActivity(true); }}><Plus size={17}/> Crear actividad</button></div> : canOpenPeriods || visibleSection === 'criteria' || visibleSection === 'indicators' ? <button type="button" className="button secondary" onClick={() => onSection('all')}>Ir a períodos</button> : null}</div>
    {visibleSection==='all'&&<PeriodEvaluationPanel courses={courses} period={period} onPeriod={onPeriod}/>}
    {visibleSection!=='all'&&<ol className="activity-sequence-steps" aria-label="Flujo de actividades"><li className={visibleSection==='sequence'&&sequenceMode==='start'?'current':canOpenPeriods?'complete':''}><span>1</span><strong>Origen</strong><small>Subir o manual</small></li><li className={visibleSection==='sequence'&&sequenceMode==='review'?'current':sequenceDraft.reviewed?'complete':sequenceDraft.planningMode==='manual'?'skipped':''}><span>2</span><strong>Revisión</strong><small>Contenido e indicadores</small></li><li className=""><span>3</span><strong>Períodos</strong><small>P1–P4 en una vista</small></li></ol>}
    {visibleSection === 'all' && canOpenPeriods && <section className="panel activity-preparation-card"><div className="activity-preparation-copy"><p className="eyebrow">{sequenceDraft.planningMode === 'manual' ? 'MODO MANUAL' : 'SECUENCIA CONFIRMADA'}</p><h2>{sequenceDraft.planningMode === 'manual' ? 'Actividades sin secuencia' : `${sequenceDraft.activities.length} elementos revisados`}</h2><p className="muted">{sequenceDraft.planningMode === 'manual' ? 'Crea la actividad y elige si evaluarás con puntos directos o por competencias. Los criterios y sus puntos se preparan en esa misma valoración.' : 'La secuencia está lista para distribuir. Si haces cambios, vuelve a revisar antes de usarla en una actividad.'}</p></div><div className="activity-preparation-actions"><button type="button" className="text-button" onClick={() => onSection('criteria')}>Plantillas opcionales</button></div></section>}
    {visibleSection === 'sequence' && <>
      {!sequenceDraft.reviewed && <div className="notice">Primero eliges una secuencia didáctica o la preparas manualmente. La revisión conserva solo el nombre y el contenido previsto; después decides en qué período ubicar cada actividad.</div>}
      <SequenceSection draft={sequenceDraft} mode={sequenceMode} setMode={setSequenceMode} busy={sequenceBusy} fileBusy={fileBusy} error={sequenceError} notice={sequenceNotice} allowManualOnly={!curriculumSequence||curriculumSequence.planningMode==='manual'&&!curriculumSequence.activities.length&&!curriculumSequence.indicators.length} onImport={importSequence} onCreateManual={startManualSequence} onContinueWithoutSequence={continueWithoutSequence} onAddActivity={addSequenceActivity} onUpdateActivity={updateSequenceActivity} onRemoveActivity={id => setSequenceDraft(current => ({ ...current, reviewed:false, activities:current.activities.filter(item => item.id !== id) }))} onSave={saveSequence}/>
    </>}
    {visibleSection === 'criteria' && <CriteriaSection criteria={criteria} loaded={criteriaLoaded} showForm={showCriterionForm} setShowForm={setShowCriterionForm} id={criterionId} setId={setCriterionId} label={criterionLabel} setLabel={setCriterionLabel} levels={criterionLevels} setLevels={setCriterionLevels} busy={criterionBusy} error={criterionError} onSave={saveCriterion} onImport={importCriteria} onEdit={item => { setCriterionId(item.id); setCriterionLabel(item.label); setCriterionLevels(item.levels.map(level => ({ ...level, description:level.description??'' }))); setShowCriterionForm(true); }} onArchive={archiveCriterion}/>}
    {visibleSection === 'indicators' && <IndicatorsSection indicators={sequenceDraft.indicators} usage={indicatorUsage.data??[]} usageLoading={indicatorUsage.loading} usageError={indicatorUsage.error} busy={sequenceBusy} error={sequenceError} notice={sequenceNotice} onAdd={addIndicator} onUpdate={updateIndicator} onRemove={id => setSequenceDraft(current => ({ ...current, indicators:current.indicators.filter(item => item.id !== id), activities:current.activities.map(item => ({ ...item, indicatorIds:item.indicatorIds.filter(value => value !== id) })) }))} onSave={() => saveSequence(sequenceDraft.reviewed, 'indicators')}/>}
    {visibleSection === 'all' && canOpenPeriods && <>
      {!sequenceDraft.reviewed && <div className="notice">No hay una secuencia confirmada. Puedes crear actividades manuales ahora; si luego revisas una secuencia, podrás vincular otras actividades a sus indicadores.</div>}
      {sequenceDraft.reviewed && <>
        {sequenceDraft.indicators.some(indicator=>!indicator.competency)&&<div className="notice warning" role="status">Hay indicadores sin competencia asignada. Puedes distribuir el resto de la secuencia, pero no los vincules a actividades ni los uses para calificar hasta revisarlos.</div>}
        <div className="period-workspace-heading"><div><p className="eyebrow">PLANIFICACIÓN DEL CONTENIDO</p><h2>Elige el período para abrir su lista</h2></div><span>{sequenceDraft.activePlanningPeriod?`${sequenceDraft.activities.filter(item=>assignedPeriods(sequenceDraft,item).includes(sequenceDraft.activePlanningPeriod!)).length} actividades en ${sequenceDraft.activePlanningPeriod}`:'Selecciona P1–P4'}</span></div>
        {sequenceDraft.activities.length>0&&<section className="panel period-allocation-panel"><div className="table-toolbar"><div><h3>Actividades de la secuencia</h3><p className="muted">Selecciona un período y asígnale actividades desde una lista. Una actividad ya usada no se mueve: puedes decidir si la vuelves a evaluar en otro período.</p></div><div className="toolbar"><button type="button" className="button secondary" disabled={!sequenceDraft.activePlanningPeriod} onClick={()=>setAssignmentPickerOpen(true)}><ClipboardList size={15}/>Elegir actividades{sequenceDraft.activePlanningPeriod?` para ${sequenceDraft.activePlanningPeriod}`:''}</button><button type="button" className="button secondary" disabled={!periodAssignmentsDirty||sequenceBusy} onClick={()=>void saveSequence(true)}>{sequenceBusy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Guardar cambios</button></div></div>
          <div className="planning-period-selector" aria-label="Seleccionar período de la lista">{(['P1','P2','P3','P4'] as const).map(value=>{const count=sequenceDraft.activities.filter(item=>assignedPeriods(sequenceDraft,item).includes(value)).length;return <button type="button" key={value} className={sequenceDraft.activePlanningPeriod===value?'active':''} aria-pressed={sequenceDraft.activePlanningPeriod===value} onClick={()=>activatePlanningPeriod(value)}><strong>{value}</strong><span>{sequenceDraft.activePlanningPeriod===value?'Lista seleccionada':'Abrir lista'}</span><small>{count} actividades asignadas</small></button>;})}</div>
          {sequenceDraft.activePlanningPeriod&&<div className="period-assigned-summary"><strong>Lista de {sequenceDraft.activePlanningPeriod}</strong>{sequenceDraft.activities.filter(item=>assignedPeriods(sequenceDraft,item).includes(sequenceDraft.activePlanningPeriod!)).map(item=><span key={item.id}><b>{item.code||'Sin código'}</b> {item.title}</span>)}{!sequenceDraft.activities.some(item=>assignedPeriods(sequenceDraft,item).includes(sequenceDraft.activePlanningPeriod!))&&<p className="muted">Todavía no hay actividades en esta lista. Usa «Elegir actividades» para agregarlas.</p>}</div>}
          {sequenceError&&<div className="notice warning" role="alert">{sequenceError}</div>}{sequenceNotice&&!periodAssignmentsDirty&&<div className="notice success">{sequenceNotice}</div>}</section>}
        {assignmentPickerOpen&&sequenceDraft.activePlanningPeriod&&<SequenceAssignmentPicker sequence={sequenceDraft} period={sequenceDraft.activePlanningPeriod} activities={activities} busy={sequenceBusy} onClose={()=>setAssignmentPickerOpen(false)} onToggle={changePeriodAssignment} onSave={()=>saveSequence(true)}/>}
      </>}
      <PeriodNav period={period} plans={plans} onPeriod={onPeriod}/>
      {plan.period !== period && <div className="notice">Estás consultando {period}; actívalo antes de guardar cambios.</div>}
      {periodPlan ? <ActivityList activities={selectedActivities} courseActivities={activities.filter(item=>item.period===period)} evaluationHistory={activities} plannedActivities={pendingSequenceActivities} sequence={sequenceDraft} courses={courses} plan={periodPlan} criteria={criteria} sequenceReviewed={sequenceDraft.reviewed} onReviewSequence={() => onSection('sequence')} onConfigure={setShowEvaluation} onGrade={onGrade} onCreate={() => { if (!canCreateInActivePeriod) return; resetActivity(); setShowActivity(true); }} onPrepareSequence={prepareSequenceEvaluation} onLoadCriteria={() => { if(!criteriaLoaded){void fetch('/api/registro?action=bootstrap',{cache:'no-store'}).then(response=>response.json()).then(body=>{setCriteria(body.data?.criteriaCatalog??[]);setCriteriaLoaded(true);});}}}/> : <section className="panel empty-state"><h2>Prepara {period}</h2><p>Define sus fechas y distribución de puntos para llevar el registro de sus actividades.</p><button className="button primary" onClick={() => onConfigure(period)}><Settings2 size={16}/> Configurar {period}</button></section>}
    </>}
    {showActivity && periodPlan && <ActivityDrawer period={period} plan={periodPlan} sequence={{...sequenceDraft,activities:periodSequenceActivities}} date={activityDate} setDate={setActivityDate} evidence={activityEvidence} setEvidence={setActivityEvidence} title={title} setTitle={setTitle} code={activityCode} setCode={selectSequenceCode} category={category} setCategory={setCategory} max={maxPoints} setMax={setMaxPoints} scoringMode={activityScoringMode} setScoringMode={setActivityScoringMode} busy={activityBusy} error={activityError} onClose={() => setShowActivity(false)} onSubmit={createActivity}/>}
     {showEvaluation && <EvaluationDrawer key={showEvaluation.id+showEvaluation.revision} activity={showEvaluation} sequence={sequenceDraft} criteria={criteria} busy={activityBusy} setBusy={setActivityBusy} error={activityError} setError={setActivityError} onClose={() => {setShowEvaluation(null);onChange();}} onSaved={() => { setShowEvaluation(null); onSection('all'); onChange(); }}/>}
  </>;
}

function PeriodNav({period,plans,onPeriod}:{period:string;plans:EvaluationPlan[];onPeriod:(period:string)=>void}){
  return <div className="period-tabs" role="tablist" aria-label="Período de actividades">{['P1','P2','P3','P4'].map(item=><button type="button" role="tab" aria-selected={period===item} className={period===item?'selected':''} key={item} onClick={()=>onPeriod(item)}><strong>{item}</strong><small>{plans.some(saved=>saved.period===item)?'Plan guardado':'Configurar'}</small></button>)}</div>;
}

function SequenceAssignmentPicker({sequence,period,activities,busy,onClose,onToggle,onSave}:{sequence:SequencePlan;period:string;activities:Activity[];busy:boolean;onClose:()=>void;onToggle:(item:SequenceActivity,include:boolean)=>void;onSave:()=>Promise<boolean>}){
  async function save(){if(await onSave())onClose();}
  return <div className="modal-backdrop" onClick={()=>!busy&&onClose()}><section className="drawer sequence-assignment-picker" role="dialog" aria-modal="true" aria-labelledby="sequence-assignment-title" onClick={event=>event.stopPropagation()}>
    <div className="drawer-heading"><div><p className="eyebrow">SECUENCIA · LISTA DE {period}</p><h2 id="sequence-assignment-title">Elige las actividades</h2><p className="muted">Las actividades se agregan a esta lista sin quitarlas de otros períodos. Si ya se calificó una, te preguntaremos antes de repetirla.</p></div><button type="button" aria-label="Cerrar" disabled={busy} className="icon-button" onClick={onClose}><X/></button></div>
    <div className="sequence-assignment-list">{sequence.activities.map(item=>{
      const periods=assignedPeriods(sequence,item);
      const evaluated=sequenceEvaluationPeriods(item,activities);
      const included=periods.includes(period)||evaluated.includes(period);
      const evaluatedHere=evaluated.includes(period);
      const criterionCount=item.assessmentInstrument?.criteria.length??item.evaluationCriteria?.length??0;
      const buttonLabel=evaluatedHere?`Ya evaluada en ${period}`:periods.includes(period)?`Quitar de ${period}`:evaluated.length?`Volver a evaluar en ${period}`:`Agregar a ${period}`;
      return <article className="sequence-assignment-option" key={item.id}>
        <div><div className="toolbar"><span className="pill">{item.code||'Sin código'}</span>{evaluated.length>0&&<span className="pill provisional">Evaluada: {evaluated.join(', ')}</span>}</div><strong>{item.title}</strong><p>{item.description||item.theme||'Sin descripción de contenido.'}</p><small>{item.indicatorIds.length} indicadores · {criterionCount} criterios fuente{item.plannedPoints?` · ${item.plannedPoints} puntos previstos`:''}</small>{periods.length>0&&<small>En las listas: {periods.join(', ')}</small>}</div>
        <button type="button" className={included?'button secondary':'button primary'} disabled={busy||evaluatedHere||isUnscoredDiagnostic(item)} aria-pressed={included} onClick={()=>onToggle(item,!periods.includes(period))}>{isUnscoredDiagnostic(item)?'Diagnóstica · sin nota':buttonLabel}</button>
      </article>;
    })}</div>
    <div className="sequence-save-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="button primary" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle className="spin" size={16}/>:<Save size={16}/>} Guardar lista de {period}</button></div>
  </section></div>;
}

function SequenceSection({draft,mode,setMode,busy,fileBusy,error,notice,allowManualOnly,onImport,onCreateManual,onContinueWithoutSequence,onAddActivity,onUpdateActivity,onRemoveActivity,onSave}: {
  draft:SequencePlan; mode:'start'|'review'|'summary'; setMode:(mode:'start'|'review'|'summary')=>void; busy:boolean; fileBusy:boolean; error:string; notice:string; allowManualOnly:boolean;
 onImport:(file?:File)=>void; onCreateManual:()=>void; onContinueWithoutSequence:()=>void; onAddActivity:()=>void; onUpdateActivity:(id:string,patch:Partial<SequenceActivity>)=>void; onRemoveActivity:(id:string)=>void; onSave:(reviewed:boolean)=>void;
}){
  return <section className="panel sequence-workspace">
    <div className="table-toolbar"><div><h2>Contenido de la secuencia</h2><p className="muted">Carga una fuente o crea la estructura a mano. La revisión guarda el nombre y qué se trabajará.</p></div><span className={'pill '+(draft.reviewed?'':'provisional')}>{draft.planningMode==='manual'?'Modo manual':draft.reviewed?'Revisada':'Borrador'}</span></div>
    {mode==='summary' ? <section className="sequence-saved-summary"><div className="metrics compact"><div className="metric"><span>Actividades guardadas</span><strong>{draft.activities.length}</strong></div><div className="metric"><span>Indicadores cargados</span><strong>{draft.indicators.length}</strong></div><div className="metric"><span>Actividades asignadas a períodos</span><strong>{draft.activities.filter(item=>Boolean(item.period)).length}</strong></div></div><div className="table-toolbar"><div><h3>Secuencia revisada</h3><p className="muted">{draft.planningMode==='manual'?'Modo manual':'Fuente: '+(draft.sourceName||'entrada manual')} · {draft.reviewed?'confirmada':'borrador'}</p></div><button type="button" className="button secondary" onClick={()=>setMode('review')}><Settings2 size={15}/> Administrar secuencia</button></div><div className="sequence-saved-activities">{draft.activities.map((item,index)=><article className="sequence-activity-card" key={item.id}><div className="sequence-activity-heading"><strong>{item.code||`Actividad ${index+1}`} · {item.title}</strong><span className="pill">{item.period||'Sin período'}</span></div><p>{item.description||item.theme||'Contenido pendiente'}</p></article>)}</div>{!draft.activities.length&&<p className="muted">Aún no hay actividades en la secuencia.</p>}</section> : mode==='start' ? <div className="sequence-source-grid">
      <article className="panel"><FileText/><h3>Subir secuencia</h3><p>Extrae texto de PDF, Word o TXT y propone títulos numerados cuando los reconoce. Revisarás el nombre y el contenido de cada actividad.</p><label className="button secondary"><Upload size={16}/>{fileBusy?'Leyendo archivo…':'Elegir PDF, DOCX o TXT'}<input type="file" hidden accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" disabled={fileBusy} onChange={event=>onImport(event.currentTarget.files?.[0])}/></label><small>Los PDF escaneados como imagen necesitan completar la ficha manualmente.</small></article>
      <article className="panel"><BookOpenCheck/><h3>Crear secuencia manual</h3><p>Registra el nombre y el contenido de las actividades. Luego distribúyelas entre los períodos.</p><button className="button secondary" onClick={onCreateManual}>Empezar en blanco</button></article>
      {allowManualOnly&&<article className="panel manual-only-choice"><ClipboardList/><h3>Trabajar sin secuencia</h3><p>Ve directamente a los períodos. Crearás las actividades por separado y definirás indicadores al preparar cada evaluación.</p><button className="button secondary" disabled={busy} onClick={onContinueWithoutSequence}>{busy?<LoaderCircle className="spin" size={15}/>:<ArrowRight size={15}/>}Continuar manualmente</button></article>}
    </div> : <>
      <div className="sequence-import-meta"><span><strong>Origen:</strong> {draft.source==='uploaded'?'Archivo cargado':'Entrada manual'}</span>{draft.sourceName&&<span><strong>Archivo:</strong> {draft.sourceName}</span>}<span><strong>{draft.activities.length}</strong> actividades detectadas</span><button type="button" className="text-button" onClick={()=>setMode('start')}>Cambiar origen</button></div>
      {draft.sourceText&&<details className="sequence-text"><summary>Ver el texto extraído para consultar</summary><pre>{draft.sourceText}</pre></details>}
      <div className="table-toolbar"><div><h3>Actividades de la secuencia</h3><p className="muted">Los indicadores, el tipo y la evidencia se gestionan después, en apartados distintos.</p></div><button type="button" className="button secondary" onClick={onAddActivity}><Plus size={14}/> Añadir actividad</button></div>
      {draft.activities.map((item,index)=><article className="sequence-activity-card" key={item.id}>
        <div className="sequence-activity-heading"><strong>Actividad {index+1}</strong><button type="button" className="text-button" onClick={()=>onRemoveActivity(item.id)}>Quitar</button></div>
        <div className="form-grid"><label className="sequence-title-field">Nombre de la actividad<input required maxLength={250} value={item.title} onChange={event=>onUpdateActivity(item.id,{title:event.target.value})} placeholder="Ej.: Suma de vectores"/></label><label className="sequence-source-wide">Qué se trabajará<textarea required rows={3} maxLength={4000} value={item.description||item.theme} onChange={event=>onUpdateActivity(item.id,{description:event.target.value,theme:''})} placeholder="Contenido, explicación, ejercicios o tema previsto"/></label></div>
      </article>)}
      {!draft.activities.length&&<div className="empty-state compact">No se detectaron actividades todavía. Añádelas aquí o revisa el texto importado.</div>}
      {error&&<div className="notice warning" role="alert">{error}</div>}{notice&&<div className="notice success">{notice}</div>}
      <div className="sequence-save-actions"><button className="button secondary" disabled={busy} onClick={()=>onSave(false)}><Save size={15}/> Guardar borrador</button><button className="button primary" disabled={busy||!draft.activities.length} onClick={()=>onSave(true)}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} Confirmar revisión</button></div>
    </>}
    {mode==='start'&&(error||notice)&&<div className={error?'notice warning':'notice success'}>{error||notice}</div>}
  </section>;
}

function IndicatorsSection({indicators,usage,usageLoading,usageError,busy,error,notice,onAdd,onUpdate,onRemove,onSave}:{indicators:SequenceIndicator[];usage:IndicatorUsageRecord[];usageLoading:boolean;usageError:string;busy:boolean;error:string;notice:string;onAdd:()=>void;onUpdate:(id:string,patch:Partial<SequenceIndicator>)=>void;onRemove:(id:string)=>void;onSave:()=>Promise<boolean>}){
  const [editing,setEditing]=useState(indicators.length===0);
  const [dirty,setDirty]=useState(false);
  useEffect(()=>{if(dirty||usageLoading)return;if(indicators.length)setEditing(false);else setEditing(usage.length===0);},[dirty,indicators.length,usage.length,usageLoading]);
  const summaries=useMemo(()=>{
    type Assignment={key:string;title:string;period:string;maxPoints:number;points:number;courses:Map<string,IndicatorUsageRecord>};
    type Summary={indicator:SequenceIndicator;inCatalog:boolean;assignments:Map<string,Assignment>};
    const result=new Map<string,Summary>();
    for(const indicator of indicators)result.set(indicator.id,{indicator,inCatalog:true,assignments:new Map()});
    for(const item of usage){
      let summary=result.get(item.indicatorId);
      if(!summary){summary={indicator:{id:item.indicatorId,code:item.code,label:item.label,competency:item.competency},inCatalog:false,assignments:new Map()};result.set(item.indicatorId,summary);}
      let assignment=summary.assignments.get(item.assignmentId);
      if(!assignment){assignment={key:item.assignmentId,title:item.title,period:item.period,maxPoints:item.maxPoints,points:item.points,courses:new Map()};summary.assignments.set(item.assignmentId,assignment);}
      assignment.courses.set(item.courseId,item);
    }
    return [...result.values()].sort((a,b)=>Number(b.assignments.size>0)-Number(a.assignments.size>0)||a.indicator.code.localeCompare(b.indicator.code)||a.indicator.label.localeCompare(b.indicator.label));
  },[indicators,usage]);
  const configuredEvaluations=new Set(usage.map(item=>item.assignmentId)).size;
  const linkedIndicators=summaries.filter(item=>item.inCatalog&&item.assignments.size>0).length;
  async function save(){if(await onSave()){setDirty(false);setEditing(false);}}
  function add(){setEditing(true);setDirty(true);onAdd();}
  const totalStudentsGraded=(summary:typeof summaries[number])=>[...summary.assignments.values()].flatMap(item=>[...item.courses.values()]).reduce((sum,item)=>sum+item.gradedStudents,0);
  const coursesWithGrades=(summary:typeof summaries[number])=>new Set([...summary.assignments.values()].flatMap(item=>[...item.courses.values()].filter(row=>row.gradedStudents>0).map(row=>row.courseId))).size;
  return <>
    {editing?<section className="panel sequence-workspace"><div className="table-toolbar"><div><h2>Configurar indicadores</h2><p className="muted">Confirma el código, el indicador y su competencia. Los puntos se asignan después, cuando lo vincules a una actividad.</p></div><div className="toolbar">{(indicators.length>0||usage.length>0)&&<button type="button" className="button secondary" disabled={dirty} title={dirty?'Guarda los cambios antes de consultar las estadísticas.':undefined} onClick={()=>setEditing(false)}>Ver estadísticas</button>}<button type="button" className="button secondary" onClick={add}><Plus size={15}/> Añadir indicador</button></div></div>
      {dirty&&<div className="notice warning">Hay cambios del catálogo sin guardar; las estadísticas muestran los datos guardados anteriormente.</div>}
      {indicators.map((indicator,index)=><div className="sequence-indicator-row" key={indicator.id}><label><small>Código</small><input maxLength={80} value={indicator.code} onChange={event=>{setDirty(true);onUpdate(indicator.id,{code:event.target.value});}} placeholder={`I${index+1}`}/></label><label><small>Indicador de logro</small><input maxLength={500} value={indicator.label} onChange={event=>{setDirty(true);onUpdate(indicator.id,{label:event.target.value});}} placeholder="Describe el logro observable"/></label><label><small>Competencia</small><select value={indicator.competency??''} onChange={event=>{setDirty(true);onUpdate(indicator.id,{competency:event.target.value?event.target.value as CompetencyKey:null});}}><option value="">Sin asignar</option>{COMPETENCY_GROUPS.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}</select></label><button type="button" className="icon-button" aria-label={`Quitar indicador ${indicator.code||index+1}`} onClick={()=>{setDirty(true);onRemove(indicator.id);}}><Trash2 size={15}/></button></div>)}
      {!indicators.length&&<div className="empty-state compact"><h3>No hay indicadores cargados</h3><p>Al importar una secuencia se guardarán aquí cuando el documento los incluya. También puedes agregarlos manualmente.</p></div>}
      {indicators.some(item=>!item.competency)&&<div className="notice warning" role="status">Hay indicadores pendientes de asociar con una competencia. Completa esa relación antes de usarlos para calificar.</div>}
      {error&&<div className="notice warning" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}
      <div className="sequence-save-actions"><button type="button" className="button primary" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Guardar catálogo</button></div>
    </section>:<>
      <section className="metrics compact indicator-usage-metrics"><div className="metric"><span>Indicadores confirmados</span><strong>{indicators.length}</strong></div><div className="metric"><span>Asignados a evaluaciones</span><strong>{linkedIndicators}</strong></div><div className="metric"><span>Evaluaciones configuradas</span><strong>{configuredEvaluations}</strong></div><div className="metric"><span>Sin asignación</span><strong>{Math.max(0,indicators.length-linkedIndicators)}</strong></div></section>
      {dirty&&<div className="notice warning">Hay cambios del catálogo sin guardar; esta vista conserva las estadísticas de las asignaciones guardadas.</div>}
      <section className="panel indicator-usage-panel"><div className="table-toolbar"><div><h2>Uso por indicador</h2><p className="muted">El conteo distingue las actividades configuradas de las calificaciones realmente guardadas en cada curso.</p></div><button type="button" className="button secondary" onClick={()=>{setEditing(true);setDirty(false);}}><Settings2 size={15}/> Administrar indicadores</button></div>
        {usageError&&<div className="notice warning" role="alert">No se pudieron cargar las estadísticas: {usageError}</div>}
        {usageLoading?<div className="loading-state"><LoaderCircle className="spin"/> Cargando uso guardado…</div>:<div className="indicator-usage-list">{summaries.map(summary=>{const courseCount=coursesWithGrades(summary);const gradedCount=totalStudentsGraded(summary);const assignments=[...summary.assignments.values()].sort((a,b)=>a.period.localeCompare(b.period)||a.title.localeCompare(b.title));return <article className="indicator-usage-card" key={summary.indicator.id}><div className="indicator-usage-card-heading"><div><div className="toolbar"><span className="pill">{summary.indicator.code||'Sin código'}</span>{!summary.inCatalog&&<span className="pill provisional">Definido dentro de una actividad</span>}</div><h3>{summary.indicator.label}</h3><p>{COMPETENCY_GROUPS.find(group=>group.key===summary.indicator.competency)?.label??'Competencia pendiente'}</p></div><div className="indicator-usage-counts"><span><strong>{summary.assignments.size}</strong> evaluaciones</span><span><strong>{courseCount}</strong> cursos con notas</span><span><strong>{gradedCount}</strong> estudiantes calificados</span></div></div>
          {assignments.length?<details className="indicator-assignment-details"><summary>Ver puntos asignados y captura por curso</summary><div className="table-wrap"><table className="data-table"><thead><tr><th>Período</th><th>Actividad</th><th>Puntos</th><th>Captura de notas</th></tr></thead><tbody>{assignments.map(item=><tr key={item.key}><td>{item.period}</td><td><strong>{item.title}</strong></td><td>{item.points} / {item.maxPoints}</td><td>{[...item.courses.values()].sort((a,b)=>a.courseCode.localeCompare(b.courseCode)).map(row=><small key={row.courseId}>{row.courseCode}: {row.gradedStudents}/{row.studentsInCourse} calificados · {row.studentsWithData} con algún dato</small>)}</td></tr>)}</tbody></table></div></details>:<p className="muted indicator-unused">Todavía no está asignado a una evaluación.</p>}
        </article>;})}{summaries.length===0&&<div className="empty-state"><h3>El catálogo está vacío</h3><p>Agrega los indicadores de la secuencia para que luego puedan asignarse a las actividades y aparezcan aquí sus resultados de uso.</p><button type="button" className="button primary" onClick={add}><Plus size={15}/> Añadir indicador</button></div>}</div>}
      </section>
    </>}
  </>;
}

function AssessmentSourcePreview({instrument}:{instrument:SourceAssessmentInstrument}){
  const kindLabel={checklist:'Lista de cotejo',rubric:'Rúbrica',scale:'Escala de valoración',exam_guide:'Guía del examen'}[instrument.kind];
  return <details className="source-instrument-preview" data-annex={instrument.annexNumber}>
    <summary>Instrumento fuente · Anexo {instrument.annexNumber} · {kindLabel}{instrument.maxPoints!==null?` · ${instrument.maxPoints} puntos`:instrument.scored?' · evaluación final':' · diagnóstico sin ponderación'}{instrument.relatedIndicatorText?` · Indicador: ${instrument.relatedIndicatorText}`:''}</summary>
    <div className="source-instrument-body">
      <strong>{instrument.title}</strong>
      {instrument.relatedIndicatorText&&<p className="source-related-indicator"><strong>Indicador relacionado en la fuente:</strong> {instrument.relatedIndicatorText}</p>}
      {instrument.relatedCompetencyText&&<p className="source-related-competencies"><strong>Competencias mencionadas en la fuente:</strong> {instrument.relatedCompetencyText}</p>}
      {instrument.scoringNote&&<p className="muted">{instrument.scoringNote}</p>}
      {instrument.criteria.length>0&&<ol>{instrument.criteria.map((criterion,index)=><li key={`${index}-${criterion}`}>{criterion}</li>)}</ol>}
      {instrument.levels.length>0&&<div className="source-instrument-levels" aria-label="Escala extraída del anexo">{instrument.levels.map(level=><div key={`${level.points}-${level.label}`}><strong>{level.label} · {level.points} pt{level.points===1?'':'s'}</strong><span>{level.description}</span></div>)}</div>}
      {!instrument.scored&&<p className="notice">Este anexo es diagnóstico. Registra observaciones; no crea una nota ni se suma al período.</p>}
    </div>
  </details>;
}

function CriteriaSection({criteria,loaded,showForm,setShowForm,id,setId,label,setLabel,levels,setLevels,busy,error,onSave,onImport,onEdit,onArchive}: {
 criteria:EvaluationCriterion[];loaded:boolean;showForm:boolean;setShowForm:(value:boolean)=>void;id:string;setId:(id:string)=>void;label:string;setLabel:(label:string)=>void;levels:LevelDraft[];setLevels:(levels:LevelDraft[])=>void;busy:boolean;error:string;
 onSave:(event:React.FormEvent)=>void;onImport:(items:ImportedRubricCriterion[])=>Promise<{imported:number;unchanged:number}>;onEdit:(item:EvaluationCriterion)=>void;onArchive:(id:string)=>void;
}){
  const [filePreview,setFilePreview]=useState<{name:string;visibility:string;criteria:ImportedRubricCriterion[]}|null>(null);
  const [fileError,setFileError]=useState('');
  const [fileNotice,setFileNotice]=useState('');
  const [fileBusy,setFileBusy]=useState(false);
  const [adminOpen,setAdminOpen]=useState(false);
  const [adminStateInitialized,setAdminStateInitialized]=useState(false);
  useEffect(()=>{if(!loaded||adminStateInitialized)return;setAdminOpen(criteria.length===0);setAdminStateInitialized(true);},[loaded,adminStateInitialized,criteria.length]);
  async function readWorkbook(file?:File){
    setFileError('');setFileNotice('');setFilePreview(null);
    if(!file)return;
    try{
      const parsed=await parseRubricWorkbook(await file.arrayBuffer());
      setFilePreview({name:file.name,visibility:parsed.sheetVisibility,criteria:parsed.criteria});
    }catch(error){setFileError(errorText(error));}
  }
  async function saveWorkbookImport(){
    if(!filePreview)return;
    setFileBusy(true);setFileError('');setFileNotice('');
    try{
      const result=await onImport(filePreview.criteria);
      setFileNotice(`${result.imported} criterios importados; ${result.unchanged} ya estaban iguales en el catálogo.`);
      setFilePreview(null);
    }catch(error){setFileError(errorText(error));}
    finally{setFileBusy(false);}
  }
  return <div className="criteria-workspace"><section className="panel"><div className="table-toolbar"><div><h2>Plantillas reutilizables (opcional)</h2><p className="muted">No necesitas prepararlas antes. Al crear una actividad por competencias puedes escribir sus criterios ahí mismo; estas plantillas solo sirven para copiar una base.</p><p className="criteria-catalog-count">{loaded?`${criteria.length} plantillas guardadas · ${criteria.filter(item=>item.levels.length===4).length} con cuatro niveles completos`:'Cargando plantillas…'}</p></div><button type="button" className="button secondary" aria-expanded={adminOpen} onClick={()=>{if(!adminOpen)setAdminOpen(true);else if(!showForm)setAdminOpen(false);}} disabled={adminOpen&&showForm}><Settings2 size={15}/>{adminOpen?'Administración abierta':'Administrar plantillas'}</button></div>
    {error&&<div className="notice warning" role="alert">{error}</div>}
    {adminOpen&&<div className="criteria-admin-workspace"><section className="panel criteria-import-card"><div className="criteria-import-header"><div><h3>Importar una matriz existente</h3><p className="muted">Lee la hoja «Criterios» de un .xlsx o .xlsm, aunque esté oculta. Primero muestra una vista previa; no importa nombres ni notas de estudiantes.</p></div><label className="button secondary criteria-import-picker"><Upload size={15}/> Elegir libro Excel<input aria-label="Libro de Excel con criterios" type="file" accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12" disabled={fileBusy} onChange={event=>{void readWorkbook(event.currentTarget.files?.[0]);event.currentTarget.value='';}}/></label></div>
      {fileError&&<div className="notice warning" role="alert">{fileError}</div>}{fileNotice&&<div className="notice success" role="status">{fileNotice}</div>}
      {filePreview&&<div className="criteria-import-preview"><div><strong>Vista previa · {filePreview.name}</strong><p className="muted">Hoja «Criterios» · {filePreview.visibility==='visible'?'visible':filePreview.visibility==='veryHidden'?'muy oculta':'oculta'} · {filePreview.criteria.length} criterios</p></div><details><summary>Revisar niveles y descriptores</summary><div className="criteria-import-list">{filePreview.criteria.map(item=><article key={item.label}><strong>{item.label}</strong><div>{item.levels.map(level=><p key={level.label}><b>{level.label} · {level.points}</b> {level.description}</p>)}</div></article>)}</div></details><div className="toolbar"><button className="button secondary" type="button" disabled={fileBusy} onClick={()=>setFilePreview(null)}>Descartar</button><button className="button primary" type="button" disabled={fileBusy} onClick={()=>void saveWorkbookImport()}>{fileBusy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Importar {filePreview.criteria.length} criterios</button></div></div>}
    </section>
    <div className="table-toolbar criteria-admin-actions"><div><h3>Administración del catálogo</h3><p className="muted">Editar los descriptores o retirar criterios que ya no se usarán.</p></div><button type="button" className="button primary" onClick={()=>{setId('');setLabel('');setLevels(LEVELS.map(level=>({...level})));setShowForm(true);}}><Plus size={16}/> Añadir criterio</button></div>
    {showForm&&<form className="panel criterion-catalog-form" onSubmit={onSave}><div className="table-toolbar"><div><h3>{id?'Editar criterio':'Nuevo criterio'}</h3><p className="muted">Los puntos 1–4 son niveles de logro y no el valor bruto de la actividad.</p></div><button type="button" className="icon-button" aria-label="Cerrar formulario" onClick={()=>setShowForm(false)}><X size={17}/></button></div><label>Nombre del criterio<input required maxLength={200} value={label} onChange={event=>setLabel(event.target.value)} placeholder="Ej.: Explica y justifica el procedimiento"/></label><div className="criterion-level-grid">{levels.map((level,index)=><label className={`criterion-level level-${index}`} key={level.label}><span>{level.label} · {level.points} punto{level.points===1?'':'s'}</span><textarea required rows={3} maxLength={1000} value={level.description} onChange={event=>setLevels(levels.map((item,i)=>i===index?{...item,description:event.target.value}:item))} placeholder="Describe la evidencia que corresponde a este nivel"/></label>)}</div><div className="toolbar"><button type="button" className="button secondary" onClick={()=>setShowForm(false)}>Cancelar</button><button className="button primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={15}/>:<Save size={15}/>} Guardar criterio</button></div></form>}
    </div>}
    {criteria.length>0?<div className="criteria-catalog-list">{criteria.map(item=><article className="panel criterion-catalog-card" key={item.id}><div className="table-toolbar"><div><h3>{item.label}</h3><p className="muted">{item.levels.length} niveles de desempeño</p></div>{adminOpen&&<div className="toolbar"><button className="button secondary" onClick={()=>onEdit(item)}>Editar</button><button className="text-button" disabled={busy} onClick={()=>void onArchive(item.id)}>Retirar</button></div>}</div><details className="criterion-level-disclosure"><summary>Ver descriptores de la rúbrica</summary><div className="criterion-catalog-levels">{item.levels.map(level=><div key={level.label}><strong>{level.label} · {level.points}</strong><p>{level.description}</p></div>)}</div></details></article>)}</div>:loaded&&<div className="empty-state"><h3>Sin plantillas</h3><p>Puedes empezar diseñando los criterios dentro de la actividad; guardar una plantilla es opcional.</p></div>}
  </section></div>;
}

function ActivityDrawer({period,plan,sequence,date,setDate,evidence,setEvidence,title,setTitle,code,setCode,category,setCategory,max,setMax,scoringMode,setScoringMode,busy,error,onClose,onSubmit}: {
 period:string;plan:EvaluationPlan;sequence:SequencePlan;date:string;setDate:(value:string)=>void;evidence:string;setEvidence:(value:string)=>void;title:string;setTitle:(value:string)=>void;code:string;setCode:(value:string)=>void;category:ActivityCategoryKey;setCategory:(value:ActivityCategoryKey)=>void;max:number;setMax:(value:number)=>void;scoringMode:'points'|'rubric';setScoringMode:(value:'points'|'rubric')=>void;busy:boolean;error:string;onClose:()=>void;onSubmit:(event:React.FormEvent)=>void;
}){
  const options=plan.categories.map(item=>({key:item.key,label:item.label}));
  const linkedSequence=sequence.activities.find(item=>item.id===code);
  return <div className="modal-backdrop" onClick={()=>!busy&&onClose()}>
    <section className="drawer activity-drawer compact-activity-drawer workflow-fullscreen" role="dialog" aria-modal="true" aria-labelledby="new-activity-title" onClick={event=>event.stopPropagation()}>
      <div className="drawer-heading"><div><p className="eyebrow">ACTIVIDADES · {period}</p><h2 id="new-activity-title">{linkedSequence?'Completar evaluación':'Nueva actividad'}</h2><p className="muted">{linkedSequence?'El nombre y el contenido vienen de la secuencia. Confirma el valor y elige cómo la calificarás.':'Define los datos básicos y el método de calificación. La actividad directa quedará lista al guardarla; la rúbrica se configura después.'}</p></div><button aria-label="Cerrar" disabled={busy} className="icon-button" onClick={onClose}><X/></button></div>
      <form onSubmit={onSubmit}><fieldset disabled={busy} className="bare-fieldset">
        {linkedSequence?<div className="linked-sequence-activity"><span>{linkedSequence.code||'Secuencia'} · Actividad seleccionada</span><strong>{linkedSequence.title}</strong><p>{linkedSequence.description||linkedSequence.theme||'Contenido guardado en la secuencia.'}</p></div>:<label>Nombre de la actividad<input required maxLength={250} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Ej.: Suma de vectores"/></label>}
        <label>Valor en puntos<input aria-label="Máximo de puntos" type="number" min={0.01} max={10000} step={0.01} value={max} required onChange={event=>setMax(Number(event.target.value))}/></label>
         {linkedSequence&&sequenceHasEvaluationCriteria(linkedSequence)&&<div className="notice">La secuencia incluye criterios de evaluación. Se seleccionó <strong>Por competencias</strong>; revisarás sus indicadores y niveles antes de guardar.</div>}
         <fieldset className="grading-choice-fieldset"><legend>¿Cómo calificarás esta actividad?</legend><div className="grading-method-options"><button type="button" className={'grading-method-option'+(scoringMode==='points'?' selected':'')} aria-pressed={scoringMode==='points'} onClick={()=>setScoringMode('points')}><strong>Puntos directos</strong><span>Escribes una nota por estudiante. La actividad queda lista al guardar.</span></button><button type="button" className={'grading-method-option'+(scoringMode==='rubric'?' selected':'')} aria-pressed={scoringMode==='rubric'} onClick={()=>setScoringMode('rubric')}><strong>Por competencias</strong><span>Preparas los indicadores y criterios para elegir niveles al calificar.</span></button></div></fieldset>
        <details className="activity-advanced-options"><summary>Opciones de asignación · fecha, categoría, secuencia y evidencia</summary><div className="activity-advanced-grid">
          <label>Fecha de evaluación<input aria-label="Fecha de evaluación" type="date" value={date} required onChange={event=>setDate(event.target.value)}/><small>La fecha de creación se registra automáticamente.</small></label>
          <label>Categoría de evaluación<select value={category} onChange={event=>setCategory(event.target.value as ActivityCategoryKey)}>{options.map(item=><option key={item.key} value={item.key}>{item.label}</option>)}<option value="extra">Puntos extra</option></select></label>
          {!linkedSequence&&<label>Vínculo con la secuencia<select value={code||'MANUAL'} onChange={event=>setCode(event.target.value)}><option value="MANUAL">Manual · sin vínculo con la secuencia</option>{sequence.reviewed&&sequence.activities.map(item=><option key={item.id} value={item.id} disabled={isUnscoredDiagnostic(item)}>{item.code} · {item.title}{assignedPeriods(sequence,item).length?` · ${assignedPeriods(sequence,item).join(', ')}`:' · sin período'}{isUnscoredDiagnostic(item)?' · diagnóstica, sin nota':''}</option>)}</select><small>{sequence.reviewed?'Al elegir una actividad de la secuencia, su nombre queda bloqueado para evitar duplicarlo.':'La secuencia es opcional; si no está revisada, la actividad se guarda sin vínculo.'}</small></label>}
          <label className="sequence-source-wide">Evidencia o producto esperado<textarea rows={2} maxLength={1000} value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="Define aquí qué entregará o mostrará el estudiante"/></label>
        </div></details>
        <div className="notice">Crear una actividad no registra asistencia ni confirma que la clase se impartió.</div>{error&&<div className="notice warning" role="alert">{error}</div>}
        <button className="button primary wide" disabled={busy}>{busy?<LoaderCircle className="spin" size={16}/>:scoringMode==='points'?<Check size={16}/>:<ArrowRight size={16}/>} {busy?'Guardando…':scoringMode==='points'?'Crear actividad lista para calificar':'Continuar a configurar criterios'}</button>
      </fieldset></form>
    </section>
  </div>;
}

function ActivityList({activities,courseActivities,evaluationHistory,plannedActivities,sequence,courses,plan,criteria,sequenceReviewed,onReviewSequence,onConfigure,onGrade,onCreate,onPrepareSequence,onLoadCriteria}:{activities:Activity[];courseActivities:Activity[];evaluationHistory:Activity[];plannedActivities:SequenceActivity[];sequence:SequencePlan;courses:Bootstrap['courses'];plan:EvaluationPlan;criteria:EvaluationCriterion[];sequenceReviewed:boolean;onReviewSequence:()=>void;onConfigure:(activity:Activity)=>void;onGrade:(activityId:string,courseId:string)=>void;onCreate:()=>void;onPrepareSequence:(item:SequenceActivity)=>void;onLoadCriteria:()=>void}){
  useEffect(onLoadCriteria,[]);
  return <section className="panel">
    <div className="table-toolbar"><div><h2>Actividades del período</h2><p className="muted">Prepara cada actividad una vez. En la captura eliges niveles o escribes puntos directos; ambos resultados pasan al libro del período.</p></div><span className="pill">{activities.length} evaluaciones · {plannedActivities.length} por preparar</span></div>
    <div className="table-wrap"><table className="data-table activity-table">
      <thead><tr><th>Fecha de evaluación / secuencia</th><th>Actividad y categoría</th><th>Valoración</th><th>Indicadores y criterios</th><th>Acciones por curso</th></tr></thead>
      <tbody>{activities.map(activity=>{const evaluationReady=activity.scoringMode==='rubric'?activity.rubric.length>0&&activity.indicatorPoints.length>0:Boolean(activity.instrument.trim()||activity.indicatorPoints.length);return <tr key={activity.id}>
        <td>{formatDate(activity.date)}<small>{activity.createdAt?`Creada ${formatDate(activity.createdAt.slice(0,10))}`:'Creación anterior no registrada'}</small><small>{activity.sequenceCode||'Sin código'}</small>{activity.sequencePlannedPeriod&&<small>Planificada {activity.sequencePlannedPeriod} · evaluada {activity.period}</small>}</td>
        <td><strong>{activity.title}</strong><small>{activityCategoryLabel(activity,plan)}</small><small>{activity.purpose||activity.description||'Sin consigna adicional'}</small></td>
        <td><span className={'pill '+(evaluationReady?'':'provisional')}>{evaluationReady?activity.scoringMode==='rubric'?'Rúbrica lista':'Puntaje directo listo':activity.scoringMode==='rubric'?'Rúbrica pendiente de configurar':activity.rubric.length?'Criterios elegidos · valoración pendiente':'Valoración pendiente'}</span><small>Máximo {activity.maxPoints} puntos</small></td>
        <td>{activity.scoringMode==='points'&&!activity.indicatorPoints.length?<small>Captura directa · máximo {activity.maxPoints}</small>:activity.indicatorPoints.length?activity.indicatorPoints.map(point=><small key={point.indicatorId}>{point.code||'Indicador'} · {point.points} pts · {point.competency.replaceAll('_',' ')}</small>):<small>{activity.scoringMode==='rubric'?'Indicador y criterios pendientes':'Sin reparto de puntos por indicador'}</small>}{activity.rubric.map(item=><small key={item.id}>Criterio · {item.label}</small>)}</td>
        <td><div className="toolbar"><button type="button" className="button secondary" disabled={!sequenceReviewed&&(Boolean(activity.sequenceActivityId)||Boolean(activity.sequenceCode))} title={!sequenceReviewed&&(activity.sequenceActivityId||activity.sequenceCode)?'Revisa la secuencia para configurar los indicadores vinculados':undefined} onClick={()=>onConfigure(activity)}><Settings2 size={14}/>{evaluationReady?'Editar valoración':'Configurar valoración'}</button><div className="course-grade-actions">{courses.map(course=>{const target=courseActivities.find(item=>item.courseId===course.id&&(activity.sharedId?item.sharedId===activity.sharedId:item.id===activity.id));const ready=target&&(target.scoringMode==='rubric'?target.rubric.length>0&&target.indicatorPoints.length>0:Boolean(target.instrument.trim()||target.indicatorPoints.length));return <button className="text-button" type="button" key={course.id} onClick={()=>target&&onGrade(target.id,course.id)} disabled={!ready} title={!target?'Actividad no disponible en este curso':!ready?'Configura cómo se calificará antes de capturar notas':undefined}>Calificar {course.code}</button>;})}</div></div></td>
      </tr>;})}
      {plannedActivities.map(item=>{const periods=sequenceEvaluationPeriods(item,evaluationHistory);const sourceCriteria=item.assessmentInstrument?.criteria??item.evaluationCriteria??[];const linkedIndicators=sequence.indicators.filter(indicator=>item.indicatorIds.includes(indicator.id));const plannedPoints=item.plannedPoints??item.assessmentInstrument?.maxPoints;return <tr className="planned-activity-row" key={`planned:${item.id}`}>
        <td>—<small>{item.code||'Secuencia'}</small><small>Asignada a {plan.period}</small>{periods.length>0&&<small>Ya evaluada en {periods.join(', ')}</small>}</td>
        <td><strong>{item.title}</strong><small>Evaluación pendiente de preparar</small><small>{item.description||item.theme||'Contenido de la secuencia'}</small></td>
        <td><span className="pill provisional">{isUnscoredDiagnostic(item)?'Diagnóstica · sin nota':'Pendiente de valoración'}</span><small>{plannedPoints!==null&&plannedPoints!==undefined?`Valor previsto ${plannedPoints} puntos`:'Define el valor al preparar'}</small></td>
        <td>{linkedIndicators.map(indicator=><small key={indicator.id}>{indicator.code||'Indicador'} · {indicator.label}</small>)}{sourceCriteria.map((label,index)=><small key={`${item.id}:criterion:${index}`}>Criterio fuente · {label}</small>)}{!linkedIndicators.length&&!sourceCriteria.length&&<small>Sin indicadores o criterios extraídos</small>}</td>
        <td>{isUnscoredDiagnostic(item)?<span className="muted">No se convierte en nota</span>:<button type="button" className="button primary" onClick={()=>onPrepareSequence(item)}><Settings2 size={14}/>{periods.length>0?`Volver a evaluar en ${plan.period}`:'Preparar evaluación'}</button>}</td>
      </tr>;})}</tbody>
    </table>{!activities.length&&!plannedActivities.length&&<div className="empty-state"><h2>No hay actividades en este período</h2><p>{sequenceReviewed?'Elige actividades de la secuencia para este período o registra una manualmente.':'Puedes empezar con una actividad manual; la secuencia queda disponible para revisarla cuando la tengas lista.'}</p><button className="button primary" onClick={onCreate}><Plus size={15}/> Crear actividad</button>{!sequenceReviewed&&<button className="button secondary" onClick={onReviewSequence}>Revisar secuencia</button>}</div>}</div>
  </section>;
}

function activityCategoryLabel(activity:Activity,plan:EvaluationPlan){
 const category=plan.categories.find(item=>item.key===activity.category);
 if(!category)return CATEGORY_LABELS[activity.category];
 return category.group?`${category.label} · Se resume en ${category.group}`:category.label;
}

function EvaluationDrawer({activity,sequence,criteria,busy,setBusy,error,setError,onClose,onSaved}:{activity:Activity;sequence:SequencePlan;criteria:EvaluationCriterion[];busy:boolean;setBusy:(value:boolean)=>void;error:string;setError:(value:string)=>void;onClose:()=>void;onSaved:()=>void}){
  const matchingSequence=sequence.activities.find(item=>item.id===activity.sequenceActivityId)??sequence.activities.find(item=>item.code===activity.sequenceCode&&item.period===(activity.sequencePlannedPeriod??activity.period));
  const sourceCriteria=matchingSequence?.assessmentInstrument?.criteria.length?matchingSequence.assessmentInstrument.criteria:matchingSequence?.evaluationCriteria??[];
  const eligible=sequence.indicators.filter(item=>!matchingSequence||matchingSequence.indicatorIds.length===0||matchingSequence.indicatorIds.includes(item.id));
  const sourceInstrument=matchingSequence?.assessmentInstrument;
  const canUseSourceRubric=Boolean(sourceInstrument?.scored&&sourceInstrument.kind!=='checklist'&&sourceInstrument.levels.length>=2&&sourceInstrument.criteria.length>0);
  const criterionPrefix=`activity:${activity.sharedId??activity.id}:`;
  const defaultIndicatorId=eligible.length===1?eligible[0]!.id:'';
  const sourceRubricDraft:SelectedCriterionDraft[]=matchingSequence?sourceCriteria.map((label,index)=>{
    const useSourceScale=Boolean(canUseSourceRubric&&sourceInstrument?.criteria[index]===label);
    const savedTemplate=criteria.find(item=>criterionKey(item.label)===criterionKey(label));
    const id=useSourceScale?`sequence:${matchingSequence.id}:${index+1}`:`${criterionPrefix}sequence-${index+1}`;
    const levels=useSourceScale?standardEvaluationLevels(sourceInstrument!.levels):savedTemplate?savedTemplate.levels.map(level=>({...level,description:level.description??''})):LEVELS.map(level=>({...level,description:''}));
    return {id,label,levels,indicatorId:defaultIndicatorId,weight:1,originLabel:useSourceScale?'Anexo de la secuencia':savedTemplate?'Plantilla de criterios':'Secuencia'};
  }):[];
  const directReady=activity.scoringMode==='points'&&activity.instrument==='Puntaje directo'&&activity.revision===0;
  const modeWasSaved=activity.revision>0||activity.indicatorPoints.length>0||activity.rubric.length>0||directReady;
  const [mode,setMode]=useState<'points'|'rubric'|null>(modeWasSaved?activity.scoringMode:activity.scoringMode==='rubric'?'rubric':null);
  const savedManualIndicators=activity.indicatorPoints.filter(item=>!sequence.indicators.some(indicator=>indicator.id===item.indicatorId));
  const usesManualIndicators=!sequence.reviewed||savedManualIndicators.length>0||eligible.length===0;
  const [manualIndicators,setManualIndicators]=useState<SequenceIndicator[]>(()=>savedManualIndicators.length?savedManualIndicators.map(item=>({id:item.indicatorId,code:item.code,label:item.label,competency:item.competency})): [{id:`manual:${activity.id}`,code:'',label:activity.indicator||activity.title,competency:activity.competency??'logico_matematica'}]);
  const availableIndicators=usesManualIndicators?manualIndicators:eligible;
  const [selectedCriteria,setSelectedCriteria]=useState<SelectedCriterionDraft[]>(()=>{const saved=activity.rubric.map((item,index)=>{const legacySource=item.id.match(/^sequence:[^:]+:(\d+)$/);const localSuffix=item.id.startsWith(`${criterionPrefix}sequence-`)?item.id.slice(`${criterionPrefix}sequence-`.length):'';const localSequence=/^\d+$/.test(localSuffix)?localSuffix:undefined;const sequenceIndex=legacySource?.[1]??localSequence;const id=item.id.startsWith('sequence:')?item.id:item.id.startsWith(criterionPrefix)?item.id:sequenceIndex?`${criterionPrefix}sequence-${sequenceIndex}`:`${criterionPrefix}saved-${index+1}`;const levels=item.levels.map(level=>({...level,description:level.description??''}));return {id,label:item.label,levels,indicatorId:item.indicatorId??(availableIndicators.length===1?availableIndicators[0]!.id:''),weight:item.weight??1,...(sequenceIndex?{originLabel:'Secuencia'}:{})};});let initial=saved.length?saved:sourceRubricDraft;if(!initial.length&&mode==='rubric'){const id=`${criterionPrefix}criterion:${newId()}`;initial=[{id,label:'',levels:LEVELS.map(level=>({...level})),indicatorId:availableIndicators.length===1?availableIndicators[0]!.id:'',weight:1,originLabel:'Nuevo'}];}return distributeCriterionValues(initial,activity.maxPoints);});
  const activeCriteria=selectedCriteria;
  const criterionItems=criteria;
  const instrument=activity.instrument||matchingSequence?.instrument||sourceInstrument?.title||'';
  const selectedIndicators=availableIndicators.filter(indicator=>activeCriteria.some(item=>item.indicatorId===indicator.id));
  const criteriaValueTotal=activeCriteria.reduce((sum,item)=>sum+criterionMaximumPoints(item),0);
  const canAddCriterion=activeCriteria.length<30&&Math.round(activity.maxPoints*100)>=activeCriteria.length+1;
  const allocations=mode==='rubric'?allocateRubricPoints(activeCriteria,selectedIndicators,activity.maxPoints):[];
  const total=allocations.reduce((sum,item)=>sum+(Number(item.points)||0),0);
  const rubricScales=new Set(activeCriteria.map(item=>JSON.stringify(item.levels.map(level=>[level.label,level.points]))));
  const rubricScaleLabel=activeCriteria.length===0?'Agrega criterios':rubricScales.size===1?activeCriteria[0]!.levels.map(level=>`${level.label} ${level.points}`).join(' · '):'Escala por criterio';
  function addManualIndicator(){const indicator:SequenceIndicator={id:`manual:${newId()}`,code:`I${manualIndicators.length+1}`,label:'',competency:activity.competency??'logico_matematica'};setManualIndicators(current=>[...current,indicator]);}
  function addCriterion(){setSelectedCriteria(current=>equalCriterionValues([...current,{id:`${criterionPrefix}criterion:${newId()}`,label:'',levels:LEVELS.map(level=>({...level})),indicatorId:availableIndicators.length===1?availableIndicators[0]!.id:'',weight:1,originLabel:'Nuevo'}],activity.maxPoints));}
  function chooseMode(next:'points'|'rubric'){setMode(next);if(next==='rubric'&&!activeCriteria.length)addCriterion();}
  function toggleCriterion(id:string){setSelectedCriteria(current=>{const existing=current.find(item=>item.templateId===id);if(existing)return distributeCriterionValues(current.filter(item=>item.id!==existing.id),activity.maxPoints);const item=criterionItems.find(row=>row.id===id);return item?equalCriterionValues([...current,{id:`${criterionPrefix}criterion:${newId()}`,templateId:item.id,label:item.label,levels:item.levels.map(level=>({...level,description:level.description??''})),indicatorId:availableIndicators.length===1?availableIndicators[0]!.id:'',weight:1,originLabel:'Plantilla'}],activity.maxPoints):current;});}
  function excludeCriterion(item:SelectedCriterionDraft){setSelectedCriteria(current=>distributeCriterionValues(current.filter(row=>row.id!==item.id),activity.maxPoints));}
  function restoreSourceCriterion(item:SelectedCriterionDraft){setSelectedCriteria(current=>equalCriterionValues([...current,item],activity.maxPoints));}
  function updateCriterion(id:string,patch:Partial<SelectedCriterionDraft>){setSelectedCriteria(current=>current.map(item=>item.id===id?{...item,...patch}:item));}
  function commitCriterionValue(id:string){setSelectedCriteria(current=>{const target=current.find(item=>item.id===id);const parsed=Number(target?.pointsInput);return Number.isFinite(parsed)&&parsed>0?setCriterionValue(current,id,parsed,activity.maxPoints):distributeCriterionValues(current,activity.maxPoints);});}
  async function save(){
    if(!mode)return;
    setBusy(true);setError('');
    try{
      const rubric:RubricCriterion[]=mode==='rubric'?activeCriteria.map(selected=>({id:selected.id,label:selected.label,indicatorId:selected.indicatorId,weight:selected.weight,levels:selected.levels})):[];
      await apiPost('configure-activity',{requestId:newId(),activityId:activity.id,revision:activity.revision,scoringMode:mode,instrument:instrument||(mode==='rubric'?'Rúbrica analítica':'Puntaje directo'),manualIndicators:usesManualIndicators&&allocations.length?selectedIndicators:[],indicatorPoints:allocations,rubric});onSaved();
    }catch(error){setError(errorText(error));}finally{setBusy(false);}
  }
  const criterionValuesMatch=Math.round(criteriaValueTotal*100)/100===Math.round(activity.maxPoints*100)/100;
  const criterionValueEditPending=activeCriteria.some(item=>item.pointsInput!==undefined&&Number(item.pointsInput)!==criterionMaximumPoints(item));
  const allocationsValid=mode==='points'||criterionValuesMatch&&allocations.length>0&&allocations.every(item=>availableIndicators.some(indicator=>indicator.id===item.indicatorId)&&item.points>0)&&Math.round(total*100)/100===Math.round(activity.maxPoints*100)/100;
  const valid=allocationsValid&&(mode==='points'||!criterionValueEditPending&&activeCriteria.length>0&&activeCriteria.every(item=>criterionMaximumPoints(item)>0&&item.label.trim()&&item.indicatorId&&availableIndicators.some(indicator=>indicator.id===item.indicatorId)&&item.levels.length>=2&&item.levels.length<=6&&item.levels.every(level=>level.description?.trim())&&allocations.some(allocation=>allocation.indicatorId===item.indicatorId))&&selectedIndicators.every(item=>item.label.trim()&&item.competency));
  const rubricBlockReason=mode!=='rubric'?null:!activeCriteria.length?'Añade al menos un criterio para esta actividad.':activeCriteria.some(item=>!item.label.trim())?'Escribe el nombre de cada criterio.':activeCriteria.some(item=>!item.indicatorId||!availableIndicators.some(indicator=>indicator.id===item.indicatorId))?'Vincula cada criterio con un indicador de la actividad.':selectedIndicators.some(item=>!item.label.trim())?'Escribe el nombre del indicador seleccionado.':selectedIndicators.some(item=>!item.competency)?'Asigna una competencia a cada indicador usado.':activeCriteria.some(item=>item.levels.length<2||item.levels.length>6||item.levels.some(level=>!level.description?.trim()))?'Completa los niveles de desempeño de cada criterio.':activeCriteria.some(item=>criterionMaximumPoints(item)<=0)?'Asigna al menos 0.01 puntos a cada criterio.':criterionValueEditPending?'Confirma el valor de puntos del criterio antes de guardar.':!criterionValuesMatch?`Asigna los ${activity.maxPoints} puntos entre los criterios. Ahora suman ${pointText(criteriaValueTotal)}.`:!allocationsValid?'Revisa los valores de los criterios para completar la distribución de la actividad.':null;
   return <div className="modal-backdrop workflow-fullscreen-backdrop" onClick={()=>!busy&&onClose()}><section className="drawer evaluation-drawer workflow-fullscreen" role="dialog" aria-modal="true" aria-labelledby="evaluation-title" onClick={event=>event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">ACTIVIDADES · MATRIZ DE EVALUACIÓN · MÁXIMO {activity.maxPoints}</p><h2 id="evaluation-title">{activity.title}</h2><p className="muted">Configura esta matriz una sola vez. Al calificar cada curso verás la misma actividad y sus criterios listos para marcar.</p></div><button className="icon-button" aria-label="Cerrar" onClick={onClose}><X/></button></div>
    {matchingSequence&&(sourceCriteria.length||matchingSequence.instrument||matchingSequence.evaluationPurpose||matchingSequence.plannedPoints!==null&&matchingSequence.plannedPoints!==undefined||matchingSequence.plannedPercent!==null&&matchingSequence.plannedPercent!==undefined||matchingSequence.feedback)&&<details className="sequence-source-evaluation grading-source"><summary>Referencia de evaluación de la secuencia</summary><div className="source-evaluation-meta">{matchingSequence.instrument&&<p><strong>Instrumento sugerido:</strong> {matchingSequence.instrument}</p>}{matchingSequence.evaluationPurpose&&<p><strong>Propósito:</strong> {PURPOSE_LABELS[matchingSequence.evaluationPurpose]}</p>}{matchingSequence.plannedPoints!==null&&matchingSequence.plannedPoints!==undefined&&<p><strong>Ponderación fuente:</strong> {matchingSequence.plannedPoints} puntos</p>}{matchingSequence.plannedPercent!==null&&matchingSequence.plannedPercent!==undefined&&<p><strong>Ponderación fuente:</strong> {matchingSequence.plannedPercent}%</p>}{matchingSequence.feedback&&<p><strong>Retroalimentación prevista:</strong> {matchingSequence.feedback}</p>}</div>{sourceCriteria.length>0&&<><strong>Criterios descritos en el plan</strong><ul>{sourceCriteria.map((item,index)=><li key={`${index}-${item}`}>{item}</li>)}</ul><p className="muted">Estos criterios sirven de referencia; define los niveles de desempeño de la rúbrica aquí abajo si la actividad se calificará con rúbrica.</p></>}</details>}
    {matchingSequence?.assessmentInstrument&&<AssessmentSourcePreview instrument={matchingSequence.assessmentInstrument}/>}
    <div className="evaluation-section"><div className="table-toolbar"><div><h3>¿Cómo se calificará?</h3><p className="muted">Elige el método para esta actividad. El resultado llega al mismo libro del período.</p></div></div><div className="grading-method-options"><button type="button" className={'grading-method-option'+(mode==='points'?' selected':'')} aria-pressed={mode==='points'} onClick={()=>chooseMode('points')}><strong>Por puntos directos</strong><span>Escribes la nota obtenida sobre {activity.maxPoints}, sin completar una rúbrica.</span></button><button type="button" className={'grading-method-option'+(mode==='rubric'?' selected':'')} aria-pressed={mode==='rubric'} onClick={()=>chooseMode('rubric')}><strong>Por competencias</strong><span>Marcas un nivel en cada criterio y asignas sus puntos.</span></button></div></div>
     {mode==='points'&&sourceCriteria.length>0&&<div className="notice rubric-conversion-notice"><div><strong>Esta actividad está guardada con puntos directos, aunque la secuencia contiene {sourceCriteria.length} criterios.</strong><span>Si quieres que aparezcan la competencia, el indicador y los niveles Insuficiente–Excelente al calificar, cambia esta actividad a evaluación por competencias.</span></div><button type="button" className="button secondary" onClick={()=>chooseMode('rubric')}>Cambiar a competencias</button></div>}
    {!mode&&<div className="notice">Elige cómo evaluar esta actividad. Puedes usar puntos directos o marcar niveles por criterio; ambos resultados llegan al mismo libro del período.</div>}
    {mode==='rubric'&&usesManualIndicators&&<div className="evaluation-section"><div className="table-toolbar"><div><h3>Indicadores de esta actividad</h3><p className="muted">Agrega los indicadores que correspondan. Cada criterio se vincula con uno y sus puntos se resumen por competencia.</p></div><button type="button" className="button secondary" onClick={addManualIndicator}><Plus size={14}/> Añadir indicador</button></div>{manualIndicators.map((indicator,index)=><div className="evaluation-allocation" key={indicator.id}><label>Indicador de logro<input maxLength={500} value={indicator.label} onChange={event=>setManualIndicators(current=>current.map((item,i)=>i===index?{...item,label:event.target.value}:item))} placeholder="Ej.: Representa los vectores y determina la resultante"/><small>Se propone el nombre de la actividad para que puedas ajustarlo.</small></label><label>Competencia<select value={indicator.competency??''} onChange={event=>setManualIndicators(current=>current.map((item,i)=>i===index?{...item,competency:event.target.value as SequenceIndicator['competency']}:item))}><option value="">Seleccionar</option>{COMPETENCY_GROUPS.map(group=><option key={group.key} value={group.key}>{group.label}</option>)}</select></label><button type="button" className="icon-button" aria-label={`Quitar indicador ${index+1}`} disabled={manualIndicators.length===1} onClick={()=>{const remaining=manualIndicators.filter(item=>item.id!==indicator.id);const fallback=remaining[0]?.id??'';setManualIndicators(remaining);setSelectedCriteria(current=>current.map(item=>item.indicatorId===indicator.id?{...item,indicatorId:fallback}:item));}}><Trash2 size={14}/></button></div>)}</div>}
    {mode==='rubric'&&<>
      {canUseSourceRubric&&<div className="notice source-criteria-ready"><strong>{sourceRubricDraft.length} criterios de la secuencia están listos para esta actividad.</strong> Puedes editar sus descriptores y asignar los puntos antes de guardar.</div>}
      {sourceCriteria.length>0&&!canUseSourceRubric&&<div className="notice">Los criterios de la secuencia se copiaron aquí. Completa sus descriptores con la escala fija del Excel: Insuficiente 1, Suficiente 2, Bueno 3 y Excelente 4.</div>}
      <div className="evaluation-section"><div className="table-toolbar"><div><h3>Criterios de esta actividad</h3><p className="muted">Deja aquí los criterios que sí evaluarás; solo esos aparecerán al calificar. Puedes usar uno o varios. Un criterio recibe el valor completo de la actividad; si usas varios, sus puntos se reparten por igual.</p></div><div className="toolbar"><span className="pill">{pointText(criteriaValueTotal)} / {activity.maxPoints} pts asignados</span><button type="button" className="button secondary" disabled={!canAddCriterion} title={!canAddCriterion?'Una rúbrica admite hasta 30 criterios y cada uno necesita puntos positivos.':undefined} onClick={addCriterion}><Plus size={14}/> Añadir criterio</button></div></div>
        {!usesManualIndicators&&<div className="toolbar rubric-indicator-summary" aria-label="Indicadores de la actividad">{availableIndicators.map(indicator=><span className="pill" key={indicator.id}>{indicator.code||'Indicador'} · {indicator.label}</span>)}</div>}
         <div className="evaluation-criteria-picks">{activeCriteria.map((selected,index)=>{const linkedIndicator=availableIndicators.find(indicator=>indicator.id===selected.indicatorId);const competencyLabel=COMPETENCY_GROUPS.find(group=>group.key===linkedIndicator?.competency)?.label;return <article className="panel selected-rubric-criterion" key={selected.id}><div className="table-toolbar"><label className="criterion-name-field">Criterio {index+1}<input aria-label={`Nombre del criterio ${index+1}`} maxLength={200} value={selected.label} onChange={event=>updateCriterion(selected.id,{label:event.target.value})} placeholder="Ej.: Representa correctamente los vectores"/></label><div className="toolbar">{selected.originLabel&&<span className="pill">{selected.originLabel}</span>}<button type="button" className="text-button" aria-label={`Quitar criterio ${index+1}`} onClick={()=>excludeCriterion(selected)}>Quitar</button></div></div><div className="form-grid"><label>Indicador de logro<select aria-label={`Indicador del criterio ${index+1}`} value={selected.indicatorId} onChange={event=>updateCriterion(selected.id,{indicatorId:event.target.value})}><option value="">Seleccionar indicador</option>{availableIndicators.map(indicator=><option key={indicator.id} value={indicator.id}>{indicator.code||'—'} · {indicator.label}</option>)}</select><small>{competencyLabel?`Competencia: ${competencyLabel}`:'Al elegir un indicador se mostrará su competencia.'}</small></label><label>Valor del criterio (puntos)<input aria-label={`Valor en puntos del criterio ${index+1}`} type="number" min={activeCriteria.length===1?activity.maxPoints:0.01} max={activeCriteria.length===1?activity.maxPoints:activity.maxPoints-0.01*(activeCriteria.length-1)} step="0.01" disabled={activeCriteria.length===1} value={selected.pointsInput??pointText(criterionMaximumPoints(selected))} onChange={event=>updateCriterion(selected.id,{pointsInput:event.target.value})} onBlur={()=>commitCriterionValue(selected.id)}/><small>{activeCriteria.length===1?'Único criterio: recibe el valor completo de la actividad.':'Al cambiarlo, los puntos restantes se reparten entre los demás criterios.'}</small></label></div><div className="criterion-level-grid">{selected.levels.map((level,levelIndex)=><label className={`criterion-level level-${levelIndex}`} key={`${selected.id}:${level.label}`}><span>{level.label} · {level.points} punto{level.points===1?'':'s'}</span><textarea required rows={3} maxLength={1000} aria-label={`${level.label} para el criterio ${index+1}`} value={level.description??''} onChange={event=>updateCriterion(selected.id,{levels:selected.levels.map((item,i)=>i===levelIndex?{...item,description:event.target.value}:item)})} placeholder="Describe lo que observarás en este nivel"/></label>)}</div></article>})}</div>
        {sourceRubricDraft.some(item=>!selectedCriteria.some(selected=>selected.id===item.id))&&<details className="activity-advanced-options"><summary>Recuperar criterios de la secuencia ({sourceRubricDraft.filter(item=>!selectedCriteria.some(selected=>selected.id===item.id)).length})</summary><div className="catalog-rubric-picks">{sourceRubricDraft.filter(item=>!selectedCriteria.some(selected=>selected.id===item.id)).map(item=><button className="button secondary" type="button" key={item.id} onClick={()=>restoreSourceCriterion(item)}><Plus size={13}/>{item.label}</button>)}</div></details>}
        {criterionItems.length>0&&<details className="activity-advanced-options"><summary>Usar una plantilla guardada (opcional)</summary><div className="catalog-rubric-picks"><p className="muted">La plantilla se copia aquí y puedes cambiar el nombre, los descriptores y su valor solo para esta actividad.</p>{criterionItems.map(item=>{const selected=selectedCriteria.some(row=>row.templateId===item.id);return <label className="check-label panel" key={item.id}><input type="checkbox" checked={selected} onChange={()=>toggleCriterion(item.id)}/><span><strong>{item.label}</strong><small>{item.levels.map(level=>`${level.label} ${level.points}`).join(' · ')}</small></span></label>;})}</div></details>}
      </div>
      <details className="activity-advanced-options rubric-auto-allocation"><summary>Ver resumen por competencia</summary><p className="muted">Los puntos que asignaste a cada criterio se agrupan aquí. La suma llega al mismo total de la actividad y al libro de notas.</p><div className="toolbar">{allocations.map(item=>{const indicator=availableIndicators.find(option=>option.id===item.indicatorId);return <span className="pill" key={item.indicatorId}>{indicator?.code||indicator?.label||'Indicador'}: {item.points} pts</span>;})}</div><strong>Total: {total} / {activity.maxPoints}</strong></details>
    </>}
    {mode==='points'&&<div className="notice">La calificación directa no pide criterios ni reparto por indicador. En la captura escribirás la nota de cada estudiante sobre {activity.maxPoints}; quedará en el mismo libro del período.</div>}
    {rubricBlockReason&&<div className="notice warning" role="status">{rubricBlockReason}</div>}
    {error&&<div className="notice warning" role="alert">{error}</div>}
    <div className="sequence-save-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="button primary" disabled={busy||!valid} onClick={()=>void save()}>{busy?<LoaderCircle className="spin" size={16}/>:<Check size={16}/>} Guardar valoración</button></div>
  </section></div>;
}
