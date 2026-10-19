"""Inspect the actual browser PDF; visual QA remains necessary."""
import json
import logging
import sys
import unicodedata
from pathlib import Path
import pdfplumber

pdf_path = Path(sys.argv[1])
logging.getLogger("pdfminer").setLevel(logging.ERROR)
with pdfplumber.open(pdf_path) as doc:
    page_text = [p.extract_text() or "" for p in doc.pages]
    # Microsoft JhengHei's embedded CMap uses supplemental radical aliases for
    # a few glyphs. These render correctly; normalize their extracted spelling.
    normalize = lambda value: "".join(unicodedata.normalize("NFKC", value).translate(str.maketrans({"⻑":"長","⺟":"母"})).split())
    compact = normalize("".join(page_text))
    appendix_start = next((i for i, value in enumerate(page_text) if value.startswith("關係來源與說明")), len(page_text))
    diagram_text = normalize("".join(page_text[:appendix_start]))
    full_name = ("驗證_" + "完整長姓名測試" * 12)[:80]
    assert full_name in diagram_text, "Complete long name missing from printed cards"
    for name in ["祖母","封存母親","父親","子女","手足","未連結",*["成員" + str(i) for i in range(5)]]:
        assert "驗證_" + name in diagram_text, "Printed member missing: " + name
    assert "口述訪談<原稿>" in compact
    assert "銜接人物" in compact
    assert "回收成員" not in compact and "不銜接封存" not in compact
    sizes = [c["size"] for p in doc.pages for c in p.chars if c["text"].strip()]
    assert min(sizes) >= 11.9, f"Text below 12pt: {min(sizes)}"
    assert all(abs(p.width - 841.92) < 2 and abs(p.height - 594.96) < 2 for p in doc.pages)
    report = {"pages": len(doc.pages), "minimumFontPt": min(sizes), "longNameComplete": True,
              "pageSizePt": [doc.pages[0].width, doc.pages[0].height],
              "pageTextCounts": [len(p.extract_text() or "") for p in doc.pages]}
    pdf_path.with_suffix(".inspection.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
