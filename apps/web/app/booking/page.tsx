/* Author: ramanpal singh | URL: https://kwebby.com */
import {Suspense} from 'react';
import {getSite,pageMetadata} from '@/lib/public';
import {SiteFrame} from '@/components/public-site';
import {BookingForm} from '@/components/public-forms';
export const dynamic='force-dynamic';
export async function generateMetadata(){const site=await getSite();return pageMetadata({id:'booking',version:1,title:'Request an appointment',slug:'booking',kind:'page'},site)}
export default async function Page(){const site=await getSite();return <SiteFrame site={site}><section className="public-content booking-page"><div><h1>Let’s find a time for you.</h1><p>Tell us a little about your visit. Our team will get back to you to confirm an appointment.</p></div><Suspense fallback={<p>Loading appointment request…</p>}><BookingForm doctors={site.doctors} services={site.services} locations={site.locations}/></Suspense></section></SiteFrame>}
