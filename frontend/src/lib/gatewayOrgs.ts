import { adminFetch } from "../hooks/useAdminToken";

export type GatewayOrg = {
  org_id: string;
  name: string;
  description: string;
  owner_email: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  account_count: number;
  active_keys: number;
  total_keys: number;
};

export type OrgCreatePayload = {
  name: string;
  description: string;
  owner_email: string;
};

export type OrgUpdatePayload = {
  name?: string;
  description?: string;
  owner_email?: string;
  status?: "active" | "disabled";
};

export async function fetchGatewayOrgs(): Promise<GatewayOrg[]> {
  const res = await adminFetch("/api/v1/gateway-orgs");
  if (!res.ok) {
    throw new Error(`Failed to fetch orgs: ${res.status}`);
  }
  const data = await res.json();
  return data.orgs || [];
}

export async function createGatewayOrg(payload: OrgCreatePayload): Promise<GatewayOrg> {
  const res = await adminFetch("/api/v1/gateway-orgs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Create failed: ${res.status}`);
  }
  const data = await res.json();
  return data.org;
}

export async function updateGatewayOrg(
  orgId: string,
  payload: OrgUpdatePayload
): Promise<GatewayOrg> {
  const res = await adminFetch(`/api/v1/gateway-orgs/${encodeURIComponent(orgId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Update failed: ${res.status}`);
  }
  const data = await res.json();
  return data.org;
}

export async function deleteGatewayOrg(orgId: string): Promise<void> {
  const res = await adminFetch(`/api/v1/gateway-orgs/${encodeURIComponent(orgId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { detail?: string }).detail || `Delete failed: ${res.status}`);
  }
}
