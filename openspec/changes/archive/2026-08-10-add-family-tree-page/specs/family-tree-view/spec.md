## ADDED Requirements

### Requirement: Family tree page document

The site SHALL provide a family tree page at `family-tree.html` in the project root. The page SHALL render correctly when opened directly in a browser from the local file system using a `file://` URL, without a web server, build step, or package installation. The page SHALL load its data with `<script src="data/family.js">` and its rendering logic with `<script src="assets/family-tree.js">`, and SHALL NOT retrieve data with `fetch` or `XMLHttpRequest`, because those requests are blocked by the browser under the `file://` protocol. The page SHALL NOT reference any external stylesheet, external script, web font, CDN, or front-end framework.

#### Scenario: Opening the tree page from the file system

- **WHEN** a person opens `family-tree.html` directly in a browser using a `file://` URL
- **THEN** the tree renders with its full styling applied, and the browser issues no network requests to external hosts

#### Scenario: No library or build dependency

- **WHEN** a reviewer inspects `family-tree.html` and `assets/family-tree.js`
- **THEN** neither file references a CDN, a front-end framework, or a charting or layout library, and neither calls `fetch` or `XMLHttpRequest`

### Requirement: Generation row layout

The page SHALL arrange people into horizontal rows, one row per generation, ordered so that generation 1 appears at the top and generation 4 at the bottom. Within a row, people SHALL be laid out left to right following their order in `FAMILY.people`, and the two partners of a union SHALL be placed adjacent to each other.

#### Scenario: Four generation rows are rendered

- **WHEN** a visitor views the tree page with the demo dataset loaded
- **THEN** the page shows 4 generation rows, and every person in `FAMILY.people` appears in the row matching that person's `gen` value

#### Scenario: Partners are adjacent

- **WHEN** a union's two partners are rendered
- **THEN** the two partner nodes sit next to each other in the same generation row with no unrelated node between them

### Requirement: Person node content

Each person SHALL be rendered as a node showing the person's name and life years. For a person whose `death` is a date string, the node SHALL show both the birth and death values. For a living person, whose `death` is `null`, the node SHALL show only the birth value together with a visible living indicator, and SHALL NOT show an empty or placeholder death value. Birth and death values SHALL be displayed exactly as stored, including a trailing question mark on an uncertain year.

#### Scenario: Deceased person shows both years

- **WHEN** a person with `birth` `"1890"` and `death` `"1962-03-11"` is rendered
- **THEN** the node shows the name together with both `1890` and `1962-03-11`

#### Scenario: Living person shows a living indicator

- **WHEN** a person whose `death` is `null` is rendered
- **THEN** the node shows the birth value and a living indicator, and shows no death value

#### Scenario: Uncertain year is shown verbatim

- **WHEN** a person with `birth` `"1895?"` is rendered
- **THEN** the node displays `1895?` including the question mark, and the question mark is not stripped or replaced

### Requirement: Relationship connectors

The page SHALL draw relationship connectors as SVG inside the tree area. For each union, a horizontal connector SHALL join the two partner nodes. For each child in a union's `children` array, a connector SHALL run from that union down to the child's node. For each entry in `FAMILY.adoptions`, a connector SHALL run from the referenced union down to the adopted child's node. Adoption connectors SHALL be visually distinct from birth connectors and SHALL be distinguishable in the DOM by an attribute, so that an adoptive relationship is never mistaken for a birth relationship.

#### Scenario: Partners are joined by a connector

- **WHEN** a union with two partners is rendered
- **THEN** an SVG connector joins the two partner nodes

#### Scenario: Adoption connector is distinguishable

- **WHEN** an adoption connector and a birth connector are both rendered
- **THEN** the two connectors carry different DOM attribute values identifying their relationship kind, and are styled differently

### Requirement: Missing data file handling

When the global `FAMILY` is undefined at render time, the page SHALL display a visible error message in the tree area explaining that the family data failed to load. The page SHALL NOT render a blank tree area, and SHALL NOT report the failure only to the browser console.

#### Scenario: Data file fails to load

- **WHEN** the page is rendered and the global `FAMILY` is undefined
- **THEN** a visible error message appears in the tree area of the page

### Requirement: Dangling reference tolerance

When `FAMILY.unions` or `FAMILY.adoptions` references a person id or union id that does not exist, the page SHALL skip drawing that single relationship, SHALL emit a console warning naming the unresolved id, and SHALL render the remainder of the tree normally. One bad record MUST NOT prevent the rest of the tree from rendering.

#### Scenario: Unresolved reference skips one connector

- **WHEN** a union lists a child id that is absent from `FAMILY.people`
- **THEN** the connector for that child is not drawn, a console warning names the unresolved id, and all other nodes and connectors still render
