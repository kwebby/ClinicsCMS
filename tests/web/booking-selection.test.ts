/* Author: ramanpal singh | URL: https://kwebby.com */
import {describe,it,expect} from 'vitest';
import {initialBookingSelection} from '../../apps/web/lib/booking-selection.js';
import {websiteLocationSchema} from '../../packages/contracts/src/website.js';
const locations=['main','north'].map((branchId,index)=>websiteLocationSchema.parse({id:branchId,branchId,name:branchId,slug:`locations/${branchId}`,primary:index===0,phone:'+441234567890',address:{streetAddress:'12 Test Street',addressLocality:'Test',postalCode:'T1 1TT',addressCountry:'GB'},timezone:'Europe/London'}));
const services=[{id:'north-service',version:1,branchId:'north'}],doctors=[{id:'north-doctor',version:1,branchIds:['north']}];
describe('public branch preselection',()=>{
 it('uses the selected service branch when there is no explicit branch',()=>expect(initialBookingSelection(new URLSearchParams('service=north-service'),locations,services,doctors)).toEqual({branchId:'north',serviceId:'north-service',doctorId:''}));
 it('uses a selected clinician public branch and ignores unpublished branch query values',()=>expect(initialBookingSelection(new URLSearchParams('branch=private&doctor=north-doctor'),locations,services,doctors)).toEqual({branchId:'north',serviceId:'',doctorId:'north-doctor'}));
 it('clears incompatible selections when a valid explicit branch takes precedence',()=>expect(initialBookingSelection(new URLSearchParams('branch=main&service=north-service&doctor=north-doctor'),locations,services,doctors)).toEqual({branchId:'main',serviceId:'',doctorId:''}));
});
