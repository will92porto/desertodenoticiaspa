import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const db = supabaseAdmin();
  const { data: projects } = await db
    .from("projects")
    .select("id, name, slug, is_active, regions(count)")
    .order("created_at", { ascending: false });

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Projetos</h2>
        <Link className="btn" href="/projects/new">+ Novo projeto</Link>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Nome</th><th>Slug</th><th>Regiões</th><th>Status</th></tr>
          </thead>
          <tbody>
            {(projects ?? []).map((p: any) => (
              <tr key={p.id}>
                <td><Link href={`/projects/${p.id}`}>{p.name}</Link></td>
                <td className="muted">{p.slug}</td>
                <td>{p.regions?.[0]?.count ?? 0}</td>
                <td><span className="badge">{p.is_active ? "ativo" : "inativo"}</span></td>
              </tr>
            ))}
            {(!projects || projects.length === 0) && (
              <tr><td colSpan={4} className="muted">Nenhum projeto ainda. Crie o primeiro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
