/* Author: ramanpal singh | URL: https://kwebby.com */
import {getSiteOrFallback,identity,seoPage,locationPage} from '@/lib/public';
import {isReservedSlug} from '@/lib/website-display';
import {toolDefinitions} from '@/lib/tool-definitions';
import {buildSitemap} from '../../../../../packages/platform/src/seo';
import type {RecordData} from '@/lib/types';
export const dynamic='force-dynamic';
export async function GET(){const site=await getSiteOrFallback();if(site.unavailable)return new Response('Website unavailable',{status:503});// Pages created before reserved slugs were rejected are shadowed by application routes; never list them.
const pages=[...site.pages,...(site.locations??[]).map(locationPage)].filter(p=>!isReservedSlug(p.slug));const basic=['home','services','doctors','contact','booking','tools',...Object.entries(toolDefinitions).filter(([,d])=>d.audience===(site.audience==='business'?'business':'patient')).map(([slug])=>`tools/${slug}`)];for(const slug of basic)if(!pages.some(p=>p.slug===slug))pages.push({id:slug,version:1,slug,title:slug==='home'?site.name:slug,kind:slug==='home'?'home':'page',status:'published'} as RecordData);return new Response(buildSitemap(pages.map(p=>seoPage(p,site)),identity(site)),{headers:{'Content-Type':'application/xml; charset=utf-8'}})}
