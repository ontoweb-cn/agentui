/**
 * KB visibility levels, aligned with intellect-rag-app `Knowledgebase.visibility` column.
 *
 * Values mirror the backend `build_ownership_fields` / `_compute_visibility` contract:
 * - `private`: only owner can access (no team/project context)
 * - `tenant`: all members of the tenant can access
 * - `team`: members of the same team can access
 * - `project`: members of the same project can access
 *
 * NOTE: `team` / `project` / `tenant` visibility requires the membership tables
 * (team_membership / project_membership / project_team) to be populated by the
 * identity-sync (Plan A) pipeline. Until Plan A lands, only `private` is
 * functionally effective for non-owner users; the other options are disabled
 * in the UI (see permission-form-field.tsx).
 */
export enum PermissionRole {
  Private = 'private',
  Tenant = 'tenant',
  Team = 'team',
  Project = 'project',
}

/**
 * @deprecated Use `PermissionRole` instead. Kept for backward compatibility
 * with locale keys and form field names that may still reference `me`.
 */
export const VISIBILITY_LEGACY_ME = 'me';
