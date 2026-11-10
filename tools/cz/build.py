#!/usr/bin/env python3
"""Vygeneruje českú verziu webu do /cz zo slovenských stránok.
Spúšťať z koreňa repa: python3 tools/cz/build.py
Preklady sú v tools/cz/preklad.json (slovenský text -> český text).
Nový slovenský text bez prekladu ostane v /cz po slovensky, skript ho vypíše."""
import json, re, os, sys

D = os.path.dirname(os.path.abspath(__file__))
tr = json.load(open(os.path.join(D, 'preklad.json'), encoding='utf-8'))
tr['Predchádzajúce'] = 'Předchozí'
tr['Ďalšie'] = 'Další'

SK = 'https://marketingnakluc.sk'
CZ = 'https://marketingnaklic.cz'
PAGES = [  # sk file, cz file, sk url, cz url
    ('index.html', 'cz/index.html', '/', '/'),
    ('ako-pracujeme-s-ai/index.html', 'cz/jak-pracujeme-s-ai/index.html', '/ako-pracujeme-s-ai/', '/jak-pracujeme-s-ai/'),
    ('studio/index.html', 'cz/studio/index.html', '/studio/', '/studio/'),
    ('filmovy-marketing/index.html', 'cz/filmovy-marketing/index.html', '/filmovy-marketing/', '/filmovy-marketing/'),
    ('tim/index.html', 'cz/tym/index.html', '/tim/', '/tym/'),
    ('kalkulacka/index.html', 'cz/kalkulacka/index.html', '/kalkulacka/', '/kalkulacka/'),
    ('dakujeme/index.html', 'cz/dekujeme/index.html', '/dakujeme/', '/dekujeme/'),
    ('404.html', 'cz/404.html', None, None),
]
LINKS = {'/ako-pracujeme-s-ai/': '/jak-pracujeme-s-ai/', '/tim/': '/tym/', '/dakujeme/': '/dekujeme/'}
ATTRS = ('alt', 'title', 'aria-label', 'content', 'placeholder', 'value')

KALK = [
    ("'sk-SK'", "'cs-CZ'"),
    ("'Stráca'", "'Prodělává'"),
    ("'Bez marže reklama nemôže zarobiť.'", "'Bez marže reklama nemůže vydělat.'"),
    ("'Na nule'", "'Na nule'"),
    ("'Reklama sa presne zaplatí, ale nič nezarobí.'", "'Reklama se přesně zaplatí, ale nic nevydělá.'"),
    ("'Zarába'", "'Vydělává'"),
    ("'Vaša ROAS je o '", "'Vaše ROAS je o '"),
    ("' nad bodom zvratu. Každé euro v reklame vám vráti '", "' nad bodem zvratu. Každé euro v reklamě vám vrátí '"),
    ("' € hrubého zisku.'", "' € hrubého zisku.'"),
    ("'Chýba '", "'Chybí '"),
    ("' ROAS do bodu zvratu. Každé euro v reklame vám vráti len '", "' ROAS do bodu zvratu. Každé euro v reklamě vám vrátí jen '"),
    ("'Bod zvratu '", "'Bod zvratu '"),
    ("'Váš odhad '", "'Váš odhad '"),
]


def translate_html(html):
    out, in_script = [], False
    for part in re.split(r'(<[^>]*>)', html):
        if part.startswith('<'):
            low = part.lower()
            if low.startswith('<script') or low.startswith('<style'):
                in_script = True
            elif low.startswith('</script') or low.startswith('</style'):
                in_script = False

            def attr(m):
                v = m.group(3)
                return m.group(1) + m.group(2) + tr.get(v, v) + m.group(2)
            part = re.sub(r'(\b(?:%s)=)(["\'])(.*?)\2' % '|'.join(ATTRS), attr, part)
            out.append(part)
        elif in_script or not part.strip():
            out.append(part)
        else:
            s = part.strip()
            if s in tr:
                part = part.replace(s, tr[s])
            out.append(part)
    return ''.join(out)


def head_links(sk_url, cz_url, lang):
    canon = (CZ + cz_url) if lang == 'cs' else (SK + sk_url)
    return ('  <link rel="canonical" href="%s">\n'
            '  <link rel="alternate" hreflang="sk" href="%s">\n'
            '  <link rel="alternate" hreflang="cs" href="%s">\n') % (canon, SK + sk_url, CZ + cz_url)


def switcher(target, lang):
    label, hl, title = ('CZ', 'cs', 'Česká verze') if lang == 'sk' else ('SK', 'sk', 'Slovenská verzia')
    return '<a class="nav__lang" href="%s" hreflang="%s" lang="%s" title="%s">%s</a>' % (target, hl, hl, title, label)


def strip_old(html):
    html = re.sub(r'  <link rel="(?:canonical|alternate)"[^>]*>\n', '', html)
    html = re.sub(r'<a class="nav__lang"[^>]*>[^<]*</a>\s*', '', html)
    return html


def add_meta(html, sk_url, cz_url, lang, target):
    if sk_url is not None and '/dakujeme/' not in sk_url:
        html = html.replace('  <link rel="icon"', head_links(sk_url, cz_url, lang) + '  <link rel="icon"', 1)
    if target:
        html = html.replace('<a class="btn nav__cta"', switcher(target, lang) + '\n      <a class="btn nav__cta"', 1)
    return html


os.makedirs('cz', exist_ok=True)
for sk_f, cz_f, sk_url, cz_url in PAGES:
    sk = strip_old(open(sk_f, encoding='utf-8').read())
    # Slovak page: hreflang + switcher to the Czech twin
    sk_out = add_meta(sk, sk_url, cz_url, 'sk', (CZ + cz_url) if cz_url else CZ + '/')
    open(sk_f, 'w', encoding='utf-8').write(sk_out)

    cz = translate_html(sk)
    cz = cz.replace('<html lang="sk">', '<html lang="cs">')
    cz = cz.replace('Vedú ľudia. Zrýchľuje AI. &nbsp;·&nbsp; 10 rokov', 'Vedou lidé. Zrychluje AI. &nbsp;·&nbsp; 10 let')
    for a, b in LINKS.items():
        cz = cz.replace('href="%s' % a, 'href="%s' % b)
    cz = cz.replace(SK + '/assets/', CZ + '/assets/')
    cz = cz.replace('/assets/img/logo.png', '/assets/img/logo-cz.png').replace('/assets/img/logo-biele.png', '/assets/img/logo-cz-biele.png')
    cz = cz.replace('value="%s/dakujeme/"' % SK, 'value="%s/dekujeme/"' % CZ)
    if 'kalkulacka' in sk_f:
        for a, b in KALK:
            cz = cz.replace(a, b)
    cz = add_meta(cz, sk_url, cz_url, 'cs', (SK + sk_url) if sk_url else SK + '/')
    os.makedirs(os.path.dirname(cz_f) or '.', exist_ok=True)
    open(cz_f, 'w', encoding='utf-8').write(cz)

# leftovers check: Slovak-only letters in visible text of CZ pages
bad = re.compile(r'[äĺľôŕ]|\b(?:ktor|alebo|sme |pre |ako |nie |aj |vám |naš|môž|ďalš)', re.I)
for _, cz_f, _, _ in PAGES:
    txt = open(cz_f, encoding='utf-8').read()
    txt = re.sub(r'<script.*?</script>|<style.*?</style>', '', txt, flags=re.S)
    for chunk in re.split(r'<[^>]*>', txt):
        if bad.search(chunk) and chunk.strip():
            print(cz_f, '|', chunk.strip()[:120])
