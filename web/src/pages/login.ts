export function render_login(root: HTMLElement): void {
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <span class="login-logo-mark" aria-hidden="true"></span>
        <div class="login-title">Dreamcatcher</div>
        <div class="login-sub">Sign in to triage your job alerts</div>
        <div style="margin-top: 1.75rem;">
          <a href="/auth/google" class="btn btn-primary btn-block">Sign in with Google</a>
        </div>

        <div class="login-privacy">
          <p class="login-privacy-lead">
            Nervous about giving an app access to your email? Good — you should be.
            Here's exactly what Dreamcatcher can and can't do, so you don't have to
            take my word for it.
          </p>
          <details class="login-privacy-more">
            <summary>What it can and can't see</summary>
            <ul>
              <li><strong>It can only read, never touch.</strong> Google won't let it send,
                delete, or change a single thing.</li>
              <li><strong>It only opens your job alerts.</strong> The search is locked to
                senders like LinkedIn and Indeed — it can't go looking through the rest of
                your inbox.</li>
              <li><strong>Your emails are never saved.</strong> It grabs the job title,
                company, and link, then throws the email away. Nothing you wrote or received
                is stored.</li>
              <li><strong>No human reads anything.</strong> Not me, not anyone.</li>
              <li><strong>You can check for yourself.</strong> The whole thing is open source,
                and you can download or delete everything it knows about you at any time.</li>
            </ul>
          </details>
          <p class="login-privacy-link">
            <a href="/privacy" target="_blank" rel="noopener">Read the full privacy policy</a>
          </p>
        </div>
      </div>
    </div>
  `;
}
