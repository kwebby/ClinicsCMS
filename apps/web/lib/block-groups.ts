/* Author: ramanpal singh | URL: https://kwebby.com */
export interface ContentBlock {id?:string;type?:string;props?:Record<string,unknown>;content?:unknown;children?:ContentBlock[]}
export type BlockGroup={kind:'block';block:ContentBlock;index:number}|{kind:'list';ordered:boolean;start?:number;items:ContentBlock[];index:number};
const listKinds:Record<string,boolean>={bulletListItem:false,numberedListItem:true};
/** Consecutive list items share one list, so numbering continues (1, 2, 3) instead of restarting on every item. */
export function groupBlocks(blocks:ContentBlock[]):BlockGroup[] {
  const groups:BlockGroup[]=[];
  blocks.forEach((block,index)=>{
    const type=String(block?.type||'');
    if(!Object.hasOwn(listKinds,type)){groups.push({kind:'block',block,index});return}
    const ordered=listKinds[type],start=ordered?Number(block.props?.start):NaN,explicit=Number.isInteger(start)&&start>0;
    const last=groups[groups.length-1];
    // An explicit start number begins a new list, as it does in the editor.
    if(last?.kind==='list'&&last.ordered===ordered&&!explicit)last.items.push(block);
    else groups.push({kind:'list',ordered,items:[block],index,...(explicit&&start!==1?{start}:{})});
  });
  return groups;
}
