import { requirePrototypes } from "@/lib/prototypes/guard";

/** Every Prototypes page answers not found while Prototypes is disabled (prototypes/availability spec). */
export default function PrototypesLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  requirePrototypes();
  return children;
}
