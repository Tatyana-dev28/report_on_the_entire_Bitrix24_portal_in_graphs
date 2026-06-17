import type { BitrixApi, BitrixMethodParams } from './bitrixTypes';

const getBitrixApi = (): BitrixApi | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.BX24 ?? null;
};

export const isBitrixAvailable = () => Boolean(getBitrixApi()?.callMethod);

export async function callBitrixMethod<T = unknown>(
  method: string,
  params: BitrixMethodParams = {},
): Promise<T> {
  const bx24 = getBitrixApi();

  if (!bx24?.callMethod) {
    throw new Error('BX24 API is not available');
  }

  return new Promise<T>((resolve, reject) => {
    try {
      bx24.callMethod<T>(method, params, (result) => {
        const error = result.error?.();

        if (error) {
          reject(new Error(result.error_description?.() ?? error));
          return;
        }

        resolve(result.data());
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function callBitrixBatch(
  calls: Record<string, [string, BitrixMethodParams]>,
): Promise<Record<string, unknown>> {
  const bx24 = getBitrixApi();

  const callBatch = bx24?.callBatch;

  if (!callBatch) {
    const entries = await Promise.all(
      Object.entries(calls).map(async ([key, [method, params]]) => [
        key,
        await callBitrixMethod(method, params),
      ]),
    );

    return Object.fromEntries(entries);
  }

  return new Promise((resolve, reject) => {
    try {
      callBatch(calls, (result) => {
        const data: Record<string, unknown> = {};

        Object.entries(result).forEach(([key, item]) => {
          const error = item.error?.();

          if (error) {
            data[key] = { error, message: item.error_description?.() };
            return;
          }

          data[key] = item.data();
        });

        resolve(data);
      });
    } catch (error) {
      reject(error);
    }
  });
}
