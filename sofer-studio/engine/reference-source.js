// Deterministic adapter for the pinned, MIT-licensed tikkun.io Torah data.
// Data only: no upstream code is executed. Reading alternatives are excluded;
// source order, written spellings, section boundaries and physical lines survive.
import {createHash} from 'node:crypto';
import {processSource} from './source.js';
import {applyStamAnnotations} from './stam-annotations.js';

export const REFERENCE_ID = 'tikkun-245-57ba104e';
export const BOOK_NAMES = ['Genesis','Exodus','Leviticus','Numbers','Deuteronomy'];
export const REFERENCE_ORIGIN = {
  id: REFERENCE_ID, title: 'Layout 1 — 245-column Tikkun reference',
  repository: 'https://github.com/akivajgordon/tikkun.io',
  commit: '57ba104e8de055cf92d3cf6aa91245bd92b34d60', license: 'MIT',
  comparison: 'Sample-compared with a published Simanim sample and independent printed columns; not whole-Torah certification.',
  review_required: true,
};
const hash = value => createHash('sha256').update(value).digest('hex');
const plain = text => text.replace(/#\[[^\]]*\]/gu,' ').replace(/[\p{M}\u200c\u200d]/gu,'');
const blank = () => ({text:[['']],verses:[],isPetucha:false,inserted_blank:true});

export function compileReference(pages, selectedBook = 'all', stamAnnotations = null) {
  if (!Array.isArray(pages) || pages.length !== 245) throw new Error('Reference must contain exactly 245 columns');
  if (selectedBook !== 'all' && !BOOK_NAMES.includes(selectedBook)) throw new Error('Unknown reference book');
  const books = BOOK_NAMES.map(name=>({name,chapters:[]}));
  const lines = [], corrections = [], allWords = [];
  let current = null, lastVerse = null, globalWord = 0, nunCount = 0;
  function append(value) {
    if (!lastVerse) throw new Error('Reference annotation before first verse');
    const chapter = books[lastVerse.book-1].chapters[lastVerse.chapter-1];
    chapter[lastVerse.verse-1] = (chapter[lastVerse.verse-1] || '') + ' ' + value;
  }
  for (let pi=0;pi<pages.length;pi++) {
    const page = pi+1;
    let records = pages[pi].map((line,index)=>({...line,source_record:index+1}));
    // The upstream digital view stores five blank records at book boundaries.
    // The physical 42-rule reference uses four: retain all text and remove only
    // the fifth blank. This mapping is explicit and included in provenance.
    if ([61,111,148,200].includes(page)) {
      const blanks=records.map((r,i)=>r.text.flat().every(x=>x.trim()==='')?i:-1).filter(i=>i>=0);
      if (records.length!==43 || blanks.length!==5 || blanks.some((v,i)=>v!==blanks[0]+i)) throw new Error('Unexpected book-transition shape at column '+page);
      records.splice(blanks[4],1); corrections.push({page,action:'five digital blank records mapped to four physical blank lines'});
    }
    if (page===78) {
      if(records.length!==40 || !records[5].text.flat().join(' ').startsWith('אָ֣ז')) throw new Error('Unexpected Shirat Hayam reference');
      records.splice(35,0,blank()); records.splice(5,0,blank());
      corrections.push({page,action:'insert physical blank lines before the song and before Miriam (sample comparison)'});
    }
    if(records.length!==42) throw new Error('Reference column '+page+' is not 42 physical lines');
    for (let ri=0;ri<records.length;ri++) {
      const raw=records[ri], starts=[...(raw.verses||[])], items=[];
      const song = (page===78 && raw.source_record>=6 && raw.source_record<=35) || raw.text.length>1;
      let petucha=false, lineBooks=new Set();
      // Non-song arrays encode setumah-separated text segments. The pinned
      // reference has one trailing empty segment after the Torah's final word;
      // it is padding, not a paragraph gap (a setumah must have text on both
      // sides). Song arrays use empty segments for physical composition and
      // therefore remain byte-for-byte represented.
      const rawSegments=raw.text.flat();
      const segments=song?rawSegments:rawSegments.filter(value=>value.trim()!=='');
      for(let si=0;si<segments.length;si++) {
        if(si) { items.push({type:song?'segment_gap':'setuma_gap'}); if(!song)append('{ס}'); }
        const clean=plain(segments[si]).replace(/#\(פ\)/gu,' {פ} ').replace(/\(׆\)#|#\(׆\)/gu,' ׆ ').replace(/־/gu,' ');
        const chunks=clean.match(/\{פ\}|׆|׃|[א-ת]+/gu)||[];
        for(const value of chunks) {
          if(value==='{פ}') { append('{פ}');petucha=true;continue; }
          if(value==='׃') {
            // The upper/lower Decalogue cantillation includes clause-ending
            // sof-pasuq signs inside one numbered verse. Preserve its explicit
            // source verse numbering rather than inventing extra verses.
            const decalogue=current && ((current.book===2&&current.chapter===20&&current.verse===13)||(current.book===5&&current.chapter===5&&current.verse===17));
            if(!(decalogue&&['תרצח','תנאף','תגנב'].includes(allWords.at(-1)?.text))) current=null;
            continue;
          }
          if(value==='׆') {items.push({type:'nun_hafucha'});nunCount++;continue;}
          if(!current) {
            current=starts.shift();
            if(!current || !BOOK_NAMES[current.book-1]) throw new Error('Missing verse start at column '+page+', record '+raw.source_record);
            const b=books[current.book-1]; b.chapters[current.chapter-1] ||= [];
            if(b.chapters[current.chapter-1][current.verse-1]) throw new Error('Duplicate verse start');
            lastVerse=current;
          }
          append(value);lineBooks.add(current.book);
          items.push({type:'word',word_index:globalWord});allWords.push({book:current.book,text:value});globalWord++;
        }
      }
      if(starts.length) throw new Error('Unconsumed verse starts at column '+page+', record '+raw.source_record);
      lines.push({page,line:ri+1,source_record:raw.source_record||null,items,petucha_end:petucha,
        fixed_pattern:song || items.some(x=>x.type==='nun_hafucha'),blank:!items.length,
        book_boundary_blank:[61,111,148,200].includes(page)&&!items.length,books:[...lineBooks]});
    }
  }
  if(current) throw new Error('Reference ends before its last verse delimiter');
  if(nunCount!==2) throw new Error('Reference must preserve both inverted nuns');
  const chosen=selectedBook==='all'?books:books.filter(b=>b.name===selectedBook);
  const selectedNumber=BOOK_NAMES.indexOf(selectedBook)+1;
  const selectedLines=selectedBook==='all'?lines:lines.filter(l=>l.books.includes(selectedNumber));
  // Preserve complete reference columns, including blank lines and book edges.
  const pageSet=new Set(selectedLines.map(l=>l.page));
  const wordMap=new Map();let index=0;
  allWords.forEach((w,i)=>{if(selectedBook==='all'||w.book===selectedNumber)wordMap.set(i,index++);});
  const mapped=lines.filter(l=>pageSet.has(l.page)).map(l=>({...l,items:l.items.filter(it=>it.type!=='word'||wordMap.has(it.word_index)).map(it=>it.type==='word'?{...it,word_index:wordMap.get(it.word_index)}:it)}));
  // A boundary column shared by two books must not inherit the other book's
  // section/special marks. Empty those rows, keeping their ruling-line positions.
  if(selectedBook!=='all')for(const l of mapped)if(l.books.length&&!l.books.includes(selectedNumber)){l.items=[];l.petucha_end=false;l.fixed_pattern=false;l.blank=true;}
  const doc=processSource({name:REFERENCE_ORIGIN.title+' · '+(selectedBook==='all'?'Full Torah':selectedBook),format:'json',text:{books:chosen},tradition:'Ashkenaz Tikkun reference — sofer review required'});
  const working=doc.verses.flatMap(v=>v.tokens.filter(t=>!t.marker).map(t=>t.consonant));
  const expected=allWords.filter(w=>selectedBook==='all'||w.book===selectedNumber).map(w=>w.text);
  if(JSON.stringify(working)!==JSON.stringify(expected))throw new Error('Reference text order changed during import');
  const reference={...REFERENCE_ORIGIN,selected_book:selectedBook,raw_sha256:hash(JSON.stringify(pages)),word_sha256:hash(expected.join(' ')),corrections,lines:mapped};
  doc.canonical={...doc.canonical,reference};
  if(stamAnnotations)applyStamAnnotations(doc,stamAnnotations);
  doc.original=JSON.stringify(doc.canonical);doc.revision_hash=hash(doc.original);doc.format='tikkun-reference';
  doc.source_label=REFERENCE_ORIGIN.title+' — review before writing';
  return doc;
}
