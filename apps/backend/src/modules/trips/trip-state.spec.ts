import type { TripParty, TripStatus } from '../../database/types';
import { judgePoint } from '../locations/location-rules';
import { canTransition, TRANSITIONS, type TripAction } from './trip-state';

const ALL: TripStatus[] = [
  'requested',
  'searching',
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
];
const PARTIES: TripParty[] = ['passenger', 'driver', 'admin', 'system'];

describe('trip state machine', () => {
  it('final states cannot change', () => {
    for (const action of Object.keys(TRANSITIONS) as TripAction[]) {
      for (const party of PARTIES) {
        for (const from of ['completed', 'cancelled', 'expired'] as TripStatus[]) {
          expect(canTransition(action, party, from)).toBe(false);
        }
      }
    }
  });

  it('only drivers drive the trip forward', () => {
    for (const action of ['accept', 'arrive', 'start', 'complete'] as TripAction[]) {
      expect(canTransition(action, 'passenger', TRANSITIONS[action].from[0]!)).toBe(false);
      expect(canTransition(action, 'driver', TRANSITIONS[action].from[0]!)).toBe(true);
    }
  });

  it('a trip in progress can only be cancelled by an admin', () => {
    expect(canTransition('cancel', 'passenger', 'in_progress')).toBe(false);
    expect(canTransition('cancel', 'driver', 'in_progress')).toBe(false);
    expect(canTransition('cancel', 'admin', 'in_progress')).toBe(true);
  });

  it('a driver cannot cancel a trip they have not accepted', () => {
    expect(canTransition('cancel', 'driver', 'searching')).toBe(false);
  });

  it('cannot skip steps', () => {
    expect(canTransition('start', 'driver', 'accepted')).toBe(false);
    expect(canTransition('complete', 'driver', 'arrived')).toBe(false);
    expect(ALL.filter((s) => canTransition('complete', 'driver', s))).toEqual(['in_progress']);
  });
});

describe('location plausibility', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000);
  const base = { lat: 9.35, lng: 42.8 };

  it('accepts normal points and GPS jitter', () => {
    expect(judgePoint({ ...base, recordedAt: at(0), accuracyM: 10 }, null, now)).toBe('ok');
    // 150 m in 1 s would be 540 km/h, but under 200 m is treated as jitter.
    expect(
      judgePoint(
        { lat: 9.3513, lng: 42.8, recordedAt: at(0) },
        { ...base, recordedAt: at(1) },
        now,
      ),
    ).toBe('ok');
  });

  it('flags teleports, inaccurate, future and old points', () => {
    expect(
      judgePoint({ lat: 9.4, lng: 42.8, recordedAt: at(0) }, { ...base, recordedAt: at(10) }, now),
    ).toBe('implausible_jump');
    expect(judgePoint({ ...base, recordedAt: at(0), accuracyM: 150 }, null, now)).toBe(
      'inaccurate',
    );
    expect(judgePoint({ ...base, recordedAt: at(-60) }, null, now)).toBe('future');
    expect(judgePoint({ ...base, recordedAt: at(300) }, null, now)).toBe('too_old');
  });
});
