"""Check actual print files; retain rendered pages for separate visual review."""
import json
import logging
import sys
import unicodedata
from pathlib import Path
import pdfplumber

logging.getLogger('pdfminer').setLevel(logging.ERROR)
root = Path(sys.argv[1])
normalize = lambda value: ''.join(unicodedata.normalize('NFKC', value).translate(str.maketrans({'⻑':'長','⺟':'母'})).split())
reports = []
for paper, orientation, private in [('A4','landscape',False),('A3','portrait',False),('A4','portrait',True)]:
    file = root / f'phase5-{paper}-{orientation}{"-private" if private else ""}.pdf'
    with pdfplumber.open(file) as doc:
        text = normalize(''.join(p.extract_text() or '' for p in doc.pages))
        assert '回收成員' not in text and '單獨封存' not in text
        if private:
            assert 'OOO' in text
            for name in ['第五階段輸出驗證','完整長姓名','封存銜接母親','第五階段測試訪談','關係資料說明']:
                assert name not in text, f'Private export leaked {name}'
        else:
            for name in ['祖母','封存銜接母親','父親','另一位配偶','親生子女','收養子女','過繼子女','師父','未連結',('完整長姓名測試'*12)[:80],'第五階段測試訪談','銜接人物','待補']:
                assert normalize(name) in text, f'Missing printed text: {name}'
        sizes = [c['size'] for p in doc.pages for c in p.chars if c['text'].strip()]
        assert min(sizes) >= 11.9, f'Text below 12pt: {min(sizes)}'
        expected = [841.92,594.96] if orientation == 'landscape' else ([841.92,1190.88] if paper == 'A3' else [594.96,841.92])
        assert all(abs(p.width-expected[0]) < 2 and abs(p.height-expected[1]) < 2 for p in doc.pages)
        assert all(p.chars for p in doc.pages), 'Unexpected blank page'
        reports.append({'file':file.name,'pages':len(doc.pages),'minimumFontPt':min(sizes),'private':private,'pageTextCounts':[len(p.extract_text() or '') for p in doc.pages]})
(root / 'pdf-inspection.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(reports,ensure_ascii=False))
