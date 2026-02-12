import type { UserExtension } from './user.ext';

// Simulating the [Type] symbol
declare const Type: unique symbol;

const UserSchema = {
  type: 'user',
  legacy: true,
  identity: { kind: '@id', name: 'id' },
  fields: [
    { kind: 'attribute', name: 'name', type: 'string' },
    { kind: 'attribute', name: 'email', type: 'string' },
  ],
} as const;

export default UserSchema;

export interface UserFields {
  readonly [Type]: 'user';
  readonly name: string | null;
  readonly email: string | null;
}

export interface User extends UserFields, UserExtension {}
