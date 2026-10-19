import { describe, expect, it } from 'vitest';
import { intersect, normalize, subtract, total } from '../src/day/intervals';

describe('minute intervals', () => {
  it('normalize sorts, merges touching and overlapping intervals and drops empty ones', () => {
    expect(
      normalize([
        [50, 60],
        [10, 20],
        [20, 30],
        [25, 28],
        [40, 40],
        [45, 44],
      ]),
    ).toEqual([
      [10, 30],
      [50, 60],
    ]);
  });

  it('total sums the lengths', () => {
    expect(
      total([
        [10, 30],
        [50, 60],
      ]),
    ).toBe(30);
    expect(total([])).toBe(0);
  });

  it('intersect keeps the common parts', () => {
    expect(
      intersect(
        [
          [0, 10],
          [20, 30],
        ],
        [
          [5, 25],
          [28, 40],
        ],
      ),
    ).toEqual([
      [5, 10],
      [20, 25],
      [28, 30],
    ]);
    expect(intersect([[0, 10]], [[10, 20]])).toEqual([]);
  });

  it('subtract removes every part of b from a', () => {
    expect(
      subtract(
        [[0, 100]],
        [
          [10, 20],
          [90, 120],
          [-5, 2],
        ],
      ),
    ).toEqual([
      [2, 10],
      [20, 90],
    ]);
    expect(subtract([[0, 10]], [])).toEqual([[0, 10]]);
    expect(subtract([[0, 10]], [[0, 10]])).toEqual([]);
  });
});
