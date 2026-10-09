/* Author: ramanpal singh | URL: https://kwebby.com */
import {getSiteOrFallback} from '@/lib/public';
export const dynamic='force-dynamic';
export async function GET(){const site=await getSiteOrFallback();if(site.unavailable)return new Response('Website unavailable',{status:503});const url=new URL('/sitemaps/pages.xml',site.url).href.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');return new Response(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${url}</loc></sitemap></sitemapindex>`,{headers:{'Content-Type':'application/xml; charset=utf-8'}})}
