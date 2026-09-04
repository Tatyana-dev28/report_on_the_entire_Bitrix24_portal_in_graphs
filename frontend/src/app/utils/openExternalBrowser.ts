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
  // Do not pass "noopener" as a window feature: in Bitrix webview that often
  // returns null and opens nothing. Null out opener after a successful open.
  const opened = window.open(url, '_blank');
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // ignore
    }
    return true;
  }

  if (tryDesktopBrowse(window, url)) {
    return true;
  }

  try {
    if (window.parent && window.parent !== window && tryDesktopBrowse(window.parent, url)) {
      return true;
    }
  } catch {
    // iframe is cross-origin
  }

  return false;
};
