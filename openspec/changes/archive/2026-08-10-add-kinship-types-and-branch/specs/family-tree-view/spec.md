## MODIFIED Requirements

### Requirement: Person node content

Each person SHALL be rendered as a node showing the person's name, life years, and branch label. For a person whose `death` is a date string, the node SHALL show both the birth and death values. For a living person, whose `death` is `null`, the node SHALL show only the birth value together with a visible living indicator, and SHALL NOT show an empty or placeholder death value. Birth and death values SHALL be displayed exactly as stored, including a trailing question mark on an uncertain year.

The branch label SHALL be the `label` produced by the branch computation for that person. When the computed label is empty, the node SHALL show no branch label rather than an empty placeholder.

#### Scenario: Deceased person shows both years

- **WHEN** a person with `birth` `1890` and `death` `1962-03-11` is rendered
- **THEN** the node shows the name together with both `1890` and `1962-03-11`

#### Scenario: Living person shows a living indicator

- **WHEN** a person whose `death` is `null` is rendered
- **THEN** the node shows the birth value and a living indicator, and shows no death value

#### Scenario: Uncertain year is shown verbatim

- **WHEN** a person with `birth` `1895?` is rendered
- **THEN** the node displays `1895?` including the question mark, and the question mark is not stripped or replaced

#### Scenario: Branch label appears on the node

- **WHEN** a person whose computed branch label is `長房二支` is rendered
- **THEN** the node displays `長房二支`

#### Scenario: Empty label renders nothing

- **WHEN** a person whose computed branch label is empty is rendered
- **THEN** the node shows no branch label element and no placeholder text

### Requirement: Relationship connectors

The page SHALL draw relationship connectors as SVG inside the tree area. For each union, a horizontal connector SHALL join the two partner nodes. For each entry in `FAMILY.descents`, a connector SHALL run from the referenced union down to the child's node. For each entry in `FAMILY.bonds`, a connector SHALL join the two member nodes.

Each connector SHALL carry a DOM attribute identifying its relationship kind, and the permitted values SHALL be seven distinct identifiers: one for the union connector, one for each of the five descent kinds, and one for the bond connector. Connectors whose descent kind confers lineage SHALL be visually distinguishable from those that do not, so that a reader can tell clan membership from social ties without consulting the legend.

The page SHALL display a legend listing every relationship kind it can draw.

#### Scenario: Partners are joined by a connector

- **WHEN** a union with two partners is rendered
- **THEN** an SVG connector joins the two partner nodes

#### Scenario: Every descent kind is distinguishable

- **WHEN** connectors for all five descent kinds are rendered
- **THEN** the five connectors carry five different DOM attribute values, and the connectors for lineage-conferring kinds differ in stroke style from those for non-lineage kinds

#### Scenario: Bond connector joins two members

- **WHEN** an entry in `FAMILY.bonds` is rendered
- **THEN** an SVG connector joins the two member nodes and carries a DOM attribute value distinct from all descent and union connectors

#### Scenario: Legend covers every kind

- **WHEN** a visitor views the legend
- **THEN** the legend lists the union connector, all five descent kinds, and the bond connector

### Requirement: Dangling reference tolerance

When `FAMILY.unions`, `FAMILY.descents`, or `FAMILY.bonds` references a person id or union id that does not exist, the page SHALL skip drawing that single relationship, SHALL emit a console warning naming the unresolved id, and SHALL render the remainder of the tree normally. One bad record MUST NOT prevent the rest of the tree from rendering.

When a descent carries a `kind` that is not one of the five permitted values, the page SHALL draw the connector with a default stroke style, SHALL emit a console warning naming the unrecognised kind, and SHALL continue rendering.

#### Scenario: Unresolved reference skips one connector

- **WHEN** a descent names a child id that is absent from `FAMILY.people`
- **THEN** the connector for that descent is not drawn, a console warning names the unresolved id, and all other nodes and connectors still render

#### Scenario: Unknown kind still renders

- **WHEN** a descent carries a `kind` outside the five permitted values
- **THEN** the connector is drawn with a default stroke style, a console warning names the unrecognised kind, and rendering continues

### Requirement: Family tree page document

The site SHALL provide a family tree page at `family-tree.html` in the project root. The page SHALL render correctly when opened directly in a browser from the local file system using a `file://` URL, without a web server, build step, or package installation. The page SHALL load its data with `<script src="data/family.js">`, its branch computation with `<script src="assets/branch.js">`, and its rendering logic with `<script src="assets/family-tree.js">`, and SHALL NOT retrieve data with `fetch` or `XMLHttpRequest`, because those requests are blocked by the browser under the `file://` protocol. The page SHALL NOT reference any external stylesheet, external script, web font, CDN, or front-end framework.

#### Scenario: Opening the tree page from the file system

- **WHEN** a person opens `family-tree.html` directly in a browser using a `file://` URL
- **THEN** the tree renders with its full styling applied, and the browser issues no network requests to external hosts

#### Scenario: No library or build dependency

- **WHEN** a reviewer inspects `family-tree.html`, `assets/branch.js`, and `assets/family-tree.js`
- **THEN** none of the files references a CDN, a front-end framework, or a charting or layout library, and none calls `fetch` or `XMLHttpRequest`
