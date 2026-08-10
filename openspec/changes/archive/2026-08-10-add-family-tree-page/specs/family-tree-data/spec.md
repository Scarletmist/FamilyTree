## ADDED Requirements

### Requirement: Demo data module

The project SHALL provide the demo genealogy data at `data/family.js` as a plain JavaScript file that declares a single global constant named `FAMILY`. The file SHALL NOT use module syntax (`import`, `export`, `module.exports`), because it is loaded with a plain `<script src>` tag rather than a module loader or bundler. `FAMILY` SHALL contain exactly three array properties: `people`, `unions`, and `adoptions`.

#### Scenario: Data file exposes a global constant

- **WHEN** a page loads `data/family.js` with a `<script src>` tag and then reads the global `FAMILY`
- **THEN** `FAMILY` is defined and has array properties `people`, `unions`, and `adoptions`

#### Scenario: No module syntax

- **WHEN** a reviewer inspects `data/family.js`
- **THEN** the file contains no `import`, `export`, or `module.exports` statement

### Requirement: Person record shape

Each entry in `FAMILY.people` SHALL be an object with the fields `id`, `name`, `gender`, `birth`, `death`, and `gen`. The `id` SHALL be a string matching the pattern `p` followed by digits, and SHALL be unique across `FAMILY.people`. The `gender` SHALL be the string `"M"` or `"F"`. The `gen` SHALL be an integer from 1 to 4, where 1 is the earliest generation.

#### Scenario: Every person has the required fields

- **WHEN** each entry of `FAMILY.people` is inspected
- **THEN** the entry has all six fields, its `id` matches the `p<digits>` pattern, its `gender` is `"M"` or `"F"`, and its `gen` is an integer between 1 and 4

#### Scenario: Person ids are unique

- **WHEN** the `id` values of all entries in `FAMILY.people` are collected
- **THEN** no `id` value appears more than once

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

### Requirement: Union record shape

Each entry in `FAMILY.unions` SHALL be an object with the fields `id`, `partners`, `children`, and `type`. The `id` SHALL be a string matching the pattern `u` followed by digits, and SHALL be unique across `FAMILY.unions`. The `partners` SHALL be an array of exactly two person ids. The `children` SHALL be an array of person ids, and SHALL be an empty array when the union has no children. The `type` SHALL be the string `"marriage"` or `"remarriage"`. Parent-child relationships SHALL be recorded on the union rather than on the person, so that half-siblings from different unions remain distinguishable.

#### Scenario: Every union has the required fields

- **WHEN** each entry of `FAMILY.unions` is inspected
- **THEN** the entry has all four fields, its `partners` array has exactly two elements, its `children` is an array, and its `type` is `"marriage"` or `"remarriage"`

#### Scenario: A remarried person appears in two unions

- **WHEN** a person has remarried
- **THEN** that person's id appears in the `partners` array of two different unions, and each union carries its own `children` list

##### Example: remarriage produces half-siblings

- **GIVEN** unions: `u1` with partners `["p1","p2"]` and children `["p3","p4"]`, and `u2` with partners `["p1","p8"]` and children `["p5"]`
- **WHEN** the parentage of `p3` and `p5` is resolved
- **THEN** `p3` descends from union `u1` and `p5` from union `u2`, sharing only `p1` as a parent

### Requirement: Adoption record shape

Each entry in `FAMILY.adoptions` SHALL be an object with the fields `child` and `union`, where `child` is a person id and `union` is a union id. Adoption SHALL be recorded separately from the union's `children` array so that adoptive relationships remain distinguishable from birth relationships.

#### Scenario: Adoption is recorded outside the children array

- **WHEN** a child joined a family by adoption
- **THEN** that child's id appears in an entry of `FAMILY.adoptions` referencing the adopting union, and does not appear in that union's `children` array

### Requirement: Referential integrity of demo data

Every person id referenced in `FAMILY.unions` (in `partners` or `children`) and in `FAMILY.adoptions` (in `child`) SHALL exist in `FAMILY.people`. Every union id referenced in `FAMILY.adoptions` SHALL exist in `FAMILY.unions`.

#### Scenario: All references resolve

- **WHEN** every id referenced by `FAMILY.unions` and `FAMILY.adoptions` is looked up in `FAMILY.people` and `FAMILY.unions`
- **THEN** every lookup succeeds and no reference is left dangling

### Requirement: Demo data coverage of edge cases

The demo dataset SHALL contain exactly 20 entries in `FAMILY.people` spanning generations 1 through 4. The dataset SHALL include at least one union whose `type` is `"remarriage"`, at least one entry in `FAMILY.adoptions`, at least one person whose `birth` ends with a question mark, and at least one person whose `death` is `null`. These four cases exist so that the hardest genealogy shapes are exercised by the demo data rather than discovered later with real records.

#### Scenario: Required edge cases are present

- **WHEN** the demo dataset is inspected
- **THEN** `FAMILY.people` has 20 entries, generations 1 through 4 are each represented, and the four required edge cases each occur at least once

##### Example: minimum edge-case coverage

| Edge case            | How it is satisfied                          | Minimum count |
| -------------------- | -------------------------------------------- | ------------- |
| Remarriage           | a union with `type: "remarriage"`             | 1             |
| Adoption             | an entry in `FAMILY.adoptions`                | 1             |
| Uncertain birth year | a person whose `birth` ends with `?`          | 1             |
| Living person        | a person whose `death` is `null`              | 1             |
