import type { TripParty, TripStatus } from '../../database/types';

/**
 * The trip lifecycle. Every status change in the system goes through this table;
 * anything not listed is refused.
 *
 *   searching → accepted → driver_arriving → arrived → in_progress → completed
 *   (searching may also become expired; non-final states may become cancelled)
 */
export type TripAction =
  'accept' | 'arriving' | 'arrive' | 'start' | 'complete' | 'cancel' | 'expire';

interface Rule {
  from: readonly TripStatus[];
  to: TripStatus;
  by: readonly TripParty[];
}

export const TRANSITIONS: Record<TripAction, Rule> = {
  accept: { from: ['searching'], to: 'accepted', by: ['driver'] },
  arriving: { from: ['accepted'], to: 'driver_arriving', by: ['driver'] },
  arrive: { from: ['accepted', 'driver_arriving'], to: 'arrived', by: ['driver'] },
  start: { from: ['arrived'], to: 'in_progress', by: ['driver'] },
  complete: { from: ['in_progress'], to: 'completed', by: ['driver'] },
  expire: { from: ['requested', 'searching'], to: 'expired', by: ['system'] },
  // Cancellation is checked per party below: nobody but an admin may cancel a trip in progress.
  cancel: {
    from: ['requested', 'searching', 'accepted', 'driver_arriving', 'arrived', 'in_progress'],
    to: 'cancelled',
    by: ['passenger', 'driver', 'admin', 'system'],
  },
};

const CANCELLABLE_BY: Record<TripParty, readonly TripStatus[]> = {
  passenger: ['requested', 'searching', 'accepted', 'driver_arriving', 'arrived'],
  driver: ['accepted', 'driver_arriving', 'arrived'],
  admin: ['requested', 'searching', 'accepted', 'driver_arriving', 'arrived', 'in_progress'],
  system: ['requested', 'searching'],
};

export const ACTIVE_STATUSES: readonly TripStatus[] = [
  'accepted',
  'driver_arriving',
  'arrived',
  'in_progress',
];
export const OPEN_STATUSES: readonly TripStatus[] = ['requested', 'searching', ...ACTIVE_STATUSES];
export const FINAL_STATUSES: readonly TripStatus[] = ['completed', 'cancelled', 'expired'];

/** The statuses from which `party` may perform `action`. Empty if never allowed. */
export function allowedFrom(action: TripAction, party: TripParty): readonly TripStatus[] {
  const rule = TRANSITIONS[action];
  if (!rule.by.includes(party)) return [];
  return action === 'cancel' ? CANCELLABLE_BY[party] : rule.from;
}

export function canTransition(action: TripAction, party: TripParty, from: TripStatus): boolean {
  return allowedFrom(action, party).includes(from);
}
