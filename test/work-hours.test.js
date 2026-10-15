const test = require('node:test');
const assert = require('node:assert/strict');
const { workHours } = require('../src/shared/work-hours.js');

const schedule = { timeZone: 'America/New_York', workdayStart: 9, workdayEnd: 18, workdays: [1, 2, 3, 4, 5] };
const at = (iso) => Date.parse(iso);

test('counts only the hours inside one working day', () => {
  assert.equal(workHours(at('2026-10-15T10:00:00-04:00'), at('2026-10-15T13:30:00-04:00'), schedule), 3.5);
});

test('ignores the evening, the night and the morning before work starts', () => {
  assert.equal(workHours(at('2026-10-14T17:00:00-04:00'), at('2026-10-15T10:00:00-04:00'), schedule), 2);
});

test('skips the weekend', () => {
  assert.equal(workHours(at('2026-10-16T16:00:00-04:00'), at('2026-10-19T11:00:00-04:00'), schedule), 4);
});

test('a pull request opened on Saturday starts counting on Monday at nine', () => {
  assert.equal(workHours(at('2026-10-17T12:00:00-04:00'), at('2026-10-19T09:45:00-04:00'), schedule), 0.75);
});

test('handles the daylight saving change in November', () => {
  assert.equal(workHours(at('2026-10-30T17:00:00-04:00'), at('2026-11-02T10:00:00-05:00'), schedule), 2);
});

test('is zero when the end is before the start', () => {
  assert.equal(workHours(at('2026-10-15T13:00:00-04:00'), at('2026-10-15T12:00:00-04:00'), schedule), 0);
});

test('respects another time zone', () => {
  const london = { ...schedule, timeZone: 'Europe/London' };
  assert.equal(workHours(at('2026-10-15T08:00:00Z'), at('2026-10-15T10:00:00Z'), london), 2);
});
