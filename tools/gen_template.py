import openpyxl, json, sys
from openpyxl.utils import get_column_letter as L
src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src)
RANGES = {0: (47, 30), 1: (37, 30)}  # rows, cols(A..AA)
def px(w): return round(w*7+5)
def side(s):
    if s is None or s.style is None: return None
    return {'s': s.style, 'c': (s.color.rgb if s.color is not None and isinstance(s.color.rgb,str) else '000000')}
res = []
for si, ws in enumerate(wb.worksheets):
    nr, nc = RANGES[si]
    dflt = ws.sheet_format.defaultColWidth or 8.43
    widths = [px(dflt)]*nc
    for k, d in ws.column_dimensions.items():
        mn, mx = d.min, d.max
        if d.width is None: continue
        for c in range(mn, min(mx, nc)+1): widths[c-1] = px(d.width)
    heights = [(ws.row_dimensions[r].height or 15) for r in range(1, nr+1)]
    merged = {}
    skip = set()
    for m in ws.merged_cells.ranges:
        if m.min_row > nr or m.min_col > nc: continue
        merged[(m.min_row, m.min_col)] = (m.max_row, m.max_col)
        for r in range(m.min_row, m.max_row+1):
            for c in range(m.min_col, m.max_col+1):
                if (r, c) != (m.min_row, m.min_col): skip.add((r, c))
    cells = []
    for r in range(1, nr+1):
        for c in range(1, nc+1):
            if (r, c) in skip: continue
            cell = ws.cell(r, c)
            r2, c2 = merged.get((r, c), (r, c))
            tl, br = cell, ws.cell(r2, c2)
            b = {'t': side(tl.border.top), 'l': side(tl.border.left), 'b': side(br.border.bottom), 'r': side(br.border.right)}
            f = cell.font; a = cell.alignment
            fill = None
            if cell.fill and cell.fill.fill_type == 'solid':
                fc = cell.fill.fgColor
                fill = fc.rgb if isinstance(fc.rgb, str) else ('000000' if fc.theme == 1 else None)
            d = {'a': f'{L(c)}{r}', 'r': r, 'c': c}
            if r2 > r: d['rs'] = r2-r+1
            if c2 > c: d['cs'] = c2-c+1
            if cell.value not in (None, ' '): d['v'] = str(cell.value)
            d['b'] = {k: v for k, v in b.items() if v}
            d['f'] = {'n': f.name, 'z': f.sz, 'b': bool(f.b), 'i': bool(f.i), 'u': bool(f.u)}
            d['al'] = {'h': a.horizontal, 'v': a.vertical, 'w': bool(a.wrap_text), 'rot': a.text_rotation or 0}
            if fill: d['fill'] = fill
            cells.append(d)
    res.append({'name': ws.title, 'rows': nr, 'cols': nc, 'widths': widths, 'heights': heights, 'cells': cells,
                'margins': {'l': ws.page_margins.left, 'r': ws.page_margins.right, 't': ws.page_margins.top, 'b': ws.page_margins.bottom}})
json.dump(res, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print([ (s['name'], s['rows'], s['cols'], sum(s['widths']), sum(s['heights'])) for s in res])
print(set(d['f']['n'] for s in res for d in s['cells']), set(d['f']['z'] for s in res for d in s['cells']))
print([ (d['a'],d['al']) for d in res[0]['cells'] if d['al']['rot']][:8])
print([ (d['a'],d.get('fill')) for d in res[0]['cells'] if d.get('fill')][:6])
