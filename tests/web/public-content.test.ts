/* Author: ramanpal singh | URL: https://kwebby.com */
import {describe,expect,it} from 'vitest';
import {groupBlocks} from '../../apps/web/lib/block-groups.js';
import {isReservedSlug,publicAddress,telHref} from '../../apps/web/lib/website-display.js';
import {allowedWorkflowTargets,weekdayNames} from '../../apps/web/lib/workflow-views.js';
import {config} from '../../apps/web/proxy.js';
const item=(type:string,text:string,props:Record<string,unknown>={})=>({id:text,type,props,content:text});

describe('document lists',()=>{
  it('groups consecutive items into one list so numbering continues',()=>{
    const groups=groupBlocks([item('paragraph','intro'),item('numberedListItem','one'),item('numberedListItem','two'),item('numberedListItem','three'),item('bulletListItem','dot'),item('paragraph','end')]);
    expect(groups.map(g=>g.kind==='list'?`${g.ordered?'ol':'ul'}:${g.items.map(i=>i.id).join(',')}`:`p:${g.block.id}`)).toEqual(['p:intro','ol:one,two,three','ul:dot','p:end']);
  });
  it('starts a new numbered list at an explicit start number and after any other block',()=>{
    const groups=groupBlocks([item('numberedListItem','a'),item('numberedListItem','b',{start:5}),item('numberedListItem','c'),item('paragraph','break'),item('numberedListItem','d')]);
    expect(groups.map(g=>g.kind==='list'?[g.items.map(i=>i.id).join(','),g.start??1]:g.block.id)).toEqual([['a',1],['b,c',5],'break',['d',1]]);
  });
  it('treats unknown or inherited type names as ordinary blocks',()=>{
    expect(groupBlocks([item('toString','x'),{} as never]).map(g=>g.kind)).toEqual(['block','block']);
  });
});

describe('public site helpers',()=>{
  it('recognises slugs whose first segment belongs to an application route',()=>{
    for(const slug of ['api','api/v1','booking','Tools/visit','/portal/x','sitemap.xml','socket.io','_next/static','fonts/a.woff2','opengraph-image'])expect(isReservedSlug(slug),slug).toBe(true);
    for(const slug of ['apixaban','bookings-help','guides/api','home','toString',''])expect(isReservedSlug(slug),slug).toBe(false);
  });
  it('builds dialable phone links and plain addresses',()=>{
    expect(telHref('+44 (0)20 7946-0000')).toBe('tel:+4402079460000');
    expect(publicAddress({address:{streetAddress:'12 Test Street',addressLocality:'Test',postalCode:'T1 1TT'}})).toBe('12 Test Street, Test, T1 1TT');
  });
});

describe('workflow lookups',()=>{
  it('names weekdays Monday first in the clinic language',()=>{
    expect(weekdayNames('en')).toEqual(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
    expect(weekdayNames('fr','short')[0]).toMatch(/^lun/);expect(weekdayNames('not a locale!')[6]).toBe('Sunday');
  });
  it('never treats Object.prototype members as modules or states',()=>{
    expect(allowedWorkflowTargets('toString',{id:'x',version:1,status:'open'})).toEqual([]);
    expect(allowedWorkflowTargets('tasks',{id:'x',version:1,status:'constructor'})).toEqual([]);
  });
});

describe('content security policy coverage',()=>{
  // The matcher source is a valid regular expression on its own; Next adds only prefix/suffix handling around it.
  const proxied=(path:string)=>new RegExp(`^${config.matcher[0]}$`).test(path);
  it('skips only whole excluded segments and files',()=>{
    for(const path of ['/api','/api/v1/records','/_next/static/app.js','/_next/image','/socket.io/x','/sitemaps/pages.xml','/favicon.ico','/sitemap.xml','/robots.txt','/opengraph-image','/opengraph-image-1a2b'])expect(proxied(path),path).toBe(false);
  });
  it('covers CMS pages whose slug merely starts with an excluded word',()=>{
    for(const path of ['/','/apixaban','/apis','/socket.iox','/sitemapsguide','/robots.txt2','/opengraph-imageboard','/guides/api','/workspace','/booking'])expect(proxied(path),path).toBe(true);
  });
});
