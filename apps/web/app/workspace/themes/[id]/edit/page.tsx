/* Author: ramanpal singh | URL: https://kwebby.com */
import {ThemeDesignerPage} from '@/components/themes';
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;return <ThemeDesignerPage key={id} themeId={id}/>}
