import {readFileSync} from 'node:fs';
import {compileReference} from '../engine/reference-source.js';
const root=new URL('../reference-data/',import.meta.url);
export function loadReferenceSource(book='all') {
  const pages=Array.from({length:245},(_,i)=>JSON.parse(readFileSync(new URL((i+1)+'.json',root),'utf8')));
  const annotations=JSON.parse(readFileSync(new URL('stam-annotations.json',root),'utf8'));
  return compileReference(pages,book,annotations);
}
