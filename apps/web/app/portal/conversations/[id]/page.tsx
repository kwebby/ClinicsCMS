/* Author: ramanpal singh | URL: https://kwebby.com */
import {Chat} from '@/components/chat';
import Link from 'next/link';
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <><Link className="page-back" href="/portal">← My care</Link><Chat conversationId={id} basePath="/portal/conversations"/></>}
