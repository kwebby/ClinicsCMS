/* Author: ramanpal singh | URL: https://kwebby.com */
import { assert } from '../../contracts/src/index.js';
import { escapeHtml, safeUrl } from './common.js';

export interface RenderOptions { mediaUrl?:(reference:string)=>string|null; }
export interface BlockNoteBlock { id?:string; type?:string; props?:Record<string,unknown>; content?:unknown; children?:BlockNoteBlock[]; }
function inline(value:unknown,depth=0):string {
 if(depth>12||value==null)return '';
 if(typeof value==='string')return escapeHtml(value);
 if(!Array.isArray(value))return '';
 return value.slice(0,10000).map(item=>{
  if(!item||typeof item!=='object')return '';
  const itemData=item as Record<string,unknown>;
  if(itemData.type==='link') {const href=safeUrl(itemData.href);const text=inline(itemData.content,depth+1);return href?`<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>`:text;}
  let text=escapeHtml(itemData.text??'');const styles=itemData.styles as Record<string,unknown>|undefined;
  if(styles?.code)text=`<code>${text}</code>`;
  if(styles?.bold)text=`<strong>${text}</strong>`;
  if(styles?.italic)text=`<em>${text}</em>`;
  if(styles?.underline)text=`<u>${text}</u>`;
  if(styles?.strike)text=`<s>${text}</s>`;
  return text;
 }).join('');
}
export function renderBlockNote(blocks:unknown,options:RenderOptions={}):string {
 assert(Array.isArray(blocks)&&blocks.length<=5000,'DOCUMENT_FORMAT','Document must contain a supported block array');
 const render=(list:BlockNoteBlock[],depth:number):string=>{
  assert(depth<=12,'DOCUMENT_DEPTH','Document nesting is too deep');
  return list.map(block=>{
   const props=block.props??{},text=inline(block.content),children=Array.isArray(block.children)&&block.children.length?render(block.children,depth+1):'';
   switch(block.type) {
    case 'heading': {const level=[1,2,3,4,5,6].includes(Number(props.level))?Number(props.level):2;return `<h${level}>${text}</h${level}>${children}`;}
    case 'bulletListItem':return `<ul><li>${text}${children}</li></ul>`;
    case 'numberedListItem':return `<ol><li>${text}${children}</li></ol>`;
    case 'checkListItem':return `<div class="checklist-item" role="checkbox" aria-checked="${props.checked===true?'true':'false'}">${props.checked===true?'☑':'☐'} ${text}${children}</div>`;
    case 'quote':return `<blockquote>${text}${children}</blockquote>`;
    case 'codeBlock':return `<pre><code>${text}</code></pre>${children}`;
    case 'divider':return '<hr>';
    case 'image': {
     const reference=typeof props.url==='string'?props.url:'';
     const mapped=options.mediaUrl?.(reference),url=safeUrl(mapped,true);
     if(!url || !url.startsWith('/') || url.startsWith('//'))return '';
     const width=Math.min(Math.max(Number(props.previewWidth)||800,1),2400);
     return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(props.alt??props.caption??props.name??'')}" width="${width}" loading="lazy" decoding="async">${props.caption?`<figcaption>${escapeHtml(props.caption)}</figcaption>`:''}</figure>`;
    }
    case 'table': {
     const data=block.content as {rows?:{cells?:unknown[]}[]};
     if(!Array.isArray(data?.rows))return '';
     return `<div class="table-scroll"><table><tbody>${data.rows.slice(0,200).map(row=>`<tr>${(row.cells??[]).slice(0,30).map(cell=>`<td>${inline(Array.isArray(cell)?cell:typeof cell==='object'&&cell?(cell as Record<string,unknown>).content:cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    case 'citation': {const url=safeUrl(props.url);return `<aside class="citation">${url?`<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(props.title??'Source')}</a>`:escapeHtml(props.title??'Source')}${props.accessedAt?` <span>Accessed ${escapeHtml(props.accessedAt)}</span>`:''}</aside>`;}
    case 'medicalReview':return `<aside class="medical-review">Reviewed by ${escapeHtml(props.reviewer??'')}${props.reviewedAt?` on ${escapeHtml(props.reviewedAt)}`:''}</aside>`;
    case 'paragraph': case undefined:return `<p>${text}</p>${children}`;
    default:return `<p>${text}</p>${children}`;
   }
  }).join('');
 };
 return render(blocks as BlockNoteBlock[],0);
}
export function blockNotePlainText(blocks:unknown):string {
 return renderBlockNote(blocks).replace(/<[^>]*>/g,' ').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
}
