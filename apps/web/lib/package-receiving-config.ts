// Server components and actions share this fail-closed gate. Never use NEXT_PUBLIC.
import { AppError } from "@wms/shared/errors";

export function packageReceivingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.PACKAGE_RECEIVING_ENABLED === "true";
}

export function assertPackageReceivingEnabled(): void {
  if (!packageReceivingEnabled()) throw new AppError("FORBIDDEN");
}
