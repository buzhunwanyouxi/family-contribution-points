import { describe, expect, it } from 'vitest';
import { previewSettlement, roundToStep } from './settle.js';

const owner = (percent: number) => ({ scorerId: 'dad', isOwner: true, percent });
const member = (id: string, percent: number) => ({ scorerId: id, isOwner: false, percent });

describe('settle() - PROJECT_GUIDE 4.5', () => {
  it('E3: perfect score on a 3 point task yields 3 points', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [owner(100)] });
    expect(r.points).toBe(3);
    expect(r.settledBy).toBe('owner');
  });

  it('E3: the guide example - 40% of 3 points is 1.2', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [owner(40)] });
    expect(r.percent).toBe(40);
    expect(r.points).toBe(1.2);
  });

  it('E4: the owner score wins over a crowd of other scores', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [owner(80), member('sis', 10), member('mom', 20)] });
    expect(r.percent).toBe(80);
    expect(r.settledBy).toBe('owner');
  });

  it('E4/E8: without an owner score the others average decides, and it is provisional', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [member('sis', 50), member('mom', 60)] });
    expect(r.percent).toBe(55);
    expect(r.points).toBe(1.65);
    expect(r.settledBy).toBe('others_avg');
    expect(r.provisional).toBe(true);
  });

  it('E6: percentages are rounded to a 5% step', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [member('a', 42), member('b', 43)] });
    expect(r.percent).toBe(45); // 42.5 -> 45
  });

  it('E5: a score below the floor is clamped up to the floor', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [owner(5)] });
    expect(r.percent).toBe(30);
    expect(r.points).toBe(0.9);
  });

  it('E9: no scores at all fall back to 60% and stay provisional', () => {
    const r = previewSettlement({ maxPoints: 3, scores: [] });
    expect(r.percent).toBe(60);
    expect(r.points).toBe(1.8);
    expect(r.settledBy).toBe('fallback_60');
    expect(r.provisional).toBe(true);
  });

  it('roundToStep never returns a value outside 0..100 for sane input', () => {
    expect(roundToStep(100)).toBe(100);
    expect(roundToStep(0)).toBe(0);
  });
});