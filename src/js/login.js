function initLogin(onLoggedIn) {
  const emailInput = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const rememberInput = document.getElementById('login-remember');
  const errorBox = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');

  async function submit() {
    errorBox.hidden = true;
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      errorBox.textContent = 'Enter both email and password.';
      errorBox.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
    try {
      const session = await window.api.auth.login(email, password, rememberInput.checked);
      onLoggedIn(session);
    } catch (err) {
      errorBox.textContent = describeAuthError(err);
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  }

  const showPasswordBtn = document.getElementById('login-show-password');
  showPasswordBtn.addEventListener('click', () => {
    const showing = passwordInput.type === 'text';
    passwordInput.type = showing ? 'password' : 'text';
    showPasswordBtn.textContent = showing ? 'Show' : 'Hide';
  });

  submitBtn.addEventListener('click', submit);
  passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  emailInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passwordInput.focus(); });
}

function describeAuthError(err) {
  const msg = (err && err.message) || '';
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.';
  if (/fetch|network|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'No connection — check your internet and try again.';
  return msg || 'Login failed. Please try again.';
}
