"use client";

import { useFormStatus } from "react-dom";
import React from "react";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  confirmMessage?: string;
  loadingText?: string;
}

export function SubmitButton({ 
  children, 
  confirmMessage, 
  loadingText = "Processando...", 
  onClick,
  ...props 
}: Props) {
  const { pending } = useFormStatus();

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (confirmMessage) {
      if (!window.confirm(confirmMessage)) {
        e.preventDefault();
        return;
      }
    }
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <button
      {...props}
      onClick={handleClick}
      disabled={pending || props.disabled}
      style={{
        ...props.style,
        opacity: pending ? 0.7 : (props.style?.opacity ?? 1),
        cursor: pending ? "wait" : (props.style?.cursor ?? "pointer")
      }}
    >
      {pending ? loadingText : children}
    </button>
  );
}
