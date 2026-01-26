# Store Type Issue in Generated Traits

## Problem

When generating trait types for intermediate models, we need to include base `Model` class properties like `id` and `store`. However, the `store` property presents a challenge:

1. **`id`**: Can be typed as `string | null` - universal across all EmberData applications
2. **`store`**: The type depends on the application's store service implementation

## Why `store` is Application-Specific

In Ember applications, the Store is typically:

1. A service that extends the base WarpDrive/EmberData `Store` class
2. May have custom methods, properties, and type declarations
3. Is imported from the app's services directory (e.g., `soxhub-client/services/store`)

Example from AuditBoard's `base-model.d.ts`:
```typescript
import type Store from 'soxhub-client/services/store';

export default class BaseModel extends AuditboardModel {
  store: Store;  // Application-specific Store type
}
```

The warp-drive package exports `Store` from `@warp-drive/core` or as `BaseStore` from the store module, but applications typically extend this with their own Store class that has additional methods.

## Current Solution

The codemod currently only adds `id` to generated intermediate model traits, not `store`. This is because:

1. The Store type path varies by application
2. There's no universal way to determine the correct import path
3. Adding the wrong Store type causes type errors

## Ideal Solutions

### Option 1: Configuration-Based Store Type

Add a config option to specify the store type and import path:

```json
{
  "storeType": {
    "name": "Store",
    "import": "soxhub-client/services/store"
  }
}
```

The codemod would then generate:
```typescript
import type Store from 'soxhub-client/services/store';

export interface BaseTrait {
  id: string | null;
  store: Store;
}
```

### Option 2: Generic Store Interface

Use a generic `Store` interface from WarpDrive that represents the minimal store contract:

```typescript
import type { BaseStore } from '@warp-drive/core/types';

export interface BaseTrait {
  id: string | null;
  store: BaseStore;
}
```

This would require WarpDrive to export a suitable base interface.

### Option 3: Unknown Store Type

Use a loose type that allows any store:

```typescript
export interface BaseTrait {
  id: string | null;
  store: unknown;
}
```

This provides type safety for the property's existence without strict typing.

### Option 4: Manual Post-Processing

Document that users should add `store` manually to their base trait after migration:

1. Codemod generates traits without `store`
2. User adds `store: Store` with the correct import to their base trait
3. All other traits inherit `store` through the type chain

## Recommended Approach

**Option 1 (Configuration-Based)** is the most flexible and correct solution:

1. It allows applications to specify their exact Store type
2. It's consistent with other configuration patterns in the codemod
3. It generates correct, type-safe code

Implementation would involve:
1. Adding `storeType` to the config schema
2. Adding the import to generated trait type files when present
3. Adding `store` property when `storeType` is configured

Until this is implemented, users need to manually add `store` to their base trait or use one of the workarounds above.
