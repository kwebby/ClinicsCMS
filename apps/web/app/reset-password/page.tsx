/* Author: ramanpal singh | URL: https://kwebby.com */
import type {Metadata} from 'next';
import {TokenForm} from '@/components/token-form';
export const metadata:Metadata={title:'Reset password',robots:{index:false,follow:false}};
export default function Page(){return <TokenForm mode="reset"/>}
