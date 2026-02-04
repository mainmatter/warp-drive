# Codemod Refactoring Execution Plan

## Overview

This plan outlines the changes needed to modify how the schema-migration codemod generates artifacts. The key changes are:

1. **Remove `.schema.types.ts` files** - Types will be merged into `.schema.js`/`.schema.ts`
2. **Change extension file naming** - From `{name}.ts` to `{name}.ext.js`/`{name}.ext.ts`
3. **Update output directory structure** - Resources and traits in `data/resources/` and `data/traits/`, extensions co-located with their schemas

## New File Structure

```
data/
├── resources/
│   ├── user.schema.js          # Schema + types (merged)
│   ├── user.ext.js             # Extension class (if needed)
│   ├── company.schema.ts       # Schema + types (TypeScript)
│   └── company.ext.ts          # Extension class (TypeScript)
└── traits/
    ├── timestamped.schema.js   # Trait schema + types
    └── timestamped.ext.js      # Trait extension (if needed)
```

## Trait Composition and Interface Inheritance

Resources can extend one or more traits, which means their TypeScript interfaces must be composites of multiple interfaces. When a schema includes a `traits` array, the generated interface should extend all referenced trait interfaces.

### How Trait Composition Works

1. **Schema declares traits** - The schema object includes a `traits` array listing trait names
2. **Interface extends traits** - The generated interface extends all trait interfaces
3. **Imports are collected** - All trait interfaces must be imported from their respective schema files
4. **Fields are additive** - The resource's own fields are added on top of inherited trait fields

### Example: Resource with Traits

A `User` that uses `Timestamped` and `Auditable` traits:

**Trait: `data/traits/timestamped.schema.ts`**
```typescript
const TimestampedSchema = {
  fields: [
    { kind: "attribute", name: "createdAt", type: "date" },
    { kind: "attribute", name: "updatedAt", type: "date" },
  ],
} as const;

export default TimestampedSchema;

export interface Timestamped {
  readonly createdAt: Date | null;
  readonly updatedAt: Date | null;
}
```

**Trait: `data/traits/auditable.schema.ts`**
```typescript
import type { User } from "app/data/resources/user.schema";

const AuditableSchema = {
  fields: [
    { kind: "belongsTo", name: "createdBy", type: "user", options: { async: false, inverse: null } },
    { kind: "belongsTo", name: "updatedBy", type: "user", options: { async: false, inverse: null } },
  ],
} as const;

export default AuditableSchema;

export interface Auditable {
  readonly createdBy: User | null;
  readonly updatedBy: User | null;
}
```

**Resource: `data/resources/post.schema.ts`**
```typescript
import type { Type } from "@warp-drive/core-types/symbols";
import type { Timestamped } from "app/data/traits/timestamped.schema";
import type { Auditable } from "app/data/traits/auditable.schema";
import type { User } from "app/data/resources/user.schema";

const PostSchema = {
  type: "post",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  traits: ["timestamped", "auditable"],
  fields: [
    { kind: "attribute", name: "title", type: "string" },
    { kind: "attribute", name: "content", type: "string" },
    { kind: "belongsTo", name: "author", type: "user", options: { async: false, inverse: "posts" } },
  ],
} as const;

export default PostSchema;

// Interface extends all trait interfaces
export interface Post extends Timestamped, Auditable {
  readonly [Type]: "post";
  readonly title: string | null;
  readonly content: string | null;
  readonly author: User | null;
}
```

### JavaScript Equivalent with JSDoc

For JavaScript files, trait composition uses JSDoc `@extends` or intersection types in `@typedef`:

**Resource: `data/resources/post.schema.js`**
```javascript
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { Timestamped } from "app/data/traits/timestamped.schema"
 * @import { Auditable } from "app/data/traits/auditable.schema"
 * @import { User } from "app/data/resources/user.schema"
 */

/** @type {const} */
const PostSchema = {
  type: "post",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  traits: ["timestamped", "auditable"],
  fields: [
    { kind: "attribute", name: "title", type: "string" },
    { kind: "attribute", name: "content", type: "string" },
    { kind: "belongsTo", name: "author", type: "user", options: { async: false, inverse: "posts" } },
  ],
};

export default PostSchema;

/**
 * @typedef {Timestamped & Auditable & {
 *   readonly [Type]: "post";
 *   readonly title: string | null;
 *   readonly content: string | null;
 *   readonly author: User | null;
 * }} Post
 */
```

---

## New File Formats

### Schema File (`.schema.js` / `.schema.ts`)

**JavaScript (simple resource without traits):**
```javascript
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { AsyncHasMany } from "@warp-drive/core"
 * @import { Company } from "app/data/resources/company.schema"
 * @import { Project } from "app/data/resources/project.schema"
 */

/** @type {const} */
const UserSchema = {
  type: "user",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "attribute", name: "email", type: "string" },
    { kind: "attribute", name: "isActive", type: "boolean", options: { defaultValue: false } },
    { kind: "belongsTo", name: "company", type: "company", options: { async: false, inverse: "employees" } },
    { kind: "hasMany", name: "projects", type: "project", options: { async: true, inverse: "owner" } },
  ],
};

export default UserSchema;

/**
 * @typedef {{
 *   readonly [Type]: "user";
 *   readonly name: string | null;
 *   readonly email: string | null;
 *   readonly isActive: boolean;
 *   readonly company: Company | null;
 *   readonly projects: AsyncHasMany<Project>;
 * }} User
 */
```

**TypeScript (simple resource without traits):**
```typescript
import type { Type } from "@warp-drive/core-types/symbols";
import type { AsyncHasMany } from "@warp-drive/core";
import type { Company } from "app/data/resources/company.schema";
import type { Project } from "app/data/resources/project.schema";

const UserSchema = {
  type: "user",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "attribute", name: "email", type: "string" },
    { kind: "attribute", name: "isActive", type: "boolean", options: { defaultValue: false } },
    { kind: "belongsTo", name: "company", type: "company", options: { async: false, inverse: "employees" } },
    { kind: "hasMany", name: "projects", type: "project", options: { async: true, inverse: "owner" } },
  ],
} as const;

export default UserSchema;

export interface User {
  readonly [Type]: "user";
  readonly name: string | null;
  readonly email: string | null;
  readonly isActive: boolean;
  readonly company: Company | null;
  readonly projects: AsyncHasMany<Project>;
}
```

**TypeScript (resource with traits):**
```typescript
import type { Type } from "@warp-drive/core-types/symbols";
import type { Timestamped } from "app/data/traits/timestamped.schema";
import type { Fileable } from "app/data/traits/fileable.schema";
import type { Company } from "app/data/resources/company.schema";

const EmployeeSchema = {
  type: "employee",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  traits: ["timestamped", "fileable"],
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "attribute", name: "role", type: "string" },
    { kind: "belongsTo", name: "company", type: "company", options: { async: false, inverse: "employees" } },
  ],
} as const;

export default EmployeeSchema;

// Extends trait interfaces
export interface Employee extends Timestamped, Fileable {
  readonly [Type]: "employee";
  readonly name: string | null;
  readonly role: string | null;
  readonly company: Company | null;
}
```

### Extension File (`.ext.js` / `.ext.ts`)

**JavaScript:**
```javascript
import { service } from "@ember/service";

class UserExtension {
  @service router;

  /** @returns {string} */
  get displayName() {
    return this.name || this.email;
  }

  /** @returns {string} */
  get initials() {
    return this.name
      ? this.name
          .split(" ")
          .map((n) => n[0])
          .join("")
      : "?";
  }

  /** @returns {Promise<void>} */
  async navigateToProfile() {
    return this.router.transitionTo("user.profile", this.id);
  }
}

export default UserExtension;
```

**TypeScript:**
```typescript
import { service } from "@ember/service";
import type RouterService from "@ember/routing/router-service";

class UserExtension {
  @service declare router: RouterService;

  get displayName(): string {
    return this.name || this.email;
  }

  get initials(): string {
    return this.name
      ? this.name
          .split(" ")
          .map((n) => n[0])
          .join("")
      : "?";
  }

  async navigateToProfile(): Promise<void> {
    return this.router.transitionTo("user.profile", this.id);
  }
}

export default UserExtension;

export { UserExtension };
```

---

## Execution Tasks

### Phase 1: Update Configuration and Types

#### Task 1.1: Update `ARTIFACT_CONFIG` in `tasks/migrate.ts`

**File:** `src/schema-migration/tasks/migrate.ts` (lines 57-107)

**Changes:**
- Remove `resource-type` artifact type
- Remove `trait-type` artifact type  
- Remove `extension-type` artifact type
- Update `extension` artifact to use `.ext.{js|ts}` naming
- Extensions should go to same directory as their schema (resourcesDir or traitsDir)

**Before:**
```typescript
const ARTIFACT_CONFIG: ArtifactConfig = {
  schema: { directoryKey: 'resourcesDir', defaultDir: './app/data/resources', ... },
  'resource-type': { directoryKey: 'resourcesDir', defaultDir: './app/data/resources', ... },
  trait: { directoryKey: 'traitsDir', defaultDir: './app/data/traits', ... },
  'trait-type': { directoryKey: 'traitsDir', defaultDir: './app/data/traits', ... },
  extension: { directoryKey: 'extensionsDir', defaultDir: './app/data/extensions', ... },
  'extension-type': { directoryKey: 'extensionsDir', defaultDir: './app/data/extensions', ... },
};
```

**After:**
```typescript
const ARTIFACT_CONFIG: ArtifactConfig = {
  schema: { directoryKey: 'resourcesDir', defaultDir: './app/data/resources', ... },
  trait: { directoryKey: 'traitsDir', defaultDir: './app/data/traits', ... },
  'resource-extension': { directoryKey: 'resourcesDir', defaultDir: './app/data/resources', ... },
  'trait-extension': { directoryKey: 'traitsDir', defaultDir: './app/data/traits', ... },
};
```

#### Task 1.2: Update `TransformOptions` interface

**File:** `src/schema-migration/config.ts`

**Changes:**
- Remove `extensionsDir` option (extensions are now co-located)
- Or repurpose it as optional override

---

### Phase 2: Update Schema Generation

#### Task 2.1: Modify `createTypeArtifact()` to return code instead of artifact

**File:** `src/schema-migration/utils/schema-generation.ts` (lines 375-408)

**Changes:**
- Rename to `generateTypeCode()` or similar
- Return just the interface code string, not a full artifact
- This code will be appended to the schema file

#### Task 2.2: Create new `generateSchemaWithTypes()` function

**File:** `src/schema-migration/utils/schema-generation.ts`

**New function that:**
1. Generates the schema object code (existing logic)
2. Generates the interface code (from modified `generateTypeCode()`)
3. Combines imports appropriately:
   - JS: Uses `@import` JSDoc comments for type imports
   - TS: Uses regular `import type` statements
4. Returns a single combined artifact

**Key considerations:**
- For JS files: Use `/** @import { Type } from "..." */` syntax
- For TS files: Use `import type { ... } from "..."`
- Schema should use `const` with `as const` for TS or `/** @type {const} */` for JS
- Export schema as default export
- Export interface as named export (TS only)

#### Task 2.3: Update import path generation for merged files

**File:** `src/schema-migration/utils/schema-generation.ts`

**Changes:**
- Type imports should now point to `.schema.js` or `.schema.ts` files
- Remove `.schema.types` from import paths
- Update `generateImportPath()` or equivalent functions

#### Task 2.4: Implement trait composition for interfaces

**File:** `src/schema-migration/utils/schema-generation.ts`

**New logic for generating composite interfaces:**

1. **Detect traits in schema** - Check if the schema has a `traits` array
2. **Resolve trait interfaces** - Map trait names to their interface names (e.g., `timestamped` → `Timestamped`)
3. **Generate extends clause** - Build `extends Trait1, Trait2, ...` for TypeScript interfaces
4. **Generate intersection type** - Build `Trait1 & Trait2 & { ... }` for JSDoc `@typedef`
5. **Collect trait imports** - Add imports for all trait interfaces from their schema files

**Implementation considerations:**
- Need mapping from trait name (kebab-case) to interface name (PascalCase)
- Need mapping from trait name to import path (`app/data/traits/{name}.schema`)
- Handle circular dependencies gracefully (traits referencing resources that use them)

**TypeScript output pattern:**
```typescript
import type { Timestamped } from "app/data/traits/timestamped.schema";
import type { Auditable } from "app/data/traits/auditable.schema";

export interface Post extends Timestamped, Auditable {
  readonly [Type]: "post";
  // ... own fields
}
```

**JavaScript output pattern:**
```javascript
/**
 * @import { Timestamped } from "app/data/traits/timestamped.schema"
 * @import { Auditable } from "app/data/traits/auditable.schema"
 */

/**
 * @typedef {Timestamped & Auditable & {
 *   readonly [Type]: "post";
 *   // ... own fields
 * }} Post
 */
```

#### Task 2.5: Create trait name to interface name mapping utility

**File:** `src/schema-migration/utils/schema-generation.ts` or `utils/string.ts`

**New function:**
```typescript
function traitNameToInterfaceName(traitName: string): string {
  // "timestamped" → "Timestamped"
  // "file-able" → "Fileable"  
  return toPascalCase(traitName);
}

function traitNameToImportPath(traitName: string, appPrefix: string): string {
  // "timestamped" → "app/data/traits/timestamped.schema"
  return `${appPrefix}/data/traits/${traitName}.schema`;
}
```

---

### Phase 3: Update Extension Generation

#### Task 3.1: Update extension file naming

**File:** `src/schema-migration/utils/extension-generation.ts`

**Changes:**
- Change suggested filename from `{name}.ts` to `{name}.ext.ts`
- Change suggested filename from `{name}.js` to `{name}.ext.js`

#### Task 3.2: Update extension artifact type

**File:** `src/schema-migration/utils/extension-generation.ts`

**Changes:**
- Split into `resource-extension` and `trait-extension` types
- Or add context parameter to determine output directory

#### Task 3.3: Remove extension type artifact generation

**Files:**
- `src/schema-migration/utils/extension-generation.ts`
- `src/schema-migration/processors/model.ts`

**Changes:**
- Remove calls to generate extension type artifacts
- Extension classes should only export themselves, not type interfaces
- For TS: Add named export of the class itself

#### Task 3.4: Update extension imports

**File:** `src/schema-migration/utils/extension-generation.ts`

**Changes:**
- Remove imports from `.schema.types` files
- Extensions don't need to import the resource interface anymore
- If type hints are needed, they reference the schema file

---

### Phase 4: Update Model Processor

#### Task 4.1: Modify `generateRegularModelArtifacts()`

**File:** `src/schema-migration/processors/model.ts` (lines 633-834)

**Changes:**
- Combine schema and type artifact generation into single artifact
- Call new `generateSchemaWithTypes()` function
- Update extension artifact generation to use new naming
- Remove separate type artifact push

**Current flow:**
```typescript
artifacts.push(schemaArtifact);
artifacts.push(typeArtifact);      // Remove this
artifacts.push(extensionArtifact);
```

**New flow:**
```typescript
artifacts.push(schemaWithTypesArtifact);  // Combined
artifacts.push(extensionArtifact);         // With new .ext naming
```

#### Task 4.2: Modify `generateIntermediateModelTraitArtifacts()`

**File:** `src/schema-migration/processors/model.ts` (lines 858-1089)

**Changes:**
- Same pattern as Task 4.1 but for traits
- Combine trait schema and type into single artifact
- Update trait extension naming to `.ext.{js|ts}`

#### Task 4.3: Update mixin processor similarly

**File:** `src/schema-migration/processors/mixin.ts`

**Changes:**
- Apply same patterns for trait generation from mixins

---

### Phase 5: Update Path Utilities

#### Task 5.1: Add helper for extension file naming

**File:** `src/schema-migration/utils/path-utils.ts`

**New function:**
```typescript
function getExtensionFileName(baseName: string, ext: '.js' | '.ts'): string {
  return `${baseName}.ext${ext}`;
}
```

#### Task 5.2: Update import path resolution

**File:** `src/schema-migration/utils/path-utils.ts`

**Changes:**
- Update any functions that generate import paths to types
- Remove `.schema.types` suffix handling
- Add `.ext` suffix handling for extensions

---

### Phase 6: Update Tests

#### Task 6.1: Update snapshot tests

**Directory:** `tests/codemods/`

**Changes:**
- Update all snapshots to reflect new file structure
- Remove `.schema.types.ts` snapshots
- Add combined schema+types snapshots
- Update extension file naming in snapshots

#### Task 6.2: Update test fixtures

**Changes:**
- Update expected output file names
- Update expected file contents

#### Task 6.3: Add new test cases

**New tests for:**
- JS schema with `@import` JSDoc syntax
- TS schema with combined interface
- Extension with `.ext.js`/`.ext.ts` naming
- Import paths between resources referencing `.schema.js` instead of `.schema.types.ts`
- Resource with single trait - verify interface extends trait
- Resource with multiple traits - verify interface extends all traits
- Trait composition with JSDoc intersection types (JS)
- Trait imports are correctly generated
- Circular dependency handling (trait references resource that uses it)

---

### Phase 7: Documentation and Cleanup

#### Task 7.1: Update README/documentation

- Document new file structure
- Document new file naming conventions
- Update migration guide if exists

#### Task 7.2: Remove dead code

- Remove any functions only used for type-only artifacts
- Remove unused artifact type handling

---

## Implementation Order

1. **Phase 1** - Configuration changes (foundation)
2. **Phase 2** - Schema generation changes (core logic)
3. **Phase 3** - Extension generation changes
4. **Phase 4** - Processor updates (ties it together)
5. **Phase 5** - Path utilities
6. **Phase 6** - Tests (verify everything works)
7. **Phase 7** - Cleanup and documentation

---

## Risk Areas

1. **Import path resolution** - Ensure all cross-references between schemas work correctly
2. **JSDoc `@import` syntax** - Verify this works correctly in consuming applications
3. **Backwards compatibility** - Consider migration path for existing generated files
4. **Extension class typing** - Ensure extensions can still access schema properties
5. **Trait composition complexity** - Interfaces extending multiple traits must correctly inherit all fields
6. **Circular dependencies** - Traits may reference resources that use those traits (e.g., `Auditable` references `User`, `User` uses `Auditable`)
7. **Trait name resolution** - Mapping from schema trait names to interface names and import paths must be accurate
8. **Multiple inheritance in JSDoc** - Intersection types (`A & B & C`) in JSDoc must be well-formed and usable

---

## Files to Modify (Summary)

| File | Priority | Changes |
|------|----------|---------|
| `src/schema-migration/tasks/migrate.ts` | High | Artifact config, routing |
| `src/schema-migration/utils/schema-generation.ts` | High | Merge schema + types |
| `src/schema-migration/utils/extension-generation.ts` | High | New naming, remove type artifacts |
| `src/schema-migration/processors/model.ts` | High | Artifact orchestration |
| `src/schema-migration/processors/mixin.ts` | Medium | Trait artifact changes |
| `src/schema-migration/config.ts` | Low | Options cleanup |
| `src/schema-migration/utils/path-utils.ts` | Medium | Path helpers |
| `tests/codemods/**` | High | Snapshot updates |

---

## Success Criteria

- [ ] No `.schema.types.ts` files are generated
- [ ] Schema files contain both schema object and TypeScript interface (for TS) or JSDoc types (for JS)
- [ ] Extension files use `.ext.js` or `.ext.ts` naming
- [ ] Extensions are co-located with their schemas in `resources/` or `traits/`
- [ ] Import paths correctly reference `.schema.{js|ts}` files
- [ ] All existing tests pass (after snapshot updates)
- [ ] JS files use `@import` JSDoc syntax for type imports
- [ ] TS files use `import type` for type imports
- [ ] Schema exports as default export
- [ ] Interface exports as named export (TS only)
- [ ] Resources with traits generate interfaces that extend all trait interfaces
- [ ] Trait imports are correctly added when a resource uses traits
- [ ] JSDoc `@typedef` uses intersection types for trait composition (JS)
- [ ] TypeScript interfaces use `extends` clause for trait composition (TS)
- [ ] Trait name to interface name mapping works correctly (kebab-case to PascalCase)
