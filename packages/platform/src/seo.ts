/* Author: ramanpal singh | URL: https://kwebby.com */
import type { WebsiteLocation } from '../../contracts/src/website.js';
import { assert } from '../../contracts/src/index.js';
import { escapeHtml, safeUrl } from './common.js';

export type SeoPageType='home'|'branch'|'doctor'|'service'|'medical'|'article'|'faq'|'about'|'contact'|'directory'|'tool'|'software'|'page';
export interface SiteIdentity {url:string;name:string;description:string;locale?:string;address?:Record<string,string>;telephone?:string;logo?:string;defaultSocialImage?:string;socialHandle?:string;socialProfiles?:string[];country?:string;locations?:WebsiteLocation[];}
export interface SeoPage {
 location?:WebsiteLocation; id?:string; slug:string; title:string; description?:string; type?:SeoPageType;status?:string;indexable?:boolean;locale?:string;seoTitle?:string;seoDescription?:string;canonical?:string;
 socialImage?:string;socialImageAlt?:string;socialTitle?:string;socialDescription?:string;publishedAt?:string;updatedAt?:string;author?:{name:string;url?:string};reviewer?:{name:string;url?:string};reviewedAt?:string;citations?:string[];
 translations?:{locale:string;slug:string;published:boolean;reciprocal?:boolean}[];faq?:{question:string;answer:string}[];price?:number;currency?:string;doctor?:{name:string;credentials?:string;specialty?:string};items?:{name:string;slug:string}[];customSchema?:Record<string,unknown>;schemaTypes?:string[];breadcrumbs?:{name:string;slug:string}[];
}
export function canonicalFor(slug:string,site:SiteIdentity):string {
 const origin=new URL(site.url);assert(['https:','http:'].includes(origin.protocol)&&!origin.username&&!origin.password,'SITE_URL','Site URL must be an HTTP(S) origin');
 assert(!/[\\?#\x00-\x20]/.test(slug)&&!slug.startsWith('//')&&!slug.split('/').some(p=>p==='.'||p==='..'),'PAGE_SLUG','Invalid page slug');
 return new URL(slug==='home'||slug===''||slug==='/'?'/':`/${slug.replace(/^\/+|\/+$/g,'')}`,origin.origin).href;
}
function imageUrl(value:unknown,site:SiteIdentity):string {const candidate=safeUrl(value);if(candidate)return new URL(candidate,new URL(site.url).origin).href;return new URL('/opengraph-image',new URL(site.url).origin).href;}
function validateCustomSchema(value:Record<string,unknown>):Record<string,unknown> {
 const serialized=JSON.stringify(value);assert(serialized.length<=32768,'SCHEMA_SIZE','Custom schema is too large');
 assert(value['@context']==='https://schema.org' || value['@context']===undefined,'SCHEMA_CONTEXT','Only schema.org context is supported');
 const visit=(data:unknown,depth:number)=>{assert(depth<=12,'SCHEMA_DEPTH','Custom schema nesting is too deep');if(Array.isArray(data)){assert(data.length<=200,'SCHEMA_SIZE','Too many schema items');data.forEach(item=>visit(item,depth+1));}else if(data&&typeof data==='object'){for(const [key,item]of Object.entries(data)){assert(!['__proto__','constructor','prototype'].includes(key),'SCHEMA_KEY','Invalid schema property');if(key==='@context')assert(item==='https://schema.org','SCHEMA_CONTEXT','Only schema.org context is supported');visit(item,depth+1);}}};visit(value,0);
 assert(typeof value['@type']==='string'||Array.isArray(value['@graph']),'SCHEMA_TYPE','Custom schema requires a type or graph');return {'@context':'https://schema.org',...value};
}
export function locationSchema(location:WebsiteLocation,site:SiteIdentity):Record<string,unknown>{
 const url=canonicalFor(location.slug,site),days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
 return {'@type':'MedicalClinic','@id':`${url}#clinic`,url,name:location.name,telephone:location.phone,address:{'@type':'PostalAddress',...location.address},branchOf:{'@id':new URL('/#clinic',site.url).href},
  ...(location.email?{email:location.email}:{}),...(location.mapsUrl?{hasMap:location.mapsUrl}:{}),...(location.googleBusinessProfileUrl?{sameAs:[location.googleBusinessProfileUrl]}:{}),
  ...(location.latitude!==undefined&&location.longitude!==undefined?{geo:{'@type':'GeoCoordinates',latitude:location.latitude,longitude:location.longitude}}:{}),
  ...(location.hours.length?{openingHoursSpecification:location.hours.filter(day=>!day.closed).map(day=>({'@type':'OpeningHoursSpecification',dayOfWeek:`https://schema.org/${days[day.day]}`,opens:day.opens,closes:day.closes}))}:{}),
  ...(location.exceptions.length?{specialOpeningHoursSpecification:location.exceptions.map(day=>({'@type':'OpeningHoursSpecification',validFrom:day.date,validThrough:day.date,opens:day.closed?'00:00':day.opens,closes:day.closed?'00:00':day.closes}))}:{})};
}
export function buildSeo(page:SeoPage,site:SiteIdentity) {
 const canonicalDefault=canonicalFor(page.slug,site);let canonical=canonicalDefault;
 if(page.canonical){const requested=safeUrl(page.canonical);assert(requested,'CANONICAL_URL','Invalid canonical URL');const candidate=new URL(requested,new URL(site.url).origin);assert(candidate.origin===new URL(site.url).origin&&!candidate.search&&!candidate.hash,'CANONICAL_URL','Canonical must be a local URL without query or fragment');canonical=candidate.href;}
 const title=(page.seoTitle??page.title).slice(0,160),description=(page.seoDescription??page.description??site.description).slice(0,320),image=imageUrl(page.socialImage??site.defaultSocialImage,site),locale=page.locale??site.locale??'en';
 const publicPage=(page.status===undefined||page.status==='published')&&page.indexable!==false;
 const clinicId=new URL('/#clinic',site.url).href;
 const location=page.location??site.locations?.find(candidate=>candidate.slug===page.slug);
 const branch=location?locationSchema(location,site):undefined;
 const clinic={'@type':'MedicalClinic','@id':clinicId,name:site.name,url:new URL('/',site.url).href,...(site.telephone?{telephone:site.telephone}:{}),...(site.address?{address:{'@type':'PostalAddress',...site.address}}:{}),...(site.logo?{logo:imageUrl(site.logo,site)}:{}),...(site.socialProfiles?.length?{sameAs:site.socialProfiles.filter(url=>!!safeUrl(url,false))}:{})};
 const base={'@id':`${canonical}#page`,url:canonical,name:page.title,description,inLanguage:locale,isPartOf:{'@id':new URL('/#website',site.url).href}};
 const author=page.author?{'@type':'Person',name:page.author.name,...(safeUrl(page.author.url)?{url:page.author.url}:{})}:undefined;
 const published=page.publishedAt&&!Number.isNaN(Date.parse(page.publishedAt))?page.publishedAt:undefined,modified=page.updatedAt&&!Number.isNaN(Date.parse(page.updatedAt))?page.updatedAt:undefined;
 let node:Record<string,unknown>={'@type':'WebPage',...base};
 const graph:Record<string,unknown>[]=[];
 switch(page.type??'page') {
  case 'home':graph.push(clinic,{'@type':'WebSite','@id':new URL('/#website',site.url).href,name:site.name,url:new URL('/',site.url).href,publisher:{'@id':clinicId}});break;
  case 'branch':node=branch?{...base,...branch,mainEntityOfPage:{'@id':base['@id']}}:{...clinic,...base,'@type':'MedicalClinic'};break;
  case 'doctor':node={...base,'@type':['Person','IndividualPhysician'],name:page.doctor?.name??page.title,worksFor:{'@id':clinicId},...(page.doctor?.credentials?{hasCredential:page.doctor.credentials}:{}),...(page.doctor?.specialty?{medicalSpecialty:page.doctor.specialty}:{})};break;
  case 'service':node={...base,'@type':'Service',provider:{'@id':clinicId},...(typeof page.price==='number'&&Number.isFinite(page.price)&&page.price>=0&&/^[A-Z]{3}$/.test(page.currency??'')?{offers:{'@type':'Offer',price:page.price,priceCurrency:page.currency,url:canonical}}:{})};break;
  case 'medical':node={...base,'@type':'MedicalWebPage',...(author?{author}:{}),...(page.reviewer?{reviewedBy:{'@type':'Person',name:page.reviewer.name}}:{}),...(page.reviewedAt?{lastReviewed:page.reviewedAt}:{}),...(page.citations?.length?{citation:page.citations.filter(url=>!!safeUrl(url,false))}:{})};break;
  case 'article':node={...base,'@type':'Article',headline:page.title,...(author?{author}:{}),...(published?{datePublished:published}:{}),...(modified?{dateModified:modified}:{}),publisher:{'@id':clinicId},image};break;
  case 'faq':if(page.faq?.length)node={...base,'@type':'FAQPage',mainEntity:page.faq.slice(0,100).map(item=>({'@type':'Question',name:item.question,acceptedAnswer:{'@type':'Answer',text:item.answer}}))};break;
  case 'about':node={...base,'@type':'AboutPage',about:{'@id':clinicId}};break;
  case 'contact':node={...base,'@type':'ContactPage',about:{'@id':clinicId}};break;
  case 'directory':node={...base,'@type':'CollectionPage',mainEntity:{'@type':'ItemList',itemListElement:(page.items??[]).map((item,index)=>({'@type':'ListItem',position:index+1,name:item.name,url:canonicalFor(item.slug,site)}))}};break;
  case 'tool':node={...base,'@type':'WebApplication',applicationCategory:'HealthApplication',operatingSystem:'Web browser'};break;
  case 'software':node={...base,'@type':'SoftwareApplication',applicationCategory:'BusinessApplication',operatingSystem:'Web browser'};break;
 }
 graph.push(node);
 const schemaWarnings:string[]=[];
 let selectedGraph=graph;
 if(page.schemaTypes!==undefined){
  assert(Array.isArray(page.schemaTypes)&&page.schemaTypes.length<=10,'SCHEMA_TYPES','Choose up to ten schema types');
  const allowed:Record<SeoPageType,string[]>={home:['WebSite','WebPage','MedicalClinic','Organization'],branch:['WebPage','MedicalClinic'],doctor:['WebPage','Person','IndividualPhysician'],service:['WebPage','Service','Offer'],medical:['WebPage','MedicalWebPage','Article'],article:['WebPage','Article','BlogPosting'],faq:['WebPage','FAQPage'],about:['WebPage','AboutPage'],contact:['WebPage','ContactPage'],directory:['WebPage','CollectionPage','ItemList'],tool:['WebPage','WebApplication'],software:['WebPage','SoftwareApplication','Organization','WebSite'],page:['WebPage']};
  const selected=[...new Set(page.schemaTypes)].filter(type=>{const permitted=allowed[page.type??'page'].includes(type)||type==='BreadcrumbList';if(!permitted)schemaWarnings.push(`${type} is not applicable to this page type`);return permitted;});
  selectedGraph=[];
  const specialized=selected.filter(type=>!['WebSite','WebPage','MedicalClinic','Organization','Offer','ItemList','BreadcrumbList'].includes(type));
  if(specialized.includes('FAQPage')&&!(page.faq?.length)){specialized.splice(specialized.indexOf('FAQPage'),1);schemaWarnings.push('FAQPage requires visible questions and answers');}
  if(specialized.length){const next={...node,'@type':specialized.length===1?specialized[0]:specialized};if(page.type==='service'&&!selected.includes('Offer'))delete (next as Record<string,unknown>).offers;selectedGraph.push(next);}
  else if(selected.includes('WebPage'))selectedGraph.push({'@type':'WebPage',...base});
  if(selected.includes('MedicalClinic'))selectedGraph.push(page.type==='branch'?node:clinic);
  if(selected.includes('Organization'))selectedGraph.push({'@type':'Organization','@id':new URL('/#organization',site.url).href,name:site.name,url:new URL('/',site.url).href});
  if(selected.includes('WebSite'))selectedGraph.push({'@type':'WebSite','@id':new URL('/#website',site.url).href,name:site.name,url:new URL('/',site.url).href});
  if(selected.includes('Offer')&&!node.offers)schemaWarnings.push('Offer requires a visible nonnegative price and currency');
  if(selected.includes('Offer')&&node.offers&&!specialized.includes('Service'))selectedGraph.push({...node.offers as object,'@id':`${canonical}#offer`});
  if(selected.includes('ItemList')&&page.items?.length&&!specialized.includes('CollectionPage'))selectedGraph.push({...node.mainEntity as object,'@id':`${canonical}#list`});
  if(selected.includes('ItemList')&&!page.items?.length)schemaWarnings.push('ItemList requires visible items');
  if(selected.includes('BreadcrumbList')){if(page.breadcrumbs?.length)selectedGraph.push({'@type':'BreadcrumbList',itemListElement:page.breadcrumbs.map((crumb,index)=>({'@type':'ListItem',position:index+1,name:crumb.name,item:canonicalFor(crumb.slug,site)}))});else schemaWarnings.push('BreadcrumbList requires visible navigation breadcrumbs');}
 }
 const jsonLd=page.customSchema?validateCustomSchema(page.customSchema):{'@context':'https://schema.org','@graph':selectedGraph};
 const alternates:Record<string,string>={[locale]:canonical};
 for(const translation of page.translations??[])if(translation.published&&translation.reciprocal&&/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(translation.locale))alternates[translation.locale]=canonicalFor(translation.slug,site);
 return {title,description,canonical,schemaWarnings,robots:{index:publicPage,follow:publicPage},alternates:{canonical,languages:alternates},openGraph:{title:page.socialTitle??title,description:page.socialDescription??description,url:canonical,siteName:site.name,type:page.type==='article'?'article':'website',locale:locale.replace('-','_'),images:[{url:image,width:1200,height:630,alt:page.socialImageAlt??`${page.title} — ${site.name}`}]},twitter:{card:'summary_large_image',title:page.socialTitle??title,description:page.socialDescription??description,images:[image],...(site.socialHandle&&/^@[A-Za-z0-9_]{1,15}$/.test(site.socialHandle)?{site:site.socialHandle}:{})},jsonLd};
}
export function jsonLdScript(value:unknown):string {return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
export function buildSitemap(pages:SeoPage[],site:SiteIdentity):string {
 const urls=pages.filter(page=>page.status==='published'&&page.indexable!==false).flatMap(page=>{const seo=buildSeo(page,site);if(seo.canonical!==canonicalFor(page.slug,site))return[];return [`<url><loc>${escapeHtml(seo.canonical)}</loc>${page.updatedAt&&!Number.isNaN(Date.parse(page.updatedAt))?`<lastmod>${new Date(page.updatedAt).toISOString()}</lastmod>`:''}${Object.entries(seo.alternates.languages).map(([lang,url])=>`<xhtml:link rel="alternate" hreflang="${escapeHtml(lang)}" href="${escapeHtml(url)}"/>`).join('')}</url>`];});
 return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>`;
}
