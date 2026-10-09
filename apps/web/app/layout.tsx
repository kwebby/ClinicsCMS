/* Author: ramanpal singh | URL: https://kwebby.com */
import {headers} from 'next/headers';
import type {Metadata,Viewport} from 'next';
import {SessionProvider} from '@/components/session';
import {getSiteOrFallback,htmlLang,siteLocalization} from '@/lib/public';
import './globals.css';
export const metadata:Metadata={metadataBase:new URL(process.env.PUBLIC_APP_URL||'http://localhost:3000'),title:{default:'ClinicsCMS',template:'%s | ClinicsCMS'},description:'ClinicsCMS brings clinic care, people, and operations into one workspace.'};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#25645d'};
// The site request is shared with the page render, so clinic time and language are right from the first paint.
export default async function RootLayout({children}:{children:React.ReactNode}){await headers();const site=await getSiteOrFallback();return <html lang={htmlLang(site)}><body><SessionProvider localization={siteLocalization(site)}>{children}</SessionProvider></body></html>}
