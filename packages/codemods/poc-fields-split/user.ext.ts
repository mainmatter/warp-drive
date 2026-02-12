import type { UserFields } from './user.schema';

export interface UserExtension extends UserFields {}

export class UserExtension {
  get displayName(): string {
    return this.name || this.email || '';
  }

  updateProfile(data: Record<string, unknown>): void {
    console.log('updating', data);
  }
}
