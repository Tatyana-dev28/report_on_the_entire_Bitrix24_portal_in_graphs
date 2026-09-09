export const FRIENDLY_BITRIX_RETRY_MESSAGE =
  'Битрикс24 сейчас не отдал данные. Предыдущий отчёт сохранён — попробуйте ещё раз через пару минут.';

export const FRIENDLY_RELOAD_REFRESH_MESSAGE =
  'Не удалось обновить данные. Обновите страницу и нажмите «Обновить сейчас».';

const looksLikeBitrixOrNetwork = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('bitrix')
    || normalized.includes('битрикс')
    || normalized.includes('crm.')
    || normalized.includes('query_limit')
    || normalized.includes('timeout')
    || normalized.includes('timed out')
    || normalized.includes('502')
    || normalized.includes('503')
    || normalized.includes('504')
    || normalized.includes('failed to fetch')
    || normalized.includes('networkerror')
    || normalized.includes('load failed')
    || normalized.includes('econnreset')
    || normalized.includes('returned ')
    || normalized.includes('limit is')
  );
};

const looksTechnical = (message: string) => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('traceback')
    || normalized.includes('exception')
    || normalized.includes('softtimelimit')
    || normalized.includes('operationalerror')
    || normalized.includes('json')
    || normalized.includes('undefined')
    || normalized.includes('typeerror')
    || normalized.includes('stack')
    || /[a-z]+error\b/.test(normalized)
    || /\b[a-z]+\.[a-z]+\.[a-z]+\b/.test(normalized)
  );
};

export const toFriendlyUserError = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const trimmed = message.trim();

  if (!trimmed) {
    return fallback;
  }

  if (
    trimmed.includes('попробуйте ещё раз')
    || trimmed.includes('Обновите страницу')
    || trimmed.includes('Обновить сейчас')
  ) {
    return trimmed;
  }

  if (looksLikeBitrixOrNetwork(trimmed)) {
    return FRIENDLY_BITRIX_RETRY_MESSAGE;
  }

  if (looksTechnical(trimmed)) {
    return fallback;
  }

  return trimmed;
};
