// Physical output only: exact mm geometry and opaque paper/ink live in the canonical SVG. Outer paper stays transparent and never inherits the application theme.
import{DESIGN_LIMITS}from'@wms/shared/labels';
export type LabelPaper='a4'|'roll';
export function labelPaperLayout(width:number,height:number,mode:LabelPaper){
 if(![width,height].every(n=>Number.isFinite(n)&&Number.isSafeInteger(Math.round(n*1000))&&Math.abs(n*1000-Math.round(n*1000))<.000001)||width<DESIGN_LIMITS.minWidth/1000||width>DESIGN_LIMITS.maxWidth/1000||height<DESIGN_LIMITS.minHeight/1000||height>DESIGN_LIMITS.maxHeight/1000||!['a4','roll'].includes(mode))throw new RangeError('INVALID_LABEL_PAPER');
 if(mode==='roll')return{columns:1,rows:1,width,height,gap:0,margin:0};
 const columns=Math.floor((190+3)/(width+3)),rows=Math.floor((277+3)/(height+3));if(columns<1||rows<1)throw new RangeError('LABEL_DOES_NOT_FIT_A4');return{columns,rows,width:190,height:277,gap:3,margin:10};
}
export function labelPaperPages(pages:readonly string[],copies:number,width:number,height:number,mode:LabelPaper):readonly(readonly string[])[]{
 const layout=labelPaperLayout(width,height,mode);if(!Number.isInteger(copies)||copies<1||copies>100||pages.length<1||pages.length>100||pages.length*copies>500)throw new RangeError('INVALID_LABEL_COUNT');
 const expanded=pages.flatMap(svg=>Array.from({length:copies},()=>svg)),size=layout.columns*layout.rows;return Array.from({length:Math.ceil(expanded.length/size)},(_,i)=>expanded.slice(i*size,(i+1)*size));
}
export function labelPhysicalCss(width:number,height:number,mode:LabelPaper):string{
 const p=labelPaperLayout(width,height,mode);
 return `@media print{@page{size:${mode==='a4'?'A4':`${width}mm ${height}mm`};margin:${p.margin}mm}html,body{margin:0!important;padding:0!important;background:none!important}body>:not(.custom-label-sheet){display:none!important}.custom-label-sheet{display:block!important;margin:0!important;padding:0!important;print-color-adjust:exact;-webkit-print-color-adjust:exact}.custom-label-sheet,.custom-label-sheet *{visibility:visible!important}.custom-label-paper{display:grid;grid-template-columns:repeat(${p.columns},${width}mm);grid-auto-rows:${height}mm;gap:${p.gap}mm;align-content:start;width:${p.width}mm;height:${p.height}mm;break-after:page;page-break-after:always;overflow:hidden}.custom-label-paper:last-child{break-after:auto;page-break-after:auto}.custom-label-cell{width:${width}mm;height:${height}mm;overflow:hidden;break-inside:avoid}.custom-label-cell>svg{display:block;width:100%;height:100%}}`;
}
