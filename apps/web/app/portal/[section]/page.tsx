/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {Portal} from '@/components/portal';
export default async function Page({params}:{params:Promise<{section:string}>}){const{section}=await params;if(!['appointments','documents','invoices','results','conversations','notifications','preferences'].includes(section))notFound();return <Portal key={section} section={section}/>}
