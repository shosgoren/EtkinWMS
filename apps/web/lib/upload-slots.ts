// T-1160 (güvenlik incelemesi MINOR-C): süreç içi, anahtarlı eşzamanlılık yuvaları. Toplam sınırın içinde çalışma alanı ve kullanıcı başına
// pay: tek bir kullanıcı ya da tek bir çalışma alanı bütün yuvaları tutup ötekileri aç bırakamaz. Kuyruk yok: yuva yoksa çağıran 429
// döner. Dönen bırakma işlevi bir kez sayılır (finally'de çağrılır). Sayaçlar süreç belleğindedir (çok süreçli kurulumda süreç başına).

export interface SlotLimits {
  readonly total: number;
  readonly perTenant: number;
  readonly perUser: number;
}

export interface KeyedSlots {
  /** Yuva al; toplam, çalışma alanı ya da kullanıcı payı doluysa `null`. */
  acquire(tenant: string, user: string): (() => void) | null;
  /** Gözlem / test: kullanılan yuvalar. */
  usage(): { readonly total: number; readonly tenants: number; readonly users: number };
}

export function createKeyedSlots(limits: SlotLimits): KeyedSlots {
  let total = 0;
  const byTenant = new Map<string, number>();
  const byUser = new Map<string, number>();
  const dec = (m: Map<string, number>, k: string): void => {
    const n = (m.get(k) ?? 1) - 1;
    if (n <= 0) m.delete(k);
    else m.set(k, n);
  };
  return {
    acquire(tenant, user) {
      if (total >= limits.total || (byTenant.get(tenant) ?? 0) >= limits.perTenant || (byUser.get(user) ?? 0) >= limits.perUser) return null;
      total += 1;
      byTenant.set(tenant, (byTenant.get(tenant) ?? 0) + 1);
      byUser.set(user, (byUser.get(user) ?? 0) + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        total -= 1;
        dec(byTenant, tenant);
        dec(byUser, user);
      };
    },
    usage: () => ({ total, tenants: byTenant.size, users: byUser.size }),
  };
}
