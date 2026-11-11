import json, csv, re, sys, os
src, out = sys.argv[1], sys.argv[2]
files = {'shelters.json':'Shelter','transitional.json':'Transitional / Recovery','psh_public.json':'PSH / Public / HUD','affordable.json':'Affordable / Low-cost'}
alias = {'funding_source':'funding','intake':'how_to_apply','capacity':'units'}
def key(n):
    n = n.lower()
    n = re.sub(r'\(.*?\)','',n)
    n = re.sub(r'\b(the|apartments?|apts?|homes?|inc|llc|reno|sparks|nevada)\b','',n)
    return re.sub(r'[^a-z0-9]','',n)
merged = {}
for f, group in files.items():
    for r in json.load(open(os.path.join(src,f))):
        r = {alias.get(k,k):v for k,v in r.items()}
        if r.get('in_scope') is False:
            r['group'] = 'Out of scope (asked about)'
        else:
            r['group'] = group
        r.pop('in_scope', None)
        k = key(r['name'])
        if k in merged:
            m = merged[k]
            m['sources'] = sorted(set((m.get('sources') or []) + (r.get('sources') or [])))
            for fld,v in r.items():
                if v not in (None,'',[]) and m.get(fld) in (None,'',[]): m[fld]=v
            if m['group'].startswith('Out of scope') and not r['group'].startswith('Out of scope'):
                m['also_in'].append(m['group']); m['group']=r['group']; m['category']=r.get('category')
            elif r['group'] not in m['also_in']: m['also_in'].append(r['group'])
            if r.get('notes') and r['notes'] != m.get('notes'):
                m['notes'] = (m.get('notes') or '') + ' | ALT: ' + r['notes']
        else:
            r['also_in'] = []
            merged[k] = r
rows = sorted(merged.values(), key=lambda r:(r['group'], r.get('category') or '', r['name']))
for i,r in enumerate(rows,1): r['id'] = f'SW-{i:03d}'
json.dump(rows, open(os.path.join(out,'housing_master.json'),'w'), indent=2)
cols = ['id','group','category','name','operator','population','address','city','phone','website','how_to_apply','units','status','waitlist_status','typical_rent','ami_limits','cost','length_of_stay','funding','confidence','notes','also_in','sources']
with open(os.path.join(out,'housing_master.csv'),'w',newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore'); w.writeheader()
    for r in rows:
        w.writerow({c:('; '.join(r[c]) if isinstance(r.get(c),list) else r.get(c)) for c in cols})
from collections import Counter
print(len(rows)); print(Counter(r['group'] for r in rows)); print(Counter(r.get('confidence') for r in rows))
print('dupes merged:', [r['name']+' <- '+','.join(r['also_in']) for r in rows if r['also_in']])

# manual merges of near-duplicates: (drop, keep)
pairs = [('Sierra Manor','Sierra Manor I & II'),('Golden Apartments (Golden I)','Golden I Apartments (Golden Apartments)'),
 ('Hawk View Apartments (redevelopment)','The Village at Hawk View (Hawk View Apartments redevelopment)'),
 ('Catholic Charities of Northern Nevada - St. Vincent\'s Residences / Battle Born Housing Plus','Battle Born Housing Plus (St. Vincent\'s Residences)')]
by = {r['name']:r for r in rows}
for d,k in pairs:
    a,b = by.pop(d), by[k]
    b['sources'] = sorted(set((b.get('sources') or [])+(a.get('sources') or [])))
    b['notes'] = (b.get('notes') or '') + ' | MERGED: ' + (a.get('notes') or '')
    for fld,v in a.items():
        if v not in (None,'',[]) and b.get(fld) in (None,'',[]): b[fld]=v
hl = by.get('Hope Landing'); 
if hl: hl['notes'] = (hl.get('notes') or '') + ' | LIKELY SAME PROJECT as Carville Court redevelopment (1245-1257 Carville Dr) - verify with RHA.'
rows = sorted(by.values(), key=lambda r:(r['group'], r.get('category') or '', r['name']))
for i,r in enumerate(rows,1): r['id'] = f'SW-{i:03d}'
json.dump(rows, open(os.path.join(out,'housing_master.json'),'w'), indent=2)
with open(os.path.join(out,'housing_master.csv'),'w',newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore'); w.writeheader()
    for r in rows: w.writerow({c:('; '.join(r[c]) if isinstance(r.get(c),list) else r.get(c)) for c in cols})
print('final', len(rows), Counter(r['group'] for r in rows), Counter(r.get('confidence') for r in rows))
