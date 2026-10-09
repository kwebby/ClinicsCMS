/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {modules} from '@/lib/modules';
import {RecordActionPage} from '@/components/record-pages';
export default async function Page({params}:{params:Promise<{module:string;id:string;actionName:string;}>}){const {module,id,actionName}=await params;if(!modules[module])notFound();return <RecordActionPage module={module} id={id} actionName={actionName}/>}
