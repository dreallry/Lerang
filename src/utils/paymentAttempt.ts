import type { WalletTransaction } from '../types';

export function topUpRequestId(amount: number, transactions: WalletTransaction[], cached: string, fresh: () => string) {
  const valid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const pending = transactions.find(transaction => transaction.tipe === 'topup' && transaction.status === 'pending' && transaction.nominal === amount && valid(transaction.request_id || ''));
  if (pending) return pending.request_id!;
  const previous = transactions.find(transaction => transaction.request_id === cached);
  return valid(cached) && !previous ? cached : fresh();
}
