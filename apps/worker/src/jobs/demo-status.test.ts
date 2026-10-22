import { beforeEach, expect, it, vi } from 'vitest';
import { createSealer } from '@wms/shared/seal';
import { loadMailConfig } from '@wms/shared/mailer';
import { randomBytes } from 'node:crypto';
import type { AccessDbClient } from '@wms/domain/identity/access';
const mocks=vi.hoisted(()=>({claim:vi.fn(),finish:vi.fn()}));
vi.mock('@wms/domain/platform/demo-requests',()=>({DEMO_SEAL_CONTEXT:{jobType:'demo.status',template:'owner-link',tenantId:'platform'},claimDemoMail:mocks.claim,finishDemoMail:mocks.finish}));
import { deliverDemoStatusBatch } from './demo-status.js';
const sealer=createSealer(randomBytes(32).toString('hex'));
const context={jobType:'demo.status',template:'owner-link',tenantId:'platform'};
const config=loadMailConfig({MAIL_MODE:'mailpit',MAILPIT_URL:'http://localhost:8025',MAIL_FROM:'test@example.test'});
beforeEach(()=>{vi.clearAllMocks();});
it('retry uses identical provider key and sealed link; completion only after successful delivery',async()=>{
 const token=randomBytes(32).toString('base64url');
 mocks.claim.mockResolvedValue([{id:'test-request',sealed:sealer.seal({email:'person@example.test',token,locale:'en'},context)}]);
 const send=vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValue(undefined);
 const deps={db:{} as AccessDbClient,sealer,config,mailer:{send}};
 await expect(deliverDemoStatusBatch(deps)).rejects.toThrow('demo mail unavailable');
 expect(mocks.finish).not.toHaveBeenCalled();
 await deliverDemoStatusBatch(deps);
 expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
 expect(send.mock.calls[0]?.[0]).toMatchObject({idempotencyKey:'demo-status-test-request',to:'person@example.test'});
 expect(send.mock.calls[0]?.[0].text).toContain(`/demo-status#${token}`);
 expect(mocks.finish).toHaveBeenCalledOnce();
});
it('a tampered sealed token never sends mail',async()=>{
 mocks.claim.mockResolvedValue([{id:'test',sealed:{v:2}}]);
 const send=vi.fn();
 await expect(deliverDemoStatusBatch({db:{} as AccessDbClient,sealer,config,mailer:{send}})).rejects.toThrow();
 expect(send).not.toHaveBeenCalled();expect(mocks.finish).not.toHaveBeenCalled();
});

it('a failed delivery does not prevent other claimed rows from being attempted',async()=>{
 const sealed=sealer.seal({email:'person@example.test',token:randomBytes(32).toString('base64url'),locale:'tr'},context);
 mocks.claim.mockResolvedValue([{id:'first',sealed},{id:'second',sealed}]);
 const send=vi.fn().mockRejectedValueOnce(new Error('transport')).mockResolvedValue(undefined);
 await expect(deliverDemoStatusBatch({db:{} as AccessDbClient,sealer,config,mailer:{send}})).rejects.toThrow('demo mail unavailable');
 expect(send).toHaveBeenCalledTimes(2);
 expect(mocks.finish).toHaveBeenCalledExactlyOnceWith({},'second');
});
