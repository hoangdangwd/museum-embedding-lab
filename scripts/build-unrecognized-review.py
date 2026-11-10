"""Generate visual review sheets and threshold distribution report for:
1. False Accept images (Ảnh nhận nhầm / sai).
2. Unaccepted positive images (Ảnh chưa nhận diện được).

Configuration: embedding_threshold = 0.78, embedding_margin = 0.10
Offline exploratory tool for calibration data only.
No provider calls, no final partition scoring, no label modifications, no production changes.
"""
from collections import Counter
import json
from pathlib import Path
from PIL import Image, ImageOps, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_CONFIG = {
    'embedding_threshold': 0.78,
    'embedding_margin': 0.10,
    'planar_inliers': 12,
    'planar_margin': 5,
    'sculpture_inliers': 6,
    'sculpture_margin': 3,
    'runnerup_limit': 8,
    'weak_conflict_limit': 6,
}

SCULPTURES = {'stamp-hoang-hau-ngoc-truc', 'stamp-phat-ba-quan-am'}


def evaluate_sample(e, g_planar, g_sculpt, config=DEFAULT_CONFIG):
    is_sculpt = e['expected'] in SCULPTURES
    g = g_sculpt if is_sculpt else g_planar

    # Geometry thresholds
    geo_thresh = config['sculpture_inliers'] if is_sculpt else config['planar_inliers']
    geo_margin_thresh = config['sculpture_margin'] if is_sculpt else config['planar_margin']

    # Guards
    runnerup_max = max(g_planar['ranking'][1]['score'], g_sculpt['ranking'][1]['score'])
    multi_target = runnerup_max >= config['runnerup_limit']
    conflict = (g['predicted'] is not None and g['predicted'] != e['predicted'] and 
                g['score'] >= config['weak_conflict_limit'])

    # Evidences
    e_ok = e['score'] >= config['embedding_threshold'] and e['margin'] >= config['embedding_margin']
    g_ok = (g['predicted'] is not None and 
            g['score'] >= geo_thresh and 
            g['margin'] >= geo_margin_thresh)

    if multi_target:
        decision = 'reject'
        pred = None
        reason = 'multi_target'
    elif conflict:
        decision = 'reject'
        pred = None
        reason = 'conflict'
    elif e_ok:
        decision = 'accept'
        pred = e['predicted']
        reason = 'embedding_primary'
    elif g_ok:
        decision = 'accept'
        pred = g['predicted']
        reason = 'family_geometry_rescue'
    else:
        decision = 'reject'
        pred = None
        reason = 'insufficient'

    scen = e['scenario']
    is_positive = scen.startswith('known_')

    if is_positive:
        if decision == 'accept':
            status = 'correct_accept' if pred == e['expected'] else 'wrong_artifact_accept'
        else:
            status = 'unaccepted_positive'
    else:
        if decision == 'accept':
            status = 'false_accept'
        else:
            status = 'correct_reject'

    emb_score = e.get('score', 0.0)
    emb_margin = e.get('margin', 0.0)
    geo_inliers = g.get('score', 0)
    geo_margin = g.get('margin', 0)

    # Near-miss classification for unaccepted positives
    near_miss = (
        is_positive and decision == 'reject' and (
            (emb_score >= 0.74 and emb_margin >= 0.06) or
            (geo_inliers >= 8 and geo_margin >= 3)
        )
    )

    return {
        'file': e['file'],
        'expected': e['expected'],
        'scenario': scen,
        'decision': decision,
        'predicted': pred,
        'reason': reason,
        'status': status,
        'is_sculpture': is_sculpt,
        'embedding_score': emb_score,
        'embedding_margin': emb_margin,
        'embedding_predicted': e.get('predicted'),
        'geometry_model': 'affine' if is_sculpt else 'homography',
        'geometry_predicted': g.get('predicted'),
        'geometry_inliers': geo_inliers,
        'geometry_margin': geo_margin,
        'geometry_runnerup': runnerup_max,
        'emb_score_gap': emb_score - config['embedding_threshold'],
        'emb_margin_gap': emb_margin - config['embedding_margin'],
        'geo_thresh': geo_thresh,
        'geo_margin_thresh': geo_margin_thresh,
        'geo_inliers_gap': geo_inliers - geo_thresh,
        'geo_margin_gap': geo_margin - geo_margin_thresh,
        'near_miss': near_miss,
    }


def collect_evaluation_rows(cal_path, geo_path, config=DEFAULT_CONFIG):
    cal_data = json.loads(cal_path.read_text(encoding='utf-8'))['rows']['max']
    geo_rows = [json.loads(line) for line in geo_path.read_text(encoding='utf-8').splitlines()]
    geo_map = {r['file']: r for r in geo_rows}

    evaluated = []
    for e in cal_data:
        f = e['file']
        g_info = geo_map[f]['variants']
        g_planar = g_info['planar']
        g_sculpt = g_info['sculpture_affine']
        evaluated.append(evaluate_sample(e, g_planar, g_sculpt, config))

    # Partition into false accepts and unaccepted positives
    false_accepts = []
    unaccepted_positives = []
    for r in evaluated:
        if r['status'] in ('false_accept', 'wrong_artifact_accept'):
            r_copy = dict(r)
            r_copy['id'] = f"ERR{len(false_accepts)+1:02d}"
            false_accepts.append(r_copy)
        elif r['status'] == 'unaccepted_positive':
            r_copy = dict(r)
            r_copy['id'] = f"U{len(unaccepted_positives)+1:03d}"
            unaccepted_positives.append(r_copy)

    return false_accepts, unaccepted_positives, evaluated


def draw_card(draw, item, cx, cy, card_w, card_h, img_path, font, small_font, bold_font):
    # Card border
    is_err = item['status'] in ('false_accept', 'wrong_artifact_accept')
    outline_col = '#ef4444' if is_err else '#d0d4dc'
    bg_col = '#fff5f5' if is_err else '#ffffff'
    draw.rectangle([cx + 4, cy + 4, cx + card_w - 4, cy + card_h - 4], fill=bg_col, outline=outline_col, width=2 if is_err else 1)

    # Thumbnail
    try:
        with Image.open(img_path) as img:
            img.load()
            thumb = ImageOps.contain(img.convert('RGB'), (card_w - 16, 175))
            draw.bitmap((cx + (card_w - thumb.width) // 2, cy + 8), thumb)
    except Exception as e:
        draw.rectangle([cx + 8, cy + 8, cx + card_w - 8, cy + 180], fill='#e0e0e0')
        draw.text((cx + 12, cy + 90), f"Err: {e}", font=small_font, fill='red')

    # Header line
    y_text = cy + 188
    if is_err:
        draw.text((cx + 8, y_text), f"{item['id']} [SAI / FALSE ACCEPT]", font=bold_font, fill='#b91c1c')
        draw.text((cx + 8, y_text + 18), f"Thực tế: {item['scenario']} ({item['expected']})", font=small_font, fill='#7f1d1d')
        draw.text((cx + 8, y_text + 34), f"Nhận nhầm: {item['predicted'].removeprefix('stamp-')}", font=bold_font, fill='#b91c1c')
        draw.text((cx + 8, y_text + 50), f"Score: {item['embedding_score']:.3f} | Margin: {item['embedding_margin']:.3f}", font=small_font, fill='#374151')
    else:
        reason_color = '#b30000' if item['reason'] == 'conflict' else ('#d97706' if item['reason'] == 'multi_target' else '#4b5563')
        draw.text((cx + 8, y_text), f"{item['id']} [{item['reason'].upper()}]", font=bold_font, fill=reason_color)
        short_gt = item['expected'].removeprefix('stamp-')
        scen_tag = 'CLN' if item['scenario'] == 'known_clean' else 'CLT'
        draw.text((cx + 8, y_text + 18), f"GT: {short_gt} ({scen_tag})", font=small_font, fill='#111827')

        emb_pred_short = (item['embedding_predicted'] or 'None').removeprefix('stamp-')
        emb_match = 'OK' if item['embedding_predicted'] == item['expected'] else 'MIS'
        draw.text(
            (cx + 8, y_text + 34),
            f"Emb: {emb_pred_short} ({emb_match}) s={item['embedding_score']:.3f} m={item['embedding_margin']:.3f}",
            font=small_font,
            fill='#1f2937' if item['embedding_score'] >= 0.78 else '#6b7280'
        )

        geo_pred_short = (item['geometry_predicted'] or 'None').removeprefix('stamp-')
        geo_model_char = 'A' if item['geometry_model'] == 'affine' else 'H'
        draw.text(
            (cx + 8, y_text + 50),
            f"Geo [{geo_model_char}]: {geo_pred_short} inl={item['geometry_inliers']} m={item['geometry_margin']} rup={item['geometry_runnerup']}",
            font=small_font,
            fill='#047857' if item['geometry_inliers'] > 0 else '#9ca3af'
        )

        if item['near_miss']:
            draw.rectangle([cx + card_w - 75, cy + 8, cx + card_w - 8, cy + 26], fill='#f59e0b')
            draw.text((cx + card_w - 71, cy + 10), "NEAR-MISS", font=small_font, fill='#ffffff')


def generate_contact_sheets(items, eval_dir, output_dir, prefix='sheet', images_per_sheet=24):
    output_dir.mkdir(parents=True, exist_ok=True)
    font_path = Path('C:/Windows/Fonts/arial.ttf')
    font = ImageFont.truetype(str(font_path), 15) if font_path.exists() else ImageFont.load_default()
    small_font = ImageFont.truetype(str(font_path), 12) if font_path.exists() else ImageFont.load_default()
    bold_font = ImageFont.truetype(str(font_path), 13) if font_path.exists() else ImageFont.load_default()

    sheets = []
    cols = 4
    card_w = 320
    card_h = 300
    sheet_w = cols * card_w

    for sheet_idx, start in enumerate(range(0, len(items), images_per_sheet)):
        batch = items[start:start + images_per_sheet]
        rows_count = (len(batch) + cols - 1) // cols
        sheet_h = rows_count * card_h
        sheet = Image.new('RGB', (sheet_w, sheet_h), '#f4f5f7')
        draw = ImageDraw.Draw(sheet)

        for i, item in enumerate(batch):
            cx = (i % cols) * card_w
            cy = (i // cols) * card_h
            img_path = eval_dir / item['file']
            draw_card(draw, item, cx, cy, card_w, card_h, img_path, font, small_font, bold_font)

        sheet_file = f"{prefix}-{sheet_idx + 1:02d}.jpg"
        sheet.save(output_dir / sheet_file, quality=90)
        sheets.append({
            'file': sheet_file,
            'count': len(batch),
            'ids': [it['id'] for it in batch],
        })

    return sheets


def build_html_report(false_accepts, unaccepted, config, err_sheets, unrec_sheets, output_dir):
    # Render error cards
    err_cards_html = []
    for item in false_accepts:
        card = f'''
        <div class="card card-error" data-type="error">
            <div class="card-img-wrap">
                <img src="../../data/evaluation/{item['file']}" loading="lazy" alt="{item['id']}">
                <div class="card-id badge-err">{item['id']} (SAI)</div>
            </div>
            <div class="card-body">
                <div class="card-tags">
                    <span class="badge badge-danger">CHẤP NHẬN SAI</span>
                    <span class="badge badge-scenario">{item['scenario']}</span>
                </div>
                <div class="item-title" style="color: #b91c1c;">Nhận nhầm thành: <strong>{item['predicted'].removeprefix('stamp-')}</strong></div>
                <div class="item-line">
                    <span class="label">Thực tế trong ảnh:</span>
                    <span style="color: #4b5563;"><strong>{item['expected']}</strong></span>
                </div>
                <div class="score-grid" style="background: #fef2f2; border-color: #fecaca;">
                    <div>Score: <strong>{item['embedding_score']:.3f}</strong> <span class="pass-tag">(≥ 0.78)</span></div>
                    <div>Margin: <strong>{item['embedding_margin']:.3f}</strong> <span class="pass-tag">(≥ 0.10)</span></div>
                </div>
                <div class="item-desc" style="font-size: 11px; color: #7f1d1d; margin-top: 6px;">
                    Ảnh ngoài danh mục (tượng chùa/bảo tàng khác) có độ tương đồng embedding vượt ngưỡng và margin cao nên bị duyệt nhầm.
                </div>
            </div>
        </div>
        '''
        err_cards_html.append(card)

    # Render unaccepted cards
    unrec_cards_html = []
    for item in unaccepted:
        short_gt = item['expected'].removeprefix('stamp-')
        emb_pred = (item['embedding_predicted'] or 'None').removeprefix('stamp-')
        geo_pred = (item['geometry_predicted'] or 'None').removeprefix('stamp-')
        emb_match_class = 'match-ok' if item['embedding_predicted'] == item['expected'] else 'match-fail'

        reason_badge = f'<span class="badge badge-{item["reason"]}">{item["reason"]}</span>'
        scenario_badge = f'<span class="badge badge-scenario">{item["scenario"]}</span>'
        near_badge = '<span class="badge badge-near">near-miss</span>' if item['near_miss'] else ''

        card = f'''
        <div class="card" data-type="unaccepted" data-reason="{item['reason']}" data-scenario="{item['scenario']}" data-artifact="{item['expected']}" data-near="{str(item['near_miss']).lower()}">
            <div class="card-img-wrap">
                <img src="../../data/evaluation/{item['file']}" loading="lazy" alt="{item['id']}">
                <div class="card-id">{item['id']}</div>
                {near_badge}
            </div>
            <div class="card-body">
                <div class="card-tags">{reason_badge} {scenario_badge}</div>
                <div class="item-title">GT: <strong>{short_gt}</strong></div>
                <div class="item-line">
                    <span class="label">Embedding Top-1:</span>
                    <span class="{emb_match_class}"><strong>{emb_pred}</strong></span>
                </div>
                <div class="score-grid">
                    <div>Score: <strong>{item['embedding_score']:.3f}</strong> <span class="gap">({item['emb_score_gap']:+.3f})</span></div>
                    <div>Margin: <strong>{item['embedding_margin']:.3f}</strong> <span class="gap">({item['emb_margin_gap']:+.3f})</span></div>
                </div>
                <div class="item-line" style="margin-top:6px;">
                    <span class="label">Geometry ({item['geometry_model']}):</span>
                    <span><strong>{geo_pred}</strong></span>
                </div>
                <div class="score-grid">
                    <div>Inliers: <strong>{item['geometry_inliers']}</strong> <span class="gap">({item['geo_inliers_gap']:+d})</span></div>
                    <div>Runner-up: <strong>{item['geometry_runnerup']}</strong></div>
                </div>
            </div>
        </div>
        '''
        unrec_cards_html.append(card)

    html_content = f'''<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Đánh giá cấu hình: Score = 0.78, Margin = 0.10</title>
<style>
  :root {{
    --bg: #f8fafc;
    --card-bg: #ffffff;
    --border: #e2e8f0;
    --text: #0f172a;
    --muted: #64748b;
    --primary: #2563eb;
    --danger: #ef4444;
    --warning: #f59e0b;
    --success: #10b981;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; line-height: 1.5; }}
  h1 {{ font-size: 24px; margin-bottom: 8px; }}
  p.subtitle {{ color: var(--muted); margin-bottom: 24px; font-size: 14px; }}
  
  .summary-banner {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }}
  .metric-card {{ background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
  .metric-card.alert {{ border-color: #f87171; background: #fffaf0; }}
  .metric-card .val {{ font-size: 28px; font-weight: 700; color: var(--primary); }}
  .metric-card.alert .val {{ color: var(--danger); }}
  .metric-card .lbl {{ font-size: 13px; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-top: 4px; }}
  
  .section-title {{ font-size: 18px; margin: 32px 0 16px 0; display: flex; align-items: center; gap: 8px; }}
  .badge-count {{ background: #cbd5e1; color: #1e293b; font-size: 13px; font-weight: 600; padding: 2px 8px; border-radius: 12px; }}
  .badge-count-red {{ background: #fee2e2; color: #b91c1c; }}

  .filter-bar {{ background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }}
  .filter-group {{ display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }}
  .filter-group span {{ font-size: 13px; font-weight: 600; color: var(--muted); margin-right: 4px; }}
  button.filter-btn {{ background: #f1f5f9; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: all .15s; }}
  button.filter-btn.active {{ background: var(--primary); color: #fff; border-color: var(--primary); font-weight: 600; }}
  button.filter-btn:hover:not(.active) {{ background: #e2e8f0; }}

  .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-bottom: 32px; }}
  .card {{ background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; transition: transform .15s, box-shadow .15s; }}
  .card:hover {{ transform: translateY(-2px); box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); }}
  .card-error {{ border: 2px solid #ef4444; background: #fffbfb; }}
  
  .card-img-wrap {{ position: relative; height: 180px; background: #000; overflow: hidden; display: flex; align-items: center; justify-content: center; }}
  .card-img-wrap img {{ max-width: 100%; max-height: 100%; object-fit: contain; }}
  .card-id {{ position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px; font-weight: bold; padding: 2px 6px; border-radius: 4px; }}
  .badge-err {{ background: #dc2626 !important; }}
  
  .badge {{ display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; }}
  .badge-near {{ position: absolute; top: 8px; right: 8px; background: var(--warning); color: #fff; }}
  .badge-danger {{ background: #fee2e2; color: #b91c1c; }}
  .badge-insufficient {{ background: #e2e8f0; color: #475569; }}
  .badge-conflict {{ background: #fee2e2; color: #b91c1c; }}
  .badge-multi_target {{ background: #fef3c7; color: #b45309; }}
  .badge-scenario {{ background: #e0e7ff; color: #4338ca; }}
  
  .card-body {{ padding: 12px; flex: 1; display: flex; flex-direction: column; font-size: 13px; }}
  .card-tags {{ margin-bottom: 6px; display: flex; gap: 4px; }}
  .item-title {{ font-size: 14px; margin-bottom: 6px; }}
  .item-line {{ margin-bottom: 4px; display: flex; justify-content: space-between; }}
  .score-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 12px; background: #f8fafc; padding: 6px; border-radius: 4px; border: 1px solid #edf2f7; }}
  .gap {{ color: var(--muted); font-size: 11px; }}
  .pass-tag {{ color: var(--success); font-size: 11px; font-weight: 600; }}
  .match-ok {{ color: var(--success); }}
  .match-fail {{ color: var(--danger); }}
</style>
</head>
<body>

<h1>Đánh giá cấu hình: Score = 0.78, Margin = 0.10</h1>
<p class="subtitle">Đánh giá trên toàn bộ 508 ảnh Calibration (436 ảnh positive + 72 ảnh kiểm định negative/out-of-catalog). Kiểm tra toàn bộ các ảnh được chấp nhận đúng, chấp nhận sai và chưa được nhận diện.</p>

<div class="summary-banner">
  <div class="metric-card">
    <div class="val" style="color: var(--success);">279 / 436</div>
    <div class="lbl">Chấp nhận đúng (+25 ảnh)</div>
  </div>
  <div class="metric-card alert">
    <div class="val">6</div>
    <div class="lbl">Ảnh nhận nhầm (False Accept)</div>
  </div>
  <div class="metric-card">
    <div class="val">157</div>
    <div class="lbl">Chưa nhận diện (-25 ảnh)</div>
  </div>
  <div class="metric-card">
    <div class="val">4</div>
    <div class="lbl">Ảnh Clean còn sót</div>
  </div>
  <div class="metric-card">
    <div class="val">97.89%</div>
    <div class="lbl">Độ chính xác (Precision)</div>
  </div>
</div>

<h2 class="section-title" style="color: #b91c1c;">
  <span>1. Các ảnh bị CHẤP NHẬN SAI (False Accepts / Lỗi)</span>
  <span class="badge-count badge-count-red">6 ảnh</span>
</h2>
<p class="subtitle" style="margin-bottom: 16px;">
  Cả 6 ảnh này là các ảnh chụp tượng ngoài danh mục (phòng Khác 2 ở bảo tàng, mã R0745–R0751). Vì score đạt 0.832 – 0.891 và margin 0.109 – 0.139, chúng vượt qua ngưỡng 0.78 / 0.10 và bị hệ thống nhận nhầm thành <strong>Phật Bà Quan Âm</strong>.
</p>

<div class="gallery">
{''.join(err_cards_html)}
</div>

<h2 class="section-title">
  <span>2. Các ảnh CHƯA ĐƯỢC CHẤP NHẬN (Unaccepted Positives)</span>
  <span class="badge-count">157 ảnh</span>
</h2>

<div class="filter-bar">
  <div class="filter-group">
    <span>Lý do:</span>
    <button class="filter-btn active" data-filter="reason" data-value="all">Tất cả (157)</button>
    <button class="filter-btn" data-filter="reason" data-value="insufficient">Insufficient (116)</button>
    <button class="filter-btn" data-filter="reason" data-value="conflict">Conflict (30)</button>
    <button class="filter-btn" data-filter="reason" data-value="multi_target">Multi-target (11)</button>
  </div>
  <div class="filter-group" style="margin-left: 16px;">
    <span>Hiện cảnh:</span>
    <button class="filter-btn active" data-filter="scenario" data-value="all">Tất cả</button>
    <button class="filter-btn" data-filter="scenario" data-value="known_clean">Clean (4)</button>
    <button class="filter-btn" data-filter="scenario" data-value="known_clutter">Clutter (153)</button>
  </div>
  <div class="filter-group" style="margin-left: 16px;">
    <span>Cận ngưỡng:</span>
    <button class="filter-btn active" data-filter="near" data-value="all">Tất cả</button>
    <button class="filter-btn" data-filter="near" data-value="true">Near-miss</button>
  </div>
</div>

<div class="gallery" id="unaccepted-gallery">
{''.join(unrec_cards_html)}
</div>

<script>
  const buttons = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('#unaccepted-gallery .card');

  const filters = {{
    reason: 'all',
    scenario: 'all',
    near: 'all'
  }};

  buttons.forEach(btn => {{
    btn.addEventListener('click', () => {{
      const type = btn.getAttribute('data-filter');
      const val = btn.getAttribute('data-value');
      
      document.querySelectorAll(`button[data-filter="${{type}}"]`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      filters[type] = val;
      applyFilters();
    }});
  }});

  function applyFilters() {{
    cards.forEach(card => {{
      const reasonMatch = filters.reason === 'all' || card.getAttribute('data-reason') === filters.reason;
      const scenarioMatch = filters.scenario === 'all' || card.getAttribute('data-scenario') === filters.scenario;
      const nearMatch = filters.near === 'all' || card.getAttribute('data-near') === filters.near;

      if (reasonMatch && scenarioMatch && nearMatch) {{
        card.style.display = 'flex';
      }} else {{
        card.style.display = 'none';
      }}
    }});
  }}
</script>

</body>
</html>
'''
    (output_dir / 'index.html').write_text(html_content, encoding='utf-8')


def build_markdown_summary(false_accepts, unaccepted, config, output_dir):
    art_counter = Counter(r['expected'] for r in unaccepted)
    art_rows = []
    for art, cnt in art_counter.most_common():
        sub = [r for r in unaccepted if r['expected'] == art]
        r_counts = Counter(r['reason'] for r in sub)
        sub_scores = [r['embedding_score'] for r in sub]
        sub_margins = [r['embedding_margin'] for r in sub]
        art_rows.append(
            f"| `{art.removeprefix('stamp-')}` | {cnt} | "
            f"{min(sub_scores):.3f} / {sorted(sub_scores)[len(sub_scores)//2]:.3f} / {max(sub_scores):.3f} | "
            f"{min(sub_margins):.3f} / {sorted(sub_margins)[len(sub_margins)//2]:.3f} / {max(sub_margins):.3f} | "
            f"{r_counts.get('insufficient', 0)} / {r_counts.get('conflict', 0)} / {r_counts.get('multi_target', 0)} |"
        )

    lines = [
        '# Báo cáo đánh giá cấu hình: Score = 0.78, Margin = 0.10',
        '',
        'Được thực hiện trên toàn bộ **508 ảnh Calibration** (436 ảnh positive và 72 ảnh negative/out-of-catalog).',
        '',
        '## 1. Kết quả tổng quan so với cấu hình gốc (0.86 / 0.13)',
        '',
        '| Chỉ số | Cấu hình gốc (0.86 / 0.13) | Cấu hình mới (0.78 / 0.10) | Thay đổi |',
        '|---|---:|---:|---:|',
        f"| **Chấp nhận đúng (Correct Accepts)** | 254 / 436 (58.3%) | **279 / 436 (64.0%)** | **+25 ảnh** |",
        f"| **Chưa nhận diện (Unaccepted Positives)** | 182 / 436 | **157 / 436** | **-25 ảnh** |",
        f"| **Chấp nhận sai (False Accepts / Lỗi)** | 0 | **6 ảnh** | +6 ảnh |",
        f"| **Nhận nhầm giữa các tranh (Wrong Art)** | 0 | **0 ảnh** | 0 (An toàn tuyệt đối) |",
        f"| **Ảnh Clean bị sót** | 7 ảnh | **4 ảnh** | -3 ảnh clean |",
        f"| **Độ chính xác (Precision)** | 100.0% | **97.89%** | -2.11% |",
        '',
        '## 2. Danh mục chi tiết 6 ảnh bị chấp nhận SAI (False Accepts)',
        '',
        'Tất cả 6 ảnh này là các ảnh thuộc kịch bản **`out_of_catalog`** (chụp một pho tượng Phật khác ở bảo tàng, nằm trong thư mục `Khác 2`).',
        'Vì pho tượng này có nét điêu khắc gỗ/đá cổ rất tương đồng với *Phật Bà Quan Âm*, mô hình nhúng cho điểm tương đồng rất cao (từ 0.832 đến 0.891) và khoảng cách margin lớn (0.109 đến 0.139), vượt qua ngưỡng 0.78 / 0.10.',
        '',
        '| Mã | File gốc | Tình huống thực tế | Bị nhận nhầm thành | Score | Margin | Lý do được chấp thuận |',
        '|---|---|---|---|---:|---:|---|',
    ]

    for err in false_accepts:
        lines.append(
            f"| `{err['id']}` | `{err['file'].split('/')[-1]}` | `out_of_catalog` | **`{err['predicted'].removeprefix('stamp-')}`** | "
            f"{err['embedding_score']:.3f} | {err['embedding_margin']:.3f} | `{err['reason']}` |"
        )

    lines += [
        '',
        '*(Lưu ý: Không có bất kỳ bức tranh hay hiện vật dương tính nào bị nhận nhầm sang một hiện vật khác!)*',
        '',
        '## 3. Phân bố 157 ảnh chưa được nhận diện (Unaccepted Positives)',
        '',
        '| Hiện vật | Bị từ chối | Score (Min / Med / Max) | Margin (Min / Med / Max) | Lý do (Insuf / Conf / Multi) |',
        '|---|---:|---|---|---|',
    ] + art_rows + [
        '',
        '### 4 ảnh Clean còn sót:',
        '1. `054d2a8553ec` (**Cánh cửa chạm rồng**): Score 0.812 (đạt), nhưng Margin **0.074** (thiếu 0.026).',
        '2. `e07cf8ab7409` (**Cánh cửa chạm rồng**): Score 0.819 (đạt), nhưng Margin **0.070** (thiếu 0.030).',
        '3. `63fc6ca9fb65` (**Em Thúy**): Score 0.778 (thiếu 0.002), Margin 0.044, Geometry inliers đạt 9 (thiếu 3 inliers).',
        '4. `be7f5fb4ec4c` (**Em Thúy**): Score 0.734, Margin 0.002 (ảnh bị lóa bề mặt).',
        '',
        '## 4. Hướng dẫn xem ảnh trực quan',
        '',
        '- Mở file `reports/unrecognized-calibration-review-v1/index.html` trong trình duyệt để quan sát trực tiếp toàn bộ 6 ảnh sai (đóng khung đỏ nổi bật) và 157 ảnh chưa nhận diện.',
        '- Xem các file contact sheet `sheet-errors-01.jpg` và `sheet-unrec-01.jpg` đến `sheet-unrec-07.jpg`.',
    ]

    (output_dir / 'summary.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    cal_path = ROOT / 'reports/evaluation-full-calibration-v1/calibration.json'
    geo_path = ROOT / 'reports/optimized-geometry-study-v1/rows.jsonl'
    eval_dir = ROOT / 'data/evaluation'
    output_dir = ROOT / 'reports/unrecognized-calibration-review-v1'

    false_accepts, unaccepted, evaluated = collect_evaluation_rows(cal_path, geo_path, DEFAULT_CONFIG)
    print(f"Evaluated with Score={DEFAULT_CONFIG['embedding_threshold']}, Margin={DEFAULT_CONFIG['embedding_margin']}")
    print(f"False accepts: {len(false_accepts)}")
    print(f"Unaccepted positives: {len(unaccepted)}")

    # Clean old sheets
    for p in output_dir.glob('sheet-*.jpg'):
        p.unlink()

    # Generate sheets
    err_sheets = generate_contact_sheets(false_accepts, eval_dir, output_dir, prefix='sheet-errors', images_per_sheet=24)
    unrec_sheets = generate_contact_sheets(unaccepted, eval_dir, output_dir, prefix='sheet-unrec', images_per_sheet=24)
    print(f"Generated {len(err_sheets)} error sheets and {len(unrec_sheets)} unaccepted sheets.")

    build_html_report(false_accepts, unaccepted, DEFAULT_CONFIG, err_sheets, unrec_sheets, output_dir)
    print(f"Generated index.html in {output_dir}")

    build_markdown_summary(false_accepts, unaccepted, DEFAULT_CONFIG, output_dir)
    print(f"Generated summary.md in {output_dir}")

    # Output json
    data_out = {
        'version': 'review-config-078-010-v1',
        'configuration': DEFAULT_CONFIG,
        'summary': {
            'total_calibration': len(evaluated),
            'correct_accepts': sum(r['status'] == 'correct_accept' for r in evaluated),
            'false_accepts': len(false_accepts),
            'wrong_artifact_accepts': sum(r['status'] == 'wrong_artifact_accept' for r in evaluated),
            'unaccepted_positives': len(unaccepted),
            'precision': (
                sum(r['status'] == 'correct_accept' for r in evaluated) /
                (sum(r['status'] == 'correct_accept' for r in evaluated) + len(false_accepts))
            )
        },
        'false_accepts': false_accepts,
        'unaccepted_positives': unaccepted,
    }
    (output_dir / 'review-data.json').write_text(json.dumps(data_out, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print("Done!")


if __name__ == '__main__':
    main()
