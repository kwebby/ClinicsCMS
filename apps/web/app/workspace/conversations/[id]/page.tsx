/* Author: ramanpal singh | URL: https://kwebby.com */
import {Chat} from '@/components/chat';
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <Chat conversationId={id}/>}
