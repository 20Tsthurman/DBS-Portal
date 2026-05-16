import {
  getSupabaseServiceClient,
  type ClientRecord,
  type PackageRecord,
  type ProjectRecord,
  type ShootRecord,
  type TimeLogRecord,
} from "@/lib/supabase";
import { currentMonthRange } from "@/app/owner/calendar/_lib/timezone";

export interface ClientWithRelations {
  client: ClientRecord;
  project: ProjectRecord | null;
  pkg: PackageRecord | null;
  hoursThisMonth: number;
}

export async function fetchClientsWithRelations(): Promise<
  ClientWithRelations[]
> {
  const supabase = getSupabaseServiceClient();

  const [clientsRes, projectsRes, packagesRes] = await Promise.all([
    supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("*"),
    supabase.from("packages").select("*"),
  ]);

  if (clientsRes.error) throw new Error(clientsRes.error.message);
  if (projectsRes.error) throw new Error(projectsRes.error.message);
  if (packagesRes.error) throw new Error(packagesRes.error.message);

  const clients = (clientsRes.data ?? []) as ClientRecord[];
  const projects = (projectsRes.data ?? []) as ProjectRecord[];
  const packages = (packagesRes.data ?? []) as PackageRecord[];

  const projectByClient = new Map<string, ProjectRecord>();
  for (const p of projects) {
    if (!projectByClient.has(p.client_id)) {
      projectByClient.set(p.client_id, p);
    }
  }
  const packageById = new Map(packages.map((p) => [p.id, p]));

  const { start, end } = currentMonthRange();
  const clientIds = clients.map((c) => c.id);
  const totals = new Map<string, number>();
  if (clientIds.length > 0) {
    const { data: logs, error } = await supabase
      .from("time_logs")
      .select("client_id, hours, date")
      .in("client_id", clientIds)
      .gte("date", start)
      .lte("date", end);
    if (error) throw new Error(error.message);
    for (const row of (logs ?? []) as Pick<
      TimeLogRecord,
      "client_id" | "hours"
    >[]) {
      totals.set(row.client_id, (totals.get(row.client_id) ?? 0) + Number(row.hours));
    }
  }

  return clients.map((client) => {
    const project = projectByClient.get(client.id) ?? null;
    const pkg = project?.package_id ? packageById.get(project.package_id) ?? null : null;
    return {
      client,
      project,
      pkg,
      hoursThisMonth: totals.get(client.id) ?? 0,
    };
  });
}

export async function fetchActivePackages(): Promise<PackageRecord[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .order("monthly_price", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PackageRecord[];
}

export interface ClientDetailData {
  client: ClientRecord;
  project: ProjectRecord | null;
  pkg: PackageRecord | null;
  hoursThisMonth: number;
  timeLogs: TimeLogRecord[];
  nextShoot: ShootRecord | null;
}

export async function fetchClientDetail(
  id: string
): Promise<ClientDetailData | null> {
  const supabase = getSupabaseServiceClient();

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (clientError) throw new Error(clientError.message);
  const client = clientRow as ClientRecord | null;
  if (!client) return null;

  const [projectRes, logsRes, shootRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("client_id", id)
      .order("start_date", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("time_logs")
      .select("*")
      .eq("client_id", id)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("shoots")
      .select("*")
      .eq("client_id", id)
      .in("status", ["requested", "confirmed"])
      .gte("scheduled_at", new Date().toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  if (projectRes.error) throw new Error(projectRes.error.message);
  if (logsRes.error) throw new Error(logsRes.error.message);
  if (shootRes.error) throw new Error(shootRes.error.message);

  const project = projectRes.data as ProjectRecord | null;
  const timeLogs = (logsRes.data ?? []) as TimeLogRecord[];
  const nextShoot = shootRes.data as ShootRecord | null;

  let pkg: PackageRecord | null = null;
  if (project?.package_id) {
    const { data: pkgRow, error: pkgError } = await supabase
      .from("packages")
      .select("*")
      .eq("id", project.package_id)
      .maybeSingle();
    if (pkgError) throw new Error(pkgError.message);
    pkg = pkgRow as PackageRecord | null;
  }

  const { start, end } = currentMonthRange();
  const hoursThisMonth = timeLogs
    .filter((log) => log.date >= start && log.date <= end)
    .reduce((sum, log) => sum + Number(log.hours), 0);

  return {
    client,
    project,
    pkg,
    hoursThisMonth,
    timeLogs,
    nextShoot,
  };
}
