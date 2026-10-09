/* Author: ramanpal singh | URL: https://kwebby.com */
import {ThemePreviewPage} from '@/components/themes';
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ThemePreviewPage key={id} themeId={id}/>}
