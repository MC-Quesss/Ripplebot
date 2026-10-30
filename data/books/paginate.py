"""Paginate a book note into 1.12 book pages by *rendered* size, not char count.

A 1.12 page shows 14 lines, 114 px wide, in the default font. Text past line 14
is hidden, which read as missing words (Dad, 2026-10-30). Usage:
  python3 -I data/books/paginate.py <book.md> <out.json>
"""
import json, re, sys

W = {**{c: 6 for c in map(chr, range(32, 127))}}
for c in "i!.,:;|'": W[c] = 2
for c in 'l`': W[c] = 3
for c in 'It[] ': W[c] = 4
for c in 'fk"()*<>{}': W[c] = 5
for c in '@~': W[c] = 7
PAGE_W, PAGE_LINES, PAGE_CHARS = 114, 14, 256

def width(s): return sum(W.get(c, 6) for c in s)

def wrap(par):
    lines, cur = [], ''
    for w in par.split():
        cand = (cur + ' ' + w) if cur else w
        if width(cand) <= PAGE_W: cur = cand
        else: lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def is_heading(p):
    return p.isupper() or p.startswith('CHAPTER') or bool(re.match(r'^[IVX]+\. ', p))

def paginate(text):
    paras = [p.strip() for p in text.split('\n\n') if p.strip()]
    pages, lines = [], []          # lines: rendered lines of the current page
    def flush():
        while lines and lines[-1] == '': lines.pop()
        if lines: pages.append('\n'.join(lines).replace('\n\n\n', '\n\n'))
        lines.clear()
    for p in paras:
        if is_heading(p) and lines: flush()
        for i, l in enumerate(wrap(p)):
            need = 1 + (1 if lines and i == 0 else 0)   # blank line between paragraphs
            chars = len(' '.join(lines)) + len(l) + 2
            if len(lines) + need > PAGE_LINES or chars > PAGE_CHARS: flush(); need = 1
            if lines and i == 0: lines.append('')
            lines.append(l)
    flush()
    # A wrapped line joined back with '\n' keeps the client from re-wrapping differently.
    return [re.sub(r'(?<!\n)\n(?!\n)', ' ', pg) for pg in pages]

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    body = open(src).read().split('---', 2)[2].strip()
    pages = paginate(body)
    assert len(pages) <= 50, f'{len(pages)} pages > 50'
    assert all(len(p) <= PAGE_CHARS for p in pages), 'page over 256 chars'
    json.dump(pages, open(out, 'w'), indent=0)
    print(out, len(pages), 'pages; longest', max(map(len, pages)), 'chars')
