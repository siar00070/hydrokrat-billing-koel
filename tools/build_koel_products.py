"""Build the KOEL (Varuna) product master from the KFD catalogue PDF.

Usage:  pip install pymupdf
        python tools/build_koel_products.py "KFD Varuna Catalogue.pdf"

Writes db/seed_koel_products.sql (run it in the Supabase SQL Editor after schema.sql).
"""
import os
import re
import sys

import pymupdf

PDF = sys.argv[1]
doc = pymupdf.open(PDF)

products = []
seen = set()


def num(s):
    s = s.strip().replace(',', '')
    try:
        return float(s)
    except ValueError:
        return None


def fmt(x):
    if x is None:
        return ''
    return ('%g' % x)


def add(series, model, kw, hp, stage=None, flow_head='', moc='', rpm=None, hsn='8413',
        extra_desc='', unit='Nos', structured=True):
    model = re.sub(r'\s+', ' ', model).strip()
    key = (series, model, fmt(kw), fmt(hp), stage)
    if key in seen:
        return
    seen.add(key)
    rating = f'{fmt(kw)} kW / {fmt(hp)} HP' if kw is not None else ''
    parts = [f'KOEL Varuna {series}', model]
    if rating:
        parts.append(rating)
    if stage:
        parts.append(f'{stage} Stage')
    if extra_desc:
        parts.append(extra_desc)
    kw_rpm = f'{fmt(kw)} kW ({fmt(hp)} HP)' if kw is not None else ''
    if kw_rpm and rpm:
        kw_rpm += f' @ {rpm} RPM'
    products.append({
        'description': ' - '.join(parts),
        'hsn_sac': hsn,
        'default_rate': 0,
        'gst_percent': 18,
        'unit': unit,
        'use_structured_specs': structured,
        'spec_model': model,
        'spec_kw_rpm': kw_rpm,
        'spec_flow_head': flow_head,
        'spec_moc': moc,
    })


def duty_range(axis, vals, axis_is_head, unit):
    """axis: list of floats; vals: list of str (may contain '-').
    Returns 'Q1 unit @ H1 m to Q2 unit @ H2 m'."""
    pts = []
    for a, v in zip(axis, vals):
        n = num(re.sub(r'\(.*\)', '', v))
        if n is None or a is None or (axis_is_head and n == 0):
            continue
        pts.append((a, n))
    if not pts:
        return ''
    def one(p):
        a, n = p
        h, q = (a, n) if axis_is_head else (n, a)
        return f'{fmt(q)} {unit} @ {fmt(h)} m'
    if len(pts) == 1:
        return one(pts[0])
    return f'{one(pts[0])} to {one(pts[-1])}'


# ---------------------------------------------------------------- surface pumps (find_tables)
SURFACE_SERIES = {
    'Ivory II': 'Ivory II Mini Self Priming Monoblock Pump',
    'Topaz': 'Topaz Mini Self Priming Monoblock Pump',
    'Super Gold': 'Super Gold N Super Suction Self Priming Monoblock Pump',
    'Emerald': 'Emerald Mini Self Priming Monoblock Pump',
    'VMB 10 D HD': 'Heavy Duty Self Priming Monoblock Pump',
    'Diamond': 'Diamond Heavy Duty Self Priming Monoblock Pump',
    'VMS': 'VMS Heavy Duty Self Priming Monoblock Pump',
    'VSW': 'VSW Centrifugal Monoblock Pump',
    'VSWA': 'VSWA Series Monoblock Pump',
    'ULTRA': 'Ultra Mini Horizontal Openwell Submersible Pump',
    'HMPS HSS': 'Mini HMPS Horizontal Openwell Submersible Pumpset',
    'CRYSTAL': 'Crystal V-Flow Self Priming Monoblock Pump',
    'HIRA PRO': 'Hira Pro Mini Self Priming Monoblock Pump',
    'IVORY PRO': 'Ivory Pro Mini Self Priming Monoblock Pump',
    'VSSP': 'VSSP Sewage Submersible Pump',
    'VSCP': 'VSCP Sewage Cutter Pump',
    'AdvantACE': 'AdvantACE Mini Monoblock Pump',
    'VNA': 'CMB Class B Centrifugal Monoblock Pumpset',
    'OSV': 'HMPS Horizontal Openwell Submersible Monoblock Pumpset',
    'HMPS': 'HMPS Horizontal Openwell Submersible Monoblock Pumpset',
}


def series_for(model):
    for k in sorted(SURFACE_SERIES, key=len, reverse=True):
        if model.upper().startswith(k.upper()):
            return SURFACE_SERIES[k]
    if 'OSV' in model:
        return SURFACE_SERIES['OSV']
    return None


SURFACE_PAGES = [11, 12, 13, 14, 16, 17, 18, 22, 24, 25]
PAGE_RPM = {22: 2880, 24: 2880, 25: 2880}
PAGE_FLOW_UNIT = {24: 'LPM', 25: 'LPM'}

for pno in SURFACE_PAGES:
    page = doc[pno - 1]
    for t in page.find_tables().tables:
        rows = [[(c or '').replace('\n', ' ').strip() for c in r] for r in t.extract()]
        # locate kW / HP / Suc / Del columns from header rows
        kw_i = hp_i = suc_i = del_i = None
        axis = None
        unit = PAGE_FLOW_UNIT.get(pno, 'LPH')
        for r in rows[:4]:
            for i, c in enumerate(r):
                cl = c.lower().replace('.', '')
                if cl == 'kw' and kw_i is None:
                    kw_i = i
                elif cl == 'hp' and hp_i is None:
                    hp_i = i
                elif cl.startswith('suc') and suc_i is None:
                    suc_i = i
                elif cl.startswith('del') and del_i is None:
                    del_i = i
                if 'lpm' in cl:
                    unit = 'LPM'
        if kw_i is None or hp_i is None:
            continue
        first_val = max(x for x in (kw_i, hp_i, suc_i or 0, del_i or 0)) + 1
        for r in rows[:4]:
            nums = [num(c) for c in r[first_val:]]
            if sum(1 for n in nums if n is not None) >= 3 and all(num(c) is None for c in r[:kw_i] if c):
                cand = [num(c) for c in r[first_val:]]
                if not any(x is not None and x > 100 for x in cand):  # head axis, not data
                    axis = cand
                    break
        if axis is None:
            continue
        # skip empty columns between del and axis (e.g. "Discharge in LPM" label column)
        name = None
        for r in rows:
            c0 = r[0]
            if c0 and not re.match(r'(?i)model|^$', c0) and c0 not in ('HMPS',):
                name = c0
            kw, hp = num(r[kw_i]), num(r[hp_i])
            if kw is None or hp is None or not name:
                continue
            if name.startswith(('VILC', 'VMS JP')) or name.startswith('7.5 OSV'):
                name = None  # added by hand below
                continue
            vals = r[first_val:]
            pipe = ''
            if suc_i is not None and del_i is not None and r[suc_i]:
                pipe = f'; Pipe size {r[suc_i]} x {r[del_i]} mm'
            fh = duty_range(axis, vals, True, unit) + pipe
            model = name
            series = 'CMB-AL Centrifugal Monoblock Pumpset' if '(LH)' in model else series_for(model)
            add(series, model, kw, hp, flow_head=fh, rpm=PAGE_RPM.get(pno))
            if pno != 22:
                name = None if rows.index(r) else name

# Pearl (page 15, irregular table)
add('Pearl Mini Self Priming Monoblock Pump', 'Pearl 1C', 0.75, 1.0,
    flow_head='2560 LPH @ 4 m to 410 LPH @ 34 m; Pipe size 25 x 25 mm')
add('Pearl Mini Self Priming Monoblock Pump', 'Pearl 2C', 0.37, 0.5,
    flow_head='1900 LPH @ 3 m to 350 LPH @ 22 m; Pipe size 25 x 25 mm')
add('Pressure Booster Pump', 'VMSPBD 0.5 - H2', 0.37, 0.5,
    flow_head='2200 LPH @ 3 m to 650 LPH @ 25 m; Setting 1.5-2.5 bar; Horizontal tank; 1 bathroom')
add('Pressure Booster Pumpset', '10VHMS 5D 1.0 - V25', 0.75, 1.0,
    flow_head='4200 LPH @ 5 m to 900 LPH @ 45 m; Setting 1.5-4.5 bar; Horizontal tank; 3 bathrooms')
add('Inline Circulation Pump', 'VILC 0.16', 0.12, 0.16,
    flow_head='25 LPM @ 2 m to 6 LPM @ 9 m; Pipe size 13 x 13 mm')
add('Inline Circulation Pump', 'VILC 0.47', 0.35, 0.47,
    flow_head='3 speed; up to 56 LPM / 15 m; Pipe size 20 x 20 mm')
add('VMSJP Centrifugal Deepwell Jet Pump (Vertical)', 'VMS JP-S70 1.0', 0.75, 1.0,
    flow_head='1100 LPH @ 35 m to 110 LPH @ 70 m; Suction 32 mm, Pressure 25 mm, Delivery 25 mm')
for m in ('ULTRA 15 (S)', 'ULTRA 15 (T)'):
    add(SURFACE_SERIES['ULTRA'], m, 1.5, 1.5,
        flow_head='12600 LPH @ 16 m to 3300 LPH @ 40 m; Pipe size 32 x 32 mm')

# CMB Class A (page 20 - transposed chart, discharge in LPS)
p20 = doc[19]
big = max(p20.find_tables().tables, key=lambda t: len(t.extract()))
rows = [[(c or '').strip() for c in r] for r in big.extract()]
models = next(r for r in rows if r[0].upper() == 'MODEL')[2:]
hp_row = next(r for r in rows if r[1] in ('H.P.',))[2:]
kw_row = next(r for r in rows if r[1] == 'kW')[2:]
del_row = next(r for r in rows if r[1] == 'DEL.')[2:]
suc_row = next(r for r in rows if r[1] == 'SUC.')[2:]
head_rows = [r for r in rows if num(r[1]) is not None and (r[0] == '' or 'Head' in r[0])]
for j, m in enumerate(models):
    pts = [(num(r[1]), num(r[2 + j])) for r in head_rows if num(r[2 + j]) is not None]
    pts.sort(key=lambda p: -p[0])
    fh = ''
    if pts:
        fh = f'{fmt(pts[0][1])} LPS @ {fmt(pts[0][0])} m to {fmt(pts[-1][1])} LPS @ {fmt(pts[-1][0])} m'
    fh += f'; Pipe size {suc_row[j]} x {del_row[j]} mm'
    add('CMB Class A Centrifugal Monoblock Pumpset', m, num(kw_row[j]), num(hp_row[j]),
        flow_head=fh, rpm=2900)
add('CMB Class A Centrifugal Monoblock Pumpset', 'VCS 2265 (A)', 2.2, 3.0,
    flow_head='355 LPM @ 27 m to 510 LPM @ 6 m; Pipe size 65 x 50 mm', rpm=2900)
add('CMB Class A Centrifugal Monoblock Pumpset', 'VCS 3765', 3.7, 5.0,
    flow_head='294 LPM @ 36 m to 750 LPM @ 14 m; Pipe size 65 x 50 mm', rpm=2900)

# HMPS rows the table parser cannot read (merged digits / unnamed rows, pages 24-25)
HM = SURFACE_SERIES['HMPS']
add(HM, '7.5 OSV 65', 5.5, 7.5, flow_head='650 LPM @ 32 m to 1400 LPM @ 16 m; Pipe size 75 x 65 mm', rpm=2880)
add(HM, '7.5 OSV 75', 5.5, 7.5, flow_head='500 LPM @ 32 m to 1270 LPM @ 22 m; Pipe size 75 x 75 mm', rpm=2880)
add(HM, '7.5 OSV 100', 5.5, 7.5, flow_head='330 LPM @ 30 m to 1480 LPM @ 18 m; Pipe size 100 x 100 mm', rpm=2880)
add(HM, 'HMPS (7.5 HP)', 5.5, 7.5, flow_head='220 LPM @ 52 m to 700 LPM @ 30 m; Pipe size 65 x 50 mm', rpm=2880)
add(HM, 'HMPS (10 HP)', 7.5, 10, flow_head='200 LPM @ 64 m to 650 LPM @ 40 m; Pipe size 65 x 50 mm', rpm=2880)
add(SURFACE_SERIES['HMPS HSS'], 'HMPS HSS', 1.5, 2,
    flow_head='290 LPM @ 18 m to 105 LPM @ 30 m; Pipe size 50 x 50 mm', rpm=2880)

# ---------------------------------------------------------------- line-based pages
def page_lines(pno):
    page = doc[pno - 1]
    words = page.get_text('words')
    words.sort(key=lambda w: (round((w[1] + w[3]) / 2), w[0]))
    rows = []
    for w in words:
        yc = (w[1] + w[3]) / 2
        if rows and abs(rows[-1][0] - yc) < 3.5:
            rows[-1][1].append(w)
        else:
            rows.append([yc, [w]])
    out = []
    for _, ws in rows:
        ws.sort(key=lambda w: w[0])
        out.append(' '.join(w[4] for w in ws))
    return out


NOISE = r'\b(Meters?|METERS?|meters?|in|In|IN|Head|HEAD|Materials?|Materia|Motors|LPM)\b'
ROW_RE = re.compile(r'^(?P<model>.*?[A-Za-z].*?)\s+(?P<kw>\d+(?:\.\d+)?)\s+(?P<hp>\d+(?:\.\d+)?)\s+'
                    r'(?P<stage>\d+)\s+(?P<vals>(?:[\d.]+|-)(?:\s+(?:[\d.]+|-))*)\s*$')
AXIS_RE = re.compile(r'(?i)\b(?:kw)\b.*?\b(?:hp|h\.p\.?)(?:\s+-)?\s+(?P<axis>[\d.\s]+)$')

MOC_V3 = 'Bowl & Impeller: Glass filled Noryl; Shaft: SS; Motor body: Non-magnetic SS'
MOC_V4 = 'Bowl & Impeller: Glass filled Noryl / CI; Shaft: SS; Motor body: Non-magnetic SS 304'
MOC_V5 = 'Bowl: CI / SS; Impeller: SS Cast / SSSM; Shaft: SS; Motor body: SS'
MOC_V8 = 'Bowl: CI; Impeller: SS Cast / SSSM; Shaft: SS; Motor body: SS'

SUB_PAGES = {
    32: ('V3 Borewell Submersible Pumpset (75/80 mm, OF/WF)', MOC_V3, True),
    36: ('V4 Borewell Submersible Pumpset (100 mm, OF/WF)', MOC_V4, True),
    37: ('V4 Borewell Submersible Pumpset (100 mm, OF/WF)', MOC_V4, True),
    38: ('V4 Borewell Submersible Pumpset (100 mm, OF/WF)', MOC_V4, True),
    39: ('V4 Borewell Submersible Pumpset (100 mm, OF/WF)', MOC_V4, True),
    43: ('V5 Borewell Submersible Pumpset (125 mm)', MOC_V5, False),
    46: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    47: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    48: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    49: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    50: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    51: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    52: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    53: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    54: ('V6 Borewell Submersible Pumpset (150 mm)', MOC_V5, False),
    55: ('V7 Borewell Submersible Pumpset (175 mm)', MOC_V5, False),
    56: ('V7 Borewell Submersible Pumpset (175 mm)', MOC_V5, False),
    59: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    60: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    61: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    62: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    63: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    64: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    65: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    66: ('V8 Borewell Submersible Pumpset (200 mm)', MOC_V8, False),
    70: ('V9 Borewell Submersible Pumpset (225 mm)', MOC_V8, False),
}
SUB_SPLIT_PREFIX = ('WW', 'VS')


def split_of_wf(model):
    toks = model.split()
    for i in range(1, len(toks)):
        right = ' '.join(toks[i:])
        if right.startswith(SUB_SPLIT_PREFIX) and not toks[i] in (':',):
            return ' '.join(toks[:i]) + ' / ' + right
    return model


unparsed = []
for pno, (series, moc, ofwf) in SUB_PAGES.items():
    axis = None
    outlet = ''
    for raw in page_lines(pno):
        mo = re.search(r'Outlet Size:\s*([\d &]+mm)', raw)
        if mo:
            outlet = mo.group(1).strip()
        line = re.sub(NOISE, ' ', raw)
        line = re.sub(r'\s+', ' ', line).strip()
        ma = AXIS_RE.search(line)
        if ma:
            axis = [num(x) for x in ma.group('axis').split()]
            continue
        if re.fullmatch(r'0(?: \d+)+', line):  # axis printed on its own line
            axis = [num(x) for x in line.split()]
            continue
        m = ROW_RE.match(line)
        if not m or axis is None:
            if re.match(r'^(VS|WO|WW|VJ|VN|VQ|HHSF|VSE|VSR|VSH|VSS)', line) and re.search(r'\d+\.\d', line):
                unparsed.append((pno, raw))
            continue
        model = m.group('model').strip()
        if model.lower().startswith(('model', 'note', 'outlet')):
            continue
        kw, hp, stage = num(m.group('kw')), num(m.group('hp')), int(m.group('stage'))
        if kw > hp * 1.5:  # catalogue typo e.g. "93" for 9.3 kW
            kw = kw / 10
        vals = m.group('vals').split()
        ax = list(axis)
        if len(ax) == len(vals) + 1 and ax[0] == 0 and ax[1] == 0:
            ax = ax[1:]
        if ofwf:
            model = split_of_wf(model)
        fh = duty_range(ax, vals, False, 'LPM')
        if outlet:
            fh += f'; Outlet {outlet}'
        add(series, model, kw, hp, stage=stage, flow_head=fh, moc=moc, rpm=2880)

# VMPS (pages 27-28) - extra frame/pump-type/outlet columns
VMPS = 'VMPS Vertical Openwell Submersible Pumpset'
for pno in (27, 28):
    axis = None
    for raw in page_lines(pno):
        line = re.sub(NOISE, ' ', raw)
        line = re.sub(r'\s+', ' ', line).strip()
        ma = re.search(r'(?i)(?:kw hp (?:type )?mm|kw hp)\s+(?P<axis>0(?:\s+\d+)+)$', line)
        if ma:
            axis = [num(x) for x in ma.group('axis').split()]
            continue
        m = re.match(r'^(?P<model>VV\s*:.*?)\s+(?P<kw>[\d.]+)\s+(?P<hp>[\d.]+)\s+(?P<stage>\d+)\s+'
                     r'(?P<frame>F\w/A\d+)\s+(?P<ptype>[MR] \d+ ?\w*)\s+(?P<outlet>\d+(?: /\d+)?)\s+(?P<vals>[\d\s]+)$', line)
        if m:
            fh = duty_range(axis, m.group('vals').split(), False, 'LPM')
            fh += f"; Outlet {m.group('outlet').replace(' ', '')} mm; Frame {m.group('frame')}; Pump {m.group('ptype')}"
            add(VMPS, m.group('model'), num(m.group('kw')), num(m.group('hp')), stage=int(m.group('stage')),
                flow_head=fh, rpm=2880)
            continue
        m = re.match(r'^(?P<model>VVT:\s*\d+/\d+)\s+(?P<kw>[\d.]+)\s+(?P<hp>[\d.]+)\s+(?P<stage>\d+)\s+'
                     r'(?P<outlet>\d+)\s+(?P<vals>[\d\s]+)$', line)
        if m:
            fh = duty_range(axis, m.group('vals').split(), False, 'LPM') + f"; Outlet {m.group('outlet')} mm"
            add(VMPS, m.group('model'), num(m.group('kw')), num(m.group('hp')), stage=int(m.group('stage')),
                flow_head=fh, rpm=2880)
        elif line.startswith('VV'):
            unparsed.append((pno, raw))

# V8 VQ HB/HC (page 67 - rotated chart)
vq67 = [
    ('VQ : 25 HB', 7.5, 10, 3, 57), ('VQ : 35 HB', 5.5, 7.5, 2, 39), ('VQ : 35 HB', 9.3, 12.5, 3, 58),
    ('VQ : 35 HB', 11, 15, 4, 77), ('VQ : 35 HB', 15, 20, 5, 97), ('VQ : 50 HB', 7.5, 10, 2, 43),
    ('VQ : 50 HB', 11, 15, 3, 65), ('VQ : 50 HB', 15, 20, 4, 87), ('VQ : 50 HB', 18.5, 25, 5, 109),
    ('VQ : 60 HB', 9.3, 12.5, 2, 49), ('VQ : 60 HB', 13, 17.5, 3, 74), ('VQ : 70 HC', 11, 15, 2, 45),
    ('VQ : 70 HC', 15, 20, 3, 68), ('VQ : 70 HC', 22.5, 30, 4, 91), ('VQ : 70 HC', 26, 35, 5, 113),
    ('VQ : 70 HC', 30, 40, 6, 135), ('VQ : 70 HC', 37.5, 50, 7, 158), ('VQ : 70 HC', 41, 55, 8, 180),
    ('VQ : 70 HC', 49, 65, 9, 203), ('VQ : 70 HC', 52, 70, 10, 225),
]
for model, kw, hp, st, h0 in vq67:
    add('V8 Borewell Submersible Pumpset (200 mm)', model, kw, hp, stage=st,
        flow_head=f'Shut-off head {h0} m; Outlet 100 mm', moc=MOC_V8, rpm=2880)

# Sewage pump variants (page 72)
add(SURFACE_SERIES['VSSP'], 'VSSP11(1PH) FS (RD)', 0.75, 1.0,
    flow_head='400 LPM @ 3 m to 55 LPM @ 11.5 m; Pipe size 50 x 35 mm')
add(SURFACE_SERIES['VSSP'], 'VSSP14(1PH) FS (RL)', 1.5, 2.0,
    flow_head='600 LPM @ 3 m to 85 LPM @ 14 m; Pipe size 50 x 35 mm')

# ---------------------------------------------------------------- uPVC column pipes (page 76)
for raw in page_lines(76):
    m = re.match(r'^(?P<size>[\d.]+)"\s+(?P<id>\d+)\s+(?P<od>\d+)\s+(?P<desc>VCP .+?)\s+(?P<colour>[A-Z]+) '
                 r'(?P<type>COUPLER|BELL END)\s+(?P<pack>\d+)\s+(?P<press>[\d.]+)\s+(?P<ubl>\d+)\s+'
                 r'(?P<spl>\d+)\s+(?P<head>\d+)$', raw)
    if not m:
        continue
    desc = m.group('desc').strip()
    add('uPVC Column Pipe', desc, None, None,
        flow_head=(f"Max pump delivery head {m.group('head')} m; Safe hydrostatic pressure "
                   f"{m.group('press')} kgf/cm2; Safe pulling load {m.group('spl')} kgf"),
        moc=f"uPVC, ID {m.group('id')} mm / OD {m.group('od')} mm, {m.group('colour').title()} {m.group('type').lower()}",
        hsn='3917')

# ---------------------------------------------------------------- single phase induction motors (page 77)
for raw in page_lines(77):
    m = re.match(r'^(?P<model>VESM\S+)\s+(?P<kw>[\d.]+)\s+(?P<hp>[\d.]+)\s+(?P<pole>\d)\s+(?P<frame>\w+)\s+'
                 r'(?P<type>\w+)\s+(?P<encl>\w+)\s+SHEET METAL\s+(?P<duty>\w+)$', raw)
    if not m:
        continue
    add('Single Phase Induction Motor', m.group('model'), num(m.group('kw')), num(m.group('hp')),
        flow_head='', rpm=1440, hsn='8501',
        extra_desc=f"{m.group('duty').title()} Duty",
        moc=(f"{m.group('pole')} pole, Frame {m.group('frame')}, {m.group('type')}, {m.group('encl')}, "
             "Sheet metal body, CI end shields, IP44, Class F"))

COLS = ['description', 'hsn_sac', 'default_rate', 'gst_percent', 'unit', 'use_structured_specs',
        'spec_model', 'spec_kw_rpm', 'spec_flow_head', 'spec_moc']


def lit(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


rows = ',\n'.join('  (' + ', '.join(lit(x[c]) for c in COLS) + ')' for x in products)
sql = f"""-- KOEL Varuna product master, generated from "KFD Varuna Catalogue" (KOEL Fluid Dynamics).
-- {len(products)} products. Rates are 0 (the catalogue has no prices) - fill them in from the price list.
-- Run once in the Supabase SQL Editor AFTER schema.sql. Safe to re-run: products whose
-- description already exists are skipped.

insert into products ({', '.join(COLS)})
select v.* from (values
{rows}
) as v({', '.join(COLS)})
where not exists (select 1 from products p where p.description = v.description);
"""
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'db', 'seed_koel_products.sql')
open(out, 'w', encoding='utf-8', newline='\n').write(sql)
print('products:', len(products))
print('unparsed candidate rows:', len(unparsed))
for u in unparsed:
    print('  ', u)
