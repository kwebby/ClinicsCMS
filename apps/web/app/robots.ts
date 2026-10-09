/* Author: ramanpal singh | URL: https://kwebby.com */
import type {MetadataRoute} from 'next';
import {getSite} from '@/lib/public';
export const dynamic='force-dynamic';
export default async function robots():Promise<MetadataRoute.Robots>{const site=await getSite();return{rules:{userAgent:'*',allow:'/',disallow:['/workspace','/portal','/login','/register','/setup','/accept-invite','/verify-email','/reset-password','/api/']},sitemap:new URL('/sitemap.xml',site.url).href}}
