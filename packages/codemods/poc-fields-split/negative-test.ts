// Verify UserFields does NOT include extension methods
import type { UserFields } from './user.schema';

function test(fields: UserFields): void {
  // @ts-expect-error - displayName should NOT exist on UserFields
  fields.displayName;

  // @ts-expect-error - updateProfile should NOT exist on UserFields
  fields.updateProfile({});
}
