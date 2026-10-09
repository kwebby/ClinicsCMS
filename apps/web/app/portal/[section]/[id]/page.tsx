/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {PortalRecordPage} from '@/components/portal';
export default async function Page({params}:{params:Promise<{section:string;id:string}>}){const{section,id}=await params;if(!['appointments','documents','invoices','results','notifications'].includes(section))notFound();return <PortalRecordPage key={`${section}:${id}`} section={section} id={id}/>}
