# branch-attribution Specification

## Purpose

TBD - created by archiving change 'add-kinship-types-and-branch'. Update Purpose after archive.

## Requirements

### Requirement: Branch attribution is derived, never stored

Branch membership (房) SHALL be computed from the genealogy at render time and SHALL NOT be stored as a field on any record in `FAMILY`. No entry in `FAMILY.people` SHALL carry a branch, house, or rank field.

Storing branch membership alongside the relationships it is derived from would create two sources of truth that drift apart whenever one is edited without the other.

#### Scenario: No branch field exists in the data

- **WHEN** each entry of `FAMILY.people` is inspected
- **THEN** the entry carries no property holding a branch label or rank path


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
### Requirement: Branch computation interface

The project SHALL provide the branch computation at `assets/branch.js`, loaded with a plain `<script src>` tag and exposing a global function `computeBranches`. The function SHALL accept the family data object and return an object keyed by person id, where each value has a `path` (an array of integers) and a `label` (a string). The function SHALL NOT modify the object passed to it, SHALL NOT read or write the DOM, and SHALL NOT use module syntax.

#### Scenario: Computation returns paths and labels

- **WHEN** `computeBranches(FAMILY)` is called
- **THEN** the returned object has an entry for every person id in `FAMILY.people`, and each entry has an integer-array `path` and a string `label`

#### Scenario: Input is not mutated

- **WHEN** `computeBranches(FAMILY)` is called and `FAMILY` is compared against its state before the call
- **THEN** `FAMILY` is unchanged


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
### Requirement: Lineage-conferring descent kinds

Only descents whose `kind` is `親生`, `過繼`, or `養子女` SHALL confer branch membership and propagate a rank path to the child. Descents whose `kind` is `義子女` or `契子女` SHALL NOT confer branch membership, and entries in `FAMILY.bonds` SHALL NOT confer branch membership.

A descent whose `kind` is not one of the five permitted values SHALL NOT confer branch membership, so that an unrecognised relationship never silently acquires clan standing.

#### Scenario: Sworn and godchild ties do not confer branch

- **WHEN** a person is linked to a union only by a descent whose `kind` is `義子女` or `契子女`
- **THEN** that person's `path` does not include the rank path of that union's branch

#### Scenario: Lineage transfer confers branch

- **WHEN** a person is linked to a union by a descent whose `kind` is `過繼`
- **THEN** that person receives a rank position within that union's children and their `path` extends that union's branch path


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
### Requirement: Rank ordering among a lineage parent's children

Rank position SHALL be assigned among all lineage-conferring children of a single lineage parent, gathered across every union that parent is a partner in, ordered by birth year ascending. Ranking SHALL NOT be scoped to a single union. Scoping ranks per union would let a later marriage's children restart the numbering, which reintroduces the distinction between a first wife's and a later wife's children that this model deliberately omits by giving marriage a single kind.

The lineage parent of a union SHALL be the partner who is the apex ancestor, or who is reachable from the apex ancestor through lineage-conferring descents. A married-in partner, having no such path, SHALL NOT be a lineage parent. When both partners are reachable from the apex, the lineage parent SHALL be the one appearing first in that union's `partners` array, so that the computation is deterministic.

Daughters SHALL be ranked alongside sons with no distinction of gender. Lineage-transferred children SHALL take a rank position among the lineage parent's children rather than being appended after them or excluded.

Birth years SHALL be compared using the first four characters of the `birth` string, so that a full date, a bare year, and an uncertain year all compare on their year alone. When two children share the same four-character year, their relative order SHALL be their order of appearance in `FAMILY.descents`, so that the computation is deterministic and repeated runs over unchanged data produce identical results.

#### Scenario: Children of different unions share one ranking

- **WHEN** a lineage parent has lineage-conferring children in two different unions
- **THEN** all of those children are ranked together in a single sequence by birth year, and no child restarts the numbering because of which union it came from

#### Scenario: Daughters occupy rank positions

- **WHEN** a lineage parent has both sons and daughters conferred by lineage kinds
- **THEN** the daughters occupy rank positions interleaved with the sons according to birth year

#### Scenario: Married-in partner confers no ranking

- **WHEN** a union has one partner reachable from the apex ancestor and one married-in partner
- **THEN** the children of that union take their rank from the reachable partner, and the married-in partner contributes no ranking of their own

#### Scenario: Same year is broken deterministically

- **WHEN** two children of the same lineage parent share the same four-character birth year
- **THEN** the one appearing earlier in `FAMILY.descents` takes the earlier rank, and repeating the computation yields the same order

##### Example: rank order in the demo data

All four are children of the same lineage parent, 陳阿土, though they arrive through two different unions.

| Person | Birth  | Union | Descent kind | Rank |
| ------ | ------ | ----- | ------------ | ---- |
| 陳文彬 | `1918` | `u1`  | `親生`       | 1    |
| 陳秀琴 | `1924` | `u1`  | `親生`       | 2    |
| 陳文德 | `1926` | `u1`  | `過繼`       | 3    |
| 陳文山 | `1930` | `u2`  | `親生`       | 4    |


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
### Requirement: Nested rank path composition

A person's rank path SHALL be the concatenation of the rank positions taken at each generation along the lineage-conferring descents from the apex ancestor down to that person. A person with no lineage-conferring descent into any union SHALL have an empty rank path.

#### Scenario: Path accumulates one rank per generation

- **WHEN** a person descends through two lineage-conferring descents from the apex ancestor
- **THEN** that person's `path` has exactly two integers, the first being their ancestor's rank and the second being their own

##### Example: nested paths in the demo data

| Person | Path      | Label          |
| ------ | --------- | -------------- |
| 陳阿土 | `[]`      | `始祖`         |
| 陳文彬 | `[1]`     | `長房`         |
| 陳秀琴 | `[2]`     | `二房`         |
| 陳文德 | `[3]`     | `三房`         |
| 陳文山 | `[4]`     | `四房`         |
| 陳建國 | `[1,1]`   | `長房長支`     |
| 陳淑芬 | `[1,2]`   | `長房二支`     |
| 陳建民 | `[1,3]`   | `長房三支`     |
| 張家豪 | `[2,1]`   | `二房長支`     |
| 陳志明 | `[1,1,1]` | `長房長支長派` |


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
### Requirement: Chinese branch label composition

A rank path SHALL be rendered as a Chinese label by pairing each position with a level noun: the first position uses `房`, the second uses `支`, the third uses `派`. Positions beyond the third SHALL be appended as a hyphen followed by the Arabic numeral, because the three traditional level nouns are exhausted.

Rank numbers SHALL use Chinese ordinals, where position 1 renders as `長` and positions 2 and above render as the Chinese numeral for that position. A person whose rank path is empty SHALL be labelled `始祖`.

#### Scenario: Apex ancestor is labelled

- **WHEN** a person has an empty rank path
- **THEN** that person's `label` is `始祖`

##### Example: label composition by path length

| Path        | Label            | Note                          |
| ----------- | ---------------- | ----------------------------- |
| `[]`        | `始祖`           | apex ancestor                 |
| `[1]`       | `長房`           | position 1 renders as `長`    |
| `[4]`       | `四房`           | position 4 renders as `四`    |
| `[1,2]`     | `長房二支`       | second level uses `支`        |
| `[1,1,1]`   | `長房長支長派`   | third level uses `派`         |
| `[1,2,3,4]` | `長房二支三派-4` | fourth level exceeds the nouns |


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
### Requirement: Spouse branch labelling

A person who has no lineage-conferring descent but is a partner in a union SHALL be labelled with the branch label of the other partner in that union. When the other partner also has no branch label, the person SHALL have an empty label. A married-in spouse SHALL NOT be assigned a rank path of their own, so that marriages never create new branches.

#### Scenario: Married-in spouse borrows the label

- **WHEN** a person has no lineage-conferring descent and is a partner of someone whose label is `長房`
- **THEN** that person's `label` is `長房` and their `path` is empty


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
### Requirement: Cycle tolerance in branch computation

When following lineage-conferring descents would revisit a person already on the current path, the computation SHALL stop tracing that path, SHALL emit a console warning naming the person id at which the cycle was detected, and SHALL leave that person's label empty. Every other person's branch SHALL still be computed. A cyclic record MUST NOT cause infinite recursion or prevent the remaining branches from being produced.

#### Scenario: Cyclic lineage is contained

- **WHEN** the data contains descents that make a person their own ancestor through lineage-conferring kinds
- **THEN** a console warning names that person id, that person's label is empty, and every other person still receives a computed label

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