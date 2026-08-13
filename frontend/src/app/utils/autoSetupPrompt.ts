const AUTO_SETUP_PROMPT_STORAGE_KEY = 'sapp24-auto-setup-prompt-v1';

export const isAutoSetupPromptSuppressed = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(AUTO_SETUP_PROMPT_STORAGE_KEY) === 'done';
  } catch {
    return false;
  }
};

export const markAutoSetupPromptSuppressed = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(AUTO_SETUP_PROMPT_STORAGE_KEY, 'done');
  } catch {
    // ignore quota / private mode
  }
};

export const clearAutoSetupPromptSuppressed = () => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.removeItem(AUTO_SETUP_PROMPT_STORAGE_KEY);
  } catch {
    // ignore
  }
};

export { AUTO_SETUP_PROMPT_STORAGE_KEY };
