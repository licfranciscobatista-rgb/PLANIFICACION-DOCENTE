import type { ActivityIndicatorPoint, CompetencyKey, RubricCriterion } from './model';

type IndicatorOption = {
  id: string;
  code: string;
  label: string;
  competency: CompetencyKey | null;
};

/**
 * Distributes an activity's maximum proportionally to the rubric weight
 * attached to each indicator. With equal 1–4 criteria, this is equivalent to
 * the workbook formula: sum(levels) / (criteria × 4) × activity maximum.
 */
export function allocateRubricPoints(
  rubric: Pick<RubricCriterion, 'indicatorId' | 'levels' | 'weight'>[],
  indicators: IndicatorOption[],
  maxPoints: number,
): ActivityIndicatorPoint[] {
  if (!Number.isFinite(maxPoints) || maxPoints <= 0 || !rubric.length) return [];

  const indicatorById = new Map(indicators.map(indicator => [indicator.id, indicator]));
  const groupMaximums = new Map<string, number>();
  for (const criterion of rubric) {
    const id = criterion.indicatorId;
    if (!id || !indicatorById.has(id) || !criterion.levels.length) continue;
    const maximum = Math.max(...criterion.levels.map(level => level.points)) * (criterion.weight ?? 1);
    if (!Number.isFinite(maximum) || maximum <= 0) continue;
    groupMaximums.set(id, (groupMaximums.get(id) ?? 0) + maximum);
  }

  const totalMaximum = [...groupMaximums.values()].reduce((sum, value) => sum + value, 0);
  if (!totalMaximum) return [];

  const totalCents = Math.round((maxPoints + Number.EPSILON) * 100);
  const shares = [...groupMaximums.entries()].map(([id, weight]) => {
    const exactCents = totalCents * weight / totalMaximum;
    return { id, cents: Math.floor(exactCents), remainder: exactCents - Math.floor(exactCents) };
  });

  let centsLeft = totalCents - shares.reduce((sum, share) => sum + share.cents, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))) {
    if (centsLeft <= 0) break;
    share.cents += 1;
    centsLeft -= 1;
  }

  return shares
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap(share => {
      const indicator = indicatorById.get(share.id)!;
      if (share.cents <= 0 || !indicator.competency) return [];
      return [{
        indicatorId: indicator.id,
        code: indicator.code,
        label: indicator.label,
        competency: indicator.competency,
        points: share.cents / 100,
      }];
    });
}
