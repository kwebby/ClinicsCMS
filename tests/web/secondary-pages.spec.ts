/* Author: ramanpal singh | URL: https://kwebby.com */
import { test, expect, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {paceApiRequests} from './network-pacing.js';

type DemoAccess={password:string;accounts:{name:string;email:string;roles:string[]}[]};
const fixture=resolve(process.env.DEMO_ACCESS_FILE||'.runtime/demo-access.json');
const access:DemoAccess|null=existsSync(fixture)?JSON.parse(readFileSync(fixture,'utf8')):null;
async function login(page:Page,role='owner'){
 if(!access)throw new Error('Seed the isolated fictional installation before running these tests.');
 const account=access.accounts.find(person=>person.roles.includes(role));
 if(!account)throw new Error(`Fictional ${role} account is missing.`);
 await page.goto('/login');
 await page.getByLabel('Email address',{exact:true}).fill(account.email);
 await page.getByLabel('Password',{exact:true}).fill(access.password);
 const signedIn=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/auth/login'));
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const response=await signedIn;expect(response.ok(),`Fictional ${role} sign-in returned HTTP ${response.status()}`).toBeTruthy();
 await page.waitForURL(role==='patient'?'**/portal':'**/workspace');
}
const noPopup=(page:Page)=>expect(page.locator('dialog:modal,[role="dialog"]')).toHaveCount(0);
async function mobile(page:Page,path:string){
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
 await expect(page.getByRole('navigation',{name:'Workspace navigation',exact:true})).not.toBeInViewport();
 await page.screenshot({path,fullPage:true,animations:'disabled'});
 await page.setViewportSize({width:1440,height:1050});
}
test.beforeEach(async({context})=>{test.skip(!access,'Seed a disposable fictional installation; local credentials remain private.');await paceApiRequests(context)});

test('themes use dedicated designer, preview, customize and scanned upload pages',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>{errors.push(`Unexpected ${dialog.type()} dialog`);void dialog.dismiss()});
 await login(page);page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});await page.goto('/workspace/themes');
 await page.getByRole('link',{name:'Design a theme',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/themes\/new$/);await noPopup(page);
 const run=Date.now();const name=`Fictional route theme ${run}`;
 await page.getByLabel('Name',{exact:true}).fill(name);
 await page.getByLabel('Slug',{exact:true}).fill(`route-theme-${run}`);
 await page.getByLabel('Author',{exact:true}).fill('Fictional testing');
 await page.getByRole('button',{name:'style',exact:true}).click();
 await expect(page.getByRole('combobox',{name:'Typeface',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('theme-designer-desktop.png'),fullPage:true});
 await mobile(page,testInfo.outputPath('theme-designer-mobile.png'));
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export ZIP',exact:true}).click();
 const download=await downloadPromise;const zipPath=testInfo.outputPath('fictional-theme.zip');await download.saveAs(zipPath);
 await page.getByRole('button',{name:'Save theme for preview',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/themes\/[^/]+\/preview$/);
 await expect(page.getByRole('heading',{name:`Preview ${name}`,exact:true})).toBeVisible();await noPopup(page);
 await page.reload();await expect(page.getByRole('heading',{name:`Preview ${name}`,exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Customize theme',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/themes\/[^/]+\/edit$/);
 await expect(page.getByLabel('Version',{exact:true})).toHaveValue('1.0.1');await noPopup(page);
 await page.getByRole('link',{name:'← Website themes',exact:true}).click();
 await page.getByRole('link',{name:'Upload ZIP',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/themes\/upload$/);
 await page.getByLabel('Theme ZIP').setInputFiles(zipPath);
 await page.getByRole('button',{name:'Upload and preview',exact:true}).click();
 await expect(page.getByRole('heading',{name:`Preview ${name}`,exact:true})).toBeVisible();await noPopup(page);
 await page.screenshot({path:testInfo.outputPath('theme-preview.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('new staff conversations open a refreshable thread page and retain messages',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page);page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});await page.goto('/workspace/conversations');
 await page.getByRole('link',{name:'New conversation',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/conversations\/new$/);await noPopup(page);
 const subject=`Fictional route conversation ${Date.now()}`;
 await page.getByLabel('Subject',{exact:false}).fill(subject);
 await page.getByRole('checkbox',{name:access!.accounts.find(a=>a.roles.includes('owner'))!.name,exact:true}).check();
 await page.getByRole('button',{name:'Save conversation',exact:true}).click();
 await expect(page).toHaveURL(/\/workspace\/conversations\/[A-Za-z0-9_-]+$/);
 await expect(page.getByRole('heading',{name:subject,exact:true})).toBeVisible();await noPopup(page);
 const message='Fictional local test message: this thread has a dedicated page.';
 await page.getByLabel('Message',{exact:true}).fill(message);
 await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.locator('.message').getByText(message,{exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.message').getByText(message,{exact:true})).toBeVisible();await noPopup(page);
 await page.screenshot({path:testInfo.outputPath('conversation-desktop.png'),fullPage:true});
 await mobile(page,testInfo.outputPath('conversation-mobile.png'));
 expect(errors).toEqual([]);
});

test('patient sections, intake and record details have dedicated protected pages',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await login(page,'patient');page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
 await page.getByRole('link',{name:'Prepare visit notes',exact:true}).click();
 await expect(page).toHaveURL(/\/portal\/intake$/);await noPopup(page);
 const note=`Fictional preparation note ${Date.now()}`;
 await page.locator('.bn-editor').click();await page.keyboard.type(note);
 const save=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith('/actions/patients.intake'));
 await page.getByRole('button',{name:'Share with care team',exact:true}).click();
 const response=await save;expect(response.ok()).toBeTruthy();const {data}=await response.json();
 await expect(page).toHaveURL(/\/portal\/appointments$/);
 await page.getByRole('link',{name:'Documents',exact:true}).click();await expect(page).toHaveURL(/\/portal\/documents$/);
 await page.locator(`a[href="/portal/documents/${data.id}"]`).click();
 await expect(page).toHaveURL(new RegExp(`/portal/documents/${data.id}$`));
 await expect(page.getByRole('heading',{name:'Patient intake',exact:true})).toBeVisible();await noPopup(page);
 await expect(page.getByText(note,{exact:true})).toBeVisible();
 await page.reload();await expect(page.getByText(note,{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('portal-detail-desktop.png'),fullPage:true});
 await mobile(page,testInfo.outputPath('portal-detail-mobile.png'));
 await page.goto('/portal/conversations');
 await page.getByRole('link',{name:'New conversation',exact:true}).click();await expect(page).toHaveURL(/\/portal\/conversations\/new$/);
 await expect(page.getByRole('combobox',{name:'Conversation type',exact:true})).toHaveValue('patient-service');await noPopup(page);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page).toHaveURL(/\/portal\/conversations$/);
 await page.goto('/portal/notifications');await expect(page.locator('.portal-tabs a[aria-current="page"]')).toHaveText('Notifications');
 expect(errors).toEqual([]);
});

test('public BlockNote images use inline description and scanned upload without a browser prompt',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',dialog=>{errors.push(`Unexpected ${dialog.type()} dialog`);void dialog.dismiss()});
 await login(page);page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});await page.goto('/workspace/pages/new');
 await expect(page.locator('.bn-editor')).toBeVisible();
 const upload=page.locator('.public-image-upload input[type="file"]');await expect(upload).toBeDisabled();
 await page.getByLabel('Public image description').fill('A fictional sage green square for an accessibility test');
 await expect(upload).toBeEnabled();
 const buffer=await sharp({create:{width:40,height:40,channels:3,background:'#25645d'}}).png().toBuffer();
 await upload.setInputFiles({name:'fictional-image.png',mimeType:'image/png',buffer});
 await expect(page.getByText('Image inserted with its accessible description.',{exact:true})).toBeVisible();
 await expect(page.locator('.bn-editor img')).toHaveCount(1);await noPopup(page);
 await page.screenshot({path:testInfo.outputPath('inline-image-upload.png'),fullPage:true});
 expect(errors).toEqual([]);
});
