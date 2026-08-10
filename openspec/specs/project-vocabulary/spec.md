# project-vocabulary Specification

## Purpose

TBD - created by archiving change 'add-kinship-types-and-branch'. Update Purpose after archive.

## Requirements

### Requirement: Project vocabulary file

The project SHALL maintain a vocabulary file at `openspec/LANGUAGE.md` recording the canonical term for each genealogy concept used across artifacts and code. Each entry SHALL state the canonical term, a definition, the synonyms to avoid, and the reason the distinction matters.

The file exists because specification files are written in English normative language while the genealogy domain terms are Chinese, and several Chinese concepts have no stable English equivalent. Without a recorded contract, each artifact drifts toward a different English approximation.

#### Scenario: Vocabulary file records the required fields

- **WHEN** an entry in `openspec/LANGUAGE.md` is inspected
- **THEN** the entry states a canonical term, a definition, the synonyms to avoid, and the reason for the distinction


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
### Requirement: Kinship term entries

The vocabulary file SHALL contain an entry for each of the six kinship kinds used in the data model — `親生`, `過繼`, `養子女`, `義子女`, `契子女`, `契手足` — and an entry for `房`. Each kinship entry SHALL state whether that relationship confers branch membership, so that the lineage rule is discoverable from the vocabulary and not only from the branch specification.

#### Scenario: Every kinship kind has an entry

- **WHEN** the vocabulary file is inspected
- **THEN** entries exist for `親生`, `過繼`, `養子女`, `義子女`, `契子女`, `契手足`, and `房`, and each kinship entry states whether it confers branch membership


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
### Requirement: Recorded drift of the term adoption

The vocabulary file SHALL record that the English term `adoption` was previously used to denote a single relationship and is ambiguous across `過繼`, `養子女`, `義子女`, and `契子女`. The entry SHALL mark `adoption` as a term to avoid as a standalone label and SHALL direct writers to the specific Chinese term instead.

This entry exists because the earlier data model and specification used `adoption` for one relationship, and reusing that word now would collapse four distinct relationships that differ in whether they confer clan membership.

#### Scenario: The ambiguous term is marked

- **WHEN** the vocabulary file is searched for `adoption`
- **THEN** an entry marks it as ambiguous, names the four Chinese terms it could denote, and directs writers to use the specific term

##### Example: distinctions the ambiguous term collapses

| Chinese term | Meaning                                  | Confers branch |
| ------------ | ---------------------------------------- | -------------- |
| `過繼`       | heir transferred within the clan          | yes            |
| `養子女`     | adopted child of a different surname      | yes            |
| `義子女`     | sworn child, a social tie                 | no             |
| `契子女`     | godchild by informal pledge               | no             |

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