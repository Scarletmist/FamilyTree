/*
 * 房別推導
 *
 * 房別完全是譜系的函數，因此不儲存於資料中，而是每次由此計算。
 * 儲存它會製造第二個事實來源，改一處忘另一處就會出現
 * 「掛在二房底下卻標記為長房」的矛盾。
 *
 * 對外只暴露 computeBranches(family)，回傳
 *   { [personId]: { path: number[], label: string } }
 *
 * 規則摘要：
 *   - 只有 親生／過繼／養子女 三種 kind 承繼房別並傳遞排行。
 *     義子女、契子女、bonds、未知 kind 皆不傳遞。
 *   - 排行以「承繼房別的那一位父母」為單位，蒐集其在所有 union
 *     中的承繼子女合併計算，不以 union 為單位切開——婚姻只有一種，
 *     以 union 分組等於把元配／續弦的區別偷偷放回來。
 *   - 生年比較只取前四字元，容納 "1895?" 與僅有年份的情況。
 */
(function () {
  "use strict";

  var LINEAGE_KINDS = ["親生", "過繼", "養子女"];
  var LEVEL_NOUNS = ["房", "支", "派"];
  var CN_NUMERALS = [
    "",
    "長",
    "二",
    "三",
    "四",
    "五",
    "六",
    "七",
    "八",
    "九",
    "十"
  ];

  function confersLineage(kind) {
    return LINEAGE_KINDS.indexOf(kind) !== -1;
  }

  /* 生年只比前四字元：完整日期、僅年份、"1895?" 三種形式都落在年份上。 */
  function birthYear(person) {
    return person && typeof person.birth === "string"
      ? person.birth.slice(0, 4)
      : "";
  }

  function numeral(n) {
    return n < CN_NUMERALS.length ? CN_NUMERALS[n] : String(n);
  }

  /* 排行路徑轉中文標籤：房、支、派三層用完後以連字號接阿拉伯數字。 */
  function labelFor(path) {
    if (path.length === 0) {
      return "始祖";
    }
    var label = "";
    for (var i = 0; i < path.length; i++) {
      if (i < LEVEL_NOUNS.length) {
        label += numeral(path[i]) + LEVEL_NOUNS[i];
      } else {
        label += "-" + path[i];
      }
    }
    return label;
  }

  function computeBranches(family) {
    var result = {};
    if (!family || !Array.isArray(family.people)) {
      return result;
    }

    var people = family.people;
    var unions = Array.isArray(family.unions) ? family.unions : [];
    var descents = Array.isArray(family.descents) ? family.descents : [];

    var personById = {};
    people.forEach(function (p) {
      personById[p.id] = p;
      result[p.id] = { path: [], label: "" };
    });

    var unionById = {};
    unions.forEach(function (u) {
      unionById[u.id] = u;
    });

    // 承繼邊：child -> 其所屬 union，以及 union -> 承繼子女清單（保留原陣列順序供同年決勝）。
    var lineageParentUnionOf = {};
    var lineageChildrenOfUnion = {};
    descents.forEach(function (d, index) {
      if (!confersLineage(d.kind)) {
        return;
      }
      if (!personById[d.child] || !unionById[d.union]) {
        return; // 壞參照由繪圖端警告，此處僅略過不計入房別
      }
      lineageParentUnionOf[d.child] = d.union;
      if (!lineageChildrenOfUnion[d.union]) {
        lineageChildrenOfUnion[d.union] = [];
      }
      lineageChildrenOfUnion[d.union].push({ child: d.child, order: index });
    });

    /*
     * 承繼房別的那一位父母：從始祖可達者。婚入配偶不是。
     * 以「該 partner 本身是否有承繼父母，或是否無人以其配偶身分之外的方式進入譜系」
     * 判斷過於迂迴，改以由上而下的走訪自然決定——見下方 walk()。
     */
    function lineageParentOfUnion(union, inLineage) {
      var candidates = union.partners.filter(function (id) {
        return inLineage[id];
      });
      if (candidates.length === 0) {
        return null;
      }
      // 兩位皆在籍時取 partners 中排前者，維持確定性。
      return candidates[0];
    }

    /*
     * 循環偵測必須在走訪之前做。若某人成為自己的祖先，他就有了承繼父母，
     * 其所屬的譜系起點 union 便不再符合「兩位 partner 都無承繼父母」，
     * 導致完全找不到始祖、整份資料靜默地算不出任何房別。
     *
     * 因此先沿承繼父母鏈向上找出閉合點，切斷該人的父母連結讓譜系重新有起點，
     * 並記下該人——其房別標籤最終留空，其餘族人照常推導。
     */
    var cyclic = {};

    function provisionalParentOf(childId) {
      var unionId = lineageParentUnionOf[childId];
      if (!unionId) {
        return null;
      }
      var union = unionById[unionId];
      if (!union) {
        return null;
      }
      var descendantPartner = union.partners.filter(function (id) {
        return lineageParentUnionOf[id];
      });
      return descendantPartner.length > 0 ? descendantPartner[0] : union.partners[0];
    }

    people.forEach(function (start) {
      var chain = {};
      var current = start.id;
      while (current) {
        if (chain[current]) {
          if (!cyclic[current]) {
            cyclic[current] = true;
            delete lineageParentUnionOf[current];
            console.warn(
              "房別推導：偵測到循環參照（" +
                current +
                "），已切斷其承繼父母連結，該族人房別留空，其餘族人照常推導。"
            );
          }
          break;
        }
        chain[current] = true;
        current = provisionalParentOf(current);
      }
    });

    // 切斷後，被切斷者不再是任何 union 的承繼子女。
    Object.keys(cyclic).forEach(function (id) {
      Object.keys(lineageChildrenOfUnion).forEach(function (unionId) {
        lineageChildrenOfUnion[unionId] = lineageChildrenOfUnion[unionId].filter(
          function (entry) {
            return entry.child !== id;
          }
        );
      });
    });

    /*
     * 始祖：只在「兩位 partner 都沒有承繼父母」的 union 產生，取 partners 排前者。
     * 不能只看「有承繼子女且自己無承繼父母」——婚入的配偶同樣符合該條件，
     * 會被誤判為另一位始祖而取得空路徑的「始祖」標籤。
     */
    var inLineage = {};
    var apexIds = [];
    unions.forEach(function (u) {
      if ((lineageChildrenOfUnion[u.id] || []).length === 0) {
        return;
      }
      var rootedPartners = u.partners.filter(function (id) {
        return personById[id] && !lineageParentUnionOf[id];
      });
      if (rootedPartners.length !== u.partners.length) {
        return; // 有一位是後代，該 union 不是譜系起點
      }
      var apex = u.partners[0];
      if (apexIds.indexOf(apex) === -1) {
        apexIds.push(apex);
      }
    });

    /*
     * 由始祖往下走訪。每到一位在籍者，蒐集其在所有 union 中的承繼子女，
     * 合併後依生年排行，再遞迴而下。visiting 用於偵測循環參照。
     */
    var visiting = {};

    function walk(personId, path) {
      if (visiting[personId]) {
        console.warn(
          "房別推導：偵測到循環參照（" +
            personId +
            "），中止此路徑的追溯，該族人房別留空。"
        );
        return;
      }
      visiting[personId] = true;
      result[personId].path = path.slice();
      result[personId].label = labelFor(path);

      // 跨 union 合併：這位父母的所有承繼子女在同一組排行中。
      var children = [];
      unions.forEach(function (u) {
        if (u.partners.indexOf(personId) === -1) {
          return;
        }
        if (lineageParentOfUnion(u, inLineage) !== personId) {
          return;
        }
        (lineageChildrenOfUnion[u.id] || []).forEach(function (entry) {
          children.push(entry);
        });
      });

      children.sort(function (a, b) {
        var ya = birthYear(personById[a.child]);
        var yb = birthYear(personById[b.child]);
        if (ya !== yb) {
          return ya < yb ? -1 : 1;
        }
        return a.order - b.order; // 同年以 descents 陣列順序決勝
      });

      children.forEach(function (entry, i) {
        inLineage[entry.child] = true;
        walk(entry.child, path.concat(i + 1));
      });

      visiting[personId] = false;
    }

    apexIds.forEach(function (id) {
      inLineage[id] = true;
    });
    apexIds.forEach(function (id) {
      walk(id, []);
    });

    /*
     * 婚入配偶：本身無承繼路徑，標籤借用另一位 partner 的標籤，
     * path 維持空陣列——婚姻不開新房。
     */
    people.forEach(function (p) {
      if (inLineage[p.id]) {
        return;
      }
      var label = "";
      unions.forEach(function (u) {
        if (label || u.partners.indexOf(p.id) === -1) {
          return;
        }
        u.partners.forEach(function (other) {
          if (other !== p.id && inLineage[other] && result[other]) {
            label = result[other].label;
          }
        });
      });
      result[p.id].label = label;
      result[p.id].path = [];
    });

    // 循環的閉合點不承繼任何房別。
    Object.keys(cyclic).forEach(function (id) {
      if (result[id]) {
        result[id].path = [];
        result[id].label = "";
      }
    });

    return result;
  }

  window.computeBranches = computeBranches;
})();
