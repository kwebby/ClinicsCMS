/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe, expect, it } from 'vitest';
import { wallTime, wallTimeCandidates, zonedDateKey } from '../../apps/web/lib/datetime.js';

describe('clinic timezone appointment input', () => {
  it('rejects the spring DST gap instead of moving a booking', () => {
    expect(wallTimeCandidates('2026-03-08T02:30', 'America/New_York')).toEqual([]);
  });
  it('requires a choice between both occurrences of a repeated DST time', () => {
    expect(wallTimeCandidates('2026-11-01T01:30', 'America/New_York')).toEqual([
      '2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z',
    ]);
  });
  it('resolves fractional offsets and uses the clinic date for the day queue', () => {
    expect(wallTimeCandidates('2026-10-09T09:00', 'Asia/Kolkata')).toEqual(['2026-10-09T03:30:00.000Z']);
    expect(wallTime('2026-10-09T23:45:00Z', 'Asia/Kolkata')).toBe('2026-10-10T05:15');
    expect(zonedDateKey('2026-10-09T23:45:00Z', 'Asia/Kolkata')).toBe('2026-10-10');
    expect(zonedDateKey('2026-10-09T23:45:00Z', 'America/Los_Angeles')).toBe('2026-10-09');
  });
  it('rejects malformed or impossible calendar values', () => {
    expect(wallTimeCandidates('tomorrow', 'UTC')).toEqual([]);
    expect(wallTimeCandidates('2026-02-30T09:00', 'UTC')).toEqual([]);
  });
});
