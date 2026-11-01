import {defaultLabelDesign,parseLabelDesign,type LabelContext,type LabelDesign,type LabelElement,type LabelField} from './model.ts';
/** Editable starting layouts. Empty optional fields stay empty; no sample identifier enters a real print. */
export function readyLabelDesign(context:LabelContext):LabelDesign{
 const base=defaultLabelDesign(context),elements:LabelElement[]=[{...base.elements[0]!,y:4000,height:10000,fontSize:4500} as LabelElement,(context==='SHIPMENT'?{...base.elements[1]!,field:'trackingCode'}:base.elements[1]!) as LabelElement];
 const row=(id:string,caption:string,field:LabelField,y:number)=>{
  const box={x:5000,y,width:14000,height:5000,rotation:0 as const,locked:false};
  elements.push({...box,id:id+'-caption',kind:'text',field:null,text:caption,fontSize:2400,bold:false,align:'start'},
   {...box,id,width:40000,x:20000,kind:'text',field,text:null,fontSize:2800,bold:false,align:'start'});
 };
 if(context==='PRODUCT'){row('item-code','Kod','code',18000);row('unit','Birim','unit',26000);row('barcode-value','Barkod','barcode',34000);}
 else if(context==='LOCATION'){row('location-name','Raf','locationName',20000);row('warehouse','Depo','warehouseName',30000);}
 else if(context==='RECEIPT'){
  row('item-code','Kod','code',14500);row('quantity','Miktar','quantity',19500);
  elements.push({id:'unit',kind:'text',field:'unit',text:null,x:47000,y:19500,width:13000,height:4500,fontSize:2800,bold:false,align:'end',rotation:0,locked:false});
  // Quantity and unit own separate non-overlapping boxes; both are real bound data.
  const q=elements.findIndex(e=>e.id==='quantity');elements[q]={...elements[q]!,width:26000} as LabelElement;
  row('lot','Lot','lot',24500);row('production','Üretim','productionDate',29500);row('expiry','SKT','expiryDate',34500);row('document','Fiş','documentNo',41500);
 }else{row('document','Sevk','documentNo',14500);row('customer','Müşteri','customerName',19500);row('quantity','Miktar','quantity',24500);row('lot','Lot','lot',29500);row('expiry','SKT','expiryDate',34500);row('unit','Birim','unit',41500);}
 return parseLabelDesign({...base,elements});
}
