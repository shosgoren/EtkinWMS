// Persistent DB outbox. Sealed token and provider idempotency key remain stable across retry/restart.
import { claimDemoMail, finishDemoMail, DEMO_SEAL_CONTEXT } from '@wms/domain/platform/demo-requests';
import type { AccessDbClient } from '@wms/domain/identity/access';
import type { Sealer } from '@wms/shared/seal';
import { canDeliver, type MailConfig, type Mailer } from '@wms/shared/mailer';
import { paragraph, renderLayout } from '../mail/layout.js';
export async function deliverDemoStatusBatch(deps:{db:AccessDbClient;sealer:Sealer;mailer:Mailer;config:MailConfig}):Promise<void>{
 let failed=false;
 for(const row of await claimDemoMail(deps.db)){
  try {
  const data=deps.sealer.open(row.sealed,DEMO_SEAL_CONTEXT);
  const email=data.email,token=data.token;
  if(!email||!token||!canDeliver(deps.config,email))throw new Error('demo mail unavailable');
  const en=data.locale==='en';
  const subject=en?'Your Etkin WMS request':'Etkin WMS talebiniz';
  const body=en?'Open this link to view your request. It expires 15 minutes after your request. If you did not request it, ignore this email.':'Talebinizi görmek için bağlantıyı açın. Bağlantı talebinizden itibaren 15 dakika geçerlidir. Siz istemediyseniz bu e-postayı yok sayabilirsiniz.';
  const label=en?'View my request':'Talebimi görüntüle';
  const href=`https://etkinyazilim.com/demo-status#${token}`;
  await deps.mailer.send({to:email,subject,text:`${body}\n\n${href}`,html:renderLayout({locale:en?'en':'tr',preheader:subject,appOrigin:'https://wms.etkinyazilim.com',title:subject,body:paragraph(body),button:{href,label}}),idempotencyKey:`demo-status-${row.id}`});
  await finishDemoMail(deps.db,row.id);
  } catch { failed=true; }
 }
 if(failed)throw new Error('demo mail unavailable');
}
export function startDemoStatusSchedule(deps:Parameters<typeof deliverDemoStatusBatch>[0],onError:()=>void):{stop():void}{
 let running=false,stopped=false;
 const tick=()=>{if(running||stopped)return;running=true;void deliverDemoStatusBatch(deps).catch(onError).finally(()=>{running=false;});};
 const timer=setInterval(tick,15000);timer.unref();tick();
 return {stop(){stopped=true;clearInterval(timer);}};
}
