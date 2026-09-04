export const copyTextToClipboard = async (
  text: string,
  visibleInput?: HTMLInputElement | HTMLTextAreaElement | null,
) => {
  const value = text.trim();
  if (!value) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Bitrix iframe often denies clipboard-write; fall back below.
  }

  const tryExecCommand = (field: HTMLInputElement | HTMLTextAreaElement) => {
    field.focus();
    field.select();
    field.setSelectionRange(0, value.length);
    return document.execCommand('copy');
  };

  if (visibleInput) {
    try {
      if (tryExecCommand(visibleInput)) {
        return true;
      }
    } catch {
      // continue to hidden field
    }
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.width = '1px';
  field.style.height = '1px';
  field.style.opacity = '0';
  document.body.appendChild(field);

  try {
    return tryExecCommand(field);
  } catch {
    return false;
  } finally {
    field.remove();
  }
};
