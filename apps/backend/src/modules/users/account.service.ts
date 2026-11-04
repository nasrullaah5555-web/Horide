import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AppError } from '../../common/errors';
import { DATABASE } from '../../database/database.module';
import type { DB } from '../../database/types';

/**
 * Account status checks for actions that change things (booking, going online, uploading).
 * Access tokens are valid for 15 minutes without a database lookup, so a suspension must be
 * checked here, at the moment of each important action.
 */
@Injectable()
export class AccountService {
  constructor(@Inject(DATABASE) private readonly db: Kysely<DB>) {}

  async requireActive(userId: string): Promise<void> {
    const user = await this.db
      .selectFrom('users')
      .select(['status', 'suspended_reason'])
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user || user.status === 'deleted') {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please log in.');
    }
    if (user.status === 'suspended') {
      throw new AppError(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_SUSPENDED',
        'Your account is suspended. Contact Horide support.',
        { reason: user.suspended_reason },
      );
    }
  }
}
