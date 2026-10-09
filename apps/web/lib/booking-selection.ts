/* Author: ramanpal singh | URL: https://kwebby.com */
import type {WebsiteLocation} from '../../../packages/contracts/src/website';
import type {RecordData} from './types';
/** Keep query preselection and branch-filtered controls consistent before the first submit. */
export function initialBookingSelection(params:Pick<URLSearchParams,'get'>,locations:WebsiteLocation[],services:RecordData[],doctors:RecordData[]){
 const primary=locations.find(l=>l.primary)?.branchId??locations[0]?.branchId??'main';
 const allowed=new Set(locations.length?locations.map(l=>l.branchId):['main']);
 const service=services.find(s=>s.id===params.get('service')),doctor=doctors.find(d=>d.id===params.get('doctor'));
 const doctorBranches=Array.isArray(doctor?.branchIds)?doctor.branchIds.filter((b):b is string=>typeof b==='string'&&allowed.has(b)):[];
 const requested=params.get('branch');
 const branchId=requested&&allowed.has(requested)?requested:typeof service?.branchId==='string'&&allowed.has(service.branchId)?service.branchId:doctorBranches.includes(primary)?primary:doctorBranches[0]??primary;
 return {branchId,serviceId:service&&(!service.branchId||service.branchId===branchId)?service.id:'',doctorId:doctor&&(!Array.isArray(doctor.branchIds)||doctorBranches.includes(branchId))?doctor.id:''};
}
