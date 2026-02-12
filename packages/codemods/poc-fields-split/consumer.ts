// This file simulates a consumer importing the complete User type
import type { User } from './user.schema';

// User should have BOTH field types and extension methods
function greetUser(user: User): string {
  // Field access (from UserFields)
  const name: string | null = user.name;
  const email: string | null = user.email;

  // Extension method access (from UserExtension via declaration merging)
  const display: string = user.displayName;
  user.updateProfile({ name: 'new name' });

  return `Hello ${display}, name=${name}, email=${email}`;
}
