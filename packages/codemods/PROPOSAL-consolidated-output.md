# Proposal: Consolidated Single-File Codemod Output

## Overview

This proposal describes a new output structure for the schema-migration codemod that consolidates multiple output files into a single file per source mixin. The goal is to reduce file proliferation while maintaining clear separation of concerns between data definitions (traits), type definitions (interfaces), and behavioral code (extensions).

## Current State (Multi-file Output)

Currently, transforming a single mixin file produces **up to 4 separate files**:

| Artifact Type          | File                          | Purpose                            |
| ---------------------- | ----------------------------- | ---------------------------------- |
| **Trait Schema**       | `traits/*.schema.js`          | Data structure definition (fields) |
| **Trait Type**         | `traits/*.schema.types.ts`    | TypeScript interface               |
| **Extension**          | `extensions/*.js`             | Behavioral code (methods, getters) |
| **Resource Type Stub** | `resources/*.schema.types.ts` | Placeholder for related types      |

### Example Current Output

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

**Current Output (3-4 files):**

```javascript
// traits/fileable.schema.js
export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    { name: "files", kind: "hasMany", type: "file", options: { async: false, inverse: "fileable", as: "fileable" } },
    { name: "showFilesRequiringReviewError", kind: "attribute", type: "boolean", options: { defaultValue: false } },
  ],
};
```

```typescript
// traits/fileable.schema.types.ts
import type { HasMany } from "@ember-data/model";
import type { File } from "app/data/resources/file.schema.types";

export interface FileableTrait {
  files: HasMany<File>;
  showFilesRequiringReviewError: boolean;
}
```

```javascript
// extensions/fileable.js
import { computed } from "@ember/object";

export const fileableExtension = {
  hasFiles: computed("files.length", function () {
    return this.files.length > 0;
  }),

  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
};
```

---

## Proposed State (Consolidated Output)

Consolidate all three concepts into a **single file** while maintaining logical separation through named exports.

### Design Principles

1. **Single source file** per mixin → single output file (plus `.d.ts` for JS sources)
2. **Trait** for runtime schema registration (field definitions inline)
3. **Extension** for behavioral code only (methods, getters, computed properties)
4. **Interface** for TypeScript type definitions
5. **Named exports only** - no default exports
6. **Omit extension** when no behavioral code exists
7. **No section comments** - rely on consistent export naming conventions

---

## Output Formats

### TypeScript Mode

When the source file is TypeScript, or when TypeScript output is configured, produce a single `.ts` file.

The trait object uses `as const` to create a literal type, which can then be used to derive types elsewhere in the system:

```typescript
// traits/fileable.ts
import type { HasMany } from "@warp-drive/core";
import type { File } from "app/data/resources/file";
import { computed } from "@ember/object";

export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    { name: "files", kind: "hasMany", type: "file", options: { async: false, inverse: "fileable", as: "fileable" } },
    { name: "showFilesRequiringReviewError", kind: "attribute", type: "boolean", options: { defaultValue: false } },
  ],
} as const;

export interface FileableTrait {
  files: HasMany<File>;
  showFilesRequiringReviewError: boolean;
}

export const fileableExtension = {
  hasFiles: computed("files.length", function () {
    return this.files.length > 0;
  }),

  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
};
```

### JavaScript Mode

When the source file is JavaScript, produce a `.js` file plus a separate `.d.ts` file for type definitions.

**Main file:**

```javascript
// traits/fileable.js
import { computed } from "@ember/object";

export const fileableTrait = {
  name: "fileable",
  mode: "legacy",
  fields: [
    { name: "files", kind: "hasMany", type: "file", options: { async: false, inverse: "fileable", as: "fileable" } },
    { name: "showFilesRequiringReviewError", kind: "attribute", type: "boolean", options: { defaultValue: false } },
  ],
};

export const fileableExtension = {
  hasFiles: computed("files.length", function () {
    return this.files.length > 0;
  }),

  hasDuplicateFileName(file) {
    return Boolean(this.files.find((f) => f.name === file.name));
  },
};
```

**Type declarations (trait as source of truth):**

The `.d.ts` file uses `typeof` to derive the trait type directly from the runtime object, ensuring the type definition stays in sync with the implementation:

```typescript
// traits/fileable.d.ts
import type { HasMany } from "@warp-drive/core";
import type { File } from "app/data/resources/file";

declare const fileableTrait: {
  readonly name: "fileable";
  readonly mode: "legacy";
  readonly fields: readonly [
    {
      readonly name: "files";
      readonly kind: "hasMany";
      readonly type: "file";
      readonly options: { readonly async: false; readonly inverse: "fileable"; readonly as: "fileable" };
    },
    {
      readonly name: "showFilesRequiringReviewError";
      readonly kind: "attribute";
      readonly type: "boolean";
      readonly options: { readonly defaultValue: false };
    },
  ];
};

export { fileableTrait };

// Type alias derived from the trait - can be used for type utilities
export type FileableTraitDefinition = typeof fileableTrait;

export interface FileableTrait {
  files: HasMany<File>;
  showFilesRequiringReviewError: boolean;
}

export declare const fileableExtension: {
  hasFiles: boolean;
  hasDuplicateFileName(file: File): boolean;
};
```

---

## Static Trait as Type Source

A key design decision is that the **trait object serves as the source of truth** for type information. This enables:

### 1. Type Derivation with `typeof`

```typescript
// The trait definition
export const amendableTrait = {
  name: "amendable",
  mode: "legacy",
  fields: [{ name: "amendments", kind: "hasMany", type: "amendment", options: { async: false, inverse: "amendable" } }],
} as const;

// Derive types from the trait
type AmendableTraitDef = typeof amendableTrait;
type AmendableFields = AmendableTraitDef["fields"];
type AmendableFieldNames = AmendableFields[number]["name"]; // "amendments"
```

### 2. Generic Type Utilities

The static trait type can be used with generic utilities to derive runtime-usable types:

```typescript
// Utility type to extract field names from a trait
type FieldNames<T extends { fields: readonly { name: string }[] }> = T["fields"][number]["name"];

// Usage
type AmendableFieldNames = FieldNames<typeof amendableTrait>; // "amendments"
```

### 3. Schema Registration

The trait object is used at runtime for schema registration:

```typescript
import { registerTrait } from "@warp-drive/core";
import { amendableTrait } from "./traits/amendable";

registerTrait(amendableTrait);
```

### 4. Type-Safe Field Access

Build-time tooling can validate field access against the static trait definition:

```typescript
// A utility that ensures type-safe field access
function getField<T extends { fields: readonly { name: string }[] }>(trait: T, fieldName: T["fields"][number]["name"]) {
  return trait.fields.find((f) => f.name === fieldName);
}

const field = getField(amendableTrait, "amendments"); // OK
const invalid = getField(amendableTrait, "nonexistent"); // Type error!
```

---

## Handling Edge Cases

### Mixin with NO Behavioral Code

When a mixin contains only data fields (no methods, getters, or computed properties), the extension export is omitted entirely.

**Input:**

```javascript
// mixins/amendable.js
export default Mixin.create({
  amendments: hasMany("amendment", { inverse: "amendable" }),
});
```

**Output (TypeScript):**

```typescript
// traits/amendable.ts
import type { HasMany } from "@warp-drive/core";
import type { Amendment } from "app/data/resources/amendment";

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
} as const;

export interface AmendableTrait {
  amendments: HasMany<Amendment>;
}

// NOTE: No amendableExtension export - omitted when no behavioral code exists
```

### Mixin with ONLY Behavioral Code

When a mixin contains only methods/computed properties and no data fields, the trait still has an empty fields array.

**Input:**

```javascript
// mixins/sortable.js
export default Mixin.create({
  sortBy(key) {
    return this.items.sortBy(key);
  },
});
```

**Output:**

```typescript
// traits/sortable.ts
export const sortableTrait = {
  name: "sortable",
  mode: "legacy",
  fields: [],
} as const;

export interface SortableTrait {
  // Empty interface - no data fields
}

export const sortableExtension = {
  sortBy(key) {
    return this.items.sortBy(key);
  },
};
```

---

## Export Naming Conventions

| Export    | Naming Pattern             | Example             |
| --------- | -------------------------- | ------------------- |
| Trait     | `{camelCaseName}Trait`     | `fileableTrait`     |
| Interface | `{PascalCaseName}Trait`    | `FileableTrait`     |
| Extension | `{camelCaseName}Extension` | `fileableExtension` |

---

## Summary of Changes

| Aspect                 | Current (Multi-file)               | Proposed (Consolidated)                |
| ---------------------- | ---------------------------------- | -------------------------------------- |
| **Files per mixin**    | Up to 4 files                      | 1-2 files (`.ts` or `.js` + `.d.ts`)   |
| **Trait location**     | `traits/*.schema.js`               | `traits/*.ts` or `traits/*.js`         |
| **Type location**      | `traits/*.schema.types.ts`         | Same file (TS) or `traits/*.d.ts` (JS) |
| **Extension location** | `extensions/*.js`                  | Same file as trait                     |
| **Extension content**  | All non-field properties           | Behavioral code only                   |
| **Empty extension**    | Creates empty object               | Omitted entirely                       |
| **File naming**        | `*.schema.js`, `*.schema.types.ts` | `*.ts` or `*.js` + `*.d.ts`            |

---

## Configuration Options

```typescript
interface ConsolidatedOutputOptions {
  // Existing options...

  /**
   * Output mode for consolidated files
   * - 'typescript': Single .ts file with inline interface
   * - 'javascript': .js file + separate .d.ts file
   * - 'preserve': Match source file extension (default)
   */
  consolidatedOutput?: "typescript" | "javascript" | "preserve";
}
```

---

## Migration Path

For existing projects using the current multi-file output:

1. **Phase 1**: Add configuration flag to opt-in to consolidated output
2. **Phase 2**: Update import paths in consuming code
3. **Phase 3**: Remove old multi-file artifacts
4. **Phase 4**: Make consolidated output the default (major version)

---

## Scope

This proposal applies to **mixin transformations only**. Model transformations (which generate `resources/` files) are not affected and will continue to use the existing multi-file structure.

---

## Benefits

1. **Reduced file count**: 1-2 files instead of 3-4 per mixin
2. **Colocation**: Related code lives together, easier to understand
3. **Simpler imports**: Single import path for trait, type, and extension
4. **Cleaner directory structure**: No separate `extensions/` directory needed for mixin-derived code
5. **Better discoverability**: All aspects of a trait visible in one place

## Trade-offs

1. **Larger individual files**: Combined file is larger than individual artifacts
2. **Mixed concerns**: Runtime code and type definitions in same file (mitigated by `.d.ts` for JS)
3. **Migration effort**: Existing projects need to update import paths
