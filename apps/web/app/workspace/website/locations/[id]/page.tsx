/* Author: ramanpal singh | URL: https://kwebby.com */
import {LocationEditor} from '@/components/website-location-settings';
export default async function Page({params}:{params:Promise<{id:string}>}){const {id}=await params;return <LocationEditor id={id}/>}
