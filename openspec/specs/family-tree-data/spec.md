# family-tree-data Specification

## Purpose

TBD - created by archiving change 'add-family-tree-page'. Update Purpose after archive.

## Requirements

### Requirement: Demo data module

The project SHALL provide the demo genealogy data at `data/family.js` as a plain JavaScript file that declares a single global constant named `FAMILY`. The file SHALL NOT use module syntax (`import`, `export`, `module.exports`), because it is loaded with a plain `<script src>` tag rather than a module loader or bundler. `FAMILY` SHALL contain exactly three array properties: `people`, `unions`, and `adoptions`.

#### Scenario: Data file exposes a global constant

- **WHEN** a page loads `data/family.js` with a `<script src>` tag and then reads the global `FAMILY`
- **THEN** `FAMILY` is defined and has array properties `people`, `unions`, and `adoptions`

#### Scenario: No module syntax

- **WHEN** a reviewer inspects `data/family.js`
- **THEN** the file contains no `import`, `export`, or `module.exports` statement


<!-- @trace
source: add-family-tree-page
updated: 2026-08-10
code:
  - index.html
  - data/family.js
  - family-tree.html
  - assets/family-tree.js
-->

---
### Requirement: Person record shape

Each entry in `FAMILY.people` SHALL be an object with the fields `id`, `name`, `gender`, `birth`, `death`, and `gen`. The `id` SHALL be a string matching the pattern `p` followed by digits, and SHALL be unique across `FAMILY.people`. The `gender` SHALL be the string `"M"` or `"F"`. The `gen` SHALL be an integer from 1 to 4, where 1 is the earliest generation.

#### Scenario: Every person has the required fields

- **WHEN** each entry of `FAMILY.people` is inspected
- **THEN** the entry has all six fields, its `id` matches the `p<digits>` pattern, its `gender` is `"M"` or `"F"`, and its `gen` is an integer between 1 and 4

#### Scenario: Person ids are unique

- **WHEN** the `id` values of all entries in `FAMILY.people` are collected
- **THEN** no `id` value appears more than once


<!-- @trace
source: add-family-tree-page
updated: 2026-08-10
code:
  - index.html
  - data/family.js
  - family-tree.html
  - assets/family-tree.js
-->

---
### Requirement: Birth and death year representation

The `birth` and `death` fields SHALL be strings, never `Date` objects or numbers, because genealogy records frequently know only a year or an approximate year. A `birth` value SHALL be one of three forms: a full date `YYYY-MM-DD`, a year alone `YYYY`, or an uncertain year written as `YYYY?` with a trailing question mark. A `death` value SHALL be one of the same three forms, or `null`. A `death` of `null` SHALL mean the person is living — it MUST NOT be used to mean the death date is unknown.

#### Scenario: Year values accept reduced precision

- **WHEN** a person's birth year is known but the month and day are not
- **THEN** the `birth` field holds the year alone as a string, and no placeholder month or day is invented

##### Example: accepted birth and death values

| Field   | Value          | Meaning                                     |
| ------- | -------------- | ------------------------------------------- |
| `birth` | `"1962-03-11"` | full date known                             |
| `birth` | `"1890"`       | year known, month and day unknown           |
| `birth` | `"1895?"`      | year uncertain                              |
| `death` | `"1970"`       | died in that year                           |
| `death` | `null`         | person is living                            |

#### Scenario: Living person is marked with null

- **WHEN** a person is living
- **THEN** that person's `death` field is `null` rather than an empty string, a missing field, or a placeholder value


<!-- @trace
source: add-family-tree-page
updated: 2026-08-10
code:
  - index.html
  - data/family.js
  - family-tree.html
  - assets/family-tree.js
-->

---
### Requirement: Union record shape

Each entry in `FAMILY.unions` SHALL be an object with exactly two fields: `id` and `partners`. The `id` SHALL be a string matching the pattern `u` followed by digits, and SHALL be unique across `FAMILY.unions`. The `partners` SHALL be an array of exactly two person ids.

A union SHALL NOT carry a `type` field, because marriage has a single kind in this model and a field with one permitted value carries no information. A union SHALL NOT carry a `children` field, because parent-child relationships are recorded in `FAMILY.descents`.

#### Scenario: Every union has exactly the required fields

- **WHEN** each entry of `FAMILY.unions` is inspected
- **THEN** the entry has an `id` matching the `u<digits>` pattern and a `partners` array of exactly two elements, and has neither a `type` nor a `children` property


<!-- @trace
source: add-kinship-types-and-branch
updated: 2026-08-10
code:
  - assets/family-tree.js
  - family-tree.html
  - data/family.js
  - index.html
  - assets/branch.js
-->

---
### Requirement: Referential integrity of demo data

Every person id referenced in `FAMILY.unions` (in `partners`), in `FAMILY.descents` (in `child`), and in `FAMILY.bonds` (in `members`) SHALL exist in `FAMILY.people`. Every union id referenced in `FAMILY.descents` (in `union`) SHALL exist in `FAMILY.unions`.

#### Scenario: All references resolve

- **WHEN** every id referenced by `FAMILY.unions`, `FAMILY.descents`, and `FAMILY.bonds` is looked up in `FAMILY.people` and `FAMILY.unions`
- **THEN** every lookup succeeds and no reference is left dangling


<!-- @trace
source: add-kinship-types-and-branch
updated: 2026-08-10
code:
  - assets/family-tree.js
  - family-tree.html
  - data/family.js
  - index.html
  - assets/branch.js
-->

---
### Requirement: Demo data coverage of edge cases

The demo dataset SHALL contain at least 20 entries in `FAMILY.people` spanning generations 1 through 4. The dataset SHALL include at least one person whose `birth` ends with a question mark, and at least one person whose `death` is `null`. The dataset SHALL include at least one entry in `FAMILY.descents` for each of the five permitted `kind` values, and at least one entry in `FAMILY.bonds`. These cases exist so that every relationship kind is exercised by the demo data rather than left unverified until real records arrive.

#### Scenario: Required edge cases are present

- **WHEN** the demo dataset is inspected
- **THEN** generations 1 through 4 are each represented, an uncertain birth year and a living person each occur at least once, each of the five descent kinds occurs at least once, and at least one bond exists

##### Example: minimum coverage counts

| Case                       | How it is satisfied                             | Minimum count |
| -------------------------- | ----------------------------------------------- | ------------- |
| Uncertain birth year       | a person whose `birth` ends with `?`             | 1             |
| Living person              | a person whose `death` is `null`                 | 1             |
| Birth descent              | a descent whose `kind` is `親生`                 | 1             |
| Lineage-transfer descent   | a descent whose `kind` is `過繼`                 | 1             |
| Adoptive descent           | a descent whose `kind` is `養子女`               | 1             |
| Sworn-child descent        | a descent whose `kind` is `義子女`               | 1             |
| Godchild descent           | a descent whose `kind` is `契子女`               | 1             |
| Sworn sibling bond         | an entry in `FAMILY.bonds`                       | 1             |


<!-- @trace
source: add-kinship-types-and-branch
updated: 2026-08-10
code:
  - assets/family-tree.js
  - family-tree.html
  - data/family.js
  - index.html
  - assets/branch.js
-->

---
### Requirement: Descent record shape

`FAMILY.descents` SHALL be an array recording every parent-child relationship. Each entry SHALL be an object with the fields `union`, `child`, and `kind`. The `union` SHALL be a union id, the `child` SHALL be a person id, and the `kind` SHALL be one of exactly five string values: `親生`, `過繼`, `養子女`, `義子女`, `契子女`.

The same `child` SHALL be permitted to appear in more than one descent entry pointing at different unions, so that a person who is the birth child of one couple and the lineage-transferred heir of another remains expressible.

#### Scenario: Every descent has the required fields

- **WHEN** each entry of `FAMILY.descents` is inspected
- **THEN** the entry has `union`, `child`, and `kind` fields, and the `kind` is one of the five permitted values

#### Scenario: Dual parentage is expressible

- **WHEN** a person is both the birth child of one union and transferred into another union's line
- **THEN** two descent entries exist for that person, one with `kind` `親生` and one with `kind` `過繼`, each naming its own union


<!-- @trace
source: add-kinship-types-and-branch
updated: 2026-08-10
code:
  - assets/family-tree.js
  - family-tree.html
  - data/family.js
  - index.html
  - assets/branch.js
-->

---
### Requirement: Bond record shape

`FAMILY.bonds` SHALL be an array recording same-generation ties that are neither marriage nor parentage. Each entry SHALL be an object with the fields `members` and `kind`. The `members` SHALL be an array of exactly two person ids. The `kind` SHALL be the string `契手足`.

The two members of a bond SHALL NOT be required to share the same `gen` value, because sworn siblinghood in practice links people of similar age but differing genealogical depth.

#### Scenario: Every bond has the required fields

- **WHEN** each entry of `FAMILY.bonds` is inspected
- **THEN** the entry has a `members` array of exactly two person ids and a `kind` of `契手足`

#### Scenario: Bond members may differ in generation

- **WHEN** a bond links two people whose `gen` values differ
- **THEN** the bond is accepted as valid data and is not rejected or reported as an error

<!-- @trace
source: add-kinship-types-and-branch
updated: 2026-08-10
code:
  - assets/family-tree.js
  - family-tree.html
  - data/family.js
  - index.html
  - assets/branch.js
-->