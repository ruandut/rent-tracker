/**
 * Maintenance mode. While the database is rolled back to a backup (Django admin, Database
 * backups), every API request answers 503 with {"code": "maintenance"}. Each response the app
 * gets is reported here; the first such one puts the app on its maintenance page, which asks the
 * server again every few seconds and reloads the app once it answers: the data changed under it.
 */
import { useMaintenance } from "@/stores/maintenance";

type MaintenanceBody = { code?: string; detail?: string } | null;

/** True if `res` says the app is down for maintenance, which it then shows. */
export async function noteMaintenance(res: Response): Promise<boolean> {
  if (res.status !== 503) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => null)) as MaintenanceBody;
  if (body?.code !== "maintenance") return false;
  useMaintenance.getState().start(body.detail ?? null);
  return true;
}

/** Ask whether maintenance is over. When it is, start the app afresh. */
export async function checkMaintenanceOver(): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch("/api/health/");
  } catch {
    return false; // The server itself may be restarting; try again.
  }
  if (!res.ok) return false;
  useMaintenance.getState().end();
  window.location.reload();
  return true;
}
