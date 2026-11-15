#!/usr/bin/env python3
"""Build a standalone visual gallery for observed baseline false accepts."""
from base64 import b64encode
from csv import DictReader
from html import escape
from pathlib import Path
from hashlib import sha256
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "reports" / "false-accept-cases.html"
rows = []
with (ROOT / "reports/jev-comprehensive-v3/primary-decisions.csv").open(encoding="utf-8-sig", newline="") as f:
    for row in DictReader(f):
        if row["baseline_accepted"] == "true" and row["expected"] == "_unknown":
            rows.append(row)
assert len(rows) == 8, len(rows)
rows.sort(key=lambda row: row["review_id"])
plan = json.loads((ROOT / "reports/jev-comprehensive-v3/plan.json").read_text(encoding="utf-8-sig"))
queries = {q["id"]: q for q in plan["queries"]}
references = {r["review_id"]: r for r in plan["references"]}
names = {
    "stamp-canh-cua-cham-rong": "Cánh cửa chạm rồng",
    "stamp-hai-thieu-nu-em-be": "Hai thiếu nữ và em bé",
    "stamp-em-thuy": "Em Thúy",
}
ref_files = {
    "stamp-canh-cua-cham-rong": "data/catalog-releases/crop-bank30-v1/R0174.jpg",
    "stamp-hai-thieu-nu-em-be": "data/catalog-releases/crop-bank30-v1/R0896.jpg",
    "stamp-em-thuy": "data/catalog-releases/crop-bank30-v1/B1637.jpg",
}
query_files = {
    "S2-08": "reports/session2-review-v1/experiment/jpeg/S2-08.jpg",
    "S2-09": "reports/session2-review-v1/experiment/jpeg/S2-09.jpg",
    "S2-10": "reports/session2-review-v1/experiment/jpeg/S2-10.jpg",
    "S2-11": "reports/session2-review-v1/experiment/jpeg/S2-11.jpg",
    "S2-12": "reports/session2-review-v1/experiment/jpeg/S2-12.jpg",
    "V0047": "reports/vnfam-negative-test-v1/prepared/V0047.jpg",
    "V0309": "reports/vnfam-negative-test-v1/prepared/V0309.jpg",
    "V0354": "reports/vnfam-negative-test-v1/prepared/V0354.jpg",
}
def image(path):
    data = b64encode((ROOT / path).read_bytes()).decode("ascii")
    return f"data:image/jpeg;base64,{data}"
def card(row, index):
    q = query_files[row["review_id"]]
    r = ref_files[row["top1"]]
    assert sha256((ROOT / q).read_bytes()).hexdigest() == queries[row["query_id"]]["digest"]
    assert sha256((ROOT / r).read_bytes()).hexdigest() == references[row["reference_id"]]["digest"]
    return f''' <article class="case"><div class="case-head"><span class="num">{index:02}</span><div><h2>{escape(row["review_id"])} · {escape(row["capture_group"])}</h2><p>Baseline nhận: <b>{escape(names[row["top1"]])}</b> · Reference: <code>{escape(row["reference_id"])}</code></p></div></div><div class="pair"><figure><img alt="Ảnh truy vấn {escape(row['review_id'])}" src="{image(q)}" tabindex="0"><figcaption><b>Ảnh query / unknown</b><br>{escape(q)}</figcaption></figure><figure><img alt="Reference {escape(row['reference_id'])}" src="{image(r)}" tabindex="0"><figcaption><b>Reference bị chọn nhầm</b><br>{escape(r)}</figcaption></figure></div><dl><div><dt>Cosine</dt><dd>{float(row["score"]):.4f}</dd></div><div><dt>Margin</dt><dd>{float(row["margin"]):.4f}</dd></div><div><dt>Jev forward</dt><dd>{float(row["probability"]):.2f}</dd></div><div><dt>Jev reverse</dt><dd>{float(row["reverse_probability"]):.2f}</dd></div><div><dt>Serving</dt><dd class="blocked">Baseline accept → Jev block</dd></div></dl></article>'''
extra_q = image("reports/reference-bank-crop-pilot-v1/prepared/R0740.jpg")
extra_r = image("reports/reference-bank-crop-pilot-v1/prepared/R1090.jpg")
html = f'''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baseline false accepts — Jev study</title><style>
:root{{--bg:#f5f1e8;--ink:#28241f;--muted:#756c60;--line:#d9d0c2;--card:#fffdf8;--red:#a83232;--gold:#9a6d16}}*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}}main{{max-width:1180px;margin:auto;padding:34px 20px 70px}}h1{{font:700 clamp(28px,4vw,48px)/1.1 Georgia,serif;margin:0 0 12px}}h2{{font-size:20px;margin:0 0 3px}}h3{{font:700 25px Georgia,serif;margin-top:50px}}p{{margin:6px 0;color:var(--muted)}}.notice{{border-left:5px solid var(--gold);padding:15px 18px;background:#fff8df;margin:24px 0 30px}}.case{{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:22px 0;box-shadow:0 5px 15px #4d3a1610}}.case-head{{display:flex;gap:14px;align-items:flex-start;margin-bottom:16px}}.num{{background:var(--red);color:white;border-radius:8px;padding:3px 9px;font-weight:700}}.pair{{display:grid;grid-template-columns:1fr 1fr;gap:16px}}figure{{margin:0;border:1px solid var(--line);background:white;border-radius:10px;overflow:hidden}}img{{display:block;width:100%;height:360px;object-fit:contain;background:#e8e3d9}}figcaption{{padding:10px 12px;font-size:13px;color:var(--muted);overflow-wrap:anywhere}}dl{{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0 0}}dl div{{background:#f1ece2;border-radius:8px;padding:7px 11px}}dt{{font-size:11px;color:var(--muted);text-transform:uppercase}}dd{{margin:1px 0 0;font-weight:650}}.blocked{{color:var(--red)}}code{{font-size:.9em;background:#eee7da;padding:2px 4px;border-radius:4px}}.small{{font-size:13px;color:var(--muted)}}@media(max-width:680px){{.pair{{grid-template-columns:1fr}}img{{height:270px}}}}
</style><main><h1>Những trường hợp baseline nhận nhầm</h1><p>Gallery trực quan từ nghiên cứu Jev v2 toàn diện. Mỗi card là một ảnh unknown/negative proposal đã vượt baseline threshold {0.8} và được gán nhầm hiện vật; Jev đã chặn cả 8 trường hợp.</p><div class="notice"><b>Đọc đúng kết quả:</b> đây là 8 lỗi quan sát được trên tập nghiên cứu, không phải tỷ lệ false-accept production. Năm ảnh S2-08…S2-12 cùng một capture group; ba ảnh VNfam là visual negative proposals và không phải benchmark độc lập hoàn toàn. Jev production hiện vẫn đang <b>off</b>.</div>{''.join(card(row,i) for i,row in enumerate(rows,1))}<h3>Phụ lục: R0740 (development crop pilot, không nằm trong 8 case chính)</h3><p>R0740 là một false accept phát hiện ở pilot trước: baseline nhận thành Hoàng hậu Ngọc Trúc, cosine 0.8179, margin 0.0685; reference gần nhất R1090. R1090 không có trong production bank32 hiện tại; đây không phải bằng chứng lỗi R0740 còn tồn tại với bank32. Case này không được cộng vào thống kê 8 case chính.</p><article class="case"><div class="pair"><figure><img alt="Ảnh truy vấn R0740 ở pilot cũ" src="{extra_q}" tabindex="0"><figcaption><b>R0740 · query unknown</b><br>Development crop pilot</figcaption></figure><figure><img alt="Reference R1090 ở pilot cũ" src="{extra_r}" tabindex="0"><figcaption><b>R1090 · reference gây nhầm</b><br>Hoàng hậu Ngọc Trúc</figcaption></figure></div></article><p class="small">Nguồn số liệu: reports/jev-comprehensive-v3/primary-decisions.csv và decision.md. Ảnh được nhúng trực tiếp để file hoạt động độc lập khi mở local. Bấm ảnh để phóng lớn; ESC để đóng. Điểm reverse chỉ là diagnostic, không được dùng để chọn lại kết quả hay lấy max hai chiều.</p></main><dialog aria-label="Xem ảnh lớn"><button autofocus>Đóng ✕</button><img alt="Ảnh phóng lớn"></dialog><style>figure img{{cursor:zoom-in}}dialog{{width:min(96vw,1400px);max-height:96vh;padding:12px;background:#fffdf8;border:0;border-radius:12px}}dialog::backdrop{{background:#000b}}dialog img{{height:auto;max-height:85vh;object-fit:contain}}dialog button{{display:block;margin:0 0 10px auto;padding:10px 16px;cursor:pointer}}</style><script>const d=document.querySelector('dialog');for(const img of document.querySelectorAll('figure img')){{const show=()=>{{d.querySelector('img').src=img.src;d.querySelector('img').alt=img.alt;d.showModal();}};img.addEventListener('click',show);img.addEventListener('keydown',e=>{{if(e.key==='Enter'||e.key===' '){{e.preventDefault();show();}}}});}}d.querySelector('button').addEventListener('click',()=>d.close());</script></html>'''
OUT.write_text(html, encoding="utf-8")
print(OUT)
print(f"cases={len(rows)}")
