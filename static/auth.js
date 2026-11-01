/**
 * auth.js — PIN & Passcode Security Controller for Linus
 */

window.LinusAuth = (() => {
  const STORAGE_KEY = 'linus_auth_token';
  const overlay = document.getElementById('linus-lock-overlay');
  const lockForm = document.getElementById('lock-form');
  const pinInput = document.getElementById('lock-pin-input');
  const errorMsg = document.getElementById('lock-error-msg');

  const settingsDialog = document.getElementById('pin-settings-dialog');
  const settingsCloseBtn = document.getElementById('pin-settings-close');
  const currentPinInput = document.getElementById('pin-current-input');
  const newPinInput = document.getElementById('pin-new-input');
  const savePinBtn = document.getElementById('pin-save-btn');
  const logoutBtn = document.getElementById('pin-logout-btn');
  const statusMsg = document.getElementById('pin-settings-status');

  function getStoredToken() {
    return localStorage.getItem(STORAGE_KEY) || '';
  }

  function setStoredToken(token) {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Check auth requirement on load
  async function checkAuthStatus() {
    try {
      const token = getStoredToken();
      const headers = token ? { 'X-Linus-Token': token } : {};
      const res = await fetch('/api/auth/status', { headers }).then(r => r.json());

      if (res.auth_required && !res.authenticated) {
        showLockOverlay();
      } else {
        hideLockOverlay();
      }
    } catch (e) {
      // Offline or error: do not block
    }
  }

  function showLockOverlay() {
    if (!overlay) return;
    overlay.classList.remove('hidden');
    if (errorMsg) errorMsg.classList.add('hidden');
    if (pinInput) {
      pinInput.value = '';
      setTimeout(() => pinInput.focus(), 100);
    }
  }

  function hideLockOverlay() {
    if (!overlay) return;
    overlay.classList.add('hidden');
  }

  // Handle PIN submission
  async function handleLogin() {
    const pin = (pinInput?.value || '').trim();
    if (!pin) return;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();

      if (res.ok && data.token) {
        setStoredToken(data.token);
        hideLockOverlay();
        window.showToast?.('🔓 Linus Unlocked');
      } else {
        if (errorMsg) {
          errorMsg.textContent = data.message || 'Incorrect passcode. Try again.';
          errorMsg.classList.remove('hidden');
        }
        if (pinInput) {
          pinInput.select();
        }
      }
    } catch (e) {
      if (errorMsg) {
        errorMsg.textContent = 'Connection error. Please try again.';
        errorMsg.classList.remove('hidden');
      }
    }
  }

  // Settings: Save / Change / Clear PIN
  async function handleSavePin() {
    const currentPin = (currentPinInput?.value || '').trim();
    const newPin = (newPinInput?.value || '').trim();

    try {
      const token = getStoredToken();
      const res = await fetch('/api/auth/set-pin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Linus-Token': token
        },
        body: JSON.stringify({ old_pin: currentPin, new_pin: newPin })
      });
      const data = await res.json();

      if (res.ok) {
        setStoredToken(data.token || '');
        if (statusMsg) {
          statusMsg.style.color = '#10b981';
          statusMsg.textContent = newPin ? '✅ Passcode enabled.' : '✅ Passcode removed.';
        }
        setTimeout(() => {
          settingsDialog?.close();
          if (statusMsg) statusMsg.textContent = '';
        }, 1200);
      } else {
        if (statusMsg) {
          statusMsg.style.color = '#ef4444';
          statusMsg.textContent = `❌ ${data.message || 'Failed to update passcode'}`;
        }
      }
    } catch (e) {
      if (statusMsg) {
        statusMsg.style.color = '#ef4444';
        statusMsg.textContent = '❌ Network error.';
      }
    }
  }

  async function handleLogout() {
    setStoredToken('');
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    settingsDialog?.close();
    showLockOverlay();
  }

  function init() {
    checkAuthStatus();

    lockForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogin();
    });

    document.getElementById('sidebar-security-btn')?.addEventListener('click', () => {
      if (currentPinInput) currentPinInput.value = '';
      if (newPinInput) newPinInput.value = '';
      if (statusMsg) statusMsg.textContent = '';
      settingsDialog?.showModal();
    });

    settingsCloseBtn?.addEventListener('click', () => {
      settingsDialog?.close();
    });

    savePinBtn?.addEventListener('click', handleSavePin);
    logoutBtn?.addEventListener('click', handleLogout);
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    checkAuthStatus,
    showLockOverlay,
    hideLockOverlay,
    logout: handleLogout
  };
})();
