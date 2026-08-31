import { Query } from '@nestjs/cqrs';
import type { UnreadCountDto } from '../../dto/notification.dto';

export class CountUnreadNotificationsQuery extends Query<UnreadCountDto> {
  constructor(
    readonly organizationId: string,
    readonly userId: string,
  ) {
    super();
  }
}
