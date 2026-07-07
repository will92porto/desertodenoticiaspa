"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AdvancePipelineButton({ 
  label, 
  confirmMessage, 
  actionFn, 
  ids, 
  className,
  style
}: { 
  label: string, 
  confirmMessage?: string, 
  actionFn: (ids?: string[]) => Promise<{ done: boolean, error?: string }>, 
  ids?: string[],
  className?: string,
  style?: React.CSSProperties
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const handleClick = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (confirmMessage && !window.confirm(confirmMessage)) return;

    const form = e.currentTarget.closest("form");
    const formData = form ? new FormData(form) : undefined;
    const currentIds = formData ? formData.getAll("ids").map(String) : undefined;
    
    // Se há ids no form mas nenhum foi selecionado, não faz nada
    if (currentIds && currentIds.length === 0 && form?.querySelector('input[name="ids"]')) {
      return;
    }

    setPending(true);
    let isDone = false;
    while (!isDone) {
      try {
        const res = await actionFn(currentIds && currentIds.length > 0 ? currentIds : undefined);
        if (res.error) {
          alert(`Erro: ${res.error}`);
          break;
        }
        isDone = res.done;
        router.refresh();
      } catch (err: any) {
        alert(`Erro inesperado: ${err.message}`);
        break;
      }
    }
    setPending(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={className}
      style={{
        ...style,
        opacity: pending ? 0.7 : 1,
        cursor: pending ? "wait" : "pointer"
      }}
    >
      {pending ? "Processando..." : label}
    </button>
  );
}
