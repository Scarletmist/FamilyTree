## MODIFIED Requirements

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
