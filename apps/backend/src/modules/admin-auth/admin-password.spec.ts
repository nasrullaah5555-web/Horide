import { adminPasswordProblem } from './admin-accounts.service';

describe('staff password rule', () => {
  it.each([
    ['Sunrise#2026', null],
    ['Ab1!xyzw', null], // exactly 8
  ])('accepts %s', (pw, expected) => expect(adminPasswordProblem(pw)).toBe(expected));

  it.each([
    ['Ab1!xyz', /8 characters/],
    ['sunrise#2026', /capital/],
    ['Sunrise#xyz', /number/],
    ['Sunrise2026', /symbol/],
    ['Password1!', /too easy/],
    ['MyMusride#1', /too easy/],
    ['Abc!12345', /too easy/],
  ])('refuses %s', (pw, problem) => expect(adminPasswordProblem(pw)).toMatch(problem));
});
