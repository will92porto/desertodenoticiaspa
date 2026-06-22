import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "Deserto de Notícias — Admin",
  description: "Painel de administração da plataforma de conteúdo regional.",
};

const nav = [
  { href: "/", label: "Visão geral" },
  { href: "/projects", label: "Projetos" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/resultados", label: "Resultados" },
  { href: "/settings/steps", label: "Etapas & Prompts" },
  { href: "/settings/models", label: "Modelos de IA" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <h1 className="logo">Deserto<br />de Notícias</h1>
            <nav>
              {nav.map((n) => (
                <Link key={n.href} href={n.href}>{n.label}</Link>
              ))}
            </nav>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
