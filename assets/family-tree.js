/*
 * 族譜圖繪製
 *
 * 讀取全域 FAMILY（data/family.js）與 computeBranches（assets/branch.js），
 * 將族人依 gen 分成水平世代列，並在節點層之上以 SVG 繪製關係連線。
 *
 * 佈局刻意簡單：同一世代依 FAMILY.people 的陣列順序由左至右排列。
 * 這在數十人的規模下足以閱讀；人數大幅成長後需要重新設計。
 *
 * 六類關係各有相異的 data-kind：
 *   spouse 婚姻｜親生／過繼／養子女（承繼，實線系列）
 *   義子女／契子女（不承繼，虛線系列）｜契手足（同輩，點線）
 */
(function () {
  "use strict";

  var SVG_NS = "http://www.w3.org/2000/svg";

  var LINEAGE_KINDS = ["親生", "過繼", "養子女"];
  var DESCENT_KINDS = ["親生", "過繼", "養子女", "義子女", "契子女"];

  // 承繼者為實線系列，非承繼者為虛線系列——「是否入房」先在視覺上可分。
  var STROKE_BY_KIND = {
    spouse: null,
    親生: null,
    過繼: "10 3",
    養子女: "6 3",
    義子女: "2 4",
    契子女: "1 4",
    契手足: "1 6",
    unknown: "12 2 2 2"
  };

  function isKnownDescentKind(kind) {
    return DESCENT_KINDS.indexOf(kind) !== -1;
  }

  function renderError(canvas, message) {
    var box = document.createElement("p");
    box.className = "tree__error";
    box.textContent = message;
    canvas.appendChild(box);
  }

  /* 節點：姓名 + 生卒年 + 房別標籤。在世者只顯示生年並加上在世標記。 */
  function buildPersonNode(person, branchLabel) {
    var node = document.createElement("div");
    node.className = "person" + (person.death === null ? " person--living" : "");
    node.dataset.personId = person.id;
    node.dataset.living = person.death === null ? "true" : "false";

    var name = document.createElement("div");
    name.className = "person__name";
    name.textContent = person.name;
    node.appendChild(name);

    var years = document.createElement("div");
    years.className = "person__years";
    if (person.death === null) {
      // 生卒年原樣輸出，不去除不確定年份的問號。
      years.textContent = person.birth + " —";
      var mark = document.createElement("span");
      mark.className = "person__living-mark";
      mark.textContent = " ●";
      years.appendChild(mark);
    } else {
      years.textContent = person.birth + " – " + person.death;
    }
    node.appendChild(years);

    // 標籤為空時完全不輸出元素，不留佔位文字。
    if (branchLabel) {
      var branch = document.createElement("div");
      branch.className = "person__branch";
      branch.textContent = branchLabel;
      node.appendChild(branch);
    }

    return node;
  }

  function buildRows(canvas, people, branches) {
    var rows = document.createElement("div");
    rows.className = "tree__rows";

    var generations = people
      .map(function (p) {
        return p.gen;
      })
      .filter(function (g, i, arr) {
        return arr.indexOf(g) === i;
      })
      .sort(function (a, b) {
        return a - b;
      });

    var nodeById = {};

    generations.forEach(function (gen) {
      var row = document.createElement("div");
      row.className = "generation";
      row.dataset.gen = String(gen);

      // 陣列順序即列內由左至右的順序，配偶已在資料中相鄰排列。
      people
        .filter(function (p) {
          return p.gen === gen;
        })
        .forEach(function (person) {
          var entry = branches[person.id];
          var node = buildPersonNode(person, entry ? entry.label : "");
          nodeById[person.id] = node;
          row.appendChild(node);
        });

      rows.appendChild(row);
    });

    canvas.appendChild(rows);
    return nodeById;
  }

  /* 節點座標，相對於 canvas 左上角。 */
  function boxOf(node, canvasRect) {
    var r = node.getBoundingClientRect();
    return {
      x: r.left - canvasRect.left + r.width / 2,
      top: r.top - canvasRect.top,
      bottom: r.bottom - canvasRect.top,
      midY: r.top - canvasRect.top + r.height / 2
    };
  }

  function styleStroke(el, kind) {
    el.setAttribute("stroke", "var(--color-connector)");
    el.setAttribute("stroke-width", "1.5");
    el.dataset.kind = kind;
    var dash = STROKE_BY_KIND[kind];
    if (dash) {
      el.setAttribute("stroke-dasharray", dash);
    }
  }

  function line(x1, y1, x2, y2, kind) {
    var el = document.createElementNS(SVG_NS, "line");
    el.setAttribute("x1", x1);
    el.setAttribute("y1", y1);
    el.setAttribute("x2", x2);
    el.setAttribute("y2", y2);
    styleStroke(el, kind);
    return el;
  }

  function polyline(points, kind) {
    var el = document.createElementNS(SVG_NS, "polyline");
    el.setAttribute(
      "points",
      points
        .map(function (p) {
          return p[0] + "," + p[1];
        })
        .join(" ")
    );
    el.setAttribute("fill", "none");
    styleStroke(el, kind);
    return el;
  }

  /*
   * 連線。一筆壞資料只跳過該條連線並在 console 警告，不讓整張圖消失。
   */
  function drawConnectors(canvas, nodeById, data) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "tree__connectors");
    svg.id = "tree-connectors";
    canvas.appendChild(svg);

    var canvasRect = canvas.getBoundingClientRect();
    svg.setAttribute("width", canvasRect.width);
    svg.setAttribute("height", canvasRect.height);

    var unionAnchors = {};

    (data.unions || []).forEach(function (union) {
      var a = nodeById[union.partners[0]];
      var b = nodeById[union.partners[1]];
      if (!a || !b) {
        console.warn(
          "族譜圖：union " +
            union.id +
            " 參照到不存在的族人 id（" +
            union.partners
              .filter(function (id) {
                return !nodeById[id];
              })
              .join("、") +
            "），略過此婚姻連線。"
        );
        return;
      }

      var ba = boxOf(a, canvasRect);
      var bb = boxOf(b, canvasRect);
      svg.appendChild(line(ba.x, ba.midY, bb.x, bb.midY, "spouse"));

      // 親子連線由配偶連線的中點向下拉。
      unionAnchors[union.id] = {
        x: (ba.x + bb.x) / 2,
        y: Math.max(ba.bottom, bb.bottom)
      };
    });

    (data.descents || []).forEach(function (descent) {
      var anchor = unionAnchors[descent.union];
      var childNode = nodeById[descent.child];
      if (!anchor) {
        console.warn(
          "族譜圖：descent 參照到不存在或無法定位的 union id（" +
            descent.union +
            "），略過此親子連線。"
        );
        return;
      }
      if (!childNode) {
        console.warn(
          "族譜圖：union " +
            descent.union +
            " 參照到不存在的族人 id（" +
            descent.child +
            "），略過此親子連線。"
        );
        return;
      }

      var kind = descent.kind;
      if (!isKnownDescentKind(kind)) {
        console.warn(
          "族譜圖：無法辨識的親子關係 kind（" +
            kind +
            "），以預設線條樣式繪出，且不承繼房別。"
        );
        kind = "unknown";
      }

      var c = boxOf(childNode, canvasRect);
      var midY = (anchor.y + c.top) / 2;
      svg.appendChild(
        polyline(
          [
            [anchor.x, anchor.y],
            [anchor.x, midY],
            [c.x, midY],
            [c.x, c.top]
          ],
          kind
        )
      );
    });

    /* 同輩橫向連線。兩人可能不在同一列，因此走列外的折線避免穿過節點。 */
    (data.bonds || []).forEach(function (bond) {
      var a = nodeById[bond.members[0]];
      var b = nodeById[bond.members[1]];
      if (!a || !b) {
        console.warn(
          "族譜圖：bond 參照到不存在的族人 id（" +
            bond.members
              .filter(function (id) {
                return !nodeById[id];
              })
              .join("、") +
            "），略過此同輩連線。"
        );
        return;
      }
      var ba = boxOf(a, canvasRect);
      var bb = boxOf(b, canvasRect);
      if (Math.abs(ba.midY - bb.midY) < 1) {
        svg.appendChild(line(ba.x, ba.midY, bb.x, bb.midY, "契手足"));
      } else {
        var gutter = Math.min(ba.x, bb.x) - 24;
        svg.appendChild(
          polyline(
            [
              [ba.x, ba.midY],
              [gutter, ba.midY],
              [gutter, bb.midY],
              [bb.x, bb.midY]
            ],
            "契手足"
          )
        );
      }
    });
  }

  function render() {
    var canvas = document.getElementById("tree-canvas");
    if (!canvas) {
      return;
    }
    canvas.innerHTML = "";

    if (typeof FAMILY === "undefined" || !FAMILY) {
      renderError(
        canvas,
        "族譜資料載入失敗，無法顯示族譜圖。請確認 data/family.js 存在且可讀取。"
      );
      return;
    }

    var branches =
      typeof computeBranches === "function" ? computeBranches(FAMILY) : {};

    var nodeById = buildRows(canvas, FAMILY.people, branches);
    drawConnectors(canvas, nodeById, FAMILY);
  }

  // 供重繪使用（例如視窗尺寸改變後連線座標需要重算）。
  window.renderFamilyTree = render;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });
})();
