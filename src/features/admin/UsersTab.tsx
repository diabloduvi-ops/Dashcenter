import { FormEvent, useState } from "react";
import { KeyRound, LogOut, MonitorSmartphone, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { AuthState } from "../../../shared/types";
import { apiRequest } from "./api";
import { Button, Field, Notice } from "./ui";

interface UsersTabProps {
  auth: AuthState;
  onRefresh: () => Promise<void>;
  notify: (message: string, kind?: "success" | "error") => void;
}

type UsersSection = "account" | "session";

export function UsersTab({ auth, onRefresh, notify }: UsersTabProps) {
  const [section, setSection] = useState<UsersSection>("account");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/auth/password", {
        method: "PUT",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      notify("Password updated");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      await onRefresh();
    } catch (requestError) {
      notify(requestError instanceof Error ? requestError.message : "Could not sign out.", "error");
    } finally {
      setBusy(false);
    }
  }

  const displayName = auth.displayName || auth.username || "Administrator";
  const initials = displayName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const sections: Array<{ id: UsersSection; label: string; summary: string; icon: typeof UserRound }> = [
    { id: "account", label: "Administrator", summary: displayName, icon: UserRound },
    { id: "session", label: "Current session", summary: "This browser", icon: MonitorSmartphone },
  ];

  return (
    <div className="admin-users-workspace">
      <header className="admin-users-workspace__topbar">
        <span><h1>Users</h1><small>Manage your local account and browser access.</small></span>
        <span className="admin-users-workspace__mode"><ShieldCheck size={15} /> Single administrator</span>
      </header>

      <nav className="admin-users-workspace__mobile-tabs" aria-label="User settings">
        {sections.map((item) => (
          <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)}>{item.label}</button>
        ))}
      </nav>

      <div className="admin-users-body">
        <nav className="admin-users-list-pane" aria-label="User settings">
          <span className="admin-users-list-pane__eyebrow">Access</span>
          <h2>Account & session</h2>
          <p>Dashcenter uses one local administrator account.</p>
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`admin-users-list-row${section === item.id ? " admin-users-list-row--active" : ""}`}
                aria-pressed={section === item.id}
                onClick={() => setSection(item.id)}
              >
                <span className="admin-users-list-row__icon"><Icon size={18} /></span>
                <span><strong>{item.label}</strong><small>{item.summary}</small></span>
              </button>
            );
          })}
        </nav>

        <section className="admin-users-detail" aria-label={section === "account" ? "Administrator settings" : "Current session settings"}>
          <header className="admin-users-detail__heading">
            <span className="admin-users-detail__icon">{section === "account" ? <UserRound size={20} /> : <MonitorSmartphone size={20} />}</span>
            <span><small>{section === "account" ? "Local account" : "Browser access"}</small><h2>{section === "account" ? "Administrator" : "Current session"}</h2><span>{section === "account" ? "Profile and password for this Dashcenter instance." : "The browser currently signed in to this dashboard."}</span></span>
          </header>

          <div className="admin-users-detail__content">
            {section === "account" ? (
              <>
                <section className="admin-users-section" aria-labelledby="admin-users-profile-title">
                  <header><span><strong id="admin-users-profile-title">Account</strong><small>Local administrator with full dashboard access</small></span></header>
                  <div className="admin-users-profile">
                    <span className="admin-users-profile__avatar">{initials}</span>
                    <span className="admin-users-profile__identity"><strong>{displayName}</strong><small>@{auth.username || "admin"}</small></span>
                    <span className="admin-users-profile__role"><ShieldCheck size={14} /> Owner</span>
                  </div>
                  <p className="admin-users-section__note"><UsersRound size={16} /> Single-admin mode keeps access on this Dashcenter instance.</p>
                </section>

                <section className="admin-users-section" aria-labelledby="admin-users-password-title">
                  <header><span><strong id="admin-users-password-title">Change password</strong><small>Use at least eight characters. Existing sessions may remain active.</small></span></header>
                  <form className="admin-users-password-form" onSubmit={changePassword}>
                    <Field label="Current password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
                    <Field label="New password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
                    <Field label="Confirm new password" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
                    {error ? <Notice kind="danger">{error}</Notice> : null}
                    <Button variant="primary" type="submit" disabled={busy || !currentPassword || newPassword.length < 8 || confirmation.length < 8}><KeyRound size={16} /> {busy ? "Updating…" : "Update password"}</Button>
                  </form>
                </section>
              </>
            ) : (
              <section className="admin-users-section" aria-labelledby="admin-users-session-title">
                <header><span><strong id="admin-users-session-title">This browser</strong><small>{auth.devBypass ? "Development authentication bypass" : "Authenticated session"}</small></span></header>
                <div className="admin-users-session">
                  <span className="admin-users-session__icon"><MonitorSmartphone size={22} /></span>
                  <span><strong>Current browser</strong><small>{auth.devBypass ? "Development mode" : `Signed in as ${displayName}`}</small></span>
                  <span className="admin-users-session__current"><i /> Current</span>
                </div>
                <p className="admin-users-section__note">Sign out ends this browser session.</p>
                <Button variant="danger" onClick={logout} disabled={busy || auth.devBypass}><LogOut size={16} /> Sign out</Button>
                {auth.devBypass ? <p className="admin-users-section__note">Sign-out is disabled while development authentication bypass is active.</p> : null}
              </section>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
