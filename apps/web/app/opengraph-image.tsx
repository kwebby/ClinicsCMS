/* Author: ramanpal singh | URL: https://kwebby.com */
import {ImageResponse} from 'next/og';
import {getSite} from '@/lib/public';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const alt='Clinic care and appointments';
export const size={width:1200,height:630};
export const contentType='image/png';
export default async function Image(){const site=await getSite();return new ImageResponse(<div style={{display:'flex',width:'100%',height:'100%',background:'#e1eee5',padding:'70px',color:'#25645d',flexDirection:'column',justifyContent:'space-between',fontFamily:'sans-serif'}}><div style={{display:'flex',alignItems:'center',gap:'20px',fontSize:35}}><span style={{fontSize:58}}>✚</span>{site.name}</div><div style={{display:'flex',fontSize:68,lineHeight:1.1,maxWidth:930,letterSpacing:-2}}>Care starts with a conversation.</div><div style={{display:'flex',fontSize:25,color:'#789b88'}}>Appointments · Your care team · Patient resources</div></div>,size)}
