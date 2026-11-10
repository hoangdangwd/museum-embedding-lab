"""Report local-feature calibration research; no final/provider/production changes."""
import importlib.util
import hashlib
import csv
import json
from pathlib import Path
import statistics
import sys

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('calibration_metrics',ROOT/'scripts/report-full-calibration-evaluation.py')
metric_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(metric_module)


def load(path):return json.loads(path.read_text(encoding='utf-8'))


def decide(row, mode, minimum, margin, other_limit):
    value=row['variants'][mode]
    return (value['predicted'] is not None and value['score']>=minimum and value['margin']>=margin
            and (other_limit is None or value['ranking'][1]['score']<other_limit))


def measure(rows, baseline, config):
    decisions=[]
    for row in rows:
        old=baseline[row['file']]
        baseline_accept=old['score']>=.86 and old['margin']>=.13
        geometric_accept=decide(row,config['mode'],config['minimum_inliers'],config['margin_inliers'],config['other_artifact_limit'])
        keep_baseline=config['rule']=='rescue_rejects' and baseline_accept
        accepted=keep_baseline or geometric_accept
        predicted=old['predicted'] if keep_baseline else row['variants'][config['mode']]['predicted']
        decisions.append({'file':row['file'],'expected':row['expected'],'scenario':row['scenario'],
                          'predicted':predicted,'score':int(accepted),'margin':1,
                          'decision_source':'baseline' if keep_baseline else 'geometry' if accepted else 'reject',
                          'baseline_accepted':baseline_accept,'baseline_predicted':old['predicted']})
    summary, decisions=metric_module.metrics(decisions,{'threshold':1,'margin':1})
    return summary,decisions


def run(output):
    from PIL import Image, ImageDraw, ImageOps
    rows=[json.loads(line) for line in (output/'rows.jsonl').read_text(encoding='utf-8').splitlines()]
    manifest_path=ROOT/'data/evaluation/full-calibration-manifest.json'
    provenance=load(output/'provenance.json')
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest()!=provenance['manifest_sha256']:
        raise ValueError('Manifest provenance drift')
    manifest=load(manifest_path)
    expected={r['file']:r for r in manifest['entries'] if r['partition']=='calibration'}
    if len(rows)!=len(expected) or {r['file'] for r in rows}!=set(expected):raise ValueError('Incomplete/duplicate calibration results')
    for row in rows:
        for key in ('partition','expected','scenario','sha256'):
            if row[key]!=expected[row['file']][key]:raise ValueError('Manifest mismatch')
    previous=load(ROOT/'reports/evaluation-full-calibration-v1/calibration.json')['rows']['max']
    baseline={r['file']:r for r in previous}
    if set(baseline)!=set(expected):raise ValueError('Baseline scope mismatch')
    for row in rows:
        if any(row[k]!=baseline[row['file']][k] for k in ('expected','scenario')):raise ValueError('Baseline label mismatch')
    fixed=[]; grid=[]; top1={}
    for mode in ('full_reference','target_roi'):
        known=[r for r in rows if r['scenario'].startswith('known_')]
        top1[mode]={'known_total':len(known),'top1_correct':sum(r['variants'][mode]['predicted']==r['expected'] for r in known),
                    'no_geometric_evidence':sum(r['variants'][mode]['predicted'] is None for r in known)}
        for other in (None,6):
            config={'mode':mode,'rule':'geometry_only','minimum_inliers':12,'margin_inliers':5,'other_artifact_limit':other}
            metrics,_=measure(rows,baseline,config);fixed.append({'configuration':config,'metrics':metrics})
        for rule in ('geometry_only','rescue_rejects'):
            for minimum in (6,8,10,12,16,24,32,48,64,96):
                for margin in (0,3,5,10,20,40):
                    for other in (None,6,10,16):
                        config={'mode':mode,'rule':rule,'minimum_inliers':minimum,'margin_inliers':margin,'other_artifact_limit':other}
                        metrics,_=measure(rows,baseline,config)
                        grid.append({'configuration':config,'metrics':metrics})
    def order(cell):
        m=cell['metrics'];c=cell['configuration']
        return (m['macro_recall'],m['correct_accept'],m['precision'] or 0,c['minimum_inliers'],c['margin_inliers'])
    frontier=[]
    for mode in ('full_reference','target_roi'):
        for rule in ('geometry_only','rescue_rejects'):
            subset=[cell for cell in grid if cell['configuration']['mode']==mode and cell['configuration']['rule']==rule]
            for floor in (.95,.98,.99,1.0):
                eligible=[cell for cell in subset if cell['metrics']['precision'] is not None and cell['metrics']['precision']>=floor]
                frontier.append({'empirical_precision_floor':floor,'mode':mode,'rule':rule,'best':max(eligible,key=order) if eligible else None})
    baseline_summary,_=metric_module.metrics(previous,{'threshold':.86,'margin':.13})
    illustrative=next(item['best'] for item in frontier if item['mode']=='target_roi' and item['rule']=='geometry_only' and item['empirical_precision_floor']==1.)
    paired=None
    if illustrative:
        _, audit_decisions=measure(rows,baseline,illustrative['configuration'])
        old_correct={r['file'] for r in audit_decisions if r['baseline_accepted'] and r['baseline_predicted']==r['expected'] and r['scenario'].startswith('known_')}
        new_correct={r['file'] for r in audit_decisions if r['outcome']=='correct_accept'}
        paired={'configuration':illustrative['configuration'],'comparison':'prior provisional max / 0.86 / 0.13, not production',
                'new_correct':len(new_correct-old_correct),'lost_correct':len(old_correct-new_correct),'shared_correct':len(old_correct&new_correct),
                'previous_correct':len(old_correct),'current_correct':len(new_correct),'labels_changed':False}
        (output/'paired-audit.json').write_text(json.dumps(paired,indent=2)+'\n',encoding='utf-8')
        with (output/'illustrative-zero-observed-error-decisions.csv').open('w',encoding='utf-8',newline='') as handle:
            writer=csv.DictWriter(handle,fieldnames=list(audit_decisions[0]));writer.writeheader();writer.writerows(audit_decisions)
    times=sorted(r['total_seconds_both_variants'] for r in rows)
    report={'version':'local-feature-calibration-study-v1','calibration':len(rows),'references':45,
            'provider_calls':0,'final_scored':False,'labels_changed':False,'production_changed':False,
            'provenance':load(output/'provenance.json'),'baseline_policy':{'aggregation':'max','threshold':.86,'margin':.13},
            'baseline_metrics':baseline_summary,'top1':top1,'fixed_operating_points':fixed,'frontier':frontier,'paired_illustrative_audit':paired,
            'timing':{'median_seconds_both_variants':statistics.median(times),'p95_seconds_both_variants':times[int(.95*(len(times)-1))],
                      'scope':'Local CPU, four concurrent queries, 45 references, both variants; not Worker/mobile production latency.'},
            'limitations':['Exploratory in-sample calibration with correlated same-session captures, not fresh validation.',
                'Manual reference-only ROI annotations are research artifacts, not approved reference replacements.',
                'Homography assumes planar appearance; sculptures and changed views may fail.',
                'Inlier count is not confidence or probability. Negative labels remain rejection targets.',
                'Study evaluates a single predicted artifact. Detecting several artworks does not resolve inconsistent target semantics.',
                'Provider calls are zero; CPU/infrastructure deployment costs have not been estimated.']}
    (output/'summary.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (output/'grid.json').write_text(json.dumps(grid,indent=2)+'\n',encoding='utf-8')
    lines=['# Local features: calibration-only research','',
           'SIFT + RANSAC; 45 existing references, 508 calibration. No final scoring, provider calls, label changes or production changes.',
           'Target ROIs manually marked on reference-only images before matching. Scores are inlier counts, not probabilities.','',
           '| Mode / rule | Empirical precision floor | Inliers / margin / other-artifact cutoff | Correct accepts | Precision | Macro recall | Wrong-known | FA unknown / ambiguous / low-quality |',
           '|---|---:|---|---:|---:|---:|---:|---|']
    for item in frontier:
        cell=item['best']
        if cell is None:
            lines.append(f"| {item['mode']} / {item['rule']} | {item['empirical_precision_floor']} | No eligible point | — | — | — | — | — |")
            continue
        c=cell['configuration'];m=cell['metrics']
        fa=' / '.join(f"{m['per_scenario'][s]['accepted']}/{m['per_scenario'][s]['total']}" for s in ('out_of_catalog','ambiguous','low_quality'))
        lines.append(f"| {item['mode']} / {item['rule']} | {item['empirical_precision_floor']} | {c['minimum_inliers']} / {c['margin_inliers']} / {c['other_artifact_limit']} | {m['correct_accept']}/{m['known_total']} | {m['precision']:.4f} | {m['macro_recall']:.4f} | {m['wrong_artifact_accept']} | {fa} |")
    if paired:
        lines+=['','## Paired audit: illustrative zero-observed-error ROI point',
                f"Against prior provisional embedding policy (not production): {paired['new_correct']} new correct accepts, {paired['lost_correct']} lost correct accepts, {paired['shared_correct']} retained. Not a universal improvement.",
                '', '| Artifact | Known | Correct accepts |','|---|---:|---:|']
        for artifact,m in illustrative['metrics']['per_artifact'].items():
            lines.append(f"| {artifact} | {m['total']} | {m['correct_accept']} |")
    lines+=['','## Caveats',*['- '+s for s in report['limitations']], '', '## Timing',json.dumps(report['timing'])]
    (output/'summary.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    # Fixed diagnostic point, not selected because it looks good on this data.
    config={'mode':'target_roi','rule':'geometry_only','minimum_inliers':12,'margin_inliers':5,'other_artifact_limit':None}
    summary,decisions=measure(rows,baseline,config)
    by_file={r['file']:r for r in rows}
    errors=sorted([r for r in decisions if r['outcome'] in ('wrong_artifact_accept','negative_false_accept')],key=lambda r:r['file'])
    rescues=[]
    for artifact in sorted({r['expected'] for r in decisions if r['scenario'].startswith('known_')}):
        candidates=sorted([r for r in decisions if r['expected']==artifact and r['outcome']=='correct_accept' and not r['baseline_accepted']],key=lambda r:r['file'])
        rescues+=candidates[:2]
    selected=errors+rescues
    index=[]
    for start in range(0,len(selected),12):
        sheet=Image.new('RGB',(1200,1200),'white');draw=ImageDraw.Draw(sheet)
        for i,decision in enumerate(selected[start:start+12]):
            row=by_file[decision['file']]
            with Image.open(ROOT/'data/evaluation'/row['file']) as im:image=im.convert('RGB')
            boxes=ImageDraw.Draw(image)
            for rank,candidate in enumerate(row['variants']['target_roi']['ranking'][:2]):
                if candidate['score']<=0 or candidate['quad'] is None:continue
                quad=[(x*image.width,y*image.height) for x,y in candidate['quad']]
                boxes.line(quad+[quad[0]],fill='lime' if rank==0 else 'red',width=6)
            thumb=ImageOps.contain(image,(290,300));x=i%4*300;y=i//4*400
            sheet.paste(thumb,(x+(300-thumb.width)//2,y))
            key=f'G{start+i+1:03}'
            draw.text((x+4,y+302),key+' '+decision['outcome'],fill='black')
            draw.text((x+4,y+320),'GT '+decision['expected'].removeprefix('stamp-'),fill='black')
            draw.text((x+4,y+338),'Top '+str(decision['predicted']).removeprefix('stamp-'),fill='black')
            draw.text((x+4,y+356),'inliers '+str(row['variants']['target_roi']['score']),fill='black')
            index.append({'review_key':key,**decision,'best_matches':row['variants']['target_roi']['ranking'][:2]})
        sheet.save(output/f'diagnostics-{start//12+1:02}.jpg',quality=94)
    (output/'diagnostic-index.json').write_text(json.dumps({'configuration':config,'errors_all':len(errors),'correct_controls':len(rescues),'entries':index},indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'top1':top1,'fixed_metrics':fixed,'timing':report['timing'],'diagnostic_errors':len(errors)},indent=2))


if __name__=='__main__':run(Path(sys.argv[1]) if len(sys.argv)>1 else ROOT/'reports/local-feature-study-v3')
