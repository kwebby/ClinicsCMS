/* Author: ramanpal singh | URL: https://kwebby.com */
import {headers} from 'next/headers';
import type {Metadata,Viewport} from 'next';
import {SessionProvider} from '@/components/session';
import './globals.css';
export const metadata:Metadata={metadataBase:new URL(process.env.PUBLIC_APP_URL||'http://localhost:3000'),title:{default:'ClinicsCMS',template:'%s | ClinicsCMS'},description:'ClinicsCMS brings clinic care, people, and operations into one workspace.'};
export const viewport:Viewport={width:'device-width',initialScale:1,themeColor:'#25645d'};
export default async function RootLayout({children}:{children:React.ReactNode}){await headers();return <html lang="en"><body><SessionProvider>{children}</SessionProvider></body></html>}
