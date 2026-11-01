// T-1026: yalnız sunucuda mevcut izinlerden görünürlük; eyleme yetki vermez.
import { hasPermission, type Permission } from '@wms/domain/identity/permissions';
import type { StepKey } from '../yolculuk/steps.ts';
import type { OpGuide } from './rehber-plan.ts';
export interface GuideMember {
    readonly roles: readonly string[];
    readonly grants: readonly string[];
    readonly screens: readonly string[] | null;
}
export function guideAccess(m: GuideMember): {
    setup: StepKey[];
    operations: OpGuide[];
} {
    const can = (p: Permission): boolean => hasPermission(m.roles, p, m.grants);
    const screen = (s: string): boolean => m.screens === null || m.screens.includes(s);
    const setup: StepKey[] = [];
    if (can('data.import'))
        setup.push('cards');
    if (can('settings.manage'))
        setup.push('shelves', 'parties');
    if (can('document.create') && screen('receive'))
        setup.push('stock');
    if (can('stock.view') && screen('labels'))
        setup.push('labels');
    if (can('settings.manage') && screen('prod'))
        setup.push('bom');
    if (can('stock.post') && screen('prod'))
        setup.push('order');
    if (can('users.manage'))
        setup.push('people');
    if (can('document.approve'))
        setup.push('task');
    const operations: OpGuide[] = [];
    if (can('stock.post') && screen('receive'))
        operations.push('receive', 'putaway');
    if (can('document.create') && screen('pick') && !m.roles.every(r => r === 'COUNTER'))
        operations.push('issue');
    if (can('stock.post') && screen('transfer'))
        operations.push('transfer');
    if (can('document.create') && screen('count'))
        operations.push('count');
    if(can('labels.view')&&can('labels.design'))operations.push('label');
    return { setup: m.roles.some(r => r === 'TENANT_ADMIN' || r === 'WAREHOUSE_MANAGER') ? setup : [], operations };
}
