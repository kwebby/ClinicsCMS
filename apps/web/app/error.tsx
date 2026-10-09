/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
export default function Error({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main className="site-unavailable"><h1>This page couldn’t be loaded.</h1><p>Your saved records are safe. Please try loading the page again.</p><button className="button primary" onClick={reset}>Try again</button></main>}
