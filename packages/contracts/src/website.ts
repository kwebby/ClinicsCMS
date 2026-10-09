/* Author: ramanpal singh | URL: https://kwebby.com */
import { z } from 'zod';

// This module is browser-safe: the editor and API use the same bounded content contract.
const id=z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const heading=z.string().trim().max(160), text=z.string().trim().max(4000);
const locale=z.string().max(30).refine(value=>{try{return Intl.getCanonicalLocales(value).length===1}catch{return false}},'Invalid locale');
const timezone=z.string().max(100).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'Invalid timezone');
const httpsUrl=z.string().max(2048).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!/[\x00-\x20\\]/.test(value)}catch{return false}},'Use an HTTPS URL');
export const websiteLinkSchema=z.string().min(1).max(2048).refine(value=>{
 if(/[\x00-\x20\\]/.test(value))return false;
 if(value.startsWith('/')&&!value.startsWith('//')){try{const decoded=decodeURIComponent(value);return !/[\x00-\x20\\]/.test(decoded)&&!decoded.startsWith('//')&&!decoded.split(/[/?#]/).some(part=>part==='.'||part==='..')}catch{return false}}
 if(/^tel:\+?[0-9().-]{3,40}$/.test(value)||/^mailto:[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value))return true;
 return httpsUrl.safeParse(value).success;
},'Use a relative path, HTTPS URL, telephone or email link');
export const websiteImageSchema=z.object({assetId:id,alt:z.string().trim().min(1).max(300),width:z.number().int().min(1).max(40000).optional(),height:z.number().int().min(1).max(40000).optional()}).strict();
export const websiteButtonSchema=z.object({label:z.string().trim().min(1).max(80),href:websiteLinkSchema,style:z.enum(['primary','secondary']).optional()}).strict();
export const SECTION_CATALOG=[
 {type:'hero',label:'Welcome and booking'}, {type:'trust',label:'Credentials and reassurance'},
 {type:'services',label:'Services'}, {type:'about',label:'About the clinic'}, {type:'doctors',label:'Care team'},
 {type:'process',label:'Your visit, step by step'}, {type:'pricing',label:'Fees and payment options'},
 {type:'testimonials',label:'Patient experiences'}, {type:'locations',label:'Locations and opening hours'},
 {type:'faq',label:'Frequently asked questions'}, {type:'resources',label:'Patient resources'},
 {type:'lead-tool',label:'Helpful visit tools'}, {type:'cta',label:'Next step'}
] as const;
export const websiteSectionSchema=z.object({
 id,type:z.enum(['hero','trust','services','about','doctors','process','pricing','testimonials','locations','faq','resources','lead-tool','cta']),
 enabled:z.boolean().default(true),variant:z.enum(['default','split','centered','compact']).default('default'),
 eyebrow:heading.optional(),heading:heading.optional(),text:text.optional(),image:websiteImageSchema.optional(),
 buttons:z.array(websiteButtonSchema).max(2).optional(),
 cards:z.array(z.object({id,eyebrow:heading.optional(),heading:heading.min(1),text:text.optional(),image:websiteImageSchema.optional(),button:websiteButtonSchema.optional()}).strict()).max(12).optional(),
 faqs:z.array(z.object({id,question:heading.min(1),answer:text.min(1)}).strict()).max(20).optional(),
 sourceIds:z.array(id).max(30).optional()
}).strict().superRefine((value,ctx)=>{for(const key of ['cards','faqs'] as const){const entries=value[key]??[];if(new Set(entries.map(entry=>entry.id)).size!==entries.length)ctx.addIssue({code:'custom',path:[key],message:'Item IDs must be unique'});}});
export const FONT_IDS=['system','inter','source-sans-3','manrope','dm-sans','source-serif-4','lora','noto-sans','noto-sans-devanagari','noto-sans-gurmukhi'] as const;
export const DEFAULT_BRANDING={primary:'#18756B',secondary:'#D1E9E3',background:'#FAFBF8',text:'#172B29',muted:'#586E69',headingFont:'system',bodyFont:'system',baseFontSize:16,radius:16,maxWidth:1200} as const;
const color=z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const websiteBrandingSchema=z.object({
 primary:color.default(DEFAULT_BRANDING.primary),secondary:color.default(DEFAULT_BRANDING.secondary),background:color.default(DEFAULT_BRANDING.background),text:color.default(DEFAULT_BRANDING.text),muted:color.default(DEFAULT_BRANDING.muted),
 headingFont:z.enum(FONT_IDS).default('system'),bodyFont:z.enum(FONT_IDS).default('system'),baseFontSize:z.number().int().min(14).max(22).default(16),radius:z.number().min(0).max(32).default(16),maxWidth:z.number().int().min(960).max(1600).default(1200),logo:websiteImageSchema.optional()
}).strict();
const time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Invalid date');
const opening={closed:z.boolean(),opens:time.optional(),closes:time.optional()};
function validOpening(value:{closed:boolean;opens?:string;closes?:string}){return value.closed?value.opens===undefined&&value.closes===undefined:!!value.opens&&!!value.closes&&value.opens<value.closes;}
export const RESERVED_LOCATION_ROUTES=['home','api','_next','workspace','portal','login','register','setup','accept-invite','verify-email','reset-password','booking','tools','services','doctors','contact','locations','sitemaps'] as const;
export function validLocationSlug(slug:string):boolean{return !RESERVED_LOCATION_ROUTES.some(route=>slug===route||(route!=='locations'&&slug.startsWith(`${route}/`)));}
export const websiteLocationSchema=z.object({
 id,branchId:id,name:z.string().trim().min(1).max(160),slug:z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/).max(200).refine(validLocationSlug,'Location URL conflicts with an application route'),primary:z.boolean().default(false),
 phone:z.string().regex(/^\+[1-9]\d{6,14}$/),displayPhone:z.string().trim().max(60).optional(),email:z.email().max(254).optional(),
 address:z.object({streetAddress:z.string().trim().min(1).max(250),addressLocality:z.string().trim().min(1).max(120),addressRegion:z.string().trim().max(120).optional(),postalCode:z.string().trim().min(1).max(30),addressCountry:z.string().regex(/^[A-Z]{2}$/)}).strict(),
 timezone,hours:z.array(z.object({day:z.number().int().min(0).max(6),...opening}).strict().refine(validOpening,'Open days require opening and closing times; closed days must omit times')).max(7).default([]),
 exceptions:z.array(z.object({date,...opening,label:z.string().max(120).optional()}).strict().refine(validOpening,'Open dates require opening and closing times; closed dates must omit times')).max(100).default([]),
 latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),mapsUrl:httpsUrl.optional(),googleBusinessProfileUrl:httpsUrl.optional(),googlePlaceId:z.string().max(200).optional(),
 accessibility:z.string().max(2000).optional(),parking:z.string().max(2000).optional(),image:websiteImageSchema.optional()
}).strict().superRefine((value,ctx)=>{
 if(value.displayPhone&&value.displayPhone.replace(/\D/g,'')!==value.phone.replace(/\D/g,''))ctx.addIssue({code:'custom',path:['displayPhone'],message:'Display phone must contain the same number as the canonical phone'});
 if((value.latitude===undefined)!==(value.longitude===undefined))ctx.addIssue({code:'custom',path:['latitude'],message:'Provide both latitude and longitude'});
 if(new Set(value.hours.map(day=>day.day)).size!==value.hours.length)ctx.addIssue({code:'custom',path:['hours'],message:'Use one opening-hours entry per weekday'});
 if(new Set(value.exceptions.map(day=>day.date)).size!==value.exceptions.length)ctx.addIssue({code:'custom',path:['exceptions'],message:'Use one exception per date'});
});
export const websiteSettingsSchema=z.object({
 siteName:z.string().trim().min(1).max(500),origin:httpsUrl,description:z.string().max(400),locale,
 socialImage:z.string().max(2048).refine(value=>/^\/api\/v1\/public\/assets\/[A-Za-z0-9_-]+$/.test(value)||httpsUrl.safeParse(value).success,'Use an approved public asset or HTTPS image URL').optional(),socialImageAlt:z.string().max(300).optional(),
 socialHandles:z.record(z.string().max(50),z.string().max(500)).default({}),searchConsoleVerification:z.string().max(200).optional(),
 navigation:z.array(z.object({label:z.string().trim().min(1).max(80),href:websiteLinkSchema}).strict()).max(20).default([]),
 homepage:z.object({sections:z.array(websiteSectionSchema).min(1).max(20)}).strict().superRefine((value,ctx)=>{if(new Set(value.sections.map(section=>section.id)).size!==value.sections.length)ctx.addIssue({code:'custom',message:'Section IDs must be unique'});if(value.sections.filter(section=>section.type==='hero'&&section.enabled).length>1)ctx.addIssue({code:'custom',message:'Use one enabled homepage hero'});}).optional(),
 branding:websiteBrandingSchema.optional(),locations:z.array(websiteLocationSchema).max(50).optional(),
 header:z.object({announcement:z.string().max(300).optional(),bookingButton:websiteButtonSchema.optional(),showPortal:z.boolean().optional()}).strict().optional(),
 footer:z.object({text:z.string().max(1000).optional(),copyright:z.string().max(200).optional(),links:z.array(z.object({label:z.string().trim().min(1).max(80),href:websiteLinkSchema}).strict()).max(30).optional()}).strict().optional()
}).strict().superRefine((value,ctx)=>{
 const locations=value.locations??[];
 for(const key of ['id','slug'] as const)if(new Set(locations.map(location=>location[key])).size!==locations.length)ctx.addIssue({code:'custom',path:['locations'],message:`Location ${key} values must be unique`});
 if(locations.length&&locations.filter(location=>location.primary).length!==1)ctx.addIssue({code:'custom',path:['locations'],message:'Choose exactly one primary location'});
 if(new TextEncoder().encode(JSON.stringify(value)).length>200*1024)ctx.addIssue({code:'custom',message:'Website settings exceed the portable 200 KiB budget'});
});
export type WebsiteSettings=z.infer<typeof websiteSettingsSchema>;
export type WebsiteSection=z.infer<typeof websiteSectionSchema>;
export type WebsiteImage=z.infer<typeof websiteImageSchema>;
export type WebsiteButton=z.infer<typeof websiteButtonSchema>;
export type WebsiteLocation=z.infer<typeof websiteLocationSchema>;
export type WebsiteBranding=z.infer<typeof websiteBrandingSchema>;
export function defaultHomepageSections():WebsiteSection[]{return [
 {id:'welcome',type:'hero',heading:'Personal care, close to home.',text:'Find the right care and take the next step with our clinic.',buttons:[{label:'Book a visit',href:'/booking',style:'primary'},{label:'Explore our services',href:'/services',style:'secondary'}]},
 {id:'services',type:'services',heading:'Care at our clinic'},
 {id:'about',type:'about',heading:'Care built around you',enabled:false},
 {id:'team',type:'doctors',heading:'Meet your care team'},
 {id:'experiences',type:'testimonials',heading:'Patient experiences',enabled:false},
 {id:'fees',type:'pricing',heading:'Fees and payment options',enabled:false},
 {id:'locations',type:'locations',heading:'Find us and plan your visit'},
 {id:'questions',type:'faq',heading:'Before your visit',enabled:false},
 {id:'next-step',type:'cta',heading:'Ready to arrange a visit?',buttons:[{label:'Request an appointment',href:'/booking',style:'primary'}]}
].map(section=>websiteSectionSchema.parse(section));}
export function websiteAssetIds(value:WebsiteSettings):string[]{
 const ids=new Set<string>();const add=(image?:WebsiteImage)=>{if(image)ids.add(image.assetId)};
 add(value.branding?.logo);for(const location of value.locations??[])add(location.image);
 for(const section of value.homepage?.sections??[]){add(section.image);for(const card of section.cards??[])add(card.image)}
 if(value.socialImage?.startsWith('/api/v1/public/assets/'))ids.add(value.socialImage.split('/').pop()!);
 return [...ids];
}
