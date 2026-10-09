/* Author: ramanpal singh | URL: https://kwebby.com */
import {notFound} from 'next/navigation';
import {modules} from '@/lib/modules';
import {RecordWorkspace} from '@/components/record-workspace';
import {Chat} from '@/components/chat';
import {Themes} from '@/components/themes';
import {Settings} from '@/components/settings';
export default async function Page({params}:{params:Promise<{module:string}>}){const {module}=await params;if(module==='themes')return <Themes/>;if(module==='settings')return <Settings/>;if(module==='conversations')return <Chat/>;if(!modules[module])notFound();return <RecordWorkspace module={module}/>}
