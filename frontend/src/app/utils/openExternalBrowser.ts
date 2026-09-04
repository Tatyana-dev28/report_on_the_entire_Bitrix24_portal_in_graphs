type DesktopWindow = Window & {
  BXDesktopSystem?: {
    BrowseURL?: (url: string) => void;
  };
  BX?: {
    desktop?: {
      browse?: (url: string) => void;
    };
  };
};

const tryDesktopBrowse = (win: Window, url: string) => {
  try {
    const desktopWindow = win as DesktopWindow;
    if (typeof desktopWindow.BXDesktopSystem?.BrowseURL === 'function') {
      desktopWindow.BXDesktopSystem.BrowseURL(url);
      return true;
    }

    if (typeof desktopWindow.BX?.desktop?.browse === 'function') {
      desktopWindow.BX.desktop.browse(url);
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

export const openExternalBrowserUrl = (url: string) => {
  if (tryDesktopBrowse(window, url)) {
    return true;
  }

  try {
    if (window.parent && window.parent !== window && tryDesktopBrowse(window.parent, url)) {
      return true;
    }
  } catch {
    // iframe is cross-origin; native link / window.open remain available
  }

  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened) {
    return true;
  }

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
};
