"""Convert Yehuda's supplied legacy symbol font without redrawing its glyphs.

Usage: python tools/convert-asirit.py path/to/x-asirt0.TTF
Requires fonttools. Original copyright and embedding flags are retained.
"""
from pathlib import Path
from hashlib import sha256
import sys
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

source = Path(sys.argv[1])
assert sha256(source.read_bytes()).hexdigest() == '54efc8a9520ea8af59045999fb719a27d271709d2bee38f199b88aafb0f9086d'
font = TTFont(source, recalcTimestamp=False)
original = font.getBestCmap()
mapping = {0x05d0 + i: original[0xf0e0 + i] for i in range(27)}
mapping[0x20] = original[0xf020]
# Hebrew text and a genuine Unicode cmap. Latin text uses the UI font rather
# than accidentally displaying the legacy font's keyboard-position glyphs.
font['cmap'].tables = []
for platform, encoding in [(0, 3), (3, 1)]:
    table = CmapSubtable.newSubtable(4)
    table.platformID, table.platEncID, table.language = platform, encoding, 0
    table.cmap = dict(mapping)
    font['cmap'].tables.append(table)
for name_id, value in {1: 'Sofer Asirit Unicode', 2: 'Regular', 3: 'Sofer-Asirit-Unicode-1.0',
                       4: 'Sofer Asirit Unicode', 5: 'Version 1.0; Unicode mapping 2026-10-06',
                       6: 'SoferAsiritUnicode'}.items():
    font['name'].removeNames(nameID=name_id)
    font['name'].setName(value, name_id, 3, 1, 0x409)
font['OS/2'].ulUnicodeRange1 = 1 << 11  # Hebrew
font['OS/2'].ulUnicodeRange2 = font['OS/2'].ulUnicodeRange3 = font['OS/2'].ulUnicodeRange4 = 0
font['OS/2'].usFirstCharIndex, font['OS/2'].usLastCharIndex = 0x20, 0x05ea
output = Path(__file__).resolve().parents[1] / 'public/fonts/SoferAsiritUnicode.ttf'
font.save(output)
check = TTFont(output)
assert all(check.getBestCmap()[cp] == glyph for cp, glyph in mapping.items())
print(output.name, sha256(output.read_bytes()).hexdigest())
