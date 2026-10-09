/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {isModule} from '@/lib/modules';
import {RecordDetailPage} from '@/components/record-pages';
export default async function Page({params}:{params:Promise<{module:string;id:string;}>}){const {module,id}=await params;if(!isModule(module))notFound();return <RecordDetailPage module={module} id={id}/>}
