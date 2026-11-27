import type { Activity } from './model';

/**
 * Direct-point activities created through the quick workflow are ready at once.
 * Rubric activities are ready only after both their criteria and indicator
 * allocation have been saved.
 */
export function isActivityEvaluationReady(activity: Pick<Activity, 'scoringMode' | 'instrument' | 'revision' | 'rubric' | 'indicatorPoints'>): boolean {
  if (activity.scoringMode === 'rubric') {
    return activity.rubric.length > 0 && activity.indicatorPoints.length > 0;
  }

  return activity.instrument.trim() === 'Puntaje directo' || activity.revision > 0;
}
