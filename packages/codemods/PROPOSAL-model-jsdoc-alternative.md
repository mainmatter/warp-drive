# Proposal: JSDoc Alternative for Consolidated Model Output

## Overview

This proposal extends the [Consolidated Single-File Codemod Output](./PROPOSAL-consolidated-output.md) proposal by introducing a **JSDoc mode** for Model transformations. Instead of generating separate TypeScript declaration files for model resources, type information is embedded directly in the JavaScript file using JSDoc annotations.

## Motivation

The original proposal focused on mixin transformations and explicitly excluded model transformations. This proposal addresses model transformations, which currently produce multiple files per model:

1. **Schema file**: `resources/*.schema.js` - Runtime schema definition
2. **Type file**: `resources/*.schema.types.ts` - TypeScript interface
3. **Extension file**: `extensions/*.js` - Behavioral code (if any)

JSDoc mode eliminates the need for separate type files by embedding types as comments in the JavaScript files.

## Prerequisites

- **TypeScript 5.5+** required for the `@import` syntax
- Project must have `checkJs: true` or `allowJs: true` in `tsconfig.json` for type checking

---

## Output Format

### Complete Example

**Input:**

```javascript
// models/user.js
import Model, { attr, belongsTo, hasMany } from "@ember-data/model";
import { service } from "@ember/service";

export default class User extends Model {
  @attr("string") name;
  @attr("string") email;
  @attr("boolean", { defaultValue: false }) isActive;
  @belongsTo("company", { async: false, inverse: "employees" }) company;
  @hasMany("project", { async: true, inverse: "owner" }) projects;

  @service router;

  get displayName() {
    return this.name || this.email;
  }

  get initials() {
    return this.name
      ? this.name
          .split(" ")
          .map((n) => n[0])
          .join("")
      : "?";
  }

  async navigateToProfile() {
    return this.router.transitionTo("user.profile", this.id);
  }
}
```

**Output (JSDoc mode) - Single file:**

```javascript
// resources/user.js
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { AsyncHasMany } from "@warp-drive/core"
 * @import { Company } from "app/data/resources/company"
 * @import { Project } from "app/data/resources/project"
 */

import { service } from "@ember/service";

/** @type {const} */
export const UserSchema = {
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

/**
 * @typedef {object} User
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {string | null} name
 * @property {string | null} email
 * @property {boolean} isActive
 * @property {Company | null} company
 * @property {AsyncHasMany<Project>} projects
 */

/**
 * @typedef {object} UserExtensionType
 * @property {string} displayName
 * @property {string} initials
 * @property {() => Promise<void>} navigateToProfile
 */

/**
 * Extension class for User resource behavioral code
 * @implements {User}
 */
export class UserExtension {
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

/** @typedef {typeof UserExtension} UserExtensionSignature */
```

---

## JSDoc Patterns for Models

### Type Imports

TypeScript 5.5+ supports the `@import` tag for importing types:

```javascript
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { HasMany, BelongsTo, AsyncHasMany, AsyncBelongsTo } from "@warp-drive/core"
 * @import { Company } from "app/data/resources/company"
 * @import { Project } from "app/data/resources/project"
 */
```

### Const Assertion for Schema

To achieve the equivalent of TypeScript's `as const`:

```javascript
/** @type {const} */
export const UserSchema = {
  type: "user",
  legacy: true,
  // ...
};
```

This ensures the schema object is treated as a literal type with readonly properties, enabling type derivation.

### Resource Interface (typedef)

Interfaces are defined using `@typedef`:

```javascript
/**
 * @typedef {object} User
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {string | null} name
 * @property {string | null} email
 * @property {boolean} isActive
 * @property {Company | null} company
 * @property {AsyncHasMany<Project>} projects
 */
```

### Extension Class Annotation

For extension classes with methods and getters:

```javascript
/**
 * Extension class for User resource behavioral code
 * @implements {User}
 */
export class UserExtension {
  /** @returns {string} */
  get displayName() {
    return this.name || this.email;
  }
}
```

### Method Return Types

Individual method return types can be annotated:

```javascript
/** @returns {Promise<void>} */
async navigateToProfile() {
  return this.router.transitionTo('user.profile', this.id);
}
```

### Method Parameters

Method parameters can be typed inline:

```javascript
/**
 * @param {string} role
 * @returns {boolean}
 */
hasRole(role) {
  return this.roles.includes(role);
}
```

---

## Edge Cases

### Model with NO Behavioral Code

When a model contains only data fields, the extension class is omitted:

```javascript
// resources/tag.js
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 */

/** @type {const} */
export const TagSchema = {
  type: "tag",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "attribute", name: "color", type: "string" },
  ],
};

/**
 * @typedef {object} Tag
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {string | null} name
 * @property {string | null} color
 */

// NOTE: No TagExtension - omitted when no behavioral code exists
```

### Model with ONLY Behavioral Code (Rare)

When a model contains only methods (extends a base with all fields), the schema has an empty fields array:

```javascript
// resources/auditable.js

/** @type {const} */
export const AuditableSchema = {
  type: "auditable",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [],
};

/**
 * @typedef {object} Auditable
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 */

/**
 * @typedef {object} AuditableExtensionType
 * @property {() => void} logAudit
 */

/** @implements {Auditable} */
export class AuditableExtension {
  logAudit() {
    console.log(`Audit: ${this.id} accessed at ${new Date()}`);
  }
}
```

### Model with Traits (Mixins)

When a model uses mixins/traits, reference them in the schema:

```javascript
// resources/document.js
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { AsyncHasMany } from "@warp-drive/core"
 * @import { File } from "app/data/resources/file"
 * @import { FileableTrait } from "app/data/traits/fileable"
 * @import { AmendableTrait } from "app/data/traits/amendable"
 */

/** @type {const} */
export const DocumentSchema = {
  type: "document",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  traits: ["fileable", "amendable"],
  fields: [
    { kind: "attribute", name: "title", type: "string" },
    { kind: "attribute", name: "content", type: "string" },
  ],
};

/**
 * Resource interface combining own fields with traits
 * @typedef {object} DocumentOwnFields
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {string | null} title
 * @property {string | null} content
 */

/** @typedef {DocumentOwnFields & FileableTrait & AmendableTrait} Document */
```

### Model with Fragment Fields

When a model contains fragment fields (embedded objects):

```javascript
// resources/contact.js
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { Address } from "app/data/fragments/address"
 * @import { PhoneNumber } from "app/data/fragments/phone-number"
 */

/** @type {const} */
export const ContactSchema = {
  type: "contact",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  fields: [
    { kind: "attribute", name: "name", type: "string" },
    { kind: "schema-object", name: "address", type: "fragment:address" },
    { kind: "schema-array", name: "phoneNumbers", type: "fragment:phone-number" },
  ],
};

/**
 * @typedef {object} Contact
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {string | null} name
 * @property {Address | null} address
 * @property {PhoneNumber[]} phoneNumbers
 */
```

### Model Extending Intermediate Base Class

When a model extends an intermediate model (configured via `intermediateModelPaths`):

```javascript
// resources/auditable-record.js
/**
 * @import { Type } from "@warp-drive/core-types/symbols"
 * @import { BaseModelTrait } from "app/data/traits/base-model"
 */

/** @type {const} */
export const AuditableRecordSchema = {
  type: "auditable-record",
  legacy: true,
  identity: {
    kind: "@id",
    name: "id",
  },
  traits: ["base-model"],
  fields: [
    { kind: "attribute", name: "createdAt", type: "date" },
    { kind: "attribute", name: "updatedAt", type: "date" },
    { kind: "attribute", name: "createdBy", type: "string" },
  ],
};

/**
 * @typedef {object} AuditableRecordOwnFields
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {Date | null} createdAt
 * @property {Date | null} updatedAt
 * @property {string | null} createdBy
 */

/** @typedef {AuditableRecordOwnFields & BaseModelTrait} AuditableRecord */
```

---

## Complex Field Types

For different field kinds, use appropriate type mappings:

```javascript
/**
 * @import { HasMany, BelongsTo, AsyncHasMany, AsyncBelongsTo } from "@warp-drive/core"
 * @import { File } from "app/data/resources/file"
 * @import { User } from "app/data/resources/user"
 * @import { Address } from "app/data/fragments/address"
 */

/**
 * @typedef {object} ExampleResource
 * @property {typeof Type} [Type] - Resource type identifier
 * @property {string} id - Unique identifier
 * @property {HasMany<File>} files - sync hasMany
 * @property {AsyncHasMany<File>} asyncFiles - async hasMany
 * @property {BelongsTo<User>} owner - sync belongsTo
 * @property {AsyncBelongsTo<User>} asyncOwner - async belongsTo
 * @property {string | null} name - string attribute (nullable)
 * @property {number | null} count - number attribute (nullable)
 * @property {boolean} active - boolean attribute (with default, non-nullable)
 * @property {Date | null} createdAt - date attribute
 * @property {string[]} tags - array attribute
 * @property {Record<string, unknown>} metadata - object attribute
 * @property {Address | null} address - schema-object (fragment)
 * @property {Address[]} addresses - schema-array (fragment array)
 */
```

---

## Configuration

### Updated Options

```typescript
interface ConsolidatedOutputOptions {
  // Existing options...

  /**
   * Output mode for consolidated resource files
   * - 'typescript': Single .ts file with inline interface
   * - 'javascript': .js file + separate .d.ts file
   * - 'jsdoc': Single .js file with inline JSDoc type annotations (requires TS 5.5+)
   * - 'preserve': Match source file extension (default)
   */
  consolidatedResourceOutput?: "typescript" | "javascript" | "jsdoc" | "preserve";
}
```

### Usage

```javascript
// codemod.config.js
module.exports = {
  consolidatedResourceOutput: "jsdoc",
  // ... other options
};
```

---

## Comparison Table

| Aspect                  | Multi-file (Current) | Consolidated TS  | Consolidated JS       | **Consolidated JSDoc** |
| ----------------------- | -------------------- | ---------------- | --------------------- | ---------------------- |
| **Files per model**     | Up to 3              | 1-2 (`.ts`)      | 2-3 (`.js` + `.d.ts`) | **1-2 (`.js`)**        |
| **Schema location**     | `*.schema.js`        | Inline           | Inline                | **Inline**             |
| **Type location**       | `*.schema.types.ts`  | Inline interface | Separate `.d.ts`      | **Inline JSDoc**       |
| **Extension location**  | `extensions/*.js`    | Same file        | Same file             | **Same file**          |
| **Type-runtime sync**   | Manual               | Automatic        | Manual                | **Automatic**          |
| **TS version required** | Any                  | Any              | Any                   | **5.5+**               |
| **IDE support**         | Excellent            | Excellent        | Excellent             | Excellent              |
| **Pure JavaScript**     | No                   | No               | Yes (runtime)         | **Yes**                |

---

## JSDoc Quick Reference for Models

| TypeScript                        | JSDoc Equivalent                                        |
| --------------------------------- | ------------------------------------------------------- |
| `as const`                        | `/** @type {const} */`                                  |
| `interface User { name: string }` | `/** @typedef {object} User @property {string} name */` |
| `import type { X } from "mod"`    | `/** @import { X } from "mod" */`                       |
| `param: Type`                     | `@param {Type} param`                                   |
| `function(): Type`                | `@returns {Type}`                                       |
| `prop?: Type`                     | `@property {Type} [prop]`                               |
| `readonly prop: Type`             | `@property {Readonly<Type>} prop`                       |
| `class X implements Y`            | `/** @implements {Y} */ class X`                        |
| `readonly [Type]: 'user'`         | `@property {typeof Type} [Type]`                        |
| `Foo & Bar`                       | `@typedef {Foo & Bar} Combined`                         |

---

## Benefits

1. **Single file output**: Only one file to manage per model (or two if extension is separate)
2. **Self-documenting code**: Types serve as inline documentation
3. **No synchronization issues**: Types and schema cannot drift apart
4. **Simpler tooling**: No need to generate or coordinate separate type files
5. **Standard JavaScript**: Works in any JS runtime; types are comments that get stripped
6. **Gradual adoption**: Can mix JSDoc and TypeScript files in the same project
7. **Colocation**: Schema, types, and extension live together

---

## Trade-offs

1. **Verbosity**: JSDoc syntax is more verbose than TypeScript
2. **TypeScript 5.5+ required**: The `@import` syntax is relatively new
3. **Limited type expressiveness**: Complex mapped types and conditionals are harder to express
4. **Comment noise**: More comment lines in source files
5. **Less familiar**: Developers may be less familiar with JSDoc typing patterns
6. **Larger files**: Combined schema + types + extension can be lengthy

---

## When to Use Each Mode

| Scenario                                   | Recommended Mode            |
| ------------------------------------------ | --------------------------- |
| TypeScript project                         | `typescript`                |
| JavaScript project, simple models, TS 5.5+ | `jsdoc`                     |
| JavaScript project, complex types          | `javascript` (with `.d.ts`) |
| JavaScript project, legacy TS support      | `javascript` (with `.d.ts`) |
| Mixed project, preserve original format    | `preserve`                  |

---

## Migration Notes

For projects switching from `javascript` mode (with `.d.ts` files) to `jsdoc` mode:

1. Update the `consolidatedResourceOutput` configuration to `'jsdoc'`
2. Re-run the codemod to regenerate output files
3. Delete the now-obsolete `.d.ts` and `.schema.types.ts` files
4. Ensure `tsconfig.json` has `checkJs: true` or `allowJs: true`
5. Verify TypeScript version is 5.5 or higher
6. Update any imports that referenced the old type files

---

## Appendix: Full Type Mapping Reference

### Attribute Types

| Attribute Type   | JSDoc Property Type         | Notes                        |
| ---------------- | --------------------------- | ---------------------------- |
| `string`         | `{string \| null}`          | Nullable unless has default  |
| `number`         | `{number \| null}`          | Nullable unless has default  |
| `boolean`        | `{boolean}`                 | Non-null if has defaultValue |
| `date`           | `{Date \| null}`            | Nullable                     |
| `object`         | `{Record<string, unknown>}` | Generic object               |
| `array`          | `{unknown[]}`               | Generic array                |
| Custom transform | `{TransformReturnType}`     | Use transform's return type  |

### Relationship Types

| Relationship | Async   | JSDoc Property Type             |
| ------------ | ------- | ------------------------------- |
| `belongsTo`  | `false` | `{RelatedType \| null}`         |
| `belongsTo`  | `true`  | `{AsyncBelongsTo<RelatedType>}` |
| `hasMany`    | `false` | `{HasMany<RelatedType>}`        |
| `hasMany`    | `true`  | `{AsyncHasMany<RelatedType>}`   |

### Fragment Types

| Fragment Kind   | JSDoc Property Type      |
| --------------- | ------------------------ |
| `schema-object` | `{FragmentType \| null}` |
| `schema-array`  | `{FragmentType[]}`       |

### Identity Field

| Identity Kind | JSDoc Property Type |
| ------------- | ------------------- |
| `@id`         | `{string}`          |
| `@lid`        | `{string}`          |

---

## Appendix: Export Naming Conventions

| Export             | Naming Pattern                       | Example                  |
| ------------------ | ------------------------------------ | ------------------------ |
| Schema             | `{PascalCaseName}Schema`             | `UserSchema`             |
| Resource Interface | `{PascalCaseName}`                   | `User`                   |
| Extension Class    | `{PascalCaseName}Extension`          | `UserExtension`          |
| Extension Type     | `{PascalCaseName}ExtensionSignature` | `UserExtensionSignature` |

---

## Appendix: Comparison with Trait JSDoc Proposal

This proposal for models mirrors the [JSDoc Alternative for Traits](./PROPOSAL-jsdoc-alternative.md) proposal. Key differences:

| Aspect          | Trait (Mixin) Migration | Model Migration                         |
| --------------- | ----------------------- | --------------------------------------- |
| **Output dir**  | `traits/`               | `resources/`                            |
| **Schema name** | `{name}Trait`           | `{Name}Schema`                          |
| **Schema key**  | `name: "traitName"`     | `type: "resource-type"`                 |
| **Identity**    | None                    | `identity: { kind: '@id', name: 'id' }` |
| **Traits ref**  | N/A                     | `traits: ['trait-name']`                |
| **Extension**   | Object literal          | Class                                   |
| **Interface**   | `{Name}Trait`           | `{Name}`                                |

Both proposals share the same JSDoc patterns, TypeScript 5.5+ requirement, and configuration approach.
