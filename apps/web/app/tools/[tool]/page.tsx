/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {getSite,pageMetadata} from '@/lib/public';
import {SiteFrame} from '@/components/public-site';
import {PublicTool} from '@/components/public-forms';
import {toolDefinitions} from '@/lib/tool-definitions';
export const dynamic='force-dynamic';
const definition=(tool:string)=>Object.hasOwn(toolDefinitions,tool)?toolDefinitions[tool]:undefined;
export async function generateMetadata({params}:{params:Promise<{tool:string}>}){const{tool}=await params;const site=await getSite();return pageMetadata({id:tool,version:1,slug:`tools/${tool}`,title:definition(tool)?.title||'Tool',kind:'tool'},site)}
export default async function Page({params}:{params:Promise<{tool:string}>}){const{tool}=await params;const site=await getSite();const def=definition(tool);if(!def||def.audience!==(site.audience==='business'?'business':'patient'))notFound();return <SiteFrame site={site}><section className="public-content public-tool-page"><a className="back-link" href="/tools">All tools</a><h1>{def.title}</h1><p>{def.description}</p><PublicTool tool={tool} services={site.services}/></section></SiteFrame>}
