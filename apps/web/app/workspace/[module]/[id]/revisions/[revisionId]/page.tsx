/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {isModule} from '@/lib/modules';
import {RecordRevisionPage} from '@/components/record-pages';
export default async function Page({params}:{params:Promise<{module:string;id:string;revisionId:string;}>}){const {module,id,revisionId}=await params;if(!isModule(module))notFound();return <RecordRevisionPage module={module} id={id} revisionId={revisionId}/>}
