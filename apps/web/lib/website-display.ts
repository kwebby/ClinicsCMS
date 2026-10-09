/* Author: ramanpal singh | URL: https://kwebby.com */
import type {CSSProperties} from 'react';
import {DEFAULT_BRANDING,type WebsiteBranding,type WebsiteLocation} from '../../../packages/contracts/src/website';

export const FONT_LIBRARY=[
 {id:'system',name:'System default',category:'Sans serif',script:'System'},
 {id:'inter',name:'Inter',category:'Sans serif',script:'Latin'},
 {id:'source-sans-3',name:'Source Sans 3',category:'Sans serif',script:'Latin'},
 {id:'manrope',name:'Manrope',category:'Sans serif',script:'Latin'},
 {id:'dm-sans',name:'DM Sans',category:'Sans serif',script:'Latin'},
 {id:'source-serif-4',name:'Source Serif 4',category:'Serif',script:'Latin'},
 {id:'lora',name:'Lora',category:'Serif',script:'Latin'},
 {id:'noto-sans',name:'Noto Sans',category:'Sans serif',script:'Latin'},
 {id:'noto-sans-devanagari',name:'Noto Sans Devanagari',category:'Sans serif',script:'Devanagari'},
 {id:'noto-sans-gurmukhi',name:'Noto Sans Gurmukhi',category:'Sans serif',script:'Gurmukhi'},
] as const;
export function fontFamily(id:string){const font=FONT_LIBRARY.find(f=>f.id===id);return !font||id==='system'?'"Avenir Next", "Segoe UI", Arial, sans-serif':`"${font.name}", ${font.category==='Serif'?'Georgia, serif':'Arial, sans-serif'}`;}
export function websiteStyle(branding?:WebsiteBranding):CSSProperties{const b=branding??DEFAULT_BRANDING;return {'--site-primary':b.primary,'--site-secondary':b.secondary,'--site-background':b.background,'--site-text':b.text,'--site-muted':b.muted,'--site-radius':`${b.radius}px`,'--site-width':`${b.maxWidth}px`,'--site-heading-font':fontFamily(b.headingFont),fontSize:b.baseFontSize,fontFamily:fontFamily(b.bodyFont)} as CSSProperties;}
export const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export function locationAddress(location:WebsiteLocation){const a=location.address;return [a.streetAddress,a.addressLocality,a.addressRegion,a.postalCode,a.addressCountry].filter(Boolean).join(', ');}
export function addressText(address?:string|Record<string,string>){if(typeof address==='string')return address;return address?[address.streetAddress,address.addressLocality,address.addressRegion,address.postalCode,address.addressCountry].filter(Boolean).join(', '):'';}
export function contrastRatio(a:string,b:string){const lum=(hex:string)=>{const values=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722};const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
