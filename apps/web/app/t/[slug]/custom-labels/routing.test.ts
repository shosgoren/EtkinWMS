import{beforeEach,expect,it,vi}from'vitest';
const s=vi.hoisted(()=>({choices:vi.fn()}));vi.mock('@wms/domain/labels/print',()=>({getLabelPrintChoices:s.choices}));
import{AppError}from'@wms/shared/errors';
import{customLabelHref}from'./routing.ts';
const p={tenantSlug:'motive',principal:{userId:'11111111-1111-4111-8111-111111111111',mfaVerified:true},db:{} as Parameters<typeof customLabelHref>[0]['db']},source={kind:'PRODUCT' as const,ids:['22222222-2222-4222-8222-222222222222']};
beforeEach(()=>{vi.clearAllMocks();});
it('default absence or missing print grant preserves legacy route; other failures propagate',async()=>{s.choices.mockResolvedValue([]);expect(await customLabelHref(p,source)).toBeNull();s.choices.mockRejectedValueOnce(new AppError('FORBIDDEN'));expect(await customLabelHref(p,source)).toBeNull();s.choices.mockRejectedValueOnce(new AppError('INTERNAL'));await expect(customLabelHref(p,source)).rejects.toMatchObject({code:'INTERNAL'});});
it('real source IDs, copies and bounded next query survive encoding; domain rechecks at destination',async()=>{s.choices.mockResolvedValue([{id:'existing',isDefault:true}]);const href=await customLabelHref(p,source,{copies:2,batchNext:'products=1&q=granül&after=next'});expect(href).toMatch(/^\/t\/motive\/custom-labels\?/);const q=new URL(href!,'https://local.test').searchParams;expect(JSON.parse(q.get('source')!)).toEqual(source);expect(q.get('copies')).toBe('2');expect(q.get('batchNext')).toBe('products=1&q=granül&after=next');});
