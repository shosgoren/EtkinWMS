import type { ReactNode } from "react";

// The tenant BottomNav owns field navigation. Space for its fixed 74px bar remains in the scroll area.
export default function FieldLayout({ children }: { children: ReactNode }) {
  return <div className="field-screen mx-auto flex w-full max-w-md min-w-0 flex-col pb-24" data-testid="field-shell">{children}</div>;
}
