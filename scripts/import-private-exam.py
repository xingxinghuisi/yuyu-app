"""Import a user-owned scan pack and a reviewed question/answer specification.

Usage: python scripts/import-private-exam.py --spec SPEC.json --paper PAPER.pdf
       --answers ANSWERS.pdf --audio LISTENING.mp3 --owner USERNAME --data-dir data
Requires pypdfium2 and Pillow on the importing computer, not on the VPS.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def validate(spec):
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,79}', spec['id']):
        raise ValueError('Invalid exam id')
    sections = {s['id']: s for s in spec['sections']}
    ids = set()
    for question in spec['questions']:
        if question['id'] in ids or question['section_id'] not in sections:
            raise ValueError('Duplicate question or unknown section')
        ids.add(question['id'])
        if type(question['correct']) is not int or not 1 <= question['correct'] <= question['option_count'] <= 4:
            raise ValueError('Invalid answer key')
        if not question['explanation_pages']:
            raise ValueError('Missing explanation reference')
        for asset in question['assets']:
            if not re.fullmatch(r'(paper|questions)/[a-z0-9-]+\.webp', asset):
                raise ValueError('Invalid question asset')
    for section in sections.values():
        count = sum(q['section_id'] == section['id'] for q in spec['questions'])
        if count != section['question_count'] or not 1 <= section['minutes'] <= 240:
            raise ValueError('Section count or duration mismatch')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('spec', 'paper', 'answers', 'audio', 'owner', 'data-dir'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--reuse-render', action='store_true')
    args = parser.parse_args()
    spec = json.loads(Path(args.spec).read_text(encoding='utf-8'))
    validate(spec)
    root = Path(args.data_dir).resolve() / 'private-exams'
    access = root / 'access.json'
    if access.exists() and json.loads(access.read_text(encoding='utf-8')).get('owner_username') != args.owner:
        raise ValueError('Existing personal library belongs to a different owner')
    folder = root / spec['id']
    source = folder / 'source'
    source.mkdir(parents=True, exist_ok=True)
    import pypdfium2 as pdfium
    from PIL import Image
    hashes = {}
    page_counts = {}
    for kind, original in (('paper', args.paper), ('answers', args.answers), ('listening', args.audio)):
        original = Path(original).resolve()
        target = source / (kind + ('.mp3' if kind == 'listening' else '.pdf'))
        if original != target.resolve():
            shutil.copy2(original, target)
        hashes[target.name] = hashlib.sha256(target.read_bytes()).hexdigest()
        if kind == 'listening':
            continue
        doc = pdfium.PdfDocument(target)
        page_counts[kind] = len(doc)
        output = folder / 'assets' / kind
        output.mkdir(parents=True, exist_ok=True)
        for index in range(len(doc)):
            path = output / f'{index+1:02}.webp'
            if args.reuse_render and path.is_file():
                continue
            page = doc[index]
            page.render(scale=2.5).to_pil().convert('RGB').save(path, quality=94, method=4)
            page.close()
        doc.close()
    crops = folder / 'assets' / 'questions'
    crops.mkdir(parents=True, exist_ok=True)
    for crop in spec.pop('crops', []):
        if not re.fullmatch(r'[a-z0-9-]+\.webp', crop['file']):
            raise ValueError('Invalid crop filename')
        pieces = []
        for part in crop['parts']:
            with Image.open(folder / 'assets' / 'paper' / f"{part['page']:02}.webp") as image:
                box = part['box']
                if not (0 <= box[0] < box[2] <= image.width and 0 <= box[1] < box[3] <= image.height):
                    raise ValueError('Crop lies outside source page')
                pieces.append(image.crop(box).convert('RGB'))
        combined = Image.new('RGB', (max(p.width for p in pieces), sum(p.height for p in pieces) + 16*(len(pieces)-1)), 'white')
        top = 0
        for piece in pieces:
            combined.paste(piece, (0, top))
            top += piece.height + 16
        combined.save(crops / crop['file'], quality=96, method=4)
    for question in spec['questions']:
        for asset in question['assets']:
            if not (folder / 'assets' / asset).is_file():
                raise ValueError('Missing question image: ' + asset)
        if not all(type(p) is int and 1 <= p <= page_counts['answers'] for p in question['explanation_pages']):
            raise ValueError('Invalid explanation page')
    spec['source_hashes'] = hashes
    spec['source_page_counts'] = page_counts
    spec['schema_version'] = 1
    (folder / 'exam.json').write_text(json.dumps(spec, ensure_ascii=False, indent=2), encoding='utf-8')
    access.write_text(json.dumps({'owner_username': args.owner}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Imported {spec['id']}: {len(spec['questions'])} questions, owner-only access")


if __name__ == '__main__':
    main()
