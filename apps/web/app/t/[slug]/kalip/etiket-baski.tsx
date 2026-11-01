"use client";
// Common approved label preview surface; only the physical @print rules differ from the legacy label screen.
import{useEffect,useState}from'react';
import{createPortal}from'react-dom';
import{labelPaperPages,labelPhysicalCss,type LabelPaper}from'../labels/physical-print.ts';
import'../labels/print.css';
export function KalipEtiketOnizleme({svg,width,height,label}:{readonly svg:string;readonly width:number;readonly height:number;readonly label:string}){
 return<section className="label-sheet" aria-label={label}><div className="label-page" style={{width:`${width}mm`,height:'auto',aspectRatio:`${width}/${height}`}} dangerouslySetInnerHTML={{__html:svg}}/></section>;
}
export function KalipEtiketBaski({pages,copies,width,height,mode,jobId}:{readonly jobId:string;readonly pages:readonly string[];readonly copies:number;readonly width:number;readonly height:number;readonly mode:LabelPaper}){
 const[mounted,setMounted]=useState(false);useEffect(()=>setMounted(true),[]);if(!mounted)return null;
 const sheets=labelPaperPages(pages,copies,width,height,mode);
 return createPortal(<section className="custom-label-sheet" aria-hidden="true" style={{display:'none'}} data-testid="custom-label-paper" data-label-job={jobId}><style>{labelPhysicalCss(width,height,mode)}</style>{sheets.map((page,i)=><div className="custom-label-paper" key={i}>{page.map((svg,j)=><div className="custom-label-cell" key={j} dangerouslySetInnerHTML={{__html:svg}}/>)}</div>)}</section>,document.body);
}
