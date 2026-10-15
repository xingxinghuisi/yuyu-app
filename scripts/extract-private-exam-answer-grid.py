"""Read boxed answer tables locally, then compare with an existing reviewed spec.

This adapter expects alternating question/answer rows. It supports a merged
question header over multiple answer cells. It never changes an exam or attempt.
Requires OpenCV, Pillow, NumPy and native Tesseract with eng and jpn models.
"""
import argparse
import csv
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROW_HEIGHT = 96


def cells_on_page(path, kind):
    import cv2
    import numpy as np
    from PIL import Image
    image = Image.open(path).convert('RGB')
    gray = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2GRAY)
    mask = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY_INV)[1]
    horizontal = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((1, max(40, image.width // 40)), np.uint8))
    vertical = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((max(50, image.height // 45), 1), np.uint8))
    contours, hierarchy = cv2.findContours(cv2.bitwise_or(horizontal, vertical), cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        raise ValueError('No boxed answer table found: ' + str(path))
    groups = {}
    for i, contour in enumerate(contours):
        x, y, w, h = cv2.boundingRect(contour)
        parent = int(hierarchy[0][i][3])
        if parent >= 0 and 45 <= w <= 700 and 45 <= h <= 180:
            groups.setdefault(parent, []).append((x, y, w, h))
    tables = [(cv2.boundingRect(contours[parent]), cells) for parent, cells in groups.items() if len(cells) >= 4]
    tables.sort(key=lambda item: (round(item[0][1] / 40), item[0][0]))
    records = []
    for table_number, (table_box, cells) in enumerate(tables, 1):
        rows = []
        for box in sorted(cells, key=lambda b: (b[1], b[0])):
            if not rows or abs(rows[-1][0][1] - box[1]) > 8:
                rows.append([])
            rows[-1].append(box)
        if len(rows) % 2:
            raise ValueError(f'Table {table_number} does not have paired header/answer rows')
        for i in range(0, len(rows), 2):
            headers = rows[i]
            answers = sorted(rows[i + 1], key=lambda b: b[0])
            subcounts = {}
            for answer in answers:
                center = answer[0] + answer[2] / 2
                matches = [h for h in headers if h[0] - 3 <= center <= h[0] + h[2] + 3]
                if len(matches) != 1:
                    raise ValueError('Ambiguous table header alignment')
                header = matches[0]
                subcounts[header] = subcounts.get(header, 0) + 1
                records.append({'kind': kind, 'table': table_number, 'table_box': table_box,
                                'header_box': header, 'answer_box': answer, 'sub_index': subcounts[header],
                                'source_image': str(path.resolve()), '_image': image})
    return records, len(tables)


def sheet(records, field, path):
    from PIL import Image, ImageChops
    result = Image.new('RGB', (260, len(records) * ROW_HEIGHT + 20), 'white')
    for i, record in enumerate(records):
        x, y, w, h = record[field]
        piece = record['_image'].crop((x + 6, y + 6, x + w - 6, y + h - 6)).convert('L')
        binary = piece.point(lambda value: 255 if value > 180 else 0)
        box = ImageChops.invert(binary).getbbox()
        if box is None:
            raise ValueError('Blank numeric cell')
        piece = piece.crop(box)
        scale = min(58 / piece.height, 180 / piece.width)
        piece = piece.resize((max(1, round(piece.width * scale)), max(1, round(piece.height * scale))), Image.Resampling.LANCZOS)
        result.paste(piece.convert('RGB'), ((260 - piece.width) // 2, 10 + i * ROW_HEIGHT + (ROW_HEIGHT - piece.height) // 2))
    result.save(path)


def ocr_sheet(path, tesseract, language, whitelist, output):
    environment = os.environ.copy()
    environment.setdefault('OMP_THREAD_LIMIT', '1')
    run = subprocess.run([tesseract, str(path), str(output), '-l', language, '--oem', '1', '--psm', '6',
                          '-c', 'tessedit_char_whitelist=' + whitelist, 'txt', 'tsv'],
                         capture_output=True, encoding='utf-8', errors='replace', env=environment, timeout=180)
    if run.returncode:
        raise ValueError(run.stderr)
    recognized = {}
    for word in csv.DictReader(io.StringIO(output.with_suffix('.tsv').read_text(encoding='utf-8')), delimiter='\t', quoting=csv.QUOTE_NONE):
        if word['level'] != '5' or not word['text'].strip():
            continue
        center = int(word['top']) + int(word['height']) / 2
        index = int((center - 10) // ROW_HEIGHT)
        recognized.setdefault(index, []).append((int(word['left']), word['text'], float(word['conf'])))
    return {i: {'text': ''.join(w[1] for w in sorted(words)), 'confidence': min(w[2] for w in words)}
            for i, words in recognized.items()}


def retry_single(record, index, tesseract, out, psm):
    from PIL import Image, ImageOps
    x, y, w, h = record['answer_box']
    with Image.open(record['source_image']) as image:
        crop = image.crop((x + 6, y + 6, x + w - 6, y + h - 6)).convert('L')
    crop = ImageOps.expand(crop.resize((crop.width * 2, crop.height * 2)), border=30, fill=255)
    image_path = out / f'retry-{index:03}-{psm}.png'
    output = out / f'retry-{index:03}-{psm}'
    crop.save(image_path)
    environment = os.environ.copy()
    environment.setdefault('OMP_THREAD_LIMIT', '1')
    run = subprocess.run([tesseract, str(image_path), str(output), '-l', 'eng', '--oem', '1', '--psm', str(psm),
                          '-c', 'tessedit_char_whitelist=1234', 'txt', 'tsv'],
                         capture_output=True, encoding='utf-8', errors='replace', env=environment, timeout=30)
    if run.returncode:
        raise ValueError(run.stderr)
    words = [word for word in csv.DictReader(io.StringIO(output.with_suffix('.tsv').read_text(encoding='utf-8')), delimiter='\t', quoting=csv.QUOTE_NONE)
             if word['level'] == '5' and word['text'].strip()]
    return {'text': ''.join(w['text'] for w in words), 'confidence': min((float(w['conf']) for w in words), default=0)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--language-page', type=Path, required=True)
    parser.add_argument('--listening-page', type=Path, required=True)
    parser.add_argument('--spec', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--tesseract', default=shutil.which('tesseract') or r'C:\Program Files\Tesseract-OCR\tesseract.exe')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    first, language_tables = cells_on_page(args.language_page, 'language')
    second, listening_tables = cells_on_page(args.listening_page, 'listening')
    records = first + second
    sheet(records, 'header_box', args.out / 'headers.png')
    sheet(records, 'answer_box', args.out / 'answers.png')
    headers = ocr_sheet(args.out / 'headers.png', args.tesseract, 'eng', '0123456789()', args.out / 'header-ocr')
    primary = ocr_sheet(args.out / 'answers.png', args.tesseract, 'eng', '1234', args.out / 'answer-eng')
    secondary = ocr_sheet(args.out / 'answers.png', args.tesseract, 'jpn', '1234', args.out / 'answer-jpn')
    spec = json.loads(args.spec.read_text(encoding='utf-8'))
    expected = {q['id']: q for q in spec['questions']}
    observed, issues = set(), []
    for i, record in enumerate(records):
        record.pop('_image')
        header = headers.get(i, {})
        text = header.get('text', '')
        number = re.fullmatch(r'\(?(\d{1,2})\)?', text)
        question_id = None
        if number:
            n = int(number[1])
            question_id = f'r{n:03}' if record['kind'] == 'language' else f'l{record["table"]}-{n + record["sub_index"] - 1}'
        record.update(question_id=question_id, header_ocr=header,
                      answer_eng=primary.get(i, {}), answer_jpn=secondary.get(i, {}))
        a, b = primary.get(i, {}).get('text'), secondary.get(i, {}).get('text')
        candidate = int(a) if a in ('1', '2', '3', '4') and a == b else None
        if candidate is None:
            retry_a = retry_single(record, i, args.tesseract, args.out, 10)
            retry_b = retry_single(record, i, args.tesseract, args.out, 7)
            record['retries'] = [retry_a, retry_b]
            if (retry_a['text'] == retry_b['text'] and retry_a['text'] in ('1', '2', '3', '4')
                    and min(retry_a['confidence'], retry_b['confidence']) >= 70):
                candidate = int(retry_a['text'])
        record['candidate'] = candidate
        reference = expected.get(question_id)
        record['reference_answer'] = reference['correct'] if reference else None
        record['matches_reviewed_spec'] = bool(reference and candidate == reference['correct'])
        if question_id in observed or not record['matches_reviewed_spec']:
            issues.append({'cell': i, 'question_id': question_id, 'reason': 'unreadable, duplicate, unknown, or differing answer'})
        if reference and candidate and not 1 <= candidate <= reference['option_count']:
            issues.append({'cell': i, 'question_id': question_id, 'reason': 'answer outside available options'})
        observed.add(question_id)
    missing = sorted(set(expected) - observed)
    report = {'schema': 1, 'exam_id': spec['id'], 'language_tables': language_tables, 'listening_tables': listening_tables,
              'cells': len(records), 'matched': sum(r['matches_reviewed_spec'] for r in records),
              'issues': issues, 'missing_questions': missing, 'records': records,
              'note': 'Agreement with the supplied answer reference, not proof of official or linguistic correctness.'}
    (args.out / 'answer-grid-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('cells', 'matched', 'issues', 'missing_questions')}, ensure_ascii=False))
    return 1 if issues or missing else 0


if __name__ == '__main__':
    raise SystemExit(main())
