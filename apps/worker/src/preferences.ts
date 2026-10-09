/* Author: ramanpal singh | URL: https://kwebby.com */
export const notificationCategories=['security','operations','clinical','finance','hr','messages','appointments','content'];
export interface DeliveryPreferences {categories:string[];email:boolean;inApp:boolean;quietStart?:string;quietEnd?:string;timezone:string;}
export function deliveryPreferences(value:unknown,defaults:unknown):DeliveryPreferences {
 const preference=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const clinic=defaults&&typeof defaults==='object'?defaults as Record<string,unknown>:{};
 return {categories:Array.isArray(preference.categories)?preference.categories.filter((value):value is string=>typeof value==='string'&&notificationCategories.includes(value)):notificationCategories,email:typeof preference.email==='boolean'?preference.email:clinic.defaultEmail===true,inApp:preference.inApp!==false,quietStart:typeof preference.quietStart==='string'?preference.quietStart:typeof clinic.quietStart==='string'?clinic.quietStart:undefined,quietEnd:typeof preference.quietEnd==='string'?preference.quietEnd:typeof clinic.quietEnd==='string'?clinic.quietEnd:undefined,timezone:String(preference.timezone??clinic.timezone??'UTC')};
}
/** Find the first real instant outside the quiet interval, including missing/repeated DST clock hours. */
export function nextDeliveryTime(now:Date,preferences:DeliveryPreferences):Date {
 const {quietStart,quietEnd,timezone}=preferences;
 if(!quietStart||!quietEnd||quietStart===quietEnd||!/^\d{2}:\d{2}$/.test(quietStart)||!/^\d{2}:\d{2}$/.test(quietEnd))return now;
 const minutes=(value:string)=>Number(value.slice(0,2))*60+Number(value.slice(3));const start=minutes(quietStart),end=minutes(quietEnd);
 if(start>=1440||end>=1440)return now;
 const formatter=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const quiet=(value:Date)=>{const parts=Object.fromEntries(formatter.formatToParts(value).map(item=>[item.type,item.value]));const minute=Number(parts.hour)*60+Number(parts.minute);return start<end?minute>=start&&minute<end:minute>=start||minute<end;};
 if(!quiet(now))return now;
 for(let offset=1;offset<=26*60;offset++){const candidate=new Date(Math.floor(now.getTime()/60000)*60000+offset*60000);if(!quiet(candidate))return candidate;}
 throw new Error('Quiet-hour end could not be resolved');
}
