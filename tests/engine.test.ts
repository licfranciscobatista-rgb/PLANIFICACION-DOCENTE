import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixedCategory, payloadHash, requireDate, rubricMaximum, rubricScore, sessionStatus } from '../src/lib/engine';
import { AppError, type RubricCriterion } from '../src/lib/model';

test('el estado respeta fecha y existencia de marcas, incluso cuando todos faltaron', () => {
  assert.equal(sessionStatus('2026-11-02', [null, null], '2026-11-13'), 'no_impartida');
  assert.equal(sessionStatus('2026-11-02', ['A', 'A'], '2026-11-13'), 'impartida');
  assert.equal(sessionStatus('2026-11-02', ['E', null], '2026-11-13'), 'impartida');
  assert.equal(sessionStatus('2026-11-13', ['P', null], '2026-11-13'), 'impartida');
  assert.equal(sessionStatus('2026-11-14', [null, null], '2026-11-13'), 'programada');
});

test('la fecha inicial autorizada es el 20 de octubre y las fechas imposibles se rechazan', () => {
  assert.equal(requireDate('2026-10-20'), '2026-10-20');
  assert.equal(requireDate('2027-01-20'), '2027-01-20');
  assert.equal(requireDate('2027-01-21'), '2027-01-21');
  for (const invalid of ['2026-10-19', '2026-11-31', '2026-02-29', '20/10/2026', 'not-a-date']) {
    assert.throws(() => requireDate(invalid), (error: unknown) => error instanceof AppError && error.status === 400, invalid);
  }
});

test('el examen conserva su aporte real y los pendientes permanecen visibles', () => {
  const first = fixedCategory('exam', [15, null], [15, 20]);
  assert.equal(first.points, 15);
  assert.equal(first.denominator, 35);
  assert.equal(first.pending, 1);
  assert.equal(first.graded, 1);
  const complete = fixedCategory('exam', [15, 20], [15, 20]);
  assert.equal(complete.points, 35);
  const zero = fixedCategory('exam', [0, null], [15, 20]);
  assert.equal(zero.rawEarned, 0);
  assert.equal(zero.graded, 1);
  assert.equal(zero.pending, 1);
});

test('la rúbrica diferencia el nivel mínimo de cero y conserva los descriptores', () => {
  const criteria: RubricCriterion[] = [{
    id: 'reasoning', label: 'Razonamiento',
    levels: [{ label: 'Insuficiente', points: 1 }, { label: 'Suficiente', points: 2 }, { label: 'Bueno', points: 3 }, { label: 'Excelente', points: 4 }],
  }];
  assert.equal(rubricMaximum(criteria), 4);
  assert.equal(rubricScore(criteria, { reasoning: 0 }), 1);
  assert.equal(rubricScore(criteria, { reasoning: 3 }), 4);
  assert.throws(() => rubricScore(criteria, { reasoning: 4 }), AppError);
  assert.throws(() => rubricScore(criteria, {}), AppError);
  assert.throws(() => rubricMaximum([...criteria, ...criteria]), AppError);
});

test('el identificador de contenido no depende del orden de las claves, pero sí de los valores', () => {
  assert.equal(payloadHash({ rows: [{ studentId: '1', score: 0 }], revision: 2 }), payloadHash({ revision: 2, rows: [{ score: 0, studentId: '1' }] }));
  assert.notEqual(payloadHash({ score: null }), payloadHash({ score: 0 }));
  assert.notEqual(payloadHash({ courseId: '5A' }), payloadHash({ courseId: '5B' }));
});
