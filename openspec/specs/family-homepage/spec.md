# family-homepage Specification

## Purpose

TBD - created by archiving change 'add-family-homepage'. Update Purpose after archive.

## Requirements

### Requirement: Homepage entry document

The site SHALL provide a single homepage document at `index.html` in the project root. The document SHALL render correctly when opened directly in a browser from the local file system, without a web server, build step, or package installation. All styling SHALL be defined in a `<style>` block inside `index.html`; the document SHALL NOT reference external stylesheets, external scripts, web fonts, or any front-end framework.

#### Scenario: Opening the homepage from the file system

- **WHEN** a person opens `index.html` directly in a browser using a `file://` URL
- **THEN** the page renders with its full styling applied, and the browser issues no network requests to external hosts

#### Scenario: No framework or build dependency

- **WHEN** a reviewer inspects `index.html`
- **THEN** the document contains no `<link rel="stylesheet">` to an external file, no `<script src>` to an external file, and no framework or CDN references

---
### Requirement: Hero section

The homepage SHALL open with a hero section that displays the family name "陳氏家族", a one-sentence description of the site, and a single primary call-to-action labelled "瀏覽族譜". The hero SHALL be the first visible content on the page.

#### Scenario: Hero content is present

- **WHEN** a visitor loads the homepage
- **THEN** the family name "陳氏家族", the one-sentence description, and the "瀏覽族譜" call-to-action are visible without scrolling on a 1280x800 viewport

---
### Requirement: Family introduction section

The homepage SHALL include a family introduction section containing two to three paragraphs of prose describing the family's origin and the purpose of the site.

#### Scenario: Introduction is readable

- **WHEN** a visitor scrolls past the hero section
- **THEN** the introduction section is displayed with between two and three paragraphs of text

---
### Requirement: Family statistics row

The homepage SHALL display a statistics row with exactly three figures: number of generations, number of members, and the earliest recorded year. Each figure SHALL be accompanied by a Traditional Chinese label identifying it. The values SHALL be written literally in the HTML markup; the homepage SHALL NOT read them from a data file, database, or network request.

#### Scenario: Three statistics are displayed with labels

- **WHEN** a visitor views the statistics row
- **THEN** exactly three figures are shown, each paired with a label naming what it counts

##### Example: statistics row contents

| Label      | Value | Notes                                |
| ---------- | ----- | ------------------------------------ |
| 世代       | 5     | hard-coded placeholder in the markup |
| 成員       | 128   | hard-coded placeholder in the markup |
| 最早紀錄   | 1890  | hard-coded placeholder in the markup |

---
### Requirement: Sub-page entry cards

The homepage SHALL display exactly three entry cards, titled 族譜圖, 成員列表, and 家族相簿. Each card SHALL carry a short description of what the destination page will contain. The 族譜圖 card and the hero call-to-action SHALL both point to `family-tree.html`, which exists. The 成員列表 and 家族相簿 cards SHALL point to `#`, because their destination pages do not exist yet, so that activating them never produces a 404 or a navigation to a missing document.

#### Scenario: Tree links reach the family tree page

- **WHEN** a visitor activates the 族譜圖 card or the "瀏覽族譜" call-to-action
- **THEN** the browser navigates to `family-tree.html` and the family tree renders

#### Scenario: Unbuilt pages stay on placeholders

- **WHEN** a visitor activates the 成員列表 card or the 家族相簿 card
- **THEN** the browser stays on the homepage and no 404 error page is shown

##### Example: link targets after this change

| Link                | href               | Reason                       |
| ------------------- | ------------------ | ---------------------------- |
| 瀏覽族譜 CTA        | `family-tree.html` | destination page exists      |
| 族譜圖 card         | `family-tree.html` | destination page exists      |
| 成員列表 card       | `#`                | destination page not built   |
| 家族相簿 card       | `#`                | destination page not built   |

#### Scenario: All three cards are present

- **WHEN** a visitor views the entry card section
- **THEN** exactly three cards are shown, titled 族譜圖, 成員列表, and 家族相簿, each with a description


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
### Requirement: Footer

The homepage SHALL end with a footer containing a contact method and a last-updated date. The last-updated date SHALL be written literally in the markup in `YYYY-MM-DD` format.

#### Scenario: Footer content is present

- **WHEN** a visitor scrolls to the bottom of the homepage
- **THEN** a contact method and a last-updated date in `YYYY-MM-DD` format are visible

---
### Requirement: Responsive layout

The homepage layout SHALL adapt to narrow viewports without horizontal scrolling. On viewports narrower than 768 pixels, the statistics row and the entry cards SHALL stack vertically instead of sitting side by side.

#### Scenario: Narrow viewport stacks content

- **WHEN** a visitor views the homepage at a viewport width of 375 pixels
- **THEN** the three statistics stack vertically, the three entry cards stack vertically, and the page body does not scroll horizontally

#### Scenario: Wide viewport uses horizontal layout

- **WHEN** a visitor views the homepage at a viewport width of 1280 pixels
- **THEN** the three statistics are arranged side by side and the three entry cards are arranged side by side