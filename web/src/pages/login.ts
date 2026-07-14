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

        <div class="login-privacy">
          <p class="login-privacy-lead">
            Dreamcatcher reads only the job-alert emails from sites like LinkedIn and
            Indeed — to pull out the listings, flag likely scams, and line them up so
            you can apply faster.
          </p>
          <details class="login-privacy-more">
            <summary>How it works &amp; your privacy</summary>
            <ul>
              <li><strong>Read-only.</strong> Google only lets it look at your mail. It can
                never send, delete, or change anything.</li>
              <li><strong>Only the alerts.</strong> It opens the emails from your job-alert
                senders and ignores the rest of your inbox.</li>
              <li><strong>Nothing is kept.</strong> It takes the job title, company, and link,
                then discards the email. Your messages are never saved on the server.</li>
              <li><strong>Never read by a person.</strong> No one running Dreamcatcher will
                ever open or look through your email.</li>
            </ul>
          </details>
        </div>
      </div>
    </div>
  `;
}
