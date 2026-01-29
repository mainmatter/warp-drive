# Proposal: JSDoc Alternative for Consolidated Output

## Overview

This proposal extends the [Consolidated Single-File Codemod Output](./PROPOSAL-consolidated-output.md) proposal by introducing a **JSDoc mode** as an alternative to `.d.ts` files for JavaScript sources. Instead of generating a separate TypeScript declaration file, type information is embedded directly in the JavaScript file using JSDoc annotations.

## Motivation

The original proposal suggests two output modes for JavaScript sources:

1. **TypeScript mode**: Single `.ts` file with inline interfaces
2. **JavaScript mode**: `.js` file + separate `.d.ts` file

The JavaScript mode still requires maintaining two files that must stay in sync. JSDoc mode eliminates this by embedding types as comments in the JavaScript file itself.

## Prerequisites

- **TypeScript 5.5+** required for the `@import` syntax
- Project must have `checkJs: true` or `allowJs: true` in `tsconfig.json` for type checking

---

## Output Format

### Complete Example

**Input:**

```javascript
// mixins/fileable.js
import Mixin from "@ember/object/mixin";
import { computed } from "@ember/object";
import { attr, hasMany } from "@ember-data/model";

export default Mixin.create({
  files: hasMany("file", { async: false, inverse: "fileable", as: "fileable" }),
  showFilesRequiringReviewError: attr("boolean", { defaultValue: false }),

  hasFiles: computed("files.length", function () {
    return this.files.length > 0;
  }),

  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
});
```

**Output (JSDoc mode):**

```javascript
// traits/fileable.js
/**
 * @import { HasMany } from "@warp-drive/core"
 * @import { File } from "app/data/resources/file"
 */

import { computed } from "@ember/object";

/** @type {const} */
export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    { name: "files", kind: "hasMany", type: "file", options: { async: false, inverse: "fileable", as: "fileable" } },
    { name: "showFilesRequiringReviewError", kind: "attribute", type: "boolean", options: { defaultValue: false } },
  ],
};

/**
 * @typedef {object} FileableTrait
 * @property {HasMany<File>} files
 * @property {boolean} showFilesRequiringReviewError
 */

/** @type {{ hasFiles: boolean, hasDuplicateFileName(file: File): boolean }} */
export const fileableExtension = {
  hasFiles: computed("files.length", function () {
    return this.files.length > 0;
  }),

  /** @param {File} file */
  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
};
```

---

## JSDoc Patterns

### Type Imports

TypeScript 5.5+ supports the `@import` tag for importing types:

```javascript
/**
 * @import { HasMany, BelongsTo } from "@warp-drive/core"
 * @import { File } from "app/data/resources/file"
 * @import { User } from "app/data/resources/user"
 */
```

Multiple types can be imported from the same module on a single line, or split across multiple `@import` tags.

### Const Assertion

To achieve the equivalent of TypeScript's `as const`:

```javascript
/** @type {const} */
export const myTrait = {
  name: "myTrait",
  // ...
};
```

This ensures the object is treated as a literal type with readonly properties.

### Interface Definition (typedef)

Interfaces are defined using `@typedef`:

```javascript
/**
 * @typedef {object} FileableTrait
 * @property {HasMany<File>} files
 * @property {boolean} showFilesRequiringReviewError
 */
```

### Object Type Annotation

For extension objects with methods:

```javascript
/** @type {{ hasFiles: boolean, hasDuplicateFileName(file: File): boolean }} */
export const fileableExtension = {
  // ...
};
```

### Method Parameters

Individual method parameters can be typed inline:

```javascript
/** @param {File} file */
hasDuplicateFileName(file) {
  return Boolean(this.files.find((f) => f.name === file.name));
}
```

---

## Edge Cases

### Mixin with NO Behavioral Code

When a mixin contains only data fields, the extension is omitted:

```javascript
// traits/amendable.js
/**
 * @import { HasMany } from "@warp-drive/core"
 * @import { Amendment } from "app/data/resources/amendment"
 */

/** @type {const} */
export const amendableTrait = {
  name: "amendable",
  mode: "legacy",
  fields: [
    {
      name: "amendments",
      kind: "hasMany",
      type: "amendment",
      options: { async: false, inverse: "amendable", as: "amendable" },
    },
  ],
};

/**
 * @typedef {object} AmendableTrait
 * @property {HasMany<Amendment>} amendments
 */
```

### Mixin with ONLY Behavioral Code

When a mixin contains only methods, the trait has an empty fields array:

```javascript
// traits/sortable.js

/** @type {const} */
export const sortableTrait = {
  name: "sortable",
  mode: "legacy",
  fields: [],
};

/**
 * @typedef {object} SortableTrait
 */

/** @type {{ sortBy(key: string): unknown[] }} */
export const sortableExtension = {
  /** @param {string} key */
  sortBy(key) {
    return this.items.sortBy(key);
  },
};
```

### Complex Field Types

For different field kinds, use appropriate type mappings:

```javascript
/**
 * @import { HasMany, BelongsTo, AsyncHasMany, AsyncBelongsTo } from "@warp-drive/core"
 * @import { File } from "app/data/resources/file"
 * @import { User } from "app/data/resources/user"
 */

/**
 * @typedef {object} ExampleTrait
 * @property {HasMany<File>} files - sync hasMany
 * @property {AsyncHasMany<File>} asyncFiles - async hasMany
 * @property {BelongsTo<User>} owner - sync belongsTo
 * @property {AsyncBelongsTo<User>} asyncOwner - async belongsTo
 * @property {string} name - string attribute
 * @property {number} count - number attribute
 * @property {boolean} active - boolean attribute
 * @property {Date} createdAt - date attribute
 * @property {string[]} tags - array attribute
 * @property {{ key: string, value: unknown }} metadata - object attribute
 */
```

---

## Configuration

### Updated Options

```typescript
interface ConsolidatedOutputOptions {
  // Existing options...

  /**
   * Output mode for consolidated files
   * - 'typescript': Single .ts file with inline interface
   * - 'javascript': .js file + separate .d.ts file
   * - 'jsdoc': Single .js file with inline JSDoc type annotations (requires TS 5.5+)
   * - 'preserve': Match source file extension (default)
   */
  consolidatedOutput?: "typescript" | "javascript" | "jsdoc" | "preserve";
}
```

### Usage

```javascript
// codemod.config.js
module.exports = {
  consolidatedOutput: "jsdoc",
  // ... other options
};
```

---

## Comparison Table

| Aspect                  | Multi-file (Current) | Consolidated TS  | Consolidated JS     | **Consolidated JSDoc** |
| ----------------------- | -------------------- | ---------------- | ------------------- | ---------------------- |
| **Files per mixin**     | Up to 4              | 1 (`.ts`)        | 2 (`.js` + `.d.ts`) | **1 (`.js`)**          |
| **Type location**       | Separate `.types.ts` | Inline interface | Separate `.d.ts`    | **Inline JSDoc**       |
| **Type-runtime sync**   | Manual               | Automatic        | Manual              | **Automatic**          |
| **TS version required** | Any                  | Any              | Any                 | **5.5+**               |
| **IDE support**         | Excellent            | Excellent        | Excellent           | Excellent              |
| **Pure JavaScript**     | No                   | No               | Yes (runtime)       | **Yes**                |

---

## JSDoc Quick Reference

| TypeScript                     | JSDoc Equivalent                                     |
| ------------------------------ | ---------------------------------------------------- |
| `as const`                     | `/** @type {const} */`                               |
| `interface Foo { prop: Type }` | `/** @typedef {object} Foo @property {Type} prop */` |
| `import type { X } from "mod"` | `/** @import { X } from "mod" */`                    |
| `param: Type`                  | `@param {Type} param`                                |
| `function(): Type`             | `@returns {Type}`                                    |
| `prop?: Type`                  | `@property {Type} [prop]`                            |
| `readonly prop: Type`          | `@property {Readonly<Type>} prop`                    |

---

## Benefits

1. **Single file output**: Only one file to manage per mixin
2. **Self-documenting code**: Types serve as inline documentation
3. **No synchronization issues**: Types and implementation cannot drift apart
4. **Simpler tooling**: No need to generate or coordinate two files
5. **Standard JavaScript**: Works in any JS runtime; types are comments that get stripped
6. **Gradual adoption**: Can mix JSDoc and TypeScript files in the same project

---

## Trade-offs

1. **Verbosity**: JSDoc syntax is more verbose than TypeScript
2. **TypeScript 5.5+ required**: The `@import` syntax is relatively new
3. **Limited type expressiveness**: Complex mapped types and conditionals are harder to express
4. **Comment noise**: More comment lines in source files
5. **Less familiar**: Developers may be less familiar with JSDoc typing patterns

---

## When to Use Each Mode

| Scenario                                  | Recommended Mode            |
| ----------------------------------------- | --------------------------- |
| TypeScript project                        | `typescript`                |
| JavaScript project, simple types, TS 5.5+ | `jsdoc`                     |
| JavaScript project, complex types         | `javascript` (with `.d.ts`) |
| JavaScript project, legacy TS support     | `javascript` (with `.d.ts`) |
| Mixed project, preserve original format   | `preserve`                  |

---

## Migration Notes

For projects switching from `javascript` mode (with `.d.ts` files) to `jsdoc` mode:

1. Update the `consolidatedOutput` configuration to `'jsdoc'`
2. Re-run the codemod to regenerate output files
3. Delete the now-obsolete `.d.ts` files
4. Ensure `tsconfig.json` has `checkJs: true` or `allowJs: true`
5. Verify TypeScript version is 5.5 or higher

---

## Appendix: Full Type Mapping Reference

### Attribute Types

| Attribute Type   | JSDoc Property Type         |
| ---------------- | --------------------------- |
| `string`         | `{string}`                  |
| `number`         | `{number}`                  |
| `boolean`        | `{boolean}`                 |
| `date`           | `{Date}`                    |
| `object`         | `{Record<string, unknown>}` |
| `array`          | `{unknown[]}`               |
| Custom transform | `{TransformReturnType}`     |

### Relationship Types

| Relationship | Async   | JSDoc Property Type             |
| ------------ | ------- | ------------------------------- |
| `belongsTo`  | `false` | `{BelongsTo<RelatedType>}`      |
| `belongsTo`  | `true`  | `{AsyncBelongsTo<RelatedType>}` |
| `hasMany`    | `false` | `{HasMany<RelatedType>}`        |
| `hasMany`    | `true`  | `{AsyncHasMany<RelatedType>}`   |
