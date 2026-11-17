import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateRubricPoints } from '../src/lib/rubric-allocation';
import type { RubricCriterion } from '../src/lib/model';

const levels = [1, 2, 3, 4].map(points => ({ label: `Nivel ${points}`, points }));

function criterion(id: string, indicatorId: string): RubricCriterion {
  return { id, label: id, indicatorId, weight: 1, levels };
}

const indicators = [
  { id: 'math', code: 'I1', label: 'Procedimiento matemático', competency: 'logico_matematica' as const },
  { id: 'explain', code: 'I2', label: 'Explicación', competency: 'comunicativa' as const },
];

test('reparte el máximo proporcionalmente a criterios y conserva el cálculo tipo Excel', () => {
  const rubric = [criterion('draw', 'math'), criterion('solve', 'math'), criterion('explain', 'explain')];
  const allocations = allocateRubricPoints(rubric, indicators, 10);
  assert.deepEqual(allocations.map(item => [item.indicatorId, item.points]), [['explain', 3.33], ['math', 6.67]]);
  const selectedLevels = { draw: 3, solve: 2, explain: 0 };
  const total = allocations.reduce((sum, allocation) => {
    const group = rubric.filter(item => item.indicatorId === allocation.indicatorId);
    const possible = group.reduce((n, item) => n + 4, 0);
    const earned = group.reduce((n, item) => n + levels[selectedLevels[item.id as keyof typeof selectedLevels]]!.points, 0);
    return sum + allocation.points * earned / possible;
  }, 0);
  assert.equal(Math.round(total * 100) / 100, 6.67);
  assert.equal(Math.round(allocations.reduce((sum, item) => sum + item.points, 0) * 100) / 100, 10);
});

test('distribuye centavos sobrantes de forma determinista y suma exactamente el máximo', () => {
  const threeIndicators = [
    ...indicators,
    { id: 'solve', code: 'I3', label: 'Resolución', competency: 'resolucion' as const },
  ];
  const allocations = allocateRubricPoints(
    [criterion('a', 'math'), criterion('b', 'explain'), criterion('c', 'solve')],
    threeIndicators,
    5,
  );
  assert.deepEqual(allocations.map(item => item.points), [1.67, 1.67, 1.66]);
  assert.equal(Math.round(allocations.reduce((sum, item) => sum + item.points, 0) * 100) / 100, 5);
});

test('no asigna puntos a criterios sin indicador válido', () => {
  assert.deepEqual(allocateRubricPoints([criterion('a', 'missing')], indicators, 10), []);
  assert.deepEqual(allocateRubricPoints([criterion('a', 'math')], [{ ...indicators[0], competency: null }], 10), []);
});
