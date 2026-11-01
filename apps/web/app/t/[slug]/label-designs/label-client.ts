// Device hint only; it never authenticates a user or grants access. Server preferences remain bound to the verified membership.
export function labelDeviceId():string{
 try{const old=localStorage.getItem('etkinwms:label-device');if(old&&/^[0-9a-f-]{36}$/i.test(old))return old;const id=crypto.randomUUID();localStorage.setItem('etkinwms:label-device',id);return id;}catch{return crypto.randomUUID();}
}
/** Re-encode local image only. Server repeats bounded PNG validation; browser processing is never a trust boundary. */
export async function labelLogoPng(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('LOGO_SIZE');
 const url=URL.createObjectURL(file);try{
  const image=new Image();image.src=url;await image.decode();if(image.naturalWidth<1||image.naturalHeight<1||image.naturalWidth>8192||image.naturalHeight>8192)throw Error('LOGO_SIZE');
  let scale=Math.min(1,1024/image.naturalWidth,1024/image.naturalHeight);
  for(let i=0;i<5;i++){
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(image.naturalWidth*scale));canvas.height=Math.max(1,Math.floor(image.naturalHeight*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('LOGO_SIZE');ctx.drawImage(image,0,0,canvas.width,canvas.height);
   const encoded=canvas.toDataURL('image/png').split(',')[1];if(encoded&&encoded.length<=174764)return encoded;scale*=.7;
  }throw Error('LOGO_SIZE');
 }finally{URL.revokeObjectURL(url);}
}
