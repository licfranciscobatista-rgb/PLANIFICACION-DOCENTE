import type { CompetencyKey, EvaluationPurpose, RubricLevel, SequenceFinalAssessment, SourceAssessmentInstrument } from './model';

export type SequenceActivityProposal = { code: string; title: string };
export type PdfSequenceTextItem = { str: string; x: number; y: number };
export type PdfActivityProposal = SequenceActivityProposal & {
  theme: string;
  period: string;
  evidence: string;
  evaluationCriteria: string[];
  instrument: string;
  evaluationPurpose: EvaluationPurpose | null;
  plannedPoints: number | null;
  plannedPercent: number | null;
  feedback: string;
  assessmentInstrument?: SourceAssessmentInstrument;
};
export type PdfIndicatorProposal = { code: string; label: string; competency: CompetencyKey | null };
export type PdfSequenceProposal = { theme: string; period: string; activities: PdfActivityProposal[]; indicators: PdfIndicatorProposal[]; finalAssessment?: SequenceFinalAssessment };

const ACTIVITY_HEADING = /^Actividad\s+(\d+(?:\.\d+){0,3})$/i;
const COMPETENCY_BY_NUMBER: Record<string, CompetencyKey | null> = {
  '1': 'comunicativa',
  '2': 'logico_matematica',
  '3': 'resolucion',
  '4': 'etica_ciudadana',
  '5': 'cientifica_tecnologica',
  // The source's competency 6 is environmental/health, while achievement indicator I6 explicitly describes technology use.
  // Keep the mismatch unresolved so the teacher assigns the correct competency during review.
  '6': null,
  '7': 'desarrollo_personal',
};

function normalizeText(value: string): string {
  return value.replace(/-\s+/g, '-').replace(/\s+/g, ' ').trim();
}

const SOURCE_COMPETENCY_TERMS: Record<CompetencyKey, string[]> = {
  comunicativa: ['comunicativa'],
  logico_matematica: ['pensamiento logico'],
  resolucion: ['resolucion de problemas'],
  etica_ciudadana: ['etica y ciudadana', 'etica ciudadana'],
  cientifica_tecnologica: ['cientifica y tecnologica'],
  ambiental_salud: ['ambiental y de la salud', 'ambiental y salud'],
  desarrollo_personal: ['desarrollo personal'],
};

function matchText(value: string) {
  return normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Suggests only a unique global indicator when an assessment annex explicitly names its competency. */
export function suggestIndicatorIdsFromCompetencies(
  relatedCompetencyText: string | undefined,
  indicators: readonly { id: string; competency: CompetencyKey | null }[],
) {
  if (!relatedCompetencyText?.trim()) return [];
  const source = matchText(relatedCompetencyText);
  const mentioned = (Object.keys(SOURCE_COMPETENCY_TERMS) as CompetencyKey[])
    .filter(key => SOURCE_COMPETENCY_TERMS[key].some(term => source.includes(term)));
  const suggestions: string[] = [];
  for (const competency of mentioned) {
    const candidates = indicators.filter(indicator => indicator.competency === competency);
    if (candidates.length === 1) suggestions.push(candidates[0]!.id);
  }
  return suggestions;
}

export function proposeActivities(text: string): SequenceActivityProposal[] {
  const proposals: SequenceActivityProposal[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*\s]+/, '');
    const match = line.match(/^(?:(?:actividad|clase|tema)\s*)?(\d+(?:\.\d+){0,3})[.)\s:–—-]+(.{3,240})$/i);
    if (!match) continue;
    proposals.push({ code: match[1], title: match[2].trim().replace(/^[\s:–—-]+/, '') });
    if (proposals.length >= 100) break;
  }
  return proposals;
}

function clusterColumnStarts(items: PdfSequenceTextItem[], minimumCount = 3): number[] {
  const sorted = items.map(item => item.x).sort((a, b) => a - b);
  const clusters: { values: number[]; count: number }[] = [];
  for (const x of sorted) {
    const last = clusters.at(-1);
    const center = last ? last.values.reduce((sum, value) => sum + value, 0) / last.values.length : Number.NaN;
    if (last && Math.abs(x - center) <= 22) {
      last.values.push(x);
      last.count++;
    } else clusters.push({ values: [x], count: 1 });
  }
  return clusters.filter(cluster => cluster.count >= minimumCount).map(cluster => cluster.values.reduce((sum, value) => sum + value, 0) / cluster.values.length);
}

function lineTexts(items: PdfSequenceTextItem[], left: number, right: number, top: number, bottom: number): string[] {
  const selected = items
    .filter(item => item.x >= left - 15 && item.x < right - 3 && item.y <= top + 1 && item.y >= bottom)
    .sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; parts: string[] }[] = [];
  for (const item of selected) {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) <= 2.5) previous.parts.push(item.str.trim());
    else lines.push({ y: item.y, parts: [item.str.trim()] });
  }
  return lines.map(line => normalizeText(line.parts.filter(Boolean).join(' '))).filter(Boolean);
}

function cellLinesInReadingOrder(items: PdfSequenceTextItem[], left: number, right: number): string[] {
  const selected = items.filter(item => item.x >= left - 15 && item.x < right - 3);
  const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
  for (const item of selected) {
    const previous = lines.at(-1);
    if (previous && Math.abs(previous.y - item.y) <= 2.5) previous.parts.push({ x: item.x, text: item.str.trim() });
    else lines.push({ y: item.y, parts: [{ x: item.x, text: item.str.trim() }] });
  }
  return lines.map(line => normalizeText(line.parts.sort((a, b) => a.x - b.x).map(part => part.text).filter(Boolean).join(' '))).filter(Boolean);
}

function joinColumn(items: PdfSequenceTextItem[], left: number, right: number, top: number, bottom: number): string {
  return normalizeText(lineTexts(items, left, right, top, bottom).join(' '));
}

function criteriaFromLines(lines: string[]): string[] {
  const criteria: string[] = [];
  for (const line of lines) {
    const startsCriterion = /^\s*[•●▪◦*-]\s*/.test(line);
    const content = line.replace(/^\s*[•●▪◦*-]\s*/, '').trim();
    if (!content) continue;
    if (startsCriterion || !criteria.length) criteria.push(content);
    else criteria[criteria.length - 1] = normalizeText(`${criteria.at(-1)} ${content}`);
  }
  return criteria;
}

function evaluationPurpose(value: string): EvaluationPurpose | null {
  const compact = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, '');
  if (/F\/S|F\+S|FORMATIVA\/SUMATIVA/.test(compact)) return 'formativa_sumativa';
  if (/D=DIAGNOSTICA|^D(?:\b|\d)/.test(compact)) return 'diagnostica';
  if (/^F(?:\b|\d)|FORMATIVA/.test(compact)) return 'formativa';
  if (/^S(?:\b|\d)|SUMATIVA/.test(compact)) return 'sumativa';
  return null;
}

function numericValue(value: string, suffix: 'points' | 'percent'): number | null {
  const pattern = suffix === 'points' ? /(\d+(?:[.,]\d+)?)\s*puntos?/i : /(\d+(?:[.,]\d+)?)\s*%/i;
  const match = value.match(pattern);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function globalIndicators(page: PdfSequenceTextItem[]): PdfIndicatorProposal[] {
  const numericRows = page
    .map(item => ({ item, match: item.str.trim().match(/^([1-7])\.$/) }))
    .filter((entry): entry is { item: PdfSequenceTextItem; match: RegExpMatchArray } => Boolean(entry.match) && entry.item.x >= 500 && entry.item.x < 555)
    .sort((a, b) => b.item.y - a.item.y);
  return numericRows.flatMap((row, index) => {
    const next = numericRows[index + 1];
    const lower = next ? next.item.y + 1 : row.item.y - 75;
    // The numbered list marker sits in a narrow gutter. Start after it so the
    // marker is not accidentally folded into the indicator text.
    const label = normalizeText(lineTexts(page, 570, 810, row.item.y, lower).join(' '));
    const competency = COMPETENCY_BY_NUMBER[row.match[1]];
    return label && competency !== undefined ? [{ code: `I${row.match[1]}`, label, competency }] : [];
  });
}

function themeFromPages(pages: PdfSequenceTextItem[][]): string {
  for (const page of pages) {
    const item = page.find(value => /^Secuencia\s*:/i.test(value.str.trim()));
    const match = item?.str.trim().match(/^Secuencia\s*:\s*(.+)$/i);
    if (match?.[1]) return normalizeText(match[1]);
  }
  return '';
}

function periodFromPages(pages: PdfSequenceTextItem[][]): string {
  for (const page of pages) {
    for (const item of page) {
      if (!/^Per[ií]odo\s*:/i.test(item.str.trim())) continue;
      const value = item.str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const match = value.match(/(?:^|\s)([1-4])\s*(?:\.?(?:er|do|to|ro)|°)?\s*periodo/);
      if (match) return `P${match[1]}`;
    }
  }
  return '';
}

type AnnexDraft = { number: number; title: string; activityCode: string | null; criteria: string[]; scoringNote: string; relatedIndicatorText?: string; relatedCompetencyText?: string };

function sourceLevels(note: string): RubricLevel[] {
  const matches = note.split(/\s*;\s*/).flatMap(part => {
    const pointFirst = part.match(/(?:^|:)\s*(\d+(?:[.,]\d+)?)\s*=\s*(.+?)\s*\.?$/);
    if (pointFirst) return [{ points: Number(pointFirst[1].replace(',', '.')), description: normalizeText(pointFirst[2]) }];
    const labelFirst = part.match(/(?:^|:)\s*([^=;]+?)\s*=\s*(\d+(?:[.,]\d+)?)\s*\.?$/);
    return labelFirst ? [{ points: Number(labelFirst[2].replace(',', '.')), description: normalizeText(labelFirst[1]) }] : [];
  }).map(level => ({ ...level, label: level.description.replace(/^./, first => first.toLocaleUpperCase('es')) }))
    .filter(level => Number.isFinite(level.points) && level.label.length > 0)
    .sort((a, b) => a.points - b.points);
  return matches.filter((level, index) => index === 0 || level.points > matches[index - 1].points).map(({points,label,description})=>({points,label,description}));
}

function annexKind(title: string, number: number): SourceAssessmentInstrument['kind'] {
  if (number === 12) return 'exam_guide';
  if (/lista\s+de\s+cotejo/i.test(title)) return 'checklist';
  if (/escala\s+de\s+valoraci[oó]n/i.test(title)) return 'scale';
  return 'rubric';
}

function assessmentAnnexes(pages: PdfSequenceTextItem[][], period: string): { byActivity: Map<string, SourceAssessmentInstrument>; finalAssessment?: SequenceFinalAssessment } {
  const drafts: AnnexDraft[] = [];
  let active: AnnexDraft | undefined;
  let readingCriteria = false;
  let readingRelatedCompetencies = false;
  const finish = () => { if (active) drafts.push(active); };
  for (const page of pages) {
    for (const item of page) {
      const text = normalizeText(item.str);
      const heading = text.match(/^ANEXO\s+(\d+)\.\s*(.+)$/i);
      if (heading) {
        finish();
        const number = Number(heading[1]);
        active = { number, title: heading[2], activityCode: heading[2].match(/Actividad\s+(\d+(?:\.\d+){0,3})/i)?.[1] ?? null, criteria: [], scoringNote: '' };
        readingCriteria = false;
        readingRelatedCompetencies = false;
        continue;
      }
      if (!active) continue;
      if (/^Criterio de evaluaci[oó]n$/i.test(text)) { readingCriteria = true; readingRelatedCompetencies = false; continue; }
      if (/^(?:Puntaje sugerido:|Registro:|Prueba escrita:)/i.test(text)) {
        readingCriteria = false;
        readingRelatedCompetencies = false;
        active.scoringNote = text;
        continue;
      }
      if (/^Observaciones:/i.test(text)) { readingCriteria = false; readingRelatedCompetencies = false; continue; }
      const related = text.match(/^Indicador(?:es)?\s+relacionado(?:s)?:\s*(.*)$/i);
      if (related) {
        readingCriteria = false;
        const body = related[1];
        const competencyMarker = body.match(/\s+Competencias:\s*/i);
        if (competencyMarker?.index !== undefined) {
          active.relatedIndicatorText = normalizeText(body.slice(0, competencyMarker.index));
          active.relatedCompetencyText = normalizeText(body.slice(competencyMarker.index + competencyMarker[0].length));
          readingRelatedCompetencies = true;
        } else {
          active.relatedIndicatorText = normalizeText(body);
          readingRelatedCompetencies = false;
        }
        continue;
      }
      if (readingRelatedCompetencies) {
        if (text) active.relatedCompetencyText = normalizeText(`${active.relatedCompetencyText ?? ''} ${text}`);
        continue;
      }
      // In these annex tables, criterion descriptions occupy the left text column.
      // Checkbox marks and the repeated scale headings are in the right columns.
      if (readingCriteria && item.x >= 85 && item.x < 225 && text && !/^[☐□✓✔]+$/.test(text)) {
        active.criteria.push(text);
      }
    }
  }
  finish();

  const byActivity = new Map<string, SourceAssessmentInstrument>();
  let finalAssessment: SequenceFinalAssessment | undefined;
  for (const draft of drafts) {
    const kind = annexKind(draft.title, draft.number);
    const pointsMatch = draft.scoringNote.match(/Puntaje sugerido:\s*(\d+(?:[.,]\d+)?)\s*puntos?/i);
    const maxPoints = pointsMatch ? Number(pointsMatch[1].replace(',', '.')) : null;
    const instrument: SourceAssessmentInstrument = {
      annexNumber: draft.number,
      title: normalizeText(draft.title),
      kind,
      criteria: [...new Set(draft.criteria)],
      levels: sourceLevels(draft.scoringNote),
      maxPoints,
      scoringNote: draft.scoringNote,
      scored: draft.number !== 1 && (kind === 'exam_guide' || maxPoints !== null),
      ...(draft.relatedIndicatorText ? { relatedIndicatorText: draft.relatedIndicatorText } : {}),
      ...(draft.relatedCompetencyText ? { relatedCompetencyText: draft.relatedCompetencyText } : {}),
    };
    if (draft.number === 12) {
      const internal = draft.scoringNote.match(/(\d+(?:[.,]\d+)?)\s*puntos\s+internos/i);
      const periodValue = draft.scoringNote.match(/aporta\s+(\d+(?:[.,]\d+)?)\s*puntos?/i);
      finalAssessment = {
        title: 'Evaluación final individual',
        period,
        internalMaxPoints: internal ? Number(internal[1].replace(',', '.')) : null,
        periodPoints: periodValue ? Number(periodValue[1].replace(',', '.')) : null,
        instrument,
      };
    } else if (draft.activityCode) byActivity.set(draft.activityCode, instrument);
  }
  return { byActivity, finalAssessment };
}

export function proposeSequenceFromPdfPages(pages: PdfSequenceTextItem[][]): PdfSequenceProposal {
  const theme = themeFromPages(pages);
  const period = periodFromPages(pages);
  const annexes = assessmentAnnexes(pages, period);
  const indicators = pages[0] ? globalIndicators(pages[0]) : [];
  const activities: PdfActivityProposal[] = [];

  const activityPages = pages.map(page => {
    const items = page.map((item, index) => ({ ...item, index })).filter(item => item.str.trim() && Number.isFinite(item.x) && Number.isFinite(item.y));
    const headings = items.flatMap(item => {
      const match = item.str.trim().match(ACTIVITY_HEADING);
      return match ? [{ item, match }] : [];
    }).sort((a, b) => a.item.index - b.item.index);
    const weekMarkers = items.filter(item => item.x < 55 && /^\d{1,2}$/.test(item.str.trim()));
    return { items, headings, weekMarkers };
  }).filter(page => page.headings.length);
  const activityCount = activityPages.reduce((sum, page) => sum + page.headings.length, 0);
  const allActivityItems = activityPages.flatMap(page => page.items);
  const columns = clusterColumnStarts(allActivityItems, Math.max(3, Math.ceil(activityCount * 0.6)));

  for (const page of activityPages) {
    const { items, headings, weekMarkers } = page;
    for (let index = 0; index < headings.length; index++) {
      const { item: heading, match } = headings[index];
      if (columns.length < 7) continue;
      const titleColumnIndex = columns.reduce((best, value, columnIndex) => Math.abs(value - heading.x) < Math.abs(columns[best] - heading.x) ? columnIndex : best, 0);
      const cellStarts = columns.slice(titleColumnIndex, titleColumnIndex + 7);
      if (cellStarts.length < 7) continue;
      const rowMarker = weekMarkers[index];
      if (!rowMarker) continue;
      const nextMarker = weekMarkers[index + 1];
      const rowStart = rowMarker.index + 1;
      let rowEnd = nextMarker?.index ?? Number.POSITIVE_INFINITY;
      const closingIndex = items.find(item => item.index >= rowStart && item.index < rowEnd && /evaluaci[oó]n\s+final/i.test(item.str))?.index;
      if (closingIndex !== undefined) rowEnd = closingIndex;
      const rowItems = items.filter(item => item.index >= rowStart && item.index < rowEnd);
      const columnBounds = cellStarts.map((start, cellIndex) => ({
        start,
        end: cellStarts[cellIndex + 1] ?? 820,
      }));
      const columnsText = columnBounds.map(bounds => cellLinesInReadingOrder(rowItems, bounds.start, bounds.end));
      const activityTitle = normalizeText(columnsText[0].filter(line => !ACTIVITY_HEADING.test(line)).join(' '));
      if (!activityTitle) continue;
      const evidence = normalizeText(columnsText[1].join(' '));
      const criteria = criteriaFromLines(columnsText[2]);
      const instrument = normalizeText(columnsText[3].join(' '));
      const purposeText = columnsText[4].join(' ');
      const weightText = columnsText[5].join(' ');
      const feedback = normalizeText(columnsText[6].join(' '));
      activities.push({
        code: match[1],
        title: activityTitle,
        theme,
        period,
        evidence,
        evaluationCriteria: criteria,
        instrument,
        evaluationPurpose: evaluationPurpose(purposeText),
        plannedPoints: numericValue(weightText, 'points'),
        plannedPercent: numericValue(weightText, 'percent'),
        feedback,
        assessmentInstrument: annexes.byActivity.get(match[1]),
      });
    }
  }

  return { theme, period, activities, indicators, ...(annexes.finalAssessment ? { finalAssessment: annexes.finalAssessment } : {}) };
}
