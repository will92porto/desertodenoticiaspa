"use client";

import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const { pending } = useFormStatus();
  const router = useRouter();

  useEffect(() => {
    if (!pending) return;

    // Se há uma ação pendente neste formulário, atualiza a rota periodicamente 
    // para mostrar o progresso no backend
    const interval = setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [pending, router, intervalMs]);

  return null;
}
