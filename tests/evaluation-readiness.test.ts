import test from 'node:test';
import assert from 'node:assert/strict';
import { isActivityEvaluationReady } from '../src/lib/evaluation-readiness';
import type { Activity } from '../src/lib/model';

const base: Activity = {
  id: 'activity-1', courseId: 'course-1', sharedId: null, period: 'P1', category: 'sequence',
  title: 'Actividad de prueba', date: '2026-11-20', createdAt: null, block: 1, maxPoints: 10,
  scoringMode: 'points', rubric: [], indicatorPoints: [], description: '', sequenceCode: '',
  sequenceActivityId: null, sequencePlannedPeriod: null, evidence: '', instrument: '', purpose: '',
  competency: null, indicator: '', revision: 0,
};

test('la lista de calificaciones solo ofrece actividades con un método realmente listo', () => {
  assert.equal(isActivityEvaluationReady({ ...base, instrument: 'Instrumento importado sin confirmar' }), false);
  assert.equal(isActivityEvaluationReady({ ...base, instrument: 'Puntaje directo' }), true,
    'el flujo directo estándar puede capturarse inmediatamente al crear la actividad');
  assert.equal(isActivityEvaluationReady({ ...base, instrument: 'Valoración del docente', revision: 1 }), true,
    'un método directo queda listo después de guardarse, aunque conserve un nombre propio');
  assert.equal(isActivityEvaluationReady({ ...base, scoringMode: 'rubric', instrument: 'Rúbrica', revision: 1 }), false,
    'una rúbrica sin criterios ni indicadores no debe pasar a captura');
  assert.equal(isActivityEvaluationReady({ ...base, scoringMode: 'rubric', rubric: [{ id: 'c1' } as Activity['rubric'][number]], indicatorPoints: [{ indicatorId: 'i1' } as Activity['indicatorPoints'][number]] }), true);
});
