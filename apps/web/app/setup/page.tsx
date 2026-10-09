/* Author: ramanpal singh | URL: https://kwebby.com */
import type {Metadata} from 'next';
import {AuthForm} from '@/components/auth';
export const metadata:Metadata={title:'Set up your clinic',robots:{index:false,follow:false}};
export default function Page(){return <AuthForm mode="setup"/>}
