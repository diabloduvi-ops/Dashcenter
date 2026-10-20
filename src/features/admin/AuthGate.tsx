import { FormEvent, useState } from "react";
import { Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import type { AuthState } from "../../../shared/types";
import { DashcenterMark } from "../../components/DashcenterMark";
import { apiRequest } from "./api";
import { Button, Field, Notice } from "./ui";

interface AuthGateProps {
  auth: AuthState;
  onRefresh: () => Promise<void>;
}

export function AuthGate({ auth, onRefresh }: AuthGateProps) {
  const setup = auth.needsSetup;
  const [username, setUsername] = useState("admin");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [starter, setStarter] = useState<"empty" | "demo">("empty");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (setup && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiRequest(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(setup ? { username, displayName, password, starter } : { username, password }),
      });
      await onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-auth">
      <div className="admin-auth__backdrop" />
      <section className="admin-auth__card">
        <div className="admin-auth__brand">
          <DashcenterMark className="admin-brand-mark" size={38} />
          <span><strong>Dashcenter</strong><small>Dashboard</small></span>
        </div>
        <div className="admin-auth__icon">
          {setup ? <ShieldCheck size={30} /> : <LockKeyhole size={30} />}
        </div>
        <h1>{setup ? "Set up your dashboard" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Create the local administrator used to manage services, connections, and appearance."
            : auth.requireSignIn ? "Sign in to view your dashboard." : "Sign in to open the dashboard editor."}
        </p>
        <form className="admin-auth__form" onSubmit={submit}>
          {setup ? (
            <Field
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          ) : null}
          {setup ? (
            <fieldset className="admin-starter-choice">
              <legend>Starting dashboard</legend>
              <label><input type="radio" name="starter" value="empty" checked={starter === "empty"} onChange={() => setStarter("empty")} /> Empty board <small>Add your own services and widgets.</small></label>
              <label><input type="radio" name="starter" value="demo" checked={starter === "demo"} onChange={() => setStarter("demo")} /> Demo board <small>Try generic example links.</small></label>
            </fieldset>
          ) : null}
          <Field
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin"
            autoComplete="username"
            required
          />
          <label className="ui-field">
            <span className="ui-field__label">Password</span>
            <span className="ui-password">
              <KeyRound size={16} />
              <input
                className="ui-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={setup ? "new-password" : "current-password"}
                minLength={8}
                required
              />
              <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
          </label>
          {setup ? (
            <Field
              label="Confirm password"
              type={showPassword ? "text" : "password"}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          ) : null}
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : setup ? "Create administrator" : "Sign in"}
          </Button>
        </form>
        <footer>
          <ShieldCheck size={14} /> Credentials stay on this server.
        </footer>
      </section>
    </main>
  );
}
