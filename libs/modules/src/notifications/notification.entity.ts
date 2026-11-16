import { generateId } from '@nestjs-fastify-nx/shared';

export interface NotificationProps {
  id: string;
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  id?: string;
  organizationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  createdAt?: Date;
}

export class Notification {
  private constructor(private readonly props: NotificationProps) {}

  static create(input: CreateNotificationInput): Notification {
    return new Notification({
      id: input.id ?? generateId(),
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      readAt: null,
      createdAt: input.createdAt ?? new Date(),
    });
  }

  static reconstitute(raw: NotificationProps): Notification {
    return new Notification(raw);
  }

  get isRead(): boolean {
    return this.props.readAt !== null;
  }

  get id(): string {
    return this.props.id;
  }
  get organizationId(): string {
    return this.props.organizationId;
  }
  get userId(): string {
    return this.props.userId;
  }
  get type(): string {
    return this.props.type;
  }
  get title(): string {
    return this.props.title;
  }
  get body(): string {
    return this.props.body;
  }
  get data(): Record<string, unknown> {
    return this.props.data;
  }
  get readAt(): Date | null {
    return this.props.readAt;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
}
