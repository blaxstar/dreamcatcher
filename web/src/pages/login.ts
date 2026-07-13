export function render_login(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-logo-mark">dc</div>
        <div class="login-title">dreamcatcher</div>
        <div class="login-sub">sign in to triage your job alerts</div>
        <div style="margin-top: 1.75rem;">
          <a href="/auth/google" class="btn btn-primary btn-block">Sign in with Google</a>
        </div>
        <p class="form-hint" style="text-align: center; margin-top: 1rem;">
          grants read-only access to your gmail job alerts
        </p>
      </div>
    </div>
  `;
}
