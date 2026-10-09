/* Author: ramanpal singh | URL: https://kwebby.com */
import type {Metadata} from 'next';
import {Workspace} from '@/components/workspace';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Workspace',robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){return <Workspace>{children}</Workspace>}
