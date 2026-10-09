/* Author: ramanpal singh | URL: https://kwebby.com */
import type {Metadata} from 'next';
import {TokenForm} from '@/components/token-form';
export const metadata:Metadata={title:'Verify email',robots:{index:false,follow:false}};
export default function Page(){return <TokenForm mode="verify"/>}
