/* Author: ramanpal singh | URL: https://kwebby.com */
import {HomepageSectionSettings} from '@/components/website-editor-pages';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <HomepageSectionSettings id={id}/>}
