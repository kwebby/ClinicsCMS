/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
export function Icon({name,size=19}:{name:string;size?:number}) {
 const paths:Record<string,React.ReactNode>={
 dashboard:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
 patients:<><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0112 0v3M17 4a3 3 0 010 6M18 14a5 5 0 013 4v3"/></>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2"/></>,
 notes:<><path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8m-8 4h6"/></>,
 results:<><path d="M9 3h6m-5 0v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M8 15h8"/></>,
 tasks:<><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M9 3h6v3H9zM8 13l3 3 5-6"/></>,
 chat:<><path d="M21 12a9 9 0 01-9 9c-1.4 0-2.8-.3-4-.9L3 21l.9-5A9 9 0 1121 12z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></>,
 leads:<><path d="M4 4h16l-6 8v7l-4 2v-9z"/></>,
 invoices:<><path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 7h8m-8 4h8m-8 4h4"/></>,
 team:<><circle cx="12" cy="6" r="3"/><path d="M7 20v-3a5 5 0 0110 0v3M3 18v-2a4 4 0 013-4m15 6v-2a4 4 0 00-3-4"/></>,
 payroll:<><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9h1m10 6h1"/></>,
 website:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
 design:<><path d="M12 3a9 9 0 100 18h2a2 2 0 001-3.7A2 2 0 0116 14h3a2 2 0 002-2 9 9 0 00-9-9z"/><circle cx="7" cy="11" r=".6"/><circle cx="10" cy="7" r=".6"/><circle cx="15" cy="7" r=".6"/></>,
 bell:<><path d="M5 16l1-2V9a6 6 0 0112 0v5l1 2H5zm5 4h4"/></>,
 settings:<><circle cx="12" cy="12" r="3"/><path d="M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,search:<><circle cx="10" cy="10" r="6"/><path d="M15 15l6 6"/></>,arrow:<path d="M5 12h14m-5-5l5 5-5 5"/>,close:<path d="M6 6l12 12M18 6L6 18"/>,menu:<path d="M4 6h16M4 12h16M4 18h16"/>,logout:<><path d="M10 4H4v16h6m4-12l4 4-4 4m-6-4h10"/></>,check:<path d="M4 12l5 5L20 6"/>,refresh:<><path d="M20 8a8 8 0 10-1 10M20 3v5h-5"/></>,security:<><path d="M12 3l8 3v6c0 4-8 9-8 9s-8-5-8-9V6zM8 12l3 3 5-6"/></>,prescription:<><path d="M6 20V4h6a4 4 0 010 8H6m6 0l7 8m-6 0l6-8"/></>,services:<><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></>,spark:<><path d="M12 3l2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z"/></>,upload:<><path d="M12 16V3m-5 5l5-5 5 5M4 15v6h16v-6"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>
 };
 return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]||paths.notes}</svg>;
}
export function Mark(){return <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M13 3h6v10h10v6H19v10h-6V19H3v-6h10z" fill="currentColor"/></svg></span>}
export function Status({value}:{value:unknown}){const v=String(value||'draft');return <span className={`status status-${v.replace(/[^a-z-]/gi,'')}`}>{v.replaceAll('-',' ')}</span>}
export function Empty({title,description,action}:{title:string;description:string;action?:React.ReactNode}){return <div className="empty-state"><span className="empty-icon"><Icon name="notes" size={25}/></span><h3>{title}</h3><p>{description}</p>{action}</div>}
export function Alert({children,kind='error'}:{children:React.ReactNode;kind?:'error'|'success'|'info'}){return <div className={`alert ${kind}`} role={kind==='error'?'alert':'status'}>{children}</div>}
export function Loading({label='Loading your workspace…'}:{label?:string}){return <div className="loading" role="status"><span className="spinner"/>{label}</div>}
