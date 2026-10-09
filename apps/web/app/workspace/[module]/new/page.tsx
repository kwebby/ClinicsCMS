/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {isModule} from '@/lib/modules';
import {RecordEditorPage} from '@/components/record-pages';
export default async function Page({params}:{params:Promise<{module:string;}>}){const {module}=await params;if(!isModule(module))notFound();return <RecordEditorPage module={module}/>}
