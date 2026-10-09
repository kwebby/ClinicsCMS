/* Author: ramanpal singh | URL: https://kwebby.com */
import {headers} from 'next/headers';
import {getSite,publicApi,pageMetadata,schemaScript} from '@/lib/public';
import type {RecordData} from '@/lib/types';
import {PublicHome,SiteFrame} from '@/components/public-site';
export const dynamic='force-dynamic';
async function home(){try{return await publicApi<RecordData>('/pages/home')}catch{return undefined}}
export async function generateMetadata(){const[site,page]=await Promise.all([getSite(),home()]);return pageMetadata(page||{id:'home',version:1,slug:'home',title:site.name,kind:'home'},site)}
export default async function Page(){const[site,page,h]=await Promise.all([getSite(),home(),headers()]);return <SiteFrame site={site}>{!site.unavailable&&<script type="application/ld+json" nonce={h.get('x-nonce')||undefined} dangerouslySetInnerHTML={{__html:schemaScript(page||{id:'home',version:1,slug:'home',title:site.name,kind:'home'},site)}}/>}<PublicHome site={site} page={page}/></SiteFrame>}
