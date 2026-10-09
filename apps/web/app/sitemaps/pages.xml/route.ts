/* Author: ramanpal singh | URL: https://kwebby.com */
import {getSite,identity,seoPage,locationPage} from '@/lib/public';
import {toolDefinitions} from '@/lib/tool-definitions';
import {buildSitemap} from '../../../../../packages/platform/src/seo';
import type {RecordData} from '@/lib/types';
export const dynamic='force-dynamic';
export async function GET(){const site=await getSite();if(site.unavailable)return new Response('Website unavailable',{status:503});const pages=[...site.pages,...(site.locations??[]).map(locationPage)];const basic=['home','services','doctors','contact','booking','tools',...Object.entries(toolDefinitions).filter(([,d])=>d.audience===(site.audience==='business'?'business':'patient')).map(([slug])=>`tools/${slug}`)];for(const slug of basic)if(!pages.some(p=>p.slug===slug))pages.push({id:slug,version:1,slug,title:slug==='home'?site.name:slug,kind:slug==='home'?'home':'page',status:'published'} as RecordData);return new Response(buildSitemap(pages.map(p=>seoPage(p,site)),identity(site)),{headers:{'Content-Type':'application/xml; charset=utf-8'}})}
