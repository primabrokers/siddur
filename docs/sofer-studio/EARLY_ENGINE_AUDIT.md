Controller read the first engine files and executed independent assertions (read-only; product code unchanged).

PASS: skeleton2mm at ref3mm scales to3mm at4.5mm; adding0.2mm stroke gives3.2mm total, while0.3mm stroke gives3.3mm. Threshold composition includes2word gaps.

MATERIAL Shem coverage issue in current engine/shem.js: analyzeToken returns false for יה, אהיה, אלוה, אלהיכם, אלהיהם, באלהיכם, ובאלהיכם. יהוה returns true. These omissions can expose Shem letters with positive caps to stretching. Ensure full relevant base/suffix/prefix coverage and source-annotation overrides, conservative protection with review flags for ambiguous homographs, never blanket certainty for every matching ordinary word. Recheck after backend child finishes; initial implementation may still be in progress.

Primary reference for code review: https://mechon-mamre.org/i/1106.htm (Yesodei HaTorah6:2–4 includes אהיה, אלוה, יה and suffix treatment;6:9 illustrates context dependence). This is support for conservative detection and expert review, not a certification of all individual Torah occurrences. Add meaningful failing cases through DeepSeek and ask Opus to audit detection/atomicity/stretch exclusions against them.

Source-data follow-up: naive removal of bracketed qere from the fetched study text yields304850Hebrew letters, not304805. Do not relabel it a verified scribal corpus; keep source version/normalization policy and limitations explicit.
