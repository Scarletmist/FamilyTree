## MODIFIED Requirements

### Requirement: Union record shape

Each entry in `FAMILY.unions` SHALL be an object with exactly two fields: `id` and `partners`. The `id` SHALL be a string matching the pattern `u` followed by digits, and SHALL be unique across `FAMILY.unions`. The `partners` SHALL be an array of exactly two person ids.

A union SHALL NOT carry a `type` field, because marriage has a single kind in this model and a field with one permitted value carries no information. A union SHALL NOT carry a `children` field, because parent-child relationships are recorded in `FAMILY.descents`.

#### Scenario: Every union has exactly the required fields

- **WHEN** each entry of `FAMILY.unions` is inspected
- **THEN** the entry has an `id` matching the `u<digits>` pattern and a `partners` array of exactly two elements, and has neither a `type` nor a `children` property

### Requirement: Referential integrity of demo data

Every person id referenced in `FAMILY.unions` (in `partners`), in `FAMILY.descents` (in `child`), and in `FAMILY.bonds` (in `members`) SHALL exist in `FAMILY.people`. Every union id referenced in `FAMILY.descents` (in `union`) SHALL exist in `FAMILY.unions`.

#### Scenario: All references resolve

- **WHEN** every id referenced by `FAMILY.unions`, `FAMILY.descents`, and `FAMILY.bonds` is looked up in `FAMILY.people` and `FAMILY.unions`
- **THEN** every lookup succeeds and no reference is left dangling

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

## ADDED Requirements

### Requirement: Descent record shape

`FAMILY.descents` SHALL be an array recording every parent-child relationship. Each entry SHALL be an object with the fields `union`, `child`, and `kind`. The `union` SHALL be a union id, the `child` SHALL be a person id, and the `kind` SHALL be one of exactly five string values: `親生`, `過繼`, `養子女`, `義子女`, `契子女`.

The same `child` SHALL be permitted to appear in more than one descent entry pointing at different unions, so that a person who is the birth child of one couple and the lineage-transferred heir of another remains expressible.

#### Scenario: Every descent has the required fields

- **WHEN** each entry of `FAMILY.descents` is inspected
- **THEN** the entry has `union`, `child`, and `kind` fields, and the `kind` is one of the five permitted values

#### Scenario: Dual parentage is expressible

- **WHEN** a person is both the birth child of one union and transferred into another union's line
- **THEN** two descent entries exist for that person, one with `kind` `親生` and one with `kind` `過繼`, each naming its own union

### Requirement: Bond record shape

`FAMILY.bonds` SHALL be an array recording same-generation ties that are neither marriage nor parentage. Each entry SHALL be an object with the fields `members` and `kind`. The `members` SHALL be an array of exactly two person ids. The `kind` SHALL be the string `契手足`.

The two members of a bond SHALL NOT be required to share the same `gen` value, because sworn siblinghood in practice links people of similar age but differing genealogical depth.

#### Scenario: Every bond has the required fields

- **WHEN** each entry of `FAMILY.bonds` is inspected
- **THEN** the entry has a `members` array of exactly two person ids and a `kind` of `契手足`

#### Scenario: Bond members may differ in generation

- **WHEN** a bond links two people whose `gen` values differ
- **THEN** the bond is accepted as valid data and is not rejected or reported as an error

## REMOVED Requirements

### Requirement: Adoption record shape

**Reason**: Replaced by Descent record shape. The old requirement recognised a single adoptive relationship recorded in a dedicated `FAMILY.adoptions` array, which could not express the five distinct kinship kinds this model now requires, and which forced every new relationship kind to add another top-level array.

**Migration**: Remove the `FAMILY.adoptions` array. Rewrite each former adoption entry `{ child, union }` as a descent entry `{ union, child, kind: "養子女" }` or `{ union, child, kind: "過繼" }`, choosing the kind that matches the real relationship. Rewrite every former `FAMILY.unions[].children` member as a descent entry with `kind` `親生`.

#### Scenario: The removed structures are absent

- **WHEN** the loaded `FAMILY` object is inspected after migration
- **THEN** `FAMILY` has no `adoptions` property and no union carries a `children` property, so that the old and new structures never coexist
