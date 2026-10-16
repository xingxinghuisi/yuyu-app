"""Adapt source-linked private drafts into v2 exam packs and a media build plan.

Writes only to a new private bundle directory; never modifies the app library.
"""
import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import re


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate_pack(pack):
    assert pack['schema_version'] == 2
    assert re.fullmatch(r'jlpt-n[12]-\d{4}-(07|12)', pack['id'])
    ids = {q['id'] for q in pack['questions']}
    assert len(ids) == len(pack['questions']) and ids
    materials = {m['id'] for m in pack['materials']}
    for q in pack['questions']:
        assert q['section_id'] in ('language', 'listening') and 1 <= q['option_count'] <= 4
        assert set(q['material_ids'] + q['transcript_material_ids']) <= materials
        assert q['grading_status'] in ('reference', 'withheld')
        if q['grading_status'] == 'withheld':
            assert q['correct'] is None
        else:
            assert type(q['correct']) is int and 1 <= q['correct'] <= q['option_count']
            if q['section_id'] == 'language':
                assert q['stem_fragments'] and {o['index'] for o in q['options']} == {1, 2, 3, 4}
        for asset in q['assets'] + q['explanation_assets']:
            assert re.fullmatch(r'(paper|answers)/[a-f0-9]{16}-p\d{4}\.webp', asset)
    assert sum(s['question_count'] for s in pack['sections']) == len(ids)


def adapt(staged, exam, page_records, reused=None):
    pmap = {p['page_id']: p for p in exam['pages']}
    media = {}
    def public_page(pid):
        return pid in pmap and 'paper_candidate' in pmap[pid]['roles'] and not any(
            b.get('kind') in ('answer_key', 'explanation', 'transcript') or b.get('answer_entries')
            for b in page_records.get(pid, {}).get('blocks', []))
    def assets(refs, kind):
        result = []
        for f in refs:
            pid = f.get('page_id')
            if pid not in pmap:
                continue
            p = pmap[pid]
            if kind == 'paper':
                # A mixed page containing a key, explanation or script is private.
                if not public_page(pid):
                    continue
            path = kind + '/' + pid + '.webp'
            media[path] = {'source': p['source'], 'source_sha256': p['source_sha256'], 'page': p['page']}
            if path not in result:
                result.append(path)
        return result
    data = deepcopy(staged)
    if reused is not None:
        artifact = reused['artifact']
        paper = next(d for d in exam['documents'] if 'paper_candidate' in d['roles'] and d['source_sha256'] in reused['source_hashes'].values())
        answers = next(d for d in exam['documents'] if 'paper_candidate' not in d['roles'] and d['source_sha256'] in reused['source_hashes'].values())
        def ref(text, sids, annotations=None):
            found = []
            for sid in sids:
                match = re.fullmatch(r'(paper|answers)-p(\d+)', sid)
                if not match: continue
                source = paper['source'] if match[1] == 'paper' else answers['source']
                p = next(p for p in exam['pages'] if p['source'] == source and p['page'] == int(match[2]))
                found.append(p['page_id'])
            return [{'text': text, 'annotations': annotations or [], 'table_rows': [],
                     **({'page_id': found[0]} if found else {})}]
        for q, original in zip(data['questions'], artifact['questions']):
            assert q['id'] == original['id']
            q['stem_fragments'] = ref(original['stem'], original.get('source_ids', []),
                [a for a in original.get('annotations', []) if a.get('target') == 'stem'])
            for opt, orig_opt in zip(q['options'], original['options']):
                opt['fragments'] = ref(orig_opt['text'], orig_opt.get('source_ids', []),
                    [a for a in original.get('annotations', []) if a.get('target') == 'option' and a.get('option_index') == opt['index']])
            answer_ids = [sid for sid in original.get('explanation_source_ids', []) + original.get('source_ids', [])
                          if sid.startswith('answers-')]
            q['explanation_fragments'] = ref(original.get('explanation', '') + '\n' + original.get('transcript', ''), answer_ids)
            q['paper_image_refs'] = [f for sid in original.get('source_images', []) for f in ref('', [sid])]
            q['reference_image_ids'] = original.get('source_images', [])
        for m, original in zip(data['materials'], artifact['passages']):
            assert m['id'] == original['id']
            m['fragments'] = ref(original.get('text', ''), original.get('source_ids', []), original.get('annotations', []))
            m['section'] = 'language'
        # These notes document already reviewed printed spellings. They do not
        # invalidate the independently checked answer cells. Keep them for the
        # post-submission review; never mix them with unresolved answer conflicts.
        source_notes = artifact.get('source_notes', [])
        for note in artifact.get('source_notes', []):
            if note.get('blocking'):
                for qid in note.get('question_ids', []):
                    data['issues'].append({'kind': 'blocking_source_note', 'question_id': qid})
        for q in data['questions']:
            q['source_notes'] = [note for note in source_notes if q['id'] in note.get('question_ids', [])]
    requested_materials = {mid for q in data['questions'] for mid in q['material_ids'] + q['transcript_material_ids']}
    data['materials'] = [m for m in data['materials'] if m['id'] in requested_materials]
    material_map = {m['id']: m for m in data['materials']}
    for material in data['materials']:
        if material.get('kind') != 'listening_transcript' and material.get('section', 'language') != 'listening':
            assert all(public_page(f.get('page_id')) for f in material['fragments']), 'Reading material contains a private source page'
    output = []
    for q in data['questions']:
        issues = [i for i in data['issues'] if i.get('question_id') == q['id'] or
                  (i.get('question') is not None and q['id'] == 'w' + str(i['question'])) or q['id'] in i.get('also_affects', [])]
        section, group = q['section'], q['group']
        choices = deepcopy(q['options'])
        # Only original-paper content is visible before submission. Transcript
        # question lines may themselves contain a printed answer such as "(3)".
        def paper_only(refs):
            return [f for f in refs if public_page(f.get('page_id'))]
        stems = paper_only(q['stem_fragments'])
        for o in choices:
            o['fragments'] = paper_only(o['fragments'])
        choices = [o for o in choices if o['fragments']]
        reason = sorted({i['kind'] for i in issues})
        correct = q.get('answer')
        if type(correct) is not int or not 1 <= correct <= 4:
            reason.append('answer_not_available')
        if section == 'language' and (not stems or {o['index'] for o in choices} != {1, 2, 3, 4}):
            reason.append('original_question_needs_review')
        option_count = 3 if section == 'listening' and group == 4 else 4
        if type(correct) is int and correct > option_count:
            reason.append('answer_outside_option_range')
        written_refs = [f for mid in q['material_ids'] for f in material_map[mid]['fragments']]
        question_refs = stems + [f for o in choices for f in o['fragments']] + written_refs + q.get('paper_image_refs', [])
        explanation_refs = q['explanation_fragments'] + [f for mid in q['transcript_material_ids'] for f in material_map[mid]['fragments']]
        number = q['id'][1:].lstrip('0') if section == 'language' else q['id'][1:]
        notice = '资料中的答案、题号或文字存在疑点，核对前不计分。' if reason else ''
        output.append({'id': q['id'], 'section_id': section, 'label': ('第 ' + number + ' 题') if section == 'language' else '听力 ' + number,
            'short_label': number, 'group_title': '问题 ' + str(group), 'option_count': option_count,
            'correct': None if reason else correct, 'grading_status': 'withheld' if reason else 'reference',
            'review_notice': notice, 'review_reasons': sorted(set(reason)), 'stem_fragments': stems,
            'source_notes': q.get('source_notes', []),
            'options': choices, 'material_ids': q['material_ids'], 'transcript_material_ids': q['transcript_material_ids'],
            'explanation_fragments': q['explanation_fragments'], 'answer_sources': q['answer_sources'],
            'assets': assets(question_refs, 'paper'), 'explanation_assets': assets(explanation_refs, 'answers'), 'explanation_pages': []})
    # Store only explicitly requested materials; never leak a transcript through the public list.
    materials = [dict(m, section='listening' if m.get('kind') == 'listening_transcript' else m.get('section', 'language')) for m in data['materials']]
    audio = exam['audio']
    assert len(audio) == 1 and audio[0]['source'].lower().endswith('.mp3'), 'Exactly one MP3 is required per exam'
    n1 = staged['level'] == 'N1'
    listening_minutes = (55 if (staged['year'], staged['month']) >= (2022, 12) else 60) if n1 else 50
    pack = {'schema_version': 2, 'id': staged['id'], 'title': staged['title'], 'level': staged['level'],
            'year': staged['year'], 'month': staged['month'], 'sections': [
                {'id': 'language', 'title': '文字 · 词汇 · 语法 · 阅读', 'minutes': 110 if n1 else 105,
                 'question_count': sum(q['section_id']=='language' for q in output)},
                {'id': 'listening', 'title': '听力', 'minutes': listening_minutes,
                 'question_count': sum(q['section_id']=='listening' for q in output)}],
            'questions': output, 'materials': materials, 'audio_file': 'audio-' + audio[0]['source_sha256'] + '.mp3',
            'grading_policy': 'uploaded_reference_with_review_exclusions; not JLPT scaled score',
            'review_count': sum(q['grading_status']=='withheld' for q in output), 'content_verified': False,
            'duration_sources': ['https://www.jlpt.jp/e/guideline/testsections.html',
                                 'https://www.jlpt.jp/topics/202208051659676565.html']}
    validate_pack(pack)
    return pack, {'id': pack['id'], 'images': media, 'audio': audio[0]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    for name in ('staging', 'plan', 'pages', 'reused-exams', 'out'):
        ap.add_argument('--' + name, required=True, type=Path)
    args = ap.parse_args()
    assert args.out.resolve() != args.staging.resolve()
    plan = load(args.plan)
    exams = {e['exam_id']:e for e in plan['exams']}
    pages = {p.stem:load(p) for p in args.pages.glob('*.json')}
    report, media = [], []
    for file in sorted(args.staging.glob('*.json')):
        staged = load(file)
        reused = args.reused_exams / file.name
        pack, build = adapt(staged, exams[staged['id']], pages, load(reused) if reused.exists() else None)
        save(args.out / 'packs' / file.name, pack)
        media.append(build)
        report.append({'id':pack['id'],'questions':len(pack['questions']),'excluded':pack['review_count'],'images':len(build['images'])})
    save(args.out / 'media-plan.json', {'version':1,'exams':media})
    save(args.out / 'manifest.json', {'schema_version':2,'exams':report,'cloud_requests':0,
        'files': {p.relative_to(args.out).as_posix():digest(p) for p in (args.out / 'packs').glob('*.json')},
        'media_plan_sha256':digest(args.out / 'media-plan.json')})
    print(json.dumps({'exams':len(report),'questions':sum(x['questions'] for x in report),
                      'excluded':sum(x['excluded'] for x in report),'image_assets':sum(x['images'] for x in report),
                      'cloud_requests':0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
