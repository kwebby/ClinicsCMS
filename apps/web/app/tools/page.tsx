/* Author: ramanpal singh | URL: https://kwebby.com */
import Link from 'next/link';
import {getSite,pageMetadata} from '@/lib/public';
import {SiteFrame} from '@/components/public-site';
import {toolDefinitions} from '@/lib/tool-definitions';
export const dynamic='force-dynamic';
export async function generateMetadata(){const site=await getSite();return pageMetadata({id:'tools',version:1,slug:'tools',title:site.audience==='business'?'Clinic operations tools':'Prepare for your visit',kind:'directory'},site)}
export default async function Page(){const site=await getSite();const business=site.audience==='business';return <SiteFrame site={site}><section className="public-content"><h1>{business?'Small insights. Better clinic decisions.':'A little preparation goes a long way.'}</h1><p>{business?'Practical tools to understand your clinic’s time, capacity, and patient experience.':'Simple tools to help you organize your visit and the questions you want to ask.'}</p><div className="public-tool-grid">{Object.entries(toolDefinitions).filter(([,d])=>d.audience===(business?'business':'patient')).map(([id,d])=><Link href={`/tools/${id}`} key={id}><span>＋</span><h2>{d.title}</h2><p>{d.description}</p><strong>Open tool</strong></Link>)}</div></section></SiteFrame>}
