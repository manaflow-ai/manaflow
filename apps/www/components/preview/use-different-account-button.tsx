"use client";
import { useUser } from "@stackframe/stack";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function UseDifferentAccountButton() {
  const user = useUser();
  const router = useRouter();
  return user ? (
    <Button
      onClick={async () => {
        await user.signOut();
        router.refresh();
      }}
      variant="ghost"
      className="mt-4 text-xs text-neutral-400 hover:text-white hover:bg-white/5"
    >
      Use a different account
    </Button>
  ) : null;
}
